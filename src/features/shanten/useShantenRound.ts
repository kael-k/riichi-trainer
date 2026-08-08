import { useEffect, useRef, useState } from 'react'
import { addTile, createHand, handToTiles, type Hand } from '../../core/hand'
import { chiitoiShanten, kokushiShanten, standardShanten } from '../../core/shanten'
import { serializeTenhou, type ParsedTile } from '../../core/tiles'
import { deal, INITIAL_HAND_SIZE } from '../../core/wall'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import { encodeSituation, type Situation } from '../situation/urlCodec'

export type ShantenPath = 'standard' | 'chiitoitsu' | 'kokushi'

export interface ShantenBreakdown {
  value: number
  /** Every formula that reaches the minimum; usually just `standard`. */
  paths: ShantenPath[]
}

export interface RoundResult {
  guess: number
  actual: ShantenBreakdown
  correct: boolean
  /** The hand that was graded — the next one is already on screen by then. */
  hand: ParsedTile[]
}

interface State {
  hand: ParsedTile[]
  running: boolean
  /** Time on the current hand, in milliseconds. */
  elapsed: number
  /** Feedback for the previous guess; never blocks the current hand. */
  lastResult: RoundResult | null
}

/** Display refresh of the live timer; the graded time itself is read from the
 *  clock at submit, so it never inherits this granularity. */
const TICK_MS = 50

function computeBreakdown(hand: Hand): ShantenBreakdown {
  const standard = standardShanten(hand)
  const chiitoitsu = chiitoiShanten(hand)
  const kokushi = kokushiShanten(hand)
  const value = Math.min(standard, chiitoitsu, kokushi)
  const paths: ShantenPath[] = []
  if (standard === value) paths.push('standard')
  if (chiitoitsu === value) paths.push('chiitoitsu')
  if (kokushi === value) paths.push('kokushi')
  return { value, paths }
}

/** Drives a continuous stream of hands: reveal once, then guess after guess with
 *  the feedback for the last one alongside the hand already dealt. */
export function useShantenRound(situation: Situation, timerEnabled: boolean, sanma: boolean) {
  const [handIndex, setHandIndex] = useState(0)
  // handIndex counts hands dealt this mount, but a link (or a rewind out of the log) names one
  // exact hand, which only the index-0 deal below shows. Reset it whenever the situation changes
  // identity — the "adjust state while rendering" pattern the other trainers use
  const [lastSituation, setLastSituation] = useState(situation)
  if (situation !== lastSituation) {
    setLastSituation(situation)
    setHandIndex(0)
  }
  const stats = useSessionStats()
  const handRef = useRef<Hand>(undefined)
  const [state, setState] = useState<State>(() => nextHand())
  const log = useLog((s) => s.log)

  /** Deals the hand for the current `handIndex`, carrying over whether the stream is
   *  running and the pending feedback so an answered hand rolls straight into the next. */
  function nextHand(prev?: State): State {
    // there is no pause, so one clock reading is the whole timer
    stats.startClock()
    const carry = {
      running: prev?.running ?? false,
      elapsed: 0,
      lastResult: prev?.lastResult ?? null,
    }
    const seed = `${situation.seed || stats.randomSeed}:${handIndex}`
    // a pinned hand is the hand the link names, not every hand from here on: it is shown once and
    // the stream carries on dealing from the seed, so a rewind doesn't freeze the trainer
    if (handIndex === 0 && situation.hand.length === INITIAL_HAND_SIZE) {
      const hand = createHand()
      for (const t of situation.hand) addTile(hand, t.id)
      handRef.current = hand
      // keep the situation's tiles (not counts) so red-five flags survive to display
      return { hand: [...situation.hand].sort((a, b) => a.id - b.id), ...carry }
    }
    const hand = deal(seed, INITIAL_HAND_SIZE, sanma)
    handRef.current = hand
    return { hand: handToTiles(hand), ...carry }
  }

  useEffect(() => {
    setState((s) => nextHand(s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, handIndex, sanma])

  useEffect(() => {
    if (!state.running || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: stats.elapsedNow() })), TICK_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.running, timerEnabled])

  return {
    ...state,
    concealed: !state.running,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    reveal: () =>
      setState((s) => {
        if (s.running) return s
        stats.startClock()
        return { ...s, running: true }
      }),
    /** Abandons the current hand: re-conceals, drops the timer, deals a fresh one —
     *  a peeked hand can't be timed again, so there is nothing to resume. */
    stop: () => {
      setState((s) => ({ ...s, running: false, elapsed: 0 }))
      setHandIndex((n) => n + 1)
    },
    submit: (guess: number) => {
      if (!state.running || !handRef.current) return
      const actual = computeBreakdown(handRef.current)
      const correct = guess === actual.value
      const elapsed = stats.elapsedNow()
      // logged here rather than from a page effect, so entries stay in play order. Raw paths/
      // correct/timerEnabled/elapsed go through as params (not formatted text) so a later
      // language switch re-translates the line instead of leaving stale fragments — see
      // formatLogEntry's special case for this key.
      log(
        'log.shanten.result',
        {
          hand: stats.totalCount + 1,
          guess,
          actual: actual.value,
          paths: actual.paths,
          correct,
          timerEnabled,
          elapsedMs: elapsed,
        },
        state.hand,
        serializeTenhou(state.hand),
        // the hand as it was asked, so the row rewinds (and shares) back to this exact deal —
        // the tiles pin it outright, which is why no seed replay is involved
        encodeSituation({ ...situation, hand: state.hand, wall: [], river: [] }),
      )
      stats.record(correct, elapsed)
      // keep running: the feedback rides along with the hand dealt by the index bump
      setState((s) => ({ ...s, lastResult: { guess, actual, correct, hand: s.hand } }))
      setHandIndex((n) => n + 1)
    },
  }
}
