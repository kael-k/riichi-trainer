import { useEffect, useRef, useState } from 'react'
import { addTile, createHand, type Hand } from '../../core/hand'
import { chiitoiShanten, kokushiShanten, standardShanten } from '../../core/shanten'
import { NUM_TILE_TYPES, type ParsedTile } from '../../core/tiles'
import { deal, INITIAL_HAND_SIZE } from '../../core/wall'
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
}

interface State {
  hand: ParsedTile[]
  running: boolean
  elapsed: number
  result: RoundResult | null
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

/** Drives one shanten guess at a time: concealed hand, reveal/pause, answer, next hand. */
export function useShantenRound(situation: Situation, timerEnabled: boolean) {
  const [handIndex, setHandIndex] = useState(0)
  // stable per mount, so an unspecified seed still gets a fresh hand each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const [correctCount, setCorrectCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const handRef = useRef<Hand>(undefined)
  const [state, setState] = useState<State>(() => nextHand())

  function nextHand(): State {
    const seed = `${situation.seed || randomSeed}:${handIndex}`
    if (situation.hand.length === INITIAL_HAND_SIZE) {
      const hand = createHand()
      for (const t of situation.hand) addTile(hand, t.id)
      handRef.current = hand
      // keep the situation's tiles (not counts) so red-five flags survive to display
      const tiles = [...situation.hand].sort((a, b) => a.id - b.id)
      return { hand: tiles, running: false, elapsed: 0, result: null }
    }
    const hand = deal(seed, INITIAL_HAND_SIZE).hand
    handRef.current = hand
    return { hand: handToTiles(hand), running: false, elapsed: 0, result: null }
  }

  useEffect(() => {
    setState(nextHand())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, handIndex])

  useEffect(() => {
    if (!state.running || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })), 1000)
    return () => clearInterval(id)
  }, [state.running, timerEnabled])

  return {
    ...state,
    concealed: !state.running && !state.result,
    correctCount,
    totalCount,
    reveal: () => setState((s) => (s.result ? s : { ...s, running: true })),
    pause: () => setState((s) => (s.result ? s : { ...s, running: false })),
    submit: (guess: number) => {
      if (state.result || !state.running || !handRef.current) return
      const actual = computeBreakdown(handRef.current)
      const correct = guess === actual.value
      setTotalCount((n) => n + 1)
      if (correct) setCorrectCount((n) => n + 1)
      setState((s) => ({ ...s, running: false, result: { guess, actual, correct } }))
    },
    newHand: () => setHandIndex((n) => n + 1),
  }
}
