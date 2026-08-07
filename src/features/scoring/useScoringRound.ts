import { useEffect, useRef, useState } from 'react'
import { generateHand, type ScoringSituation } from '../../core/generateHand'
import {
  findMatchAsync,
  type MatchOptions,
  type MatchState,
  type WinRecord,
} from '../../core/match'
import { mulberry32 } from '../../core/rng'
import { scoreHand, type ScoreResult } from '../../core/score'
import { HONOR, serializeTenhou } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import type { Settings } from '../settings/settingsStore'
import { encodeScoringUrl, encodeScoringSeedUrl, type ScoringUrl } from './scoringUrl'

/** The whole scoring settings section, plus the ruleset the round runs under (which a shared
 *  link can pin, so it isn't a plain setting). */
export type RoundOptions = Settings['scoring'] & { sanma: boolean }

export interface Answer {
  han?: number
  fu?: number
  /** Single points field: the ron total, or what each payer owes on a dealer tsumo. */
  points?: number
  /** Non-dealer tsumo only: the two payments differ, so they're graded separately. */
  pointsMain?: number
  pointsFromDealer?: number
}

export interface RoundResult {
  answer: Answer
  actual: ScoreResult
  correctHan: boolean
  correctFu: boolean
  correctPoints: boolean
  correct: boolean
  situation: ScoringSituation
}

interface State {
  situation: ScoringSituation
  /** The hand that was actually played out, for the table. Null for a link-pinned hand and for
   *  the constructive fallback — neither has a match behind it. */
  match: MatchState | null
  /** Seat that won; the table seats the player there. */
  seat: number
  /** Seed that reproduces this exact match, for the share link. */
  matchSeed: string | null
  actual: ScoreResult
  elapsed: number
  checked: boolean
  lastResult: RoundResult | null
  /** Searching for a match. The board is not up yet, and the clock has not started. */
  loading: boolean
  /** The URL pinned a hand that has no legal win (bad tiles, or no yaku) — a generated hand is
   *  shown instead, and the page says so rather than silently swapping it. */
  invalidLink: boolean
}

const TICK_MS = 50

function scoreSituation(situation: ScoringSituation, options: RoundOptions): ScoreResult | null {
  return scoreHand({
    ...situation,
    rules: { kiriageMangan: options.kiriageMangan, honba: situation.honba, sanma: options.sanma },
  })
}

function matchOptions(seed: string, options: RoundOptions): MatchOptions {
  const rng = mulberry32(`${seed}:round`)
  return {
    sanma: options.sanma,
    aka: options.aka,
    // the round wind is part of the drill (it decides which wind pairs are yakuhai), so it
    // varies per hand — seeded, like everything else
    round: HONOR + Math.floor(rng() * 4),
    deadWall: true,
    calls: options.openHands,
    riichi: true,
    wins: true,
  }
}

function situationFromWin(win: WinRecord, seed: string, options: RoundOptions): ScoringSituation {
  // matches play a single hand, so there is no honba to inherit — it stays a seeded extra the
  // setting adds on top, exactly as the constructive generator did
  const rng = mulberry32(`${seed}:honba`)
  const honba = options.honba && rng() < 0.3 ? Math.floor(rng() * 3) + 1 : 0
  return {
    concealed: win.concealed,
    melds: win.melds,
    ctx: win.ctx,
    doraIndicators: win.doraIndicators,
    uraIndicators: win.uraIndicators,
    kita: win.kita,
    honba,
  }
}

/** Drives one hand of the scoring trainer: deal a match, answer, check, repeat. Unlike the
 *  shanten trainer's auto-advancing stream, `check` deliberately stops and waits for `next` —
 *  the feedback here (yaku list, fu breakdown) needs to be read, not just glanced at. */
export function useScoringRound(urlData: ScoringUrl, options: RoundOptions) {
  const [handIndex, setHandIndex] = useState(0)
  const stats = useSessionStats()
  const [state, setState] = useState<State | null>(null)
  const log = useLog((s) => s.log)
  // a resolution that arrives after the seed moved on belongs to a hand nobody is looking at
  const request = useRef(0)

  function fallbackHand(seed: string, invalidLink: boolean): State {
    const situation = generateHand(seed, options)
    return {
      situation,
      match: null,
      seat: situation.ctx.seat - HONOR,
      matchSeed: null,
      // generateHand only ever returns a scoreable situation, so this is non-null
      actual: scoreSituation(situation, options)!,
      elapsed: 0,
      checked: false,
      lastResult: null,
      loading: false,
      invalidLink,
    }
  }

  useEffect(() => {
    const id = ++request.current
    const pinned = urlData.situation
    const pinnedScore = pinned ? scoreSituation(pinned, options) : null
    if (pinned && pinnedScore) {
      stats.startClock()
      setState((prev) => ({
        situation: pinned,
        match: null,
        seat: pinned.ctx.seat - HONOR,
        matchSeed: null,
        actual: pinnedScore,
        elapsed: 0,
        checked: false,
        lastResult: prev?.lastResult ?? null,
        loading: false,
        invalidLink: false,
      }))
      return
    }

    const seed = `${urlData.seed || stats.randomSeed}:${handIndex}`
    const opts = matchOptions(seed, options)
    setState((prev) => (prev ? { ...prev, loading: true } : prev))
    void findMatchAsync(seed, options.sanma ? 3 : 4, opts, (outcome) =>
      outcome.state.win ? { win: outcome.state.win, state: outcome.state } : null,
    ).then((found) => {
      if (id !== request.current) return
      stats.startClock()
      if (!found) {
        // no seed in the budget produced a legal win: fall back to a constructed hand, which
        // is also the only way rare shapes (kokushi, yakuman) ever come up
        setState((prev) => ({ ...fallbackHand(seed, false), lastResult: prev?.lastResult ?? null }))
        return
      }
      const situation = situationFromWin(found.result.win, found.seed, options)
      setState((prev) => ({
        situation,
        match: found.result.state,
        seat: found.result.win.seat,
        matchSeed: found.seed,
        actual: scoreSituation(situation, options)!,
        elapsed: 0,
        checked: false,
        lastResult: prev?.lastResult ?? null,
        loading: false,
        invalidLink: pinned !== null,
      }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    urlData,
    handIndex,
    options.sanma,
    options.aka,
    options.openHands,
    options.honba,
    options.kiriageMangan,
  ])

  useEffect(() => {
    if (!state || state.checked || state.loading || !options.timerEnabled) return
    const id = setInterval(
      () => setState((s) => (s ? { ...s, elapsed: stats.elapsedNow() } : s)),
      TICK_MS,
    )
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.checked, state?.loading, options.timerEnabled])

  function check(answer: Answer) {
    if (!state || state.checked) return
    const { actual } = state

    const correctHan = !options.testHan || answer.han === actual.han
    const skipFu = options.ignoreFuOnLimit && actual.han >= 5
    const expectedFu = options.exactFu ? actual.fuExact : actual.fu
    const correctFu = !options.testFu || skipFu || answer.fu === expectedFu

    const split = actual.payments.fromDealer !== undefined
    const correctPoints =
      !options.testPoints ||
      (split
        ? answer.pointsMain === actual.payments.main &&
          answer.pointsFromDealer === actual.payments.fromDealer
        : answer.points === actual.payments.main)

    const correct = correctHan && correctFu && correctPoints
    const elapsed = stats.elapsedNow()

    // logged here (not from a page effect) so entries stay in play order; raw fields go
    // through as params rather than formatted text, so a later language switch re-translates
    log(
      'log.scoring.result',
      {
        hand: stats.totalCount + 1,
        correct,
        han: actual.han,
        timerEnabled: options.timerEnabled,
        elapsedMs: elapsed,
      },
      state.situation.concealed,
      serializeTenhou(state.situation.concealed),
    )
    stats.record(correct, elapsed)

    const result: RoundResult = {
      answer,
      actual,
      correctHan,
      correctFu,
      correctPoints,
      correct,
      situation: state.situation,
    }
    setState((s) => (s ? { ...s, checked: true, lastResult: result } : s))
  }

  return {
    // undefined only while the search is running; the page shows a dealing state instead
    situation: state?.situation,
    actual: state?.actual,
    match: state?.match ?? null,
    seat: state?.seat ?? 0,
    elapsed: state?.elapsed ?? 0,
    checked: state?.checked ?? false,
    lastResult: state?.lastResult ?? null,
    invalidLink: state?.invalidLink ?? false,
    loading: state === null || state.loading,
    /** Which hand is on screen right now — distinct from `totalCount`, which only bumps once
     *  a hand is checked, so it would otherwise jump ahead while the graded hand is still
     *  showing and "New Hand" hasn't been pressed yet. */
    handNumber: handIndex + 1,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    check,
    next: () => setHandIndex((n) => n + 1),
    /** A match reproduces from its seed alone, rivers and all, so that is the better link;
     *  a pinned or constructed hand has no match behind it and ships its tiles instead. */
    situationQuery: () =>
      state?.matchSeed
        ? encodeScoringSeedUrl(state.matchSeed, options)
        : state
          ? encodeScoringUrl(state.situation, options.sanma)
          : '',
  }
}
