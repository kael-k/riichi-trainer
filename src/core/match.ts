import { decompose, type Meld } from './agari'
import type { ThreatView } from './danger'
import { evaluateDiscards, isBestDiscard } from './efficiency'
import { addTile, createHand, removeTile, type Hand } from './hand'
import { chooseCall, chooseDiscard, chooseFold, isFuriten, waits, type SeatPolicy } from './policy'
import { scoreHand, type ScoreResult } from './score'
import { shanten } from './shanten'
import { HONOR, NUM_TILE_TYPES, type ParsedTile, type RiverTile, type TileId } from './tiles'
import { completeWall, DEAD_WALL_SIZE, fullWallSize, INITIAL_HAND_SIZE, TILES_PER_KIND } from './wall'
import { isMenzen, type WinContext } from './yaku'

/**
 * A whole hand of mahjong, simulated deterministically. Same seed and same human choices always
 * replay identically — that is what makes a situation link reproduce a drill, and what lets a
 * generator search seeds for a hand that reaches some target state (a scoreable win, an opponent
 * riichi) by simply replaying them.
 *
 * The turn is split into `beginTurn` (draw) and `finishTurn` (discard, then everyone else's
 * reactions) so an interactive trainer can stop between the two and let a human pick the discard,
 * while `playMatch` just runs both in a loop.
 */

/** Kan-dora indicators a real dead wall holds, each sitting on top of its ura counterpart. */
const MAX_DORA_INDICATORS = 5

/** North — the nukidora (kita) tile in sanma. */
export const NORTH: TileId = HONOR + 3

export interface MatchOptions {
  sanma: boolean
  aka: boolean
  /** Round wind as an honour tile id (`HONOR` = East). */
  round: TileId
  /** Reserve a dead wall and flip a dora indicator. */
  deadWall: boolean
  /** Let the AI call pon/chi. */
  calls: boolean
  /** Let the AI declare riichi. */
  riichi: boolean
  /** Let players win. The efficiency trainer turns this off: ending the hand on someone else's
   *  tsumo would cut its per-turn drill short on a result the player did not cause. */
  wins: boolean
  /** Seat played by a person: the engine draws for it but never chooses for it, so its discard
   *  comes in through `finishTurn` and it is never auto-kita'd. */
  human?: number
}

export interface PlayerState {
  hand: Hand
  /** Kinds whose red copy this player holds — `Hand` only keeps counts. */
  reds: Set<TileId>
  melds: Meld[]
  river: RiverTile[]
  /** River index of the riichi declaration tile; unset while not riichi. */
  riichiAt?: number
  /** Turn the riichi was declared on, for double riichi. */
  riichiTurn?: number
  ippatsu: boolean
  nuki: ParsedTile[]
  /** Passed on a discard that would have won: no ron until this player's next draw (and, under
   *  riichi, not for the rest of the hand). Own-river furiten is derived, not stored. */
  missedWin: boolean
  /** How the engine plays this seat. Per seat and flippable mid-hand — ignored once `riichiAt`
   *  is set (riichi locks every later discard to tsumogiri regardless) and for `options.human`,
   *  which the engine never decides for. */
  policy: SeatPolicy
}

export interface WinRecord {
  seat: number
  /** Discarder's seat on a ron; unset on a tsumo. */
  from?: number
  ctx: WinContext
  score: ScoreResult
  concealed: ParsedTile[]
  melds: Meld[]
  doraIndicators: TileId[]
  uraIndicators: TileId[]
  kita: number
}

export type MatchEvent =
  | { kind: 'draw'; seat: number; tile: ParsedTile }
  | { kind: 'discard'; seat: number; tile: RiverTile }
  | { kind: 'riichi'; seat: number }
  | { kind: 'call'; seat: number; from: number; meld: Meld }
  | { kind: 'win'; win: WinRecord }
  | { kind: 'exhaustive' }

export interface MatchState {
  players: PlayerState[]
  /** The complete wall this match dealt from, in draw order: each seat's 13 starting tiles, then
   *  the live draws, then the trailing 14 tiles the dead wall is cut from (dora indicator first).
   *  Captured once in `createMatch` and never touched again — unlike `liveWall`, which shrinks as
   *  the hand is played. */
  wall: ParsedTile[]
  liveWall: ParsedTile[]
  /** The live wall exactly as dealt — snapshotted once at the end of the deal, in `createMatch`,
   *  and never touched again. `liveWall` above only holds what's left (`take()` shifts off its
   *  front, `drawReplacement()` pops its tail); the wall-reveal display walks this instead so it
   *  can show the whole wall, greying what's gone. See `wallDrawnCount`. */
  liveWallSnapshot: ParsedTile[]
  deadWall: ParsedTile[]
  /** All 14 dead-wall tiles in build order — the flipped dora indicator, the rest of the dora
   *  stack, the whole ura stack, then the four rinshan tiles — captured once alongside `deadWall`
   *  and never touched again. Empty when `options.deadWall` is off. */
  deadWallSnapshot: ParsedTile[]
  doraStack: ParsedTile[]
  uraStack: ParsedTile[]
  doraIndicators: ParsedTile[]
  /** Every face-up tile: all rivers, all melds, every flipped indicator. Feeds ukeire. */
  visible: Uint8Array
  /** Every discard in order, seat included. Not the same as the rivers: a claimed tile is popped
   *  out of `river` (below) and it is still a tile that seat threw, which genbutsu depends on.
   *  Never popped — anything counting tiles must read the rivers and melds, not this. */
  discards: { seat: number; tile: RiverTile }[]
  seat: number
  turn: number
  /** Cleared right after a call — the caller already holds 14 tiles and does not draw. */
  pendingDraw: boolean
  /** Replacement (rinshan) draws taken so far, counted in `drawReplacement`. Combined with the
   *  two snapshots above it lets a display reconstruct "already drawn/taken" without a fourth
   *  stored field — see `wallDrawnCount`. */
  replacements: number
  /** Tile that brought the current seat to 14, if any. */
  drawn?: ParsedTile
  ended?: 'win' | 'exhaustive'
  win?: WinRecord
}

function createPlayer(): PlayerState {
  return {
    hand: createHand(),
    reds: new Set(),
    melds: [],
    river: [],
    ippatsu: false,
    nuki: [],
    missedWin: false,
    policy: 'efficiency',
  }
}

/**
 * Deals a match from an explicit wall, in draw order: `wall`'s leading `players * 13` tiles ARE
 * the starting hands (seat 0's 13, then seat 1's, …), the trailing `DEAD_WALL_SIZE` (when
 * `options.deadWall`) are cut off for the dead wall and its dora/ura stacks, and everything
 * between is the live draw pool. A short `wall` is a prefix — `completeWall` fills the remainder
 * at random (or from `fillSeed`, for reproducible tests/generation) from the copies it leaves.
 */
export function createMatch(
  wall: ParsedTile[],
  players: number,
  options: MatchOptions,
  fillSeed?: string,
): MatchState {
  const full =
    wall.length >= fullWallSize(options.sanma)
      ? wall
      : completeWall(wall, options.sanma, options.aka, fillSeed)

  let deadWall: ParsedTile[] = []
  let deadWallSnapshot: ParsedTile[] = []
  let doraStack: ParsedTile[] = []
  let uraStack: ParsedTile[] = []
  const doraIndicators: ParsedTile[] = []
  let reserved = 0
  const pool = full.slice(players * INITIAL_HAND_SIZE)
  if (options.deadWall) {
    const dead = Math.min(DEAD_WALL_SIZE, pool.length)
    const chunk = pool.slice(pool.length - dead)
    // build order, before doraStack.shift() below peels its first tile off into doraIndicators
    deadWallSnapshot = chunk
    const indicators = Math.min(MAX_DORA_INDICATORS, Math.floor(dead / 2))
    doraStack = chunk.slice(0, indicators)
    uraStack = chunk.slice(indicators, indicators * 2)
    deadWall = chunk.slice(indicators * 2)
    const first = doraStack.shift()
    if (first) doraIndicators.push(first)
    // uraStack stays whole and parallel: the ura for the Nth flipped indicator is uraStack[N-1],
    // which is why readers slice it by the number of indicators showing rather than shifting it
    reserved += dead
  }

  const dealable = pool.slice(0, pool.length - reserved)
  const visible = new Uint8Array(NUM_TILE_TYPES)
  for (const indicator of doraIndicators) visible[indicator.id]++

  const state: MatchState = {
    players: Array.from({ length: players }, createPlayer),
    wall: full,
    liveWall: dealable,
    liveWallSnapshot: [],
    deadWall,
    deadWallSnapshot,
    doraStack,
    uraStack,
    doraIndicators,
    visible,
    discards: [],
    seat: 0,
    turn: 1,
    pendingDraw: true,
    replacements: 0,
  }

  for (let i = 0; i < players; i++) {
    const player = state.players[i]
    for (const t of full.slice(i * INITIAL_HAND_SIZE, (i + 1) * INITIAL_HAND_SIZE)) {
      addTile(player.hand, t.id)
      if (t.red) player.reds.add(t.id)
    }
  }
  // captured after the deal, not before: the snapshot is the wall play will actually draw from
  state.liveWallSnapshot = [...state.liveWall]
  return state
}

function take(state: MatchState, player: PlayerState): ParsedTile | undefined {
  const tile = state.liveWall.shift()
  if (!tile) return undefined
  addTile(player.hand, tile.id)
  if (tile.red) player.reds.add(tile.id)
  return tile
}

/** Concealed tiles as display/scoring tiles, with the held red copies marked. */
export function concealedTiles(player: PlayerState): ParsedTile[] {
  const tiles: ParsedTile[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    for (let k = 0; k < player.hand.counts[id]; k++) {
      tiles.push({ id, red: k === 0 && player.reds.has(id) })
    }
  }
  return tiles
}

/** What this seat can see when deciding: every face-up tile plus its own hand. Clamped to
 *  `TILES_PER_KIND` as a safety net, not a behaviour change — face-up tiles and your own hand are
 *  disjoint sets, so the sum cannot legitimately exceed four copies; clamping means a future
 *  bookkeeping slip degrades an ukeire count instead of proposing a fifth copy. Exported (rather
 *  than wrapped only in `table.ts`) because `table.ts` imports this stepper, so this module must
 *  not import back from `table.ts` — the canonical computation has to live here. */
export function seenBy(state: MatchState, player: PlayerState): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = Math.min(TILES_PER_KIND, state.visible[i] + player.hand.counts[i])
  }
  return seen
}

/** What is publicly known about every seat currently in riichi, for `chooseFold` and the folding
 *  trainer's grader alike. Both genbutsu sources come from `state.discards` rather than
 *  `PlayerState.river`: a threat's own discards (furiten on all of them) and every tile anyone
 *  threw after they declared without being ronned (passed, so they may not ron it now either) —
 *  and a called discard is popped out of `river` while it stays in the log. */
export function threatViews(state: MatchState): ThreatView[] {
  return state.players.flatMap((declarer, seat) => {
    if (declarer.riichiAt === undefined) return []
    const declaredAt = state.discards.findIndex((d) => d.seat === seat && d.tile.riichi)
    const discards: TileId[] = []
    const passed: TileId[] = []
    state.discards.forEach((d, i) => {
      if (d.seat === seat) discards.push(d.tile.id)
      if (declaredAt >= 0 && i > declaredAt) passed.push(d.tile.id)
    })
    return [{ seat, discards, passed }]
  })
}

function buildContext(
  state: MatchState,
  seat: number,
  options: MatchOptions,
  winTile: TileId,
  tsumo: boolean,
): WinContext {
  const player = state.players[seat]
  const riichi = player.riichiAt !== undefined
  const double = riichi && player.riichiTurn === 1
  return {
    round: options.round,
    seat: HONOR + seat,
    tsumo,
    riichi: riichi && !double,
    doubleRiichi: double,
    ippatsu: riichi && player.ippatsu,
    haitei: tsumo && state.liveWall.length === 0,
    houtei: !tsumo && state.liveWall.length === 0,
    // no kakan is modelled, so a replacement-tile win is always rinshan and never chankan
    rinshan: false,
    chankan: false,
    winTile,
  }
}

/**
 * Whether `seat` wins on `tile`, and for how much. A win needs the shape (`decompose`), a yaku
 * (`scoreHand` returns null without one) and, on a ron, no furiten.
 */
function tryWin(
  state: MatchState,
  seat: number,
  options: MatchOptions,
  tile: ParsedTile,
  tsumo: boolean,
  from?: number,
): WinRecord | null {
  if (!options.wins) return null
  const player = state.players[seat]

  // one shanten call gates the whole win check, and it fails for almost every seat on almost
  // every discard. Everything below — decompose, the wait set, scoring — is far more expensive,
  // so nothing else may run before this.
  if (shanten(player.hand) !== (tsumo ? -1 : 0)) return null

  // a ron tile is scored as part of the hand, redness included, then taken back out
  let addedRed = false
  if (!tsumo) {
    addTile(player.hand, tile.id)
    addedRed = tile.red && !player.reds.has(tile.id)
    if (addedRed) player.reds.add(tile.id)
  }
  const complete = decompose(player.hand.counts, player.melds).length > 0
  const concealed = complete ? concealedTiles(player) : []
  if (!tsumo) {
    removeTile(player.hand, tile.id)
    if (addedRed) player.reds.delete(tile.id)
  }
  if (!complete) return null
  // furiten is only worth computing once the tile is known to complete the hand
  if (!tsumo && (player.missedWin || isFuriten(waits(player.hand, options.sanma), player.river))) {
    return null
  }

  const ctx = buildContext(state, seat, options, tile.id, tsumo)
  const uraIndicators =
    ctx.riichi || ctx.doubleRiichi
      ? state.uraStack.slice(0, state.doraIndicators.length).map((t) => t.id)
      : []
  const score = scoreHand({
    concealed,
    melds: player.melds,
    ctx,
    doraIndicators: state.doraIndicators.map((t) => t.id),
    uraIndicators,
    kita: player.nuki.length,
    rules: { kiriageMangan: false, honba: 0, sanma: options.sanma },
  })
  if (!score) return null

  return {
    seat,
    from,
    ctx,
    score,
    concealed,
    melds: player.melds,
    doraIndicators: state.doraIndicators.map((t) => t.id),
    uraIndicators,
    kita: player.nuki.length,
  }
}

function endWith(state: MatchState, win: WinRecord): MatchEvent[] {
  state.ended = 'win'
  state.win = win
  return [{ kind: 'win', win }]
}

/** Draws for the seat whose turn it is, and takes the tsumo if there is one. */
export function beginTurn(state: MatchState, options: MatchOptions): MatchEvent[] {
  if (state.ended) return []
  const player = state.players[state.seat]
  player.missedWin = player.riichiAt !== undefined && player.missedWin

  if (!state.pendingDraw) {
    state.pendingDraw = true
    state.drawn = undefined
    return []
  }
  if (state.liveWall.length === 0) {
    state.ended = 'exhaustive'
    return [{ kind: 'exhaustive' }]
  }

  const events: MatchEvent[] = []
  let tile = take(state, player)!
  events.push({ kind: 'draw', seat: state.seat, tile })

  // sanma nukidora: pulling a held north is graded exactly as the efficiency trainer grades the
  // human's — north's own evaluateDiscards entry against the best discard — so the AI pulls
  // whenever that entry is as good as the best line, and draws its replacement
  while (options.sanma && state.seat !== options.human && player.hand.counts[NORTH] > 0) {
    const seen = seenBy(state, player)
    const ranked = evaluateDiscards(player.hand, seen, options.sanma)
    const north = ranked.find((o) => o.discard === NORTH)
    if (!north || !isBestDiscard(north, ranked[0])) break

    removeTile(player.hand, NORTH)
    player.nuki.push({ id: NORTH, red: false })
    state.visible[NORTH]++
    const replacement = drawReplacement(state, player)
    if (!replacement) break
    tile = replacement
    events.push({ kind: 'draw', seat: state.seat, tile })
  }

  state.drawn = tile
  const win = tryWin(state, state.seat, options, tile, true)
  if (win) return [...events, ...endWith(state, win)]
  return events
}

/** Replacement draw off the dead wall's far end, backfilled from the live wall tail so the dead
 *  wall keeps its size; straight off the live wall when there is no dead wall. */
export function drawReplacement(state: MatchState, player: PlayerState): ParsedTile | undefined {
  let tile = state.deadWall.pop()
  if (tile) {
    // counted only on this branch: it names tiles that left the live wall's *tail* as backfill.
    // With no dead wall the replacement comes off the front like any other draw, and the
    // front-draw derivation already accounts for it
    state.replacements++
    const backfill = state.liveWall.pop()
    if (backfill) state.deadWall.unshift(backfill)
    addTile(player.hand, tile.id)
    if (tile.red) player.reds.add(tile.id)
  } else {
    tile = take(state, player)
  }
  return tile
}

/** How many tiles have left `liveWallSnapshot` from the front — real draws, as opposed to the
 *  `replacements` more that left off the tail to backfill the dead wall after a kan. Derived
 *  rather than stored: `liveWall.length` already nets both out, so front-only is what's left
 *  once `replacements` is subtracted back out. What the wall-reveal display greys. */
export function wallDrawnCount(state: MatchState): number {
  return state.liveWallSnapshot.length - state.liveWall.length - state.replacements
}

/**
 * Plays the current seat's discard — `discard` overrides the AI, which is how a human seat takes
 * its turn — then lets every other seat react to it: ron first, then calls.
 */
export function finishTurn(
  state: MatchState,
  options: MatchOptions,
  discard?: ParsedTile,
): MatchEvent[] {
  if (state.ended) return []
  const seat = state.seat
  const player = state.players[seat]
  const events: MatchEvent[] = []

  const forcedTsumogiri = player.riichiAt !== undefined && state.drawn !== undefined
  let tile = discard
  if (!tile) {
    if (forcedTsumogiri) {
      tile = state.drawn
    } else if (player.policy === 'defense') {
      const fold = chooseFold(player.hand, threatViews(state), seenBy(state, player), options.sanma)
      tile = pickTile(player, fold)
    } else {
      tile = pickTile(player, chooseDiscard(player.hand, seenBy(state, player), options.sanma).discard)
    }
  }
  if (!tile) return events

  const tsumogiri = state.drawn !== undefined && sameTile(tile, state.drawn)
  removeTile(player.hand, tile.id)
  if (tile.red) player.reds.delete(tile.id)

  // riichi is declared with the discard that reaches tenpai, so it is decided after the choice
  let declaring = false
  if (
    options.riichi &&
    // never for the human seat: riichi is a choice, and it locks every later discard to tsumogiri
    seat !== options.human &&
    // a folding seat must not declare — it is trying to leave the hand, not win it
    player.policy !== 'defense' &&
    player.riichiAt === undefined &&
    isMenzen(player.melds) &&
    shanten(player.hand) === 0 &&
    state.liveWall.length >= 4
  ) {
    declaring = true
    player.riichiAt = player.river.length
    player.riichiTurn = state.turn
    player.ippatsu = true
  } else if (player.riichiAt !== undefined) {
    // ippatsu survives only until this player's own next discard
    player.ippatsu = false
  }

  const entry: RiverTile = { id: tile.id, red: tile.red }
  if (tsumogiri) entry.tsumogiri = true
  if (declaring) entry.riichi = true
  player.river.push(entry)
  state.discards.push({ seat, tile: entry })
  state.visible[tile.id]++
  state.drawn = undefined
  if (declaring) events.push({ kind: 'riichi', seat })
  events.push({ kind: 'discard', seat, tile: entry })

  for (const other of seatsFrom(state, seat)) {
    const win = tryWin(state, other, options, tile, false, seat)
    if (win) {
      entry.win = true
      return [...events, ...endWith(state, win)]
    }
    // declining a win that was there is what makes a player temporarily furiten
    if (options.wins && couldHaveWon(state, other, tile.id)) state.players[other].missedWin = true
  }

  if (options.calls) {
    for (const other of seatsFrom(state, seat)) {
      const caller = state.players[other]
      // a call is a decision, and `human` is the seat the engine never decides for — calling on
      // its behalf would open a hand its player never chose to open. A folding seat does not
      // call either: every meld it opened is one more shape it might have to defend a wait with.
      if (other === options.human || caller.riichiAt !== undefined || caller.policy === 'defense')
        continue
      const call = chooseCall(
        caller.hand,
        caller.melds,
        tile.id,
        other === (seat + 1) % state.players.length,
        options.round,
        HONOR + other,
      )
      if (!call) continue

      const meldTiles: ParsedTile[] = [{ id: tile.id, red: tile.red }]
      for (const id of call.from) {
        meldTiles.push({ id, red: caller.reds.has(id) })
        removeTile(caller.hand, id)
        caller.reds.delete(id)
      }
      meldTiles.sort((a, b) => a.id - b.id)
      const meld: Meld = { kind: call.kind, tiles: meldTiles }
      caller.melds.push(meld)
      caller.hand.melds++
      // the claimed tile leaves the river and lives in the meld from here on — leaving it in
      // both is a duplicate copy of that tile on the table
      player.river.pop()
      // the called tile was already counted as visible when it was discarded
      for (const id of call.from) state.visible[id]++
      // a call kills every outstanding ippatsu
      for (const p of state.players) p.ippatsu = false

      state.seat = other
      state.pendingDraw = false
      events.push({ kind: 'call', seat: other, from: seat, meld })
      return events
    }
  }

  state.seat = (seat + 1) % state.players.length
  if (state.seat === 0) state.turn++
  return events
}

/** Seats in claim order starting after `seat` — the order ron and calls are resolved in. */
function seatsFrom(state: MatchState, seat: number): number[] {
  const order: number[] = []
  for (let k = 1; k < state.players.length; k++) order.push((seat + k) % state.players.length)
  return order
}

/** A win this seat passed up, ignoring furiten — the test for *entering* temporary furiten. */
function couldHaveWon(state: MatchState, seat: number, tile: TileId): boolean {
  const player = state.players[seat]
  // same tenpai gate as tryWin, for the same reason
  if (shanten(player.hand) !== 0) return false
  addTile(player.hand, tile)
  const complete = decompose(player.hand.counts, player.melds).length > 0
  removeTile(player.hand, tile)
  return complete
}

function sameTile(a: ParsedTile, b: ParsedTile): boolean {
  return a.id === b.id && a.red === b.red
}

/** The held copy of `id` being discarded. Only red when it is the last copy held — with several
 *  in hand the red one is the one you keep, and `reds` tracks kinds rather than copies. */
function pickTile(player: PlayerState, id: TileId): ParsedTile {
  return { id, red: player.reds.has(id) && player.hand.counts[id] === 1 }
}

export interface MatchOutcome {
  state: MatchState
  events: MatchEvent[]
  ended: 'win' | 'exhaustive' | 'stopped'
}

/** Plays `state` out from wherever it stands. `stop` ends it early — that is how a generator asks
 *  for "the first match that reaches X" without knowing anything about how a hand is played.
 *  Shared by `playMatch` (seeded, dealt fresh) and `playWall` (an explicit wall, already dealt). */
function playFrom(
  state: MatchState,
  options: MatchOptions,
  stop?: (event: MatchEvent, state: MatchState) => boolean,
): MatchOutcome {
  const events: MatchEvent[] = []
  // a hand is ~18 turns; the bound is a backstop against a rule bug spinning forever
  for (let guard = 0; guard < 400 && !state.ended; guard++) {
    for (const event of [...beginTurn(state, options), ...finishTurn(state, options)]) {
      events.push(event)
      if (stop?.(event, state)) return { state, events, ended: 'stopped' }
    }
  }
  return { state, events, ended: state.ended ?? 'exhaustive' }
}

/** Plays a whole hand out from a seeded deal. */
export function playMatch(
  seed: string,
  players: number,
  options: MatchOptions,
  stop?: (event: MatchEvent, state: MatchState) => boolean,
): MatchOutcome {
  return playFrom(createMatch([], players, options, seed), options, stop)
}

/** Plays a whole hand out from an explicit wall — the scoring trainer's random-wall search
 *  (D-09): unlike `playMatch`'s seed suffixing, a fresh wall is dealt per attempt by handing in a
 *  short/empty wall each time, and the wall actually dealt (`outcome.state.wall`) is what gets
 *  shared, not a seed. */
export function playWall(
  wall: ParsedTile[],
  players: number,
  options: MatchOptions,
  stop?: (event: MatchEvent, state: MatchState) => boolean,
): MatchOutcome {
  return playFrom(createMatch(wall, players, options), options, stop)
}

/**
 * Replays a seed, then `seed#1`, `seed#2`… until `accept` takes one. Same suffixing the trainers
 * use for restarts, so the accepted attempt's seed alone reproduces the whole match from a URL.
 */
export function findMatch<T>(
  seed: string,
  players: number,
  options: MatchOptions,
  accept: (outcome: MatchOutcome) => T | null,
  maxAttempts = 40,
): { result: T; seed: string } | null {
  for (let i = 0; i < maxAttempts; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const result = accept(playMatch(attemptSeed, players, options))
    if (result !== null) return { result, seed: attemptSeed }
  }
  return null
}

/** `findMatch`, yielding between attempts so a trainer can paint a "dealing" state. */
export async function findMatchAsync<T>(
  seed: string,
  players: number,
  options: MatchOptions,
  accept: (outcome: MatchOutcome) => T | null,
  maxAttempts = 40,
): Promise<{ result: T; seed: string } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const result = accept(playMatch(attemptSeed, players, options))
    if (result !== null) return { result, seed: attemptSeed }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return null
}
