import { useEffect, useRef, useState } from 'react'
import { evaluateDiscards, isBestDiscard, type DiscardOption } from '../../core/efficiency'
import { addTile, createHand, removeTile, tileCount, type Hand } from '../../core/hand'
import { shanten } from '../../core/shanten'
import {
  HONOR,
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

/** Options that change how a round plays out; resolved from settings with
 *  per-situation overrides so shared links reproduce exactly. */
export interface RoundOptions {
  opponents: boolean
  deadWall: boolean
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma: boolean
}

function redFiveIds(sanma: boolean): TileId[] {
  return sanma ? [PIN + 4, SOU + 4] : [MAN + 4, PIN + 4, SOU + 4]
}

/** North — the nukidora (kita) tile in sanma. */
export const NORTH: TileId = HONOR + 3

export interface TurnResult {
  turn: number
  yours: DiscardOption
  best: DiscardOption
  /** 'kita' when this grades a nukidora pull rather than an actual discard — the DiscardFeedback
   *  labels differ since pulling isn't discarding, even though `yours`/`best` share the same
   *  DiscardOption shape (north's own evaluateDiscards entry doubles as "what if I nuki"). */
  kind: 'discard' | 'kita'
}

/** Mutable state of one round. The engine `Hand` only keeps counts, so redness is
 *  carried separately: `reds` holds the tile ids whose red copy is currently held. */
interface RoundCore {
  hand: Hand
  reds: Set<TileId>
  /** Upcoming draws, consumed front-first by whoever draws next. */
  liveWall: ParsedTile[]
  /** Materialized (not just a reserved count) so a kita pull can draw a replacement from its
   *  far end and backfill from the live wall, same as a kan would. Empty when the dead wall
   *  setting is off — a kita replacement then falls back to the live wall directly. */
  deadWall: ParsedTile[]
  doraIndicator: ParsedTile | null
  /** Count of every face-up tile: all rivers plus the dora indicator. */
  visible: Uint8Array
  /** Discards per seat (0 = East); the user's is rivers[seatIndex]. */
  rivers: ParsedTile[][]
  /** Norths pulled via kita, in pull order. */
  nuki: ParsedTile[]
  seatIndex: number
  /** Tile drawn to reach the current 14-tile hand; undefined when the situation
   *  pinned all 14 (no draw happened) or the wall ran dry. */
  drawn: ParsedTile | undefined
  turn: number
  players: number
}

interface RoundState {
  /** Sorted hand without the separated drawn tile (all 14 when `drawn` is unset). */
  hand: ParsedTile[]
  drawn: ParsedTile | undefined
  turn: number
  doraIndicator: ParsedTile | null
  rivers: ParsedTile[][]
  nuki: ParsedTile[]
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

/** Pulls the held north to the nuki pile and draws its replacement — from the dead wall's
 *  far end (backfilled from the live wall tail, same as a kan) when one exists, else straight
 *  from the live wall. Hand stays at 14, ready for the discard that follows; no turn/opponent
 *  advance, this is a sub-step of the current turn, not a turn of its own. */
function pullNorth(core: RoundCore): ParsedTile | undefined {
  removeTile(core.hand, NORTH)
  core.nuki.push({ id: NORTH, red: false })
  core.visible[NORTH]++

  let drawn = core.deadWall.pop()
  if (drawn) {
    const backfill = core.liveWall.pop()
    if (backfill) core.deadWall.unshift(backfill)
  } else {
    drawn = core.liveWall.shift()
  }
  if (drawn) {
    addTile(core.hand, drawn.id)
    if (drawn.red) core.reds.add(drawn.id)
  }
  core.drawn = drawn
  return drawn
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
    for (let k = 1; k < core.players; k++) {
      opponentTsumogiri(core, (core.seatIndex + k) % core.players)
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
  const players = options.sanma ? 3 : 4
  const used = new Uint8Array(NUM_TILE_TYPES)
  const pinnedRedSuits = new Set<TileId>()
  for (const t of allTiles(situation)) {
    used[t.id]++
    if (t.red) pinnedRedSuits.add(t.id)
  }
  let pool: ParsedTile[] = buildWall(seed, options.sanma)
    .filter((id) => {
      if (used[id] === 0) return true
      used[id]--
      return false
    })
    .map((id) => ({ id, red: false }))
  if (options.aka) {
    for (const redId of redFiveIds(options.sanma)) {
      if (pinnedRedSuits.has(redId)) continue
      const i = pool.findIndex((t) => t.id === redId)
      if (i >= 0) pool[i] = { id: redId, red: true }
    }
  }

  let reserved = 0
  let deadWall: ParsedTile[] = []
  let doraIndicator: ParsedTile | null = null
  if (options.deadWall) {
    const dead = Math.min(DEAD_WALL_SIZE, pool.length)
    deadWall = pool.slice(pool.length - dead)
    doraIndicator = dead > 0 ? deadWall[0] : null
    reserved += dead
  }
  if (options.opponents) {
    reserved += Math.min((players - 1) * INITIAL_HAND_SIZE, pool.length - reserved)
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

  // a shared ?seat=N link built under yonma can name a seat sanma doesn't have (North)
  const seatIndex = Math.min(Math.max(0, WINDS.indexOf(situation.seat)), players - 1)
  const core: RoundCore = {
    hand,
    reds,
    liveWall,
    deadWall,
    doraIndicator,
    visible,
    rivers: Array.from({ length: players }, () => []),
    nuki: [],
    seatIndex,
    drawn: undefined,
    turn: 1,
    players,
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
    nuki: [...core.nuki],
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
  }, [situation, options.opponents, options.deadWall, options.aka, options.sanma, restartCount])

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
    const ranked = evaluateDiscards(r.hand, seen, options.sanma)
    const yours = ranked.find((o) => o.discard === tile.id)!
    const best = ranked[0]
    // ukeire counts only compare directly at the same shanten (best is always <= yours,
    // since options are sorted shanten-first); a worse shanten forfeits the whole ukeire gap
    const lost =
      yours.shanten > best.shanten ? best.ukeireCount : best.ukeireCount - yours.ukeireCount
    const lastResult: TurnResult = { turn: r.turn, yours, best, kind: 'discard' }

    // one entry per turn, logged here (not from a page effect) so entries stay in play order.
    // Keys carry raw params (tile notation is locale-invariant) rather than formatted text, so
    // a later language switch re-translates the whole log instead of leaving stale fragments.
    const drewCode = state.drawn ? tileCode(state.drawn.id, state.drawn.red) : undefined
    const drewTiles = state.drawn ? [state.drawn] : []
    if (isBestDiscard(yours, best)) {
      log(
        drewCode ? 'log.efficiency.discardBestDrew' : 'log.efficiency.discardBest',
        {
          turn: r.turn,
          drawn: drewCode,
          tile: tileCode(tile.id, tile.red),
          ukeire: yours.ukeireCount,
        },
        [...drewTiles, tile],
      )
    } else {
      log(
        drewCode ? 'log.efficiency.discardMistakeDrew' : 'log.efficiency.discardMistake',
        {
          turn: r.turn,
          drawn: drewCode,
          tile: tileCode(tile.id, tile.red),
          yours: yours.ukeireCount,
          best: tileCode(best.discard),
          bestUkeire: best.ukeireCount,
        },
        [...drewTiles, tile, { id: best.discard, red: false }],
      )
    }
    if (yours.shanten <= 0) {
      log(
        'log.efficiency.tenpai',
        { turn: r.turn },
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

  /** Pulls a held north (sanma only). Graded like a discard by reusing north's own
   *  evaluateDiscards entry (id `NORTH`) — that entry already IS "shanten/ukeire with this
   *  north removed", which is exactly what pulling it costs. A pair of norths serving as the
   *  hand's head costs shanten/ukeire in that entry the same way a bad discard would, so it's
   *  correctly graded a mistake rather than always recommending the pull. */
  function kita() {
    const r = core.current
    if (!r || state.finished || !options.sanma || r.hand.counts[NORTH] === 0) return

    const seen = new Uint8Array(NUM_TILE_TYPES)
    for (let i = 0; i < NUM_TILE_TYPES; i++) seen[i] = r.hand.counts[i] + r.visible[i]
    const ranked = evaluateDiscards(r.hand, seen, options.sanma)
    const yours = ranked.find((o) => o.discard === NORTH)!
    const best = ranked[0]
    const lost =
      yours.shanten > best.shanten ? best.ukeireCount : best.ukeireCount - yours.ukeireCount
    const lastResult: TurnResult = { turn: r.turn, yours, best, kind: 'kita' }
    const isBest = isBestDiscard(yours, best)

    const northTile: ParsedTile = { id: NORTH, red: false }
    const drawn = pullNorth(r)
    const tiles = drawn ? [northTile, drawn] : [northTile]

    if (isBest) {
      log('log.efficiency.kitaBest', { turn: r.turn, ukeire: yours.ukeireCount }, tiles)
    } else {
      log(
        'log.efficiency.kitaMistake',
        {
          turn: r.turn,
          yours: yours.ukeireCount,
          best: tileCode(best.discard),
          bestUkeire: best.ukeireCount,
        },
        tiles,
      )
    }

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
    kita,
    situationQuery,
    togglePause: () => setState((s) => ({ ...s, paused: !s.paused })),
    restart: () => setRestartCount((n) => n + 1),
  }
}
