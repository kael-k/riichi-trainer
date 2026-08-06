import { useEffect, useRef, useState } from 'react'
import { addTile, createHand, type Hand } from '../../core/hand'
import { chiitoiShanten, kokushiShanten, standardShanten } from '../../core/shanten'
import { NUM_TILE_TYPES, serializeTenhou, type ParsedTile } from '../../core/tiles'
import { deal, INITIAL_HAND_SIZE } from '../../core/wall'
import { useLog } from '../../store/log'
import type { Situation } from '../situation/urlCodec'

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

function handToTiles(hand: Hand): ParsedTile[] {
  const tiles: ParsedTile[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    for (let k = 0; k < hand.counts[id]; k++) tiles.push({ id, red: false })
  }
  return tiles
}

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
  // stable per mount, so an unspecified seed still gets a fresh hand each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const [correctCount, setCorrectCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  const handRef = useRef<Hand>(undefined)
  // clock reading the current hand was revealed at; there is no pause, so one
  // reading is the whole timer
  const startedAt = useRef(0)
  const [state, setState] = useState<State>(() => nextHand())
  const log = useLog((s) => s.log)
  const entryCount = useLog((s) => s.entries.length)

  function elapsedNow(): number {
    return performance.now() - startedAt.current
  }

  /** Deals the hand for the current `handIndex`, carrying over whether the stream is
   *  running and the pending feedback so an answered hand rolls straight into the next. */
  function nextHand(prev?: State): State {
    startedAt.current = performance.now()
    const carry = {
      running: prev?.running ?? false,
      elapsed: 0,
      lastResult: prev?.lastResult ?? null,
    }
    const seed = `${situation.seed || randomSeed}:${handIndex}`
    if (situation.hand.length === INITIAL_HAND_SIZE) {
      const hand = createHand()
      for (const t of situation.hand) addTile(hand, t.id)
      handRef.current = hand
      // keep the situation's tiles (not counts) so red-five flags survive to display
      return { hand: [...situation.hand].sort((a, b) => a.id - b.id), ...carry }
    }
    const hand = deal(seed, INITIAL_HAND_SIZE, sanma).hand
    handRef.current = hand
    return { hand: handToTiles(hand), ...carry }
  }

  useEffect(() => {
    setState((s) => nextHand(s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, handIndex, sanma])

  useEffect(() => {
    if (!state.running || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: elapsedNow() })), TICK_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.running, timerEnabled])

  // clearing the log clears the session it recorded: score and average go with it
  useEffect(() => {
    if (entryCount > 0) return
    setCorrectCount(0)
    setTotalCount(0)
    setTotalTime(0)
  }, [entryCount])

  return {
    ...state,
    concealed: !state.running,
    correctCount,
    totalCount,
    /** Mean time per graded hand, in milliseconds. */
    averageTime: totalCount > 0 ? totalTime / totalCount : 0,
    reveal: () =>
      setState((s) => {
        if (s.running) return s
        startedAt.current = performance.now()
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
      const elapsed = elapsedNow()
      // logged here rather than from a page effect, so entries stay in play order. Raw paths/
      // correct/timerEnabled/elapsed go through as params (not formatted text) so a later
      // language switch re-translates the line instead of leaving stale fragments — see
      // formatLogEntry's special case for this key.
      log(
        'log.shanten.result',
        {
          hand: totalCount + 1,
          guess,
          actual: actual.value,
          paths: actual.paths,
          correct,
          timerEnabled,
          elapsedMs: elapsed,
        },
        state.hand,
        serializeTenhou(state.hand),
      )
      setTotalCount((n) => n + 1)
      setTotalTime((t) => t + elapsed)
      if (correct) setCorrectCount((n) => n + 1)
      // keep running: the feedback rides along with the hand dealt by the index bump
      setState((s) => ({ ...s, lastResult: { guess, actual, correct, hand: s.hand } }))
      setHandIndex((n) => n + 1)
    },
  }
}
