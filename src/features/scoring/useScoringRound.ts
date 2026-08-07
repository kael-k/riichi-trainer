import { useEffect, useState } from 'react'
import { generateHand, type ScoringSituation } from '../../core/generateHand'
import { scoreHand, type ScoreResult } from '../../core/score'
import { serializeTenhou } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import type { Settings } from '../settings/settingsStore'
import { encodeScoringUrl, type ScoringUrl } from './scoringUrl'

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
  actual: ScoreResult
  elapsed: number
  checked: boolean
  lastResult: RoundResult | null
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

/** Drives one hand of the scoring trainer: load, answer, check, repeat. Unlike the shanten
 *  trainer's auto-advancing stream, `check` deliberately stops and waits for `next` — the
 *  feedback here (yaku list, fu breakdown) needs to be read, not just glanced at. */
export function useScoringRound(urlData: ScoringUrl, options: RoundOptions) {
  const [handIndex, setHandIndex] = useState(0)
  const stats = useSessionStats()
  const [state, setState] = useState<State>(() => nextHand())
  const log = useLog((s) => s.log)

  function nextHand(prev?: State): State {
    stats.startClock()
    const pinned = urlData.situation
    const pinnedScore = pinned ? scoreSituation(pinned, options) : null
    const situation =
      pinnedScore !== null && pinned !== null
        ? pinned
        : generateHand(`${urlData.seed || stats.randomSeed}:${handIndex}`, options)
    return {
      situation,
      // generateHand only ever returns a scoreable situation, so this is non-null either way
      actual: pinnedScore ?? scoreSituation(situation, options)!,
      elapsed: 0,
      checked: false,
      lastResult: prev?.lastResult ?? null,
      invalidLink: pinned !== null && pinnedScore === null,
    }
  }

  useEffect(() => {
    setState((s) => nextHand(s))
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
    if (state.checked || !options.timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: stats.elapsedNow() })), TICK_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.checked, options.timerEnabled])

  function check(answer: Answer) {
    if (state.checked) return
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
    setState((s) => ({ ...s, checked: true, lastResult: result }))
  }

  return {
    ...state,
    /** Which hand is on screen right now — distinct from `totalCount`, which only bumps once
     *  a hand is checked, so it would otherwise jump ahead while the graded hand is still
     *  showing and "New Hand" hasn't been pressed yet. */
    handNumber: handIndex + 1,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    check,
    next: () => setHandIndex((n) => n + 1),
    situationQuery: () => encodeScoringUrl(state.situation, options.sanma),
  }
}
