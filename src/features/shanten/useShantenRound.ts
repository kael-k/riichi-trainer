import { useEffect, useRef, useState } from 'react'
import { addTile, createHand, type Hand } from '../../core/hand'
import { chiitoiShanten, kokushiShanten, standardShanten } from '../../core/shanten'
import { NUM_TILE_TYPES, serializeTenhou, type ParsedTile } from '../../core/tiles'
import { deal, INITIAL_HAND_SIZE } from '../../core/wall'
import { formatElapsed } from '../../lib/formatElapsed'
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
  elapsed: number
  /** Feedback for the previous guess; never blocks the current hand. */
  lastResult: RoundResult | null
}

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
export function useShantenRound(situation: Situation, timerEnabled: boolean) {
  const [handIndex, setHandIndex] = useState(0)
  // stable per mount, so an unspecified seed still gets a fresh hand each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const [correctCount, setCorrectCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const handRef = useRef<Hand>(undefined)
  const [state, setState] = useState<State>(() => nextHand())
  const log = useLog((s) => s.log)

  /** Deals the hand for the current `handIndex`, carrying over whether the stream is
   *  running and the pending feedback so an answered hand rolls straight into the next. */
  function nextHand(prev?: State): State {
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
    const hand = deal(seed, INITIAL_HAND_SIZE).hand
    handRef.current = hand
    return { hand: handToTiles(hand), ...carry }
  }

  useEffect(() => {
    setState((s) => nextHand(s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, handIndex])

  useEffect(() => {
    if (!state.running || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })), 1000)
    return () => clearInterval(id)
  }, [state.running, timerEnabled])

  return {
    ...state,
    concealed: !state.running,
    correctCount,
    totalCount,
    reveal: () => setState((s) => ({ ...s, running: true })),
    pause: () => setState((s) => ({ ...s, running: false })),
    submit: (guess: number) => {
      if (!state.running || !handRef.current) return
      const actual = computeBreakdown(handRef.current)
      const correct = guess === actual.value
      // logged here rather than from a page effect, so entries stay in play order
      const paths = actual.paths.join(' / ')
      const via = paths === 'standard' ? '' : ` (via ${paths})`
      const time = timerEnabled ? ` in ${formatElapsed(state.elapsed)}` : ''
      log(
        `Hand ${totalCount + 1}: guessed ${guess}, actual ${actual.value}${via} — ${correct ? 'correct' : 'wrong'}${time}`,
        state.hand,
        serializeTenhou(state.hand),
      )
      setTotalCount((n) => n + 1)
      if (correct) setCorrectCount((n) => n + 1)
      // keep running: the feedback rides along with the hand dealt by the index bump
      setState((s) => ({ ...s, lastResult: { guess, actual, correct, hand: s.hand } }))
      setHandIndex((n) => n + 1)
    },
  }
}
