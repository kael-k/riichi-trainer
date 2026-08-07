import { useEffect, useRef, useState } from 'react'
import { generateHand, type ScoringSituation } from '../../core/generateHand'
import { scoreHand, type ScoreResult } from '../../core/score'
import { serializeTenhou } from '../../core/tiles'
import { useLog } from '../../store/log'
import { encodeScoringUrl, type ScoringUrl } from './scoringUrl'

export interface RoundOptions {
  sanma: boolean
  aka: boolean
  openHands: boolean
  honba: boolean
  kiriageMangan: boolean
  exactFu: boolean
  ignoreFuOnLimit: boolean
  testHan: boolean
  testFu: boolean
  testPoints: boolean
}

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
    concealed: situation.concealed,
    melds: situation.melds,
    ctx: situation.ctx,
    doraIndicators: situation.doraIndicators,
    uraIndicators: situation.uraIndicators,
    kita: situation.kita,
    rules: { kiriageMangan: options.kiriageMangan, honba: situation.honba, sanma: options.sanma },
  })
}

/** Drives one hand of the scoring trainer: load, answer, check, repeat. Unlike the shanten
 *  trainer's auto-advancing stream, `check` deliberately stops and waits for `next` — the
 *  feedback here (yaku list, fu breakdown) needs to be read, not just glanced at. */
export function useScoringRound(urlData: ScoringUrl, options: RoundOptions, timerEnabled: boolean) {
  const [handIndex, setHandIndex] = useState(0)
  // stable per mount, so an unspecified seed still gets a fresh hand each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const [correctCount, setCorrectCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  const startedAt = useRef(0)
  const [state, setState] = useState<State>(() => nextHand())
  const log = useLog((s) => s.log)
  const entryCount = useLog((s) => s.entries.length)

  function elapsedNow(): number {
    return performance.now() - startedAt.current
  }

  function nextHand(prev?: State): State {
    startedAt.current = performance.now()
    const pinned = urlData.situation
    const pinnedScore = pinned ? scoreSituation(pinned, options) : null
    const situation =
      pinnedScore !== null && pinned !== null
        ? pinned
        : generateHand(`${urlData.seed || randomSeed}:${handIndex}`, {
            sanma: options.sanma,
            aka: options.aka,
            openHands: options.openHands,
            honba: options.honba,
          })
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
    if (state.checked || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: elapsedNow() })), TICK_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.checked, timerEnabled])

  // clearing the log clears the session it recorded: score and average go with it
  useEffect(() => {
    if (entryCount > 0) return
    setCorrectCount(0)
    setTotalCount(0)
    setTotalTime(0)
  }, [entryCount])

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
    const elapsed = elapsedNow()

    // logged here (not from a page effect) so entries stay in play order; raw fields go
    // through as params rather than formatted text, so a later language switch re-translates
    log(
      'log.scoring.result',
      { hand: totalCount + 1, correct, han: actual.han, timerEnabled, elapsedMs: elapsed },
      state.situation.concealed,
      serializeTenhou(state.situation.concealed),
    )
    setTotalCount((n) => n + 1)
    setTotalTime((t) => t + elapsed)
    if (correct) setCorrectCount((n) => n + 1)

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
    correctCount,
    totalCount,
    /** Mean time per graded hand, in milliseconds. */
    averageTime: totalCount > 0 ? totalTime / totalCount : 0,
    check,
    next: () => setHandIndex((n) => n + 1),
    situationQuery: () => encodeScoringUrl(state.situation, options.sanma),
  }
}
