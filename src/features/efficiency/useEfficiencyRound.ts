import { useEffect, useRef, useState } from 'react'
import { evaluateDiscards, type DiscardOption } from '../../core/efficiency'
import { addTile, createHand, removeTile, tileCount, type Hand } from '../../core/hand'
import { NUM_TILE_TYPES, type ParsedTile, type TileId } from '../../core/tiles'
import { buildWall } from '../../core/wall'
import { allTiles, type Situation } from '../situation/urlCodec'

export interface TurnResult {
  turn: number
  yours: DiscardOption
  best: DiscardOption
}

interface RoundState {
  hand: ParsedTile[]
  turn: number
  lastResult: TurnResult | null
  cumulativeLost: number
  finished: boolean
}

function handToTiles(hand: Hand): ParsedTile[] {
  const tiles: ParsedTile[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    for (let k = 0; k < hand.counts[id]; k++) tiles.push({ id, red: false })
  }
  return tiles
}

/** Draw order for a round: the situation's explicit wall prefix, then the seeded pool
 *  minus every tile the situation already pins down (hand/wall/rivers). */
function buildRoundWall(situation: Situation, seed: string): TileId[] {
  const used = new Uint8Array(NUM_TILE_TYPES)
  for (const t of allTiles(situation)) used[t.id]++
  const pool = buildWall(seed).filter((id) => {
    if (used[id] === 0) return true
    used[id]--
    return false
  })
  return [...situation.wall.map((t) => t.id), ...pool]
}

/** Drives one efficiency round: deal, discard, draw, repeat, until `totalTurns` or the wall runs dry. */
export function useEfficiencyRound(situation: Situation, totalTurns: number) {
  const [restartCount, setRestartCount] = useState(0)
  const round = useRef<{ hand: Hand; wall: TileId[]; discards: Uint8Array }>(undefined)
  const [state, setState] = useState<RoundState>(() => startRound())

  function startRound(): RoundState {
    const seed = `${situation.seed || 'efficiency-demo'}:${restartCount}`
    const wall = buildRoundWall(situation, seed)
    const hand = createHand()
    for (const t of situation.hand) addTile(hand, t.id)
    let cursor = 0
    while (tileCount(hand) < 14) addTile(hand, wall[cursor++])
    round.current = { hand, wall: wall.slice(cursor), discards: new Uint8Array(NUM_TILE_TYPES) }
    return {
      hand: handToTiles(hand),
      turn: 1,
      lastResult: null,
      cumulativeLost: 0,
      finished: false,
    }
  }

  useEffect(() => {
    setState(startRound())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, totalTurns, restartCount])

  function discard(index: number) {
    const r = round.current
    if (!r || state.finished) return
    const tile = state.hand[index]

    const visible = new Uint8Array(NUM_TILE_TYPES)
    for (let i = 0; i < NUM_TILE_TYPES; i++) visible[i] = r.hand.counts[i] + r.discards[i]
    const options = evaluateDiscards(r.hand, visible)
    const yours = options.find((o) => o.discard === tile.id)!
    const best = options[0]

    removeTile(r.hand, tile.id)
    r.discards[tile.id]++
    // ukeire counts only compare directly at the same shanten (best is always <= yours,
    // since options are sorted shanten-first); a worse shanten forfeits the whole ukeire gap
    const lost =
      yours.shanten > best.shanten ? best.ukeireCount : best.ukeireCount - yours.ukeireCount
    const lastResult: TurnResult = { turn: state.turn, yours, best }

    if (state.turn >= totalTurns || r.wall.length === 0) {
      setState((s) => ({
        ...s,
        hand: handToTiles(r.hand),
        lastResult,
        cumulativeLost: s.cumulativeLost + lost,
        finished: true,
      }))
      return
    }

    addTile(r.hand, r.wall[0])
    r.wall = r.wall.slice(1)
    setState((s) => ({
      ...s,
      hand: handToTiles(r.hand),
      turn: s.turn + 1,
      lastResult,
      cumulativeLost: s.cumulativeLost + lost,
    }))
  }

  return { ...state, discard, restart: () => setRestartCount((n) => n + 1) }
}
