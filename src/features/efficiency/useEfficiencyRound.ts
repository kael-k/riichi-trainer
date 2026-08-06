import { useEffect, useRef, useState } from 'react'
import { evaluateDiscards, isBestDiscard, type DiscardOption } from '../../core/efficiency'
import { addTile, createHand, removeTile, tileCount, type Hand } from '../../core/hand'
import { NUM_TILE_TYPES, tileCode, type ParsedTile, type TileId } from '../../core/tiles'
import { buildWall } from '../../core/wall'
import { useLog } from '../../store/log'
import { allTiles, type Situation } from '../situation/urlCodec'

export interface TurnResult {
  turn: number
  yours: DiscardOption
  best: DiscardOption
}

interface RoundState {
  hand: ParsedTile[]
  turn: number
  /** Tile drawn to reach the current hand; undefined for turn 1 when the situation already
   *  pins down a full 14-tile hand (no draw happened). */
  drawn: ParsedTile | undefined
  lastResult: TurnResult | null
  cumulativeLost: number
  finished: boolean
  elapsed: number
  wallRemaining: number
}

/** The engine `Hand` only keeps counts, so redness is carried separately: `reds` holds the
 *  tile ids (5m/5p/5s) whose red copy is currently in the hand. */
function handToTiles(hand: Hand, reds: ReadonlySet<TileId>): ParsedTile[] {
  const tiles: ParsedTile[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    for (let k = 0; k < hand.counts[id]; k++) tiles.push({ id, red: k === 0 && reds.has(id) })
  }
  return tiles
}

/** Draw order for a round: the situation's explicit wall prefix, then the seeded pool
 *  minus every tile the situation already pins down (hand/wall/rivers). */
function buildRoundWall(situation: Situation, seed: string): ParsedTile[] {
  const used = new Uint8Array(NUM_TILE_TYPES)
  for (const t of allTiles(situation)) used[t.id]++
  const pool = buildWall(seed).filter((id) => {
    if (used[id] === 0) return true
    used[id]--
    return false
  })
  return [...situation.wall, ...pool.map((id) => ({ id, red: false }))]
}

/** Drives one efficiency round: deal, discard, draw, repeat, until the wall runs dry. */
export function useEfficiencyRound(situation: Situation, timerEnabled: boolean) {
  const [restartCount, setRestartCount] = useState(0)
  // stable per mount, so an unspecified seed still gets a fresh deal each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const round = useRef<{
    hand: Hand
    wall: ParsedTile[]
    discards: Uint8Array
    reds: Set<TileId>
  }>(undefined)
  const [state, setState] = useState<RoundState>(() => startRound())
  const log = useLog((s) => s.log)

  function startRound(): RoundState {
    const seed = `${situation.seed || randomSeed}:${restartCount}`
    const wall = buildRoundWall(situation, seed)
    const hand = createHand()
    const reds = new Set<TileId>()
    for (const t of situation.hand) {
      addTile(hand, t.id)
      if (t.red) reds.add(t.id)
    }
    let cursor = 0
    let drawn: ParsedTile | undefined
    while (tileCount(hand) < 14) {
      drawn = wall[cursor++]
      addTile(hand, drawn.id)
      if (drawn.red) reds.add(drawn.id)
    }
    const wallLeft = wall.slice(cursor)
    // rivers are face up, so their tiles start out visible for ukeire remaining counts
    const discards = new Uint8Array(NUM_TILE_TYPES)
    for (const t of situation.rivers.flat()) discards[t.id]++
    round.current = { hand, wall: wallLeft, discards, reds }
    return {
      hand: handToTiles(hand, reds),
      turn: 1,
      drawn,
      lastResult: null,
      cumulativeLost: 0,
      finished: wallLeft.length === 0,
      elapsed: 0,
      wallRemaining: wallLeft.length,
    }
  }

  useEffect(() => {
    setState(startRound())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, restartCount])

  useEffect(() => {
    if (state.finished || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })), 1000)
    return () => clearInterval(id)
  }, [state.finished, timerEnabled])

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
    if (tile.red) r.reds.delete(tile.id)
    // ukeire counts only compare directly at the same shanten (best is always <= yours,
    // since options are sorted shanten-first); a worse shanten forfeits the whole ukeire gap
    const lost =
      yours.shanten > best.shanten ? best.ukeireCount : best.ukeireCount - yours.ukeireCount
    const lastResult: TurnResult = { turn: state.turn, yours, best }

    // one entry per turn, logged here (not from a page effect) so entries stay in play order
    const drew = state.drawn ? `drew ${tileCode(state.drawn.id, state.drawn.red)}, ` : ''
    const drewTiles = state.drawn ? [state.drawn] : []
    if (isBestDiscard(yours, best)) {
      log(
        `Turn ${state.turn}: ${drew}discarded ${tileCode(tile.id, tile.red)} — best choice (ukeire ${yours.ukeireCount})`,
        [...drewTiles, tile],
      )
    } else {
      log(
        `Turn ${state.turn}: ${drew}discarded ${tileCode(tile.id, tile.red)} (ukeire ${yours.ukeireCount}); best was ${tileCode(best.discard)} (ukeire ${best.ukeireCount})`,
        [...drewTiles, tile, { id: best.discard, red: false }],
      )
    }

    if (r.wall.length === 0) {
      setState((s) => ({
        ...s,
        hand: handToTiles(r.hand, r.reds),
        lastResult,
        cumulativeLost: s.cumulativeLost + lost,
        finished: true,
        wallRemaining: 0,
      }))
      return
    }

    const drawn = r.wall[0]
    addTile(r.hand, drawn.id)
    if (drawn.red) r.reds.add(drawn.id)
    r.wall = r.wall.slice(1)
    setState((s) => ({
      ...s,
      hand: handToTiles(r.hand, r.reds),
      turn: s.turn + 1,
      drawn,
      lastResult,
      cumulativeLost: s.cumulativeLost + lost,
      wallRemaining: r.wall.length,
    }))
  }

  return { ...state, discard, restart: () => setRestartCount((n) => n + 1) }
}
