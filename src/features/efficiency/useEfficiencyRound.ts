import { useEffect, useRef, useState } from 'react'
import { evaluateDiscards, isBestDiscard, type DiscardOption } from '../../core/efficiency'
import { addTile, createHand, removeTile, tileCount, type Hand } from '../../core/hand'
import { shanten } from '../../core/shanten'
import {
  MAN,
  NUM_TILE_TYPES,
  PIN,
  SOU,
  tileCode,
  type ParsedTile,
  type TileId,
} from '../../core/tiles'
import { buildWall, DEAD_WALL_SIZE, INITIAL_HAND_SIZE } from '../../core/wall'
import { useLog } from '../../store/log'
import { allTiles, encodeSituation, WINDS, type Situation } from '../situation/urlCodec'

// ponytail: sanma will make this 3 and shrink the tile set inside buildWall — keep
// player count flowing from this one constant, never hardcode 4/3 below
const PLAYERS = 4
const RED_FIVE_IDS: TileId[] = [MAN + 4, PIN + 4, SOU + 4]

/** Options that change how a round plays out; resolved from settings with
 *  per-situation overrides so shared links reproduce exactly. */
export interface RoundOptions {
  opponents: boolean
  deadWall: boolean
  aka: boolean
}

export interface TurnResult {
  turn: number
  yours: DiscardOption
  best: DiscardOption
}

/** Mutable state of one round. The engine `Hand` only keeps counts, so redness is
 *  carried separately: `reds` holds the tile ids whose red copy is currently held. */
interface RoundCore {
  hand: Hand
  reds: Set<TileId>
  /** Upcoming draws, consumed front-first by whoever draws next. */
  liveWall: ParsedTile[]
  doraIndicator: ParsedTile | null
  /** Count of every face-up tile: all rivers plus the dora indicator. */
  visible: Uint8Array
  /** Discards per seat (0 = East); the user's is rivers[seatIndex]. */
  rivers: ParsedTile[][]
  seatIndex: number
  /** Tile drawn to reach the current 14-tile hand; undefined when the situation
   *  pinned all 14 (no draw happened) or the wall ran dry. */
  drawn: ParsedTile | undefined
  turn: number
}

interface RoundState {
  /** Sorted hand without the separated drawn tile (all 14 when `drawn` is unset). */
  hand: ParsedTile[]
  drawn: ParsedTile | undefined
  turn: number
  doraIndicator: ParsedTile | null
  rivers: ParsedTile[][]
  seatIndex: number
  liveWall: ParsedTile[]
  wallRemaining: number
  lastResult: TurnResult | null
  cumulativeLost: number
  finished: boolean
  /** Finished because the hand reached tenpai (rather than the wall drying up). */
  tenpai: boolean
  elapsed: number
  paused: boolean
}

function handToTiles(hand: Hand, reds: ReadonlySet<TileId>): ParsedTile[] {
  const tiles: ParsedTile[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    for (let k = 0; k < hand.counts[id]; k++) tiles.push({ id, red: k === 0 && reds.has(id) })
  }
  return tiles
}

function opponentTsumogiri(core: RoundCore, seat: number): void {
  const tile = core.liveWall.shift()
  if (!tile) return
  core.rivers[seat].push(tile)
  core.visible[tile.id]++
}

function userDraw(core: RoundCore): void {
  const tile = core.liveWall.shift()
  if (tile) {
    addTile(core.hand, tile.id)
    if (tile.red) core.reds.add(tile.id)
  }
  core.drawn = tile
}

/** Discards `tile` for the user, lets the opponents tsumogiri around the table,
 *  and draws the user's next tile. Returns false when the drill is over instead —
 *  either the discard reached tenpai or the wall ran dry. */
function advanceAfterDiscard(core: RoundCore, tile: ParsedTile, options: RoundOptions): boolean {
  removeTile(core.hand, tile.id)
  if (tile.red) core.reds.delete(tile.id)
  core.rivers[core.seatIndex].push(tile)
  core.visible[tile.id]++
  // tenpai is the goal, so stop here: the hand stays at 13 tiles, which is what
  // "finished" is derived from, and the opponents/wall are left untouched
  if (shanten(core.hand) <= 0) {
    core.drawn = undefined
    return false
  }
  if (options.opponents) {
    for (let k = 1; k < PLAYERS; k++) {
      opponentTsumogiri(core, (core.seatIndex + k) % PLAYERS)
    }
  }
  if (core.liveWall.length === 0) {
    core.drawn = undefined
    return false
  }
  core.turn++
  userDraw(core)
  return true
}

/** Builds the round: seeded pool minus pinned tiles, aka marking, dead wall and
 *  hidden opponent hands reserved from the pool tail (never the pinned prefix),
 *  deal, seat-ordered first draws, then replay of the situation's river. */
function createRound(situation: Situation, options: RoundOptions, seed: string): RoundCore {
  const used = new Uint8Array(NUM_TILE_TYPES)
  const pinnedRedSuits = new Set<TileId>()
  for (const t of allTiles(situation)) {
    used[t.id]++
    if (t.red) pinnedRedSuits.add(t.id)
  }
  let pool: ParsedTile[] = buildWall(seed)
    .filter((id) => {
      if (used[id] === 0) return true
      used[id]--
      return false
    })
    .map((id) => ({ id, red: false }))
  if (options.aka) {
    for (const redId of RED_FIVE_IDS) {
      if (pinnedRedSuits.has(redId)) continue
      const i = pool.findIndex((t) => t.id === redId)
      if (i >= 0) pool[i] = { id: redId, red: true }
    }
  }

  let reserved = 0
  let doraIndicator: ParsedTile | null = null
  if (options.deadWall) {
    const dead = Math.min(DEAD_WALL_SIZE, pool.length)
    doraIndicator = dead > 0 ? pool[pool.length - dead] : null
    reserved += dead
  }
  if (options.opponents) {
    reserved += Math.min((PLAYERS - 1) * INITIAL_HAND_SIZE, pool.length - reserved)
  }
  const liveWall = [...situation.wall, ...pool.slice(0, pool.length - reserved)]

  const hand = createHand()
  const reds = new Set<TileId>()
  for (const t of situation.hand) {
    addTile(hand, t.id)
    if (t.red) reds.add(t.id)
  }
  const visible = new Uint8Array(NUM_TILE_TYPES)
  if (doraIndicator) visible[doraIndicator.id]++

  const core: RoundCore = {
    hand,
    reds,
    liveWall,
    doraIndicator,
    visible,
    rivers: Array.from({ length: PLAYERS }, () => []),
    seatIndex: Math.max(0, WINDS.indexOf(situation.seat)),
    drawn: undefined,
    turn: 1,
  }

  while (tileCount(hand) < INITIAL_HAND_SIZE && liveWall.length > 0) {
    const t = liveWall.shift()!
    addTile(hand, t.id)
    if (t.red) reds.add(t.id)
  }
  if (tileCount(hand) === INITIAL_HAND_SIZE) {
    // opponents seated before the user act first on turn 1 (East leads)
    if (options.opponents) {
      for (let s = 0; s < core.seatIndex; s++) opponentTsumogiri(core, s)
    }
    userDraw(core)
  }

  // fast-forward the user's recorded discards; stops quietly on an impossible one
  for (const t of situation.river) {
    if (hand.counts[t.id] === 0) break
    const red = reds.has(t.id) && (t.red || hand.counts[t.id] === 1)
    if (!advanceAfterDiscard(core, { id: t.id, red }, options)) break
  }
  return core
}

function snapshot(core: RoundCore, prev?: RoundState): RoundState {
  const finished = tileCount(core.hand) < 14
  let hand = handToTiles(core.hand, core.reds)
  if (core.drawn) {
    const i = hand.findIndex((t) => t.id === core.drawn!.id && t.red === core.drawn!.red)
    if (i >= 0) hand = [...hand.slice(0, i), ...hand.slice(i + 1)]
  }
  return {
    hand,
    drawn: core.drawn,
    turn: core.turn,
    doraIndicator: core.doraIndicator,
    rivers: core.rivers.map((r) => [...r]),
    seatIndex: core.seatIndex,
    liveWall: [...core.liveWall],
    wallRemaining: core.liveWall.length,
    finished,
    tenpai: finished && shanten(core.hand) <= 0,
    lastResult: prev?.lastResult ?? null,
    cumulativeLost: prev?.cumulativeLost ?? 0,
    elapsed: prev?.elapsed ?? 0,
    paused: prev?.paused ?? false,
  }
}

/** Drives one efficiency round: deal, discard, draw, repeat, until the wall runs dry. */
export function useEfficiencyRound(
  situation: Situation,
  options: RoundOptions,
  timerEnabled: boolean,
) {
  const [restartCount, setRestartCount] = useState(0)
  // stable per mount, so an unspecified seed still gets a fresh deal each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const core = useRef<RoundCore>(undefined)
  const effectiveSeed = useRef('')
  const [state, setState] = useState<RoundState>(() => startRound())
  const log = useLog((s) => s.log)

  function startRound(): RoundState {
    // no suffix on first load, so a URL whose seed came from situationQuery() (already
    // suffixed or not) rebuilds the identical round instead of hashing differently
    const base = situation.seed || randomSeed
    effectiveSeed.current = restartCount === 0 ? base : `${base}:${restartCount}`
    core.current = createRound(situation, options, effectiveSeed.current)
    return snapshot(core.current)
  }

  useEffect(() => {
    setState(startRound())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, options.opponents, options.deadWall, options.aka, restartCount])

  useEffect(() => {
    if (state.finished || state.paused || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })), 1000)
    return () => clearInterval(id)
  }, [state.finished, state.paused, timerEnabled])

  function discard(index: number) {
    const r = core.current
    if (!r || state.finished) return
    const tile = index === state.hand.length ? state.drawn : state.hand[index]
    if (!tile) return

    const seen = new Uint8Array(NUM_TILE_TYPES)
    for (let i = 0; i < NUM_TILE_TYPES; i++) seen[i] = r.hand.counts[i] + r.visible[i]
    const ranked = evaluateDiscards(r.hand, seen)
    const yours = ranked.find((o) => o.discard === tile.id)!
    const best = ranked[0]
    // ukeire counts only compare directly at the same shanten (best is always <= yours,
    // since options are sorted shanten-first); a worse shanten forfeits the whole ukeire gap
    const lost =
      yours.shanten > best.shanten ? best.ukeireCount : best.ukeireCount - yours.ukeireCount
    const lastResult: TurnResult = { turn: r.turn, yours, best }

    // one entry per turn, logged here (not from a page effect) so entries stay in play order
    const drew = state.drawn ? `drew ${tileCode(state.drawn.id, state.drawn.red)}, ` : ''
    const drewTiles = state.drawn ? [state.drawn] : []
    if (isBestDiscard(yours, best)) {
      log(
        `Turn ${r.turn}: ${drew}discarded ${tileCode(tile.id, tile.red)} — best choice (ukeire ${yours.ukeireCount})`,
        [...drewTiles, tile],
      )
    } else {
      log(
        `Turn ${r.turn}: ${drew}discarded ${tileCode(tile.id, tile.red)} (ukeire ${yours.ukeireCount}); best was ${tileCode(best.discard)} (ukeire ${best.ukeireCount})`,
        [...drewTiles, tile, { id: best.discard, red: false }],
      )
    }
    if (yours.shanten <= 0) {
      log(
        `Tenpai on turn ${r.turn} — waiting on`,
        yours.ukeireTiles.map((t) => ({ id: t.tile, red: false })),
      )
    }

    advanceAfterDiscard(r, tile, options)
    setState((s) => ({
      ...snapshot(r, s),
      lastResult,
      cumulativeLost: s.cumulativeLost + lost,
    }))
  }

  /** Current round as a shareable query string: same seed, original hand/wall, the
   *  user's discards so far as the replay river, and the round options pinned. */
  function situationQuery(): string {
    const r = core.current
    return encodeSituation({
      ...situation,
      seed: effectiveSeed.current,
      river: r ? r.rivers[r.seatIndex].slice() : [],
      ...options,
    })
  }

  return {
    ...state,
    discard,
    situationQuery,
    togglePause: () => setState((s) => ({ ...s, paused: !s.paused })),
    restart: () => setRestartCount((n) => n + 1),
  }
}
