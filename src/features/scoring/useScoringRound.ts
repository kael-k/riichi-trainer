import { useEffect, useRef, useState } from 'react'
import { generateHand, type ScoringSituation } from '../../core/generateHand'
import {
  playWall,
  type MatchOptions,
  type MatchOutcome,
  type MatchState,
  type WinRecord,
} from '../../core/match'
import { mulberry32 } from '../../core/rng'
import { scoreHand, type ScoreResult } from '../../core/score'
import { HONOR, serializeTenhou, serializeTenhouOrdered, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import type { Settings } from '../settings/settingsStore'
import type { AgariCall } from '../table/useTableRound'
import { completeWall } from '../../core/wall'
import { encodeScoringUrl, encodeScoringWallUrl, type ScoringUrl } from './scoringUrl'

/** The whole scoring settings section, plus the ruleset the round runs under (which a shared
 *  link can pin, so it isn't a plain setting) and the global red-fives toggle. */
export type RoundOptions = Settings['scoring'] & { sanma: boolean; aka: boolean }

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
  /** Wall that reproduces this exact match, for the share link (D-09) — replaces the old
   *  seed-based record, which searched seed suffixes rather than random walls. */
  matchWall: ParsedTile[] | null
  actual: ScoreResult
  checked: boolean
  lastResult: RoundResult | null
  /** Searching for a match. The board is not up yet, and the clock has not started. */
  loading: boolean
  /** The URL pinned a hand (or wall) with no legal win — a generated hand is shown instead, and
   *  the page says so rather than silently swapping it. */
  invalidLink: boolean
}

const MAX_ATTEMPTS = 40

function scoreSituation(situation: ScoringSituation, options: RoundOptions): ScoreResult | null {
  return scoreHand({
    ...situation,
    rules: { kiriageMangan: options.kiriageMangan, honba: situation.honba, sanma: options.sanma },
  })
}

/** The board's own draw-order content, standing in for the seed a wall-based match no longer
 *  carries (D-09) — the same wall always hashes to the same key, which is what lets `matchOptions`
 *  and `situationFromWin` reproduce the same round wind and honba roll from the wall alone. */
function wallKey(wall: ParsedTile[]): string {
  return serializeTenhouOrdered(wall)
}

function matchOptions(wall: ParsedTile[], options: RoundOptions): MatchOptions {
  const rng = mulberry32(`${wallKey(wall)}:round`)
  return {
    sanma: options.sanma,
    aka: options.aka,
    // the round wind is part of the drill (it decides which wind pairs are yakuhai), so it
    // varies per hand — derived from the wall itself, like everything else about the round
    round: HONOR + Math.floor(rng() * 4),
    deadWall: true,
    calls: options.openHands,
    riichi: true,
    wins: true,
  }
}

function situationFromWin(
  win: WinRecord,
  wall: ParsedTile[],
  options: RoundOptions,
): ScoringSituation {
  // matches play a single hand, so there is no honba to inherit — it stays a wall-seeded extra
  // the setting adds on top, exactly as the constructive generator did
  const rng = mulberry32(`${wallKey(wall)}:honba`)
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

/** Deals a fresh random wall (D-09: generation via random walls, not seed suffixes) and plays it
 *  out, until `accept` takes one — `findMatchAsync`'s shape (capped attempts, yielding between
 *  them), but each attempt is an independently random wall rather than a seed suffix, since walls
 *  are no longer named by a seed. */
async function findWall(
  players: number,
  options: RoundOptions,
  accept: (outcome: MatchOutcome) => WinRecord | null,
  maxAttempts = MAX_ATTEMPTS,
): Promise<{ win: WinRecord; wall: ParsedTile[]; match: MatchState } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const wall = completeWall([], options.sanma, options.aka)
    const outcome = playWall(wall, players, matchOptions(wall, options))
    const win = accept(outcome)
    if (win) return { win, wall, match: outcome.state }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return null
}

/** Drives one hand of the scoring trainer: deal a match, answer, check, repeat. Unlike the
 *  shanten trainer's auto-advancing stream, `check` deliberately stops and waits for `next` —
 *  the feedback here (yaku list, fu breakdown) needs to be read, not just glanced at. */
export function useScoringRound(urlData: ScoringUrl, options: RoundOptions) {
  const [handIndex, setHandIndex] = useState(0)
  // handIndex is per-mount state that counts "next hand" presses, but a link (or a rewind out of
  // the log) already names one exact hand — carrying a stale index into it would deal a different
  // one on top of what the link named. Reset it whenever the link changes identity, the "adjust
  // state while rendering" pattern
  const [lastUrlData, setLastUrlData] = useState(urlData)
  if (urlData !== lastUrlData) {
    setLastUrlData(urlData)
    setHandIndex(0)
  }
  const stats = useSessionStats()
  const [state, setState] = useState<State | null>(null)
  const log = useLog((s) => s.log)
  // a resolution that arrives after the seed moved on belongs to a hand nobody is looking at
  const request = useRef(0)
  // the wall/match/invalidLink a pending win came from — stashed immediately before invoking
  // `onAgariCall` below, since `AgariCall`'s signature (`(win: WinRecord) => void`, shared with
  // `useTableRound`) carries only the WinRecord itself
  const pending = useRef<{ wall: ParsedTile[]; match: MatchState | null; invalidLink: boolean }>({
    wall: [],
    match: null,
    invalidLink: false,
  })

  function fallbackHand(seed: string, invalidLink: boolean): State {
    const situation = generateHand(seed, options)
    return {
      situation,
      match: null,
      seat: situation.ctx.seat - HONOR,
      matchWall: null,
      // generateHand only ever returns a scoreable situation, so this is non-null
      actual: scoreSituation(situation, options)!,
      checked: false,
      lastResult: null,
      loading: false,
      invalidLink,
    }
  }

  // scoring never re-touches its match after generation (D-07) — this is its one entry point,
  // typed with `AgariCall` to match the contract `useTableRound` hands its own consumers. Nothing
  // else in this hook reads `outcome.state.win`/`win` directly.
  const onAgariCall: AgariCall = (win) => {
    const { wall, match, invalidLink } = pending.current
    const situation = situationFromWin(win, wall, options)
    setState((prev) => ({
      situation,
      match,
      seat: win.seat,
      matchWall: wall,
      actual: scoreSituation(situation, options)!,
      checked: false,
      lastResult: prev?.lastResult ?? null,
      loading: false,
      invalidLink,
    }))
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
        matchWall: null,
        actual: pinnedScore,
        checked: false,
        lastResult: prev?.lastResult ?? null,
        loading: false,
        invalidLink: false,
      }))
      return
    }

    const players = options.sanma ? 3 : 4
    const fallbackSeed = `${stats.randomSeed}:${handIndex}`

    if (urlData.wall.length > 0) {
      const outcome = playWall(urlData.wall, players, matchOptions(urlData.wall, options))
      if (outcome.state.win) {
        stats.startClock()
        pending.current = { wall: urlData.wall, match: outcome.state, invalidLink: pinned !== null }
        onAgariCall(outcome.state.win)
        return
      }
      // this specific wall has no legal win: fall through to the random search below, exactly as
      // a pinned situation with no legal score does today
    }

    setState((prev) => (prev ? { ...prev, loading: true } : prev))
    void findWall(players, options, (outcome) => outcome.state.win ?? null).then((found) => {
      if (id !== request.current) return
      stats.startClock()
      if (!found) {
        // no attempt in the budget produced a legal win: fall back to a constructed hand, which
        // is also the only way rare shapes (kokushi, yakuman) ever come up
        setState((prev) => ({
          ...fallbackHand(fallbackSeed, false),
          lastResult: prev?.lastResult ?? null,
        }))
        return
      }
      pending.current = {
        wall: found.wall,
        match: found.match,
        invalidLink: urlData.wall.length > 0 || pinned !== null,
      }
      onAgariCall(found.win)
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

  /** Current hand as a shareable query string. A match reproduces from its wall, rivers and all,
   *  so that is the better link; a pinned or constructed hand has no match behind it and ships
   *  its tiles instead. */
  function situationQuery(): string {
    return state?.matchWall
      ? encodeScoringWallUrl(state.matchWall, options)
      : state
        ? encodeScoringUrl(state.situation, options.sanma)
        : ''
  }

  function check(answer: Answer) {
    if (!state || state.checked) return
    const { actual } = state
    // captured before the state update below moves the round on to "checked"
    const situationBefore = situationQuery()

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
      situationBefore,
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
    elapsedNow: stats.elapsedNow,
    /** Whether the clock is ticking: a board is up, unanswered and unpaused. */
    running: !!state && !state.checked && !state.loading && !stats.paused,
    checked: state?.checked ?? false,
    lastResult: state?.lastResult ?? null,
    invalidLink: state?.invalidLink ?? false,
    loading: state === null || state.loading,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    paused: stats.paused,
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    check,
    next: () => setHandIndex((n) => n + 1),
    situationQuery,
  }
}
