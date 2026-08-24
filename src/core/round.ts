import { decompose, type Meld } from './agari'
import { ALGORITHMS, type SeatView, type WinCandidate } from './algorithm'
import type { ThreatView } from './danger'
import { addTile, createHand, removeTile, type Hand } from './hand'
import type { MatchState } from './match'
import { availableCalls, isFuriten, waits, type Call, type SeatAlgorithm } from './policy'
import { scoreHand, type ScoreResult } from './score'
import { shanten } from './shanten'
import { HONOR, NUM_TILE_TYPES, type ParsedTile, type RiverTile, type TileId } from './tiles'
import {
  completeWall,
  DEAD_WALL_SIZE,
  DEAL_CHUNKS,
  fullWallSize,
  INITIAL_HAND_SIZE,
  TILES_PER_KIND,
} from './wall'
import { isMenzen, type WinContext } from './yaku'

/**
 * A whole hand of mahjong, simulated deterministically. Same seed and same manual-seat choices
 * always replay identically — that is what makes a situation link reproduce a drill, and what
 * lets a generator search seeds for a hand that reaches some target state (a scoreable win, an
 * opponent riichi) by simply replaying them.
 *
 * The turn is split into `beginTurn` (draw) and `finishTurn` (discard, then everyone else's
 * reactions) so an interactive trainer can stop between the two and let a manual seat pick the
 * discard, while `playRound` just runs both in a loop.
 */

/** Kan-dora indicators a real dead wall holds, each sitting on top of its ura counterpart. */
const MAX_DORA_INDICATORS = 5

/** North — the nukidora (kita) tile in sanma. */
export const NORTH: TileId = HONOR + 3

export interface RoundOptions {
  sanma: boolean
  aka: boolean
  /** The match this round sits inside — prevalent wind, dealer seat, points, honba, riichi
   *  sticks, which round it is. Carry-in only: nothing here steps between rounds, no dealer
   *  rotation, no honba increment, no settlement. A round's own riichi declarations do mutate
   *  `points`/`riichiSticks` on the copy `createRound` takes (T4) — the caller's own object is
   *  never written back to. */
  match: MatchState
  /** Let the AI call pon/chi. */
  calls: boolean
  /** Let the AI declare riichi. */
  riichi: boolean
  /** Let players win. The efficiency trainer turns this off: ending the hand on someone else's
   *  tsumo would cut its per-turn drill short on a result the player did not cause. */
  wins: boolean
  /** Seeds each player's `PlayerState.algorithm`, indexed by seat; a seat with no entry starts on
   *  `'efficiency'`. Seeding only — the live value lives on the player and moves without touching
   *  options, and a `'manual'` seat is one the engine draws for but never chooses for: each
   *  discard comes in through `finishTurn`, none is auto-kita'd, none auto-declares riichi and
   *  none calls or rons without being asked (`claimOptions`/`answerClaim`). More than one seat
   *  can be `'manual'` at once — four manual seats is one person playing the whole table. */
  algorithms?: readonly SeatAlgorithm[]
  /** Ask manual seats what to do with *other* seats' discards — ron, pon, chi. Off by default,
   *  and deliberately: the graded drills ask one question per turn ("what do you discard"), and a
   *  trainer that interrupted every ponnable tile with a prompt would be grading a different
   *  skill. The free-play boards turn it on. Independent of `calls`, which is about the AI. */
  claims?: boolean
}

/** Whether the engine must stop and ask instead of deciding for `seat`. */
export function isManual(state: RoundState, seat: number): boolean {
  return state.players[seat].algorithm === 'manual'
}

export interface PlayerState {
  hand: Hand
  /** Concealed tiles as actually held, redness included — `hand` stays counts-only for the
   *  shanten/ukeire hot path. Kept sorted (ascending id, a kind's red copy first) except for its
   *  very last element while `drawn` is set, which is that 14th tile appended rather than sorted
   *  in (T1 — this is what lets a discard know tedashi from tsumogiri without inferring it). */
  concealed: ParsedTile[]
  /** The 14th tile that brought the hand to 14, if one is currently held — always
   *  `concealed.at(-1)` when set. Cleared the moment the tile leaves (a discard, kita, ankan),
   *  before any algorithm decision reads it. Replaces the old `Hand.drawn` (ADR-0003's own
   *  exception): the reason it lived beside `Hand` — that redness of the draw specifically isn't
   *  reconstructable from a kinds-only red set — is moot now that `concealed` tracks instances. */
  drawn?: ParsedTile
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
  /** How the engine plays this seat. LIVE: flip it mid-hand and the next turn obeys — no redeal,
   *  no new match. `'manual'` is not "a person" but "ask, don't decide", and once set the engine
   *  never chooses for that seat — ignored, too, once `riichiAt` is set (riichi locks every later
   *  discard to tsumogiri regardless of algorithm). */
  algorithm: SeatAlgorithm
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

/** One thing a seat may do with the tile someone else just discarded. `from` names the caller's
 *  own tiles that would join it — empty for a ron, two tiles for a pon or chi. Daiminkan is
 *  absent on purpose: the engine models no called kan at all (`chooseCall` never offers one
 *  either), so offering it to a manual seat alone would be the one call the AI seats cannot answer. */
export interface ClaimOption {
  kind: 'ron' | 'pon' | 'chi'
  from: TileId[]
}

/** A manual seat's reply to `ClaimOption`s. `'pass'` gives up every claim on that discard, ron
 *  included — which is what puts the seat in temporary furiten, exactly as declining costs an AI
 *  seat its ron. */
export type ClaimAnswer =
  { kind: 'pass' } | { kind: 'ron' } | { kind: 'pon' | 'chi'; from: TileId[] }

/** The decision the board is waiting on. While `RoundState.claim` is set the turn is suspended
 *  mid-discard: nobody draws, nobody discards, and `answerClaim` is the only way forward. */
export interface PendingClaim {
  /** Seat being asked right now. */
  seat: number
  /** Seat that made the discard. */
  from: number
  tile: RiverTile
  options: ClaimOption[]
  /** Every manual seat's answer to *this* discard so far, seat-indexed. Reactions are resolved
   *  from scratch each time one arrives (see `resolveReactions`), so this is what makes the
   *  re-run skip the seats already asked instead of asking them again. */
  answers: Record<number, ClaimAnswer>
}

export type RoundEvent =
  | { kind: 'draw'; seat: number; tile: ParsedTile }
  | { kind: 'discard'; seat: number; tile: RiverTile }
  | { kind: 'riichi'; seat: number }
  | { kind: 'call'; seat: number; from: number; meld: Meld }
  | { kind: 'win'; win: WinRecord }
  | { kind: 'exhaustive' }
  | { kind: 'kita'; seat: number; tile: ParsedTile | undefined }
  | { kind: 'ankan'; seat: number; tile: TileId; replacement: ParsedTile | undefined }

/** One seat's decision, logged the instant it's made — discard (with `fromDrawn`/`riichi`, the
 *  ground truth Phase 1 put on `Hand.drawn`), pon/chi (`Call` reused verbatim from `policy.ts`,
 *  since it's already the exact shape a replayed claim answer needs), kita, closed kan, and a win
 *  (tsumo when `from` is absent). No `kakan` — nothing in this engine models one (`buildContext`
 *  hardcodes `chankan: false`); no `pass`/decline — a claim nobody answered is already derivable
 *  by comparing who *could* have claimed against who's in the log (`resolveReactions` already does
 *  exactly this for `missedWin`), so logging silence would only be logging what `replayLog`
 *  (below) can already recompute. */
export type LogEntry =
  | { kind: 'discard'; seat: number; tile: ParsedTile; fromDrawn: boolean; riichi: boolean }
  | { kind: 'call'; seat: number; from: number; call: Call }
  | { kind: 'kita'; seat: number }
  | { kind: 'ankan'; seat: number; tile: TileId }
  | { kind: 'win'; seat: number; from?: number }

export interface RoundState {
  /** A copy of `RoundOptions.match`, taken once by `createRound` — the caller's own object is
   *  never written back to. Mutated within the round by a riichi declaration (T4); nothing here
   *  sequences to a next round. */
  match: MatchState
  players: PlayerState[]
  /** The complete wall this match dealt from, in draw order: each seat's 13 starting tiles, then
   *  the live draws, then the trailing 14 tiles the dead wall is cut from (rinshan last, the
   *  flipped dora indicator the 9th of the 14 — see `deadWallSnapshot`).
   *  Captured once in `createRound` and never touched again — unlike `liveWall`, which shrinks as
   *  the hand is played. */
  wall: ParsedTile[]
  liveWall: ParsedTile[]
  /** The live wall exactly as dealt — snapshotted once at the end of the deal, in `createRound`,
   *  and never touched again. `liveWall` above only holds what's left (`take()` shifts off its
   *  front, `drawReplacement()` pops its tail); the wall-reveal display walks this instead so it
   *  can show the whole wall, greying what's gone. See `wallDrawnCount`. */
  liveWallSnapshot: ParsedTile[]
  deadWall: ParsedTile[]
  /** All 14 dead-wall tiles in draw order — five dora stacks (each an indicator over the ura dora
   *  under it, the deal's own indicator being the *last* of the five) then the four rinshan tiles,
   *  which is where `drawReplacement` pops from. Captured once alongside `deadWall` and never
   *  touched again. */
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
  /** Every seat's decision, in order, from the top of the hand — the full record `replayLog`
   *  (`core/table.ts`) plays back. Sibling to `discards`, not its replacement: `discards`/`river`
   *  still feed genbutsu (`threatViews`), this feeds replay. Never popped. */
  log: LogEntry[]
  seat: number
  turn: number
  /** Cleared right after a call — the caller already holds 14 tiles and does not draw. */
  pendingDraw: boolean
  /** Replacement (rinshan) draws taken so far, counted in `drawReplacement`. Combined with the
   *  two snapshots above it lets a display reconstruct "already drawn/taken" without a fourth
   *  stored field — see `wallDrawnCount`. */
  replacements: number
  /** A manual seat's outstanding decision on the discard just made. Set only while the turn is
   *  suspended; `beginTurn`/`finishTurn` are no-ops until `answerClaim` clears it. */
  claim?: PendingClaim
  ended?: 'win' | 'exhaustive'
  win?: WinRecord
}

function createPlayer(algorithm: SeatAlgorithm = 'efficiency'): PlayerState {
  return {
    hand: createHand(),
    concealed: [],
    melds: [],
    river: [],
    ippatsu: false,
    nuki: [],
    missedWin: false,
    algorithm,
  }
}

/**
 * Deals a match from an explicit wall, in draw order: `wall`'s leading `players * 13` tiles ARE
 * the starting hands (seat 0's 13, then seat 1's, …), the trailing `DEAD_WALL_SIZE` are cut off
 * for the dead wall and its dora/ura stacks, and everything between is the live draw pool. A
 * short `wall` is a prefix — `completeWall` fills the remainder at random (or from `fillSeed`, for
 * reproducible tests/generation) from the copies it leaves.
 */
export function createRound(
  wall: ParsedTile[],
  players: number,
  options: RoundOptions,
  fillSeed?: string,
): RoundState {
  const full =
    wall.length >= fullWallSize(options.sanma)
      ? wall
      : completeWall(wall, options.sanma, options.aka, fillSeed)

  const doraStack: ParsedTile[] = []
  const uraStack: ParsedTile[] = []
  const doraIndicators: ParsedTile[] = []
  const pool = full.slice(players * INITIAL_HAND_SIZE)
  const reserved = Math.min(DEAD_WALL_SIZE, pool.length)
  const chunk = pool.slice(pool.length - reserved)
  // build order, before doraStack.shift() below peels its first tile off into doraIndicators
  const deadWallSnapshot = chunk
  const indicators = Math.min(MAX_DORA_INDICATORS, Math.floor(reserved / 2))
  // The dead wall's seven stacks, laid flat in draw order. The two stacks nearest the break —
  // the chunk's *tail*, which `drawReplacement` pops — are the four rinshan tiles; the five
  // before them are the dora stacks, each an indicator (the stack's top tile, drawn first) over
  // the ura dora under it. The stack nearest the rinshan is the one flipped at the deal, and
  // each kan dora walks back from there toward the live wall, so the indicators are read off
  // the pair block backwards while the pair itself stays in draw order.
  const deadWall = chunk.slice(indicators * 2)
  for (let stack = indicators - 1; stack >= 0; stack--) {
    doraStack.push(chunk[stack * 2])
    uraStack.push(chunk[stack * 2 + 1])
  }
  const first = doraStack.shift()
  if (first) doraIndicators.push(first)
  // uraStack stays whole and parallel: the ura for the Nth flipped indicator is uraStack[N-1],
  // which is why readers slice it by the number of indicators showing rather than shifting it

  const dealable = pool.slice(0, pool.length - reserved)
  const visible = new Uint8Array(NUM_TILE_TYPES)
  for (const indicator of doraIndicators) visible[indicator.id]++

  const state: RoundState = {
    match: { ...options.match, points: [...options.match.points] },
    players: Array.from({ length: players }, (_, seat) => createPlayer(options.algorithms?.[seat])),
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
    log: [],
    seat: 0,
    turn: 1,
    pendingDraw: true,
    replacements: 0,
  }

  // dealt the way a table deals: three rounds of four tiles per seat, then one apiece
  // (`DEAL_CHUNKS`), so a seat's thirteen are spread through the leading block rather than sitting
  // in it as one slab. `dealtSeat` is the same walk, read the other way round
  let cut = 0
  for (const size of DEAL_CHUNKS) {
    for (let i = 0; i < players; i++, cut += size) {
      const player = state.players[i]
      for (const t of full.slice(cut, cut + size)) {
        addTile(player.hand, t.id)
        insertConcealed(player, t)
      }
    }
  }
  // captured after the deal, not before: the snapshot is the wall play will actually draw from
  state.liveWallSnapshot = [...state.liveWall]
  return state
}

function take(state: RoundState, player: PlayerState): ParsedTile | undefined {
  const tile = state.liveWall.shift()
  if (!tile) return undefined
  addTile(player.hand, tile.id)
  player.concealed.push(tile)
  player.drawn = tile
  return tile
}

/** Inserts `tile` into `player.concealed` in sorted position (ascending id, a kind's red copy
 *  first) — used only for tiles that settle straight into the hand rather than sitting as the
 *  14th (the deal, and a ron tile's temporary probe in `tryWin`): a real draw instead appends via
 *  `player.drawn`, deliberately out of this order (see `PlayerState.concealed`). */
function insertConcealed(player: PlayerState, tile: ParsedTile): void {
  let i = player.concealed.length
  while (i > 0) {
    const prev = player.concealed[i - 1]
    if (prev.id < tile.id || (prev.id === tile.id && (prev.red || !tile.red))) break
    i--
  }
  player.concealed.splice(i, 0, tile)
}

/** Removes the one held copy matching `tile` exactly (id and redness) from `player.concealed`. */
function removeConcealed(player: PlayerState, tile: ParsedTile): void {
  const i = player.concealed.findIndex((t) => t.id === tile.id && t.red === tile.red)
  if (i >= 0) player.concealed.splice(i, 1)
}

/** The 14th tile has left, or was never really this seat's to hold (a call landing the turn on it
 *  without a draw) — clears `drawn` and restores the sorted invariant, since the one tile allowed
 *  to sit unsorted at the end was exactly the one this just unset. A no-op resort when nothing was
 *  out of place, which is the common case (the removal above already took the trailing element). */
function clearDrawn(player: PlayerState): void {
  player.drawn = undefined
  player.concealed.sort((a, b) => a.id - b.id || Number(b.red) - Number(a.red))
}

/** Concealed tiles for display/scoring: sorted (ascending id, a kind's red copy first) even while
 *  `player.concealed`'s own last slot is a not-yet-sorted 14th tile — every consumer here expects
 *  the drawn tile in its natural position among the rest and splits it back out by identity
 *  (`splitDrawn`), not by array position. */
export function concealedTiles(player: PlayerState): ParsedTile[] {
  return [...player.concealed].sort((a, b) => a.id - b.id || Number(b.red) - Number(a.red))
}

/** What this seat can see when deciding: every face-up tile plus its own hand. Clamped to
 *  `TILES_PER_KIND` as a safety net, not a behaviour change — face-up tiles and your own hand are
 *  disjoint sets, so the sum cannot legitimately exceed four copies; clamping means a future
 *  bookkeeping slip degrades an ukeire count instead of proposing a fifth copy. Exported (rather
 *  than wrapped only in `table.ts`) because `table.ts` imports this stepper, so this module must
 *  not import back from `table.ts` — the canonical computation has to live here. */
export function seenBy(state: RoundState, player: PlayerState): Uint8Array {
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
export function threatViews(state: RoundState): ThreatView[] {
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

/** Builds `seat`'s `SeatView` (`core/algorithm.ts`) as `state` stands right now — call it again
 *  after the board moves on rather than reusing an old one, since `seen`/`threats`/`furiten` cache
 *  only their own first read (same discipline as `core/table.ts#analysisOf`'s `TableAnalysis`).
 *  Lives here rather than in `algorithm.ts` itself so that module never has to import `RoundState`
 *  back from this one — `algorithm.ts` imports nothing from `round.ts`, `round.ts` imports
 *  `ALGORITHMS` from `algorithm.ts`, and importing back would be a cycle. */
function seatView(state: RoundState, options: RoundOptions, seat: number): SeatView {
  const player = state.players[seat]
  let seenCache: Uint8Array | undefined
  let threatsCache: ThreatView[] | undefined
  let furitenCache: boolean | undefined
  return {
    seat,
    hand: player.hand,
    concealed: player.concealed,
    drawn: player.drawn,
    melds: player.melds,
    river: player.river,
    riichi: player.riichiAt !== undefined,
    nuki: player.nuki.length,
    players: state.players.map((p) => ({
      river: p.river,
      melds: p.melds,
      riichi: p.riichiAt !== undefined,
      nuki: p.nuki.length,
    })),
    prevalentWind: state.match.prevalentWind,
    seatWind: HONOR + ((seat - state.match.dealer + state.players.length) % state.players.length),
    dealer: seat === state.match.dealer,
    turn: state.turn,
    wallLeft: state.liveWall.length,
    doraIndicators: state.doraIndicators,
    sanma: options.sanma,
    match: state.match,
    get seen() {
      return (seenCache ??= seenBy(state, player))
    },
    get threats() {
      return (threatsCache ??= threatViews(state))
    },
    get furiten() {
      return (furitenCache ??=
        isFuriten(waits(player.hand, options.sanma), player.river) || player.missedWin)
    },
  }
}

function buildContext(
  state: RoundState,
  seat: number,
  winTile: TileId,
  tsumo: boolean,
): WinContext {
  const player = state.players[seat]
  const riichi = player.riichiAt !== undefined
  const double = riichi && player.riichiTurn === 1
  return {
    round: state.match.prevalentWind,
    seat: HONOR + ((seat - state.match.dealer + state.players.length) % state.players.length),
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
  state: RoundState,
  seat: number,
  options: RoundOptions,
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
  if (!tsumo) {
    addTile(player.hand, tile.id)
    insertConcealed(player, tile)
  }
  const complete = decompose(player.hand.counts, player.melds).length > 0
  const concealed = complete ? concealedTiles(player) : []
  if (!tsumo) {
    removeTile(player.hand, tile.id)
    removeConcealed(player, tile)
  }
  if (!complete) return null
  // furiten is only worth computing once the tile is known to complete the hand
  if (!tsumo && (player.missedWin || isFuriten(waits(player.hand, options.sanma), player.river))) {
    return null
  }

  const ctx = buildContext(state, seat, tile.id, tsumo)
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
    rules: { kiriageMangan: false, honba: state.match.honba, sanma: options.sanma },
  })
  if (!score) return null

  // a human's own win is never an explicit choice here — riichi.wiki agrees a legal tsumo always
  // ends the hand, and a manual seat's own ron only ever reaches this function because the reader
  // already asked for it (`answerClaim`). Every other seat's algorithm gets to see the priced
  // candidate and decline it — an algorithm that can't see what it declines can't price it (ADR-0009).
  if (player.algorithm !== 'manual') {
    const candidate: WinCandidate = { tile, from, score }
    if (!ALGORITHMS[player.algorithm].win(seatView(state, options, seat), candidate)) return null
  }

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

function endWith(state: RoundState, win: WinRecord): RoundEvent[] {
  state.ended = 'win'
  state.win = win
  state.log.push({ kind: 'win', seat: win.seat, from: win.from })
  return [{ kind: 'win', win }]
}

/** Draws for the seat whose turn it is, and takes the tsumo if there is one. `declineTsumo` only
 *  ever matters for a manual seat: a manual seat's own win is otherwise unconditional (`tryWin`
 *  skips the algorithm ask entirely once `algorithm === 'manual'` — a real person's legal tsumo is
 *  never an explicit choice). Replay (`replayLog`) is the one caller that ever needs the opposite:
 *  every seat is forced manual there (so no algorithm is ever consulted), yet the *original* live
 *  play may have had this seat on `defense`/`tsumogiri` and genuinely declined a legal tsumo mid-
 *  hand — an outcome only representable by asking `beginTurn` not to take it. Every other caller
 *  omits the argument and gets exactly today's behaviour. */
export function beginTurn(
  state: RoundState,
  options: RoundOptions,
  declineTsumo = false,
): RoundEvent[] {
  // a pending claim suspends the whole turn: the discard it hangs on may still be ronned or
  // called, which decides whose turn comes next. One guard here (and in `finishTurn`) rather
  // than one in each of the four callers that step a match
  if (state.ended || state.claim) return []
  const player = state.players[state.seat]

  if (!state.pendingDraw) {
    state.pendingDraw = true
    clearDrawn(player)
    return []
  }
  if (state.liveWall.length === 0) {
    state.ended = 'exhaustive'
    return [{ kind: 'exhaustive' }]
  }

  const events: RoundEvent[] = []
  let tile = take(state, player)!
  events.push({ kind: 'draw', seat: state.seat, tile })

  // sanma nukidora: whether to pull a held north is the algorithm's own call (ADR-0009) — `efficiency`
  // prices it exactly as the efficiency trainer grades a manual seat's own pull, `defense` never
  // pulls (leaving the hand, not chasing dora). A fresh `SeatView` every iteration, same discipline
  // as `analysisOf`'s own doc comment: the hand (and `state.visible`) just changed underneath it,
  // so a reused view's cached `seen` would go stale on a second pull in the same turn.
  while (
    options.sanma &&
    player.algorithm !== 'manual' &&
    player.hand.counts[NORTH] > 0 &&
    ALGORITHMS[player.algorithm].kita(seatView(state, options, state.seat))
  ) {
    removeTile(player.hand, NORTH)
    removeConcealed(player, { id: NORTH, red: false })
    player.nuki.push({ id: NORTH, red: false })
    state.visible[NORTH]++
    state.log.push({ kind: 'kita', seat: state.seat })
    const replacement = drawReplacement(state, player)
    if (!replacement) break
    tile = replacement
    events.push({ kind: 'draw', seat: state.seat, tile })
  }

  const win = tryWin(state, state.seat, options, tile, true)
  if (win && !declineTsumo) return [...events, ...endWith(state, win)]
  return events
}

/** Replacement draw off the dead wall's far end, backfilled from the live wall tail so the dead
 *  wall keeps its size; straight off the live wall when there is no dead wall. */
export function drawReplacement(state: RoundState, player: PlayerState): ParsedTile | undefined {
  let tile = state.deadWall.pop()
  if (tile) {
    // counted only on this branch: it names tiles that left the live wall's *tail* as backfill.
    // With no dead wall the replacement comes off the front like any other draw, and the
    // front-draw derivation already accounts for it
    state.replacements++
    const backfill = state.liveWall.pop()
    if (backfill) state.deadWall.unshift(backfill)
    addTile(player.hand, tile.id)
    player.concealed.push(tile)
    player.drawn = tile
  } else {
    tile = take(state, player)
  }
  return tile
}

/** A manual (or replayed) seat pulling a held north — the mutation and its log entry together, so
 *  a caller can't do one without the other. `beginTurn`'s own kita loop covers AI seats; this is
 *  the entry point for everyone else, formerly hand-mutated by `useTableRound.ts#kita`. A no-op
 *  (`[]`) on an illegal call — wrong turn, hand already ended, a claim pending, no north held —
 *  same "untrusted caller" posture as `finishTurn`/`answerClaim`, rather than throwing. */
export function callKita(state: RoundState, options: RoundOptions, seat: number): RoundEvent[] {
  if (state.ended || state.claim || seat !== state.seat || !options.sanma) return []
  const player = state.players[seat]
  if (player.hand.counts[NORTH] === 0) return []
  removeTile(player.hand, NORTH)
  removeConcealed(player, { id: NORTH, red: false })
  player.nuki.push({ id: NORTH, red: false })
  state.visible[NORTH]++
  state.log.push({ kind: 'kita', seat })
  const tile = drawReplacement(state, player)
  return [{ kind: 'kita', seat, tile }, ...(tile ? [{ kind: 'draw', seat, tile } as const] : [])]
}

/** A manual (or replayed) seat calling a closed kan on a held quad — same reasoning as `callKita`:
 *  mutation and log entry together, formerly hand-mutated by `useTableRound.ts#kan`. No `options`
 *  parameter — unlike every other decision point here, nothing about ankan's legality or effect
 *  depends on any `RoundOptions` field (no wait-preserving-kan rule is modelled, same as kakan
 *  simply not existing) — so it is deliberately absent rather than threaded in unused. */
export function callAnkan(state: RoundState, seat: number, id: TileId): RoundEvent[] {
  if (state.ended || state.claim || seat !== state.seat) return []
  const player = state.players[seat]
  if (player.hand.counts[id] !== 4) return []
  const red = player.concealed.some((t) => t.id === id && t.red)
  for (let k = 0; k < 4; k++) {
    removeTile(player.hand, id)
    removeConcealed(player, { id, red: k === 0 && red })
  }
  player.hand.melds++
  state.visible[id] += 4
  const meld: Meld = {
    kind: 'ankan',
    tiles: [
      { id, red },
      { id, red: false },
      { id, red: false },
      { id, red: false },
    ],
  }
  player.melds.push(meld)

  const indicator = state.doraStack.shift()
  if (indicator) {
    state.doraIndicators.push(indicator)
    state.visible[indicator.id]++
  }
  state.log.push({ kind: 'ankan', seat, tile: id })
  const replacement = drawReplacement(state, player)
  return [
    { kind: 'ankan', seat, tile: id, replacement },
    ...(replacement ? [{ kind: 'draw', seat, tile: replacement } as const] : []),
  ]
}

/** How many tiles have left `liveWallSnapshot` from the front — real draws, as opposed to the
 *  `replacements` more that left off the tail to backfill the dead wall after a kan. Derived
 *  rather than stored: `liveWall.length` already nets both out, so front-only is what's left
 *  once `replacements` is subtracted back out. What the wall-reveal display greys. */
export function wallDrawnCount(state: RoundState): number {
  return state.liveWallSnapshot.length - state.liveWall.length - state.replacements
}

/**
 * Plays the current seat's discard — `discard` overrides the AI, which is how a manual seat takes
 * its turn — then lets every other seat react to it: ron first, then calls.
 *
 * `declareRiichi` is read only for a manual seat, where riichi has to be a choice: it locks every
 * later discard to tsumogiri, so the engine must never declare one on a player's behalf. An AI
 * seat ignores it and declares on its own terms, exactly as before.
 *
 * The reaction half can suspend (see `resolveReactions`) when a manual seat has a legal claim on
 * the discard. The turn is then unfinished until `answerClaim` resolves it.
 *
 * `beforeReactions` runs between the two halves — after the tile is on the river and any riichi is
 * declared, before any seat reacts. It exists because "the moment a riichi lands" is otherwise not
 * observable from outside: by the time `finishTurn` returns, the calls made on that declaration
 * tile have already happened.
 */
export function finishTurn(
  state: RoundState,
  options: RoundOptions,
  discard?: { tile: ParsedTile; fromDrawn: boolean },
  declareRiichi = false,
  beforeReactions?: (state: RoundState) => void,
): RoundEvent[] {
  if (state.ended || state.claim) return []
  const seat = state.seat
  const player = state.players[seat]
  const events: RoundEvent[] = []

  const forcedTsumogiri = player.riichiAt !== undefined && player.drawn !== undefined
  let tile: ParsedTile | undefined
  let fromDrawn: boolean
  // riichi first, *before* the explicit discard: the lock is a rule of the game, not a default an
  // argument may override. It used to sit in the `else` branch, so it only ever reached the seats
  // nobody was deciding for — a manual seat in riichi could hand in any tile it liked and the
  // engine threw it. Replay is unaffected: a riichi seat's logged discard is its drawn tile
  // already, so forcing it here resolves to the same tile the log names.
  if (forcedTsumogiri) {
    tile = player.drawn
    fromDrawn = true
  } else if (discard) {
    tile = discard.tile
    fromDrawn = discard.fromDrawn
  } else {
    // no explicit discard and not forced tsumogiri: `finishTurn` is being driven mechanically
    // (a test, `playRound`'s bare loop, `useFoldingRound.ts`'s own generation) rather than
    // through the interactive `discard()` path, which always supplies a tile for a real manual
    // seat's own turn — `goRound` never reaches this function for a manual seat either (it stops
    // at the top of its loop instead). A 'manual' seat caught here anyway still needs *some*
    // discard to keep the simulation moving, so it borrows 'efficiency''s.
    const algorithm = player.algorithm === 'manual' ? 'efficiency' : player.algorithm
    const picked = ALGORITHMS[algorithm].discard(seatView(state, options, seat))
    tile = pickTile(player, picked.tile)
    // not `picked.fromDrawn` — an algorithm decides at the kind level (`chooseDiscard` never sees
    // redness) and `pickTile` above always keeps a held red five over a duplicate plain one, which
    // can silently swap *which* physical copy leaves even when the kind matches the drawn one (draw
    // the aka, hold the plain: `pickTile` throws the plain copy, so it is tedashi, not tsumogiri).
    // Full identity against the actual resolved tile is ground truth; the id-only comparison an
    // algorithm can offer is not
    const drawn = player.drawn
    fromDrawn = drawn !== undefined && tile.id === drawn.id && tile.red === drawn.red
  }
  if (!tile) return events

  removeTile(player.hand, tile.id)
  removeConcealed(player, tile)
  // cleared here, not at the end: a naive end-of-function clear would leave `drawn` naming a
  // tile no longer in the hand while the riichi decision below builds its `SeatView`
  clearDrawn(player)

  // riichi is declared with the discard that reaches tenpai, so it is decided after the choice
  const declaring = canDeclareRiichi(state, options, seat)
    ? player.algorithm === 'manual'
      ? declareRiichi
      : ALGORITHMS[player.algorithm].riichi(seatView(state, options, seat))
    : false
  if (declaring) {
    player.riichiAt = player.river.length
    player.riichiTurn = state.turn
    player.ippatsu = true
    state.match.points[seat] -= 1000
    state.match.riichiSticks += 1
  } else if (player.riichiAt !== undefined) {
    // ippatsu survives only until this player's own next discard
    player.ippatsu = false
  }

  const entry: RiverTile = { id: tile.id, red: tile.red }
  if (fromDrawn) entry.tsumogiri = true
  // The rotated tile marks where this seat's river stopped being safe, so it has to survive the
  // declaration tile being called away: `resolveReactions` pops that tile out of the river, which
  // puts `river.length` back to exactly the `riichiAt` it was declared at, and the next discard
  // this seat makes lands in the same slot and takes the mark instead. One comparison covers both
  // — the declaration itself (`riichiAt` is set to `river.length` just above) and the re-rotation
  // after a call. `riichiAt` needs no repair for the same reason: the slot it names is refilled.
  if (player.riichiAt === player.river.length) entry.riichi = true
  player.river.push(entry)
  state.discards.push({ seat, tile: entry })
  // temporary furiten (declining a win on somebody else's discard) lasts until this seat has taken
  // its own turn — cleared here, on the discard that ends it, rather than on the draw that opened
  // it, so the badge is still up while the reader is deciding and can say why the ron was refused.
  // No ron is possible between the two moments either way: nobody else discards while this seat
  // holds its 14th. A seat in riichi keeps it for the rest of the hand, which is the actual rule
  // and the reason this is not a plain `= false`.
  player.missedWin = player.riichiAt !== undefined && player.missedWin
  state.log.push({
    kind: 'discard',
    seat,
    tile: { id: tile.id, red: tile.red },
    fromDrawn,
    riichi: declaring,
  })
  state.visible[tile.id]++
  if (declaring) events.push({ kind: 'riichi', seat })
  events.push({ kind: 'discard', seat, tile: entry })

  // the one seam between "the discard is on the river, riichi and all" and "everyone reacts to
  // it" — a riichi declared this turn is already visible to every seat about to decide, so a
  // caller that wants to act on the declaration (the folding drill flips every non-declarer to
  // `'defense'`) has to do it here or the seats it flips will already have called the declaration
  // tile with the algorithm they had a moment ago
  beforeReactions?.(state)

  return [...events, ...resolveReactions(state, options, seat, entry, {})]
}

/** Whether `seat` is in a position to declare riichi with the discard it has just made — the
 *  legality half only, shared by the engine's own declaration and by the UI's riichi button, so
 *  the button can never offer a declaration `finishTurn` would then refuse. Read *after* the
 *  tile has left the hand, since riichi is declared with the discard that reaches tenpai. */
export function canDeclareRiichi(state: RoundState, options: RoundOptions, seat: number): boolean {
  const player = state.players[seat]
  return (
    options.riichi &&
    player.riichiAt === undefined &&
    isMenzen(player.melds) &&
    shanten(player.hand) === 0 &&
    state.liveWall.length >= 4
  )
}

/**
 * Every seat's reaction to `entry`, the tile `discarder` has just thrown: ron first (in claim
 * order from the discarder), then calls, then handing the turn on.
 *
 * Manual seats are asked rather than decided for, which is what makes this restartable: it runs
 * from the top on every `answerClaim`, reading each manual seat's reply out of `answers` and
 * suspending again on the first one that has not replied yet. Everything it re-runs on the way
 * back through is idempotent — `tryWin` restores the hand it probes, `couldHaveWon` too, and
 * `missedWin` only ever goes true — so re-running costs a little work and changes nothing.
 *
 * The three phases are separate for priority's sake: every manual seat is asked before any ron
 * is awarded, so a pon answered early can never outrank a ron the seat order says comes first.
 */
function resolveReactions(
  state: RoundState,
  options: RoundOptions,
  discarder: number,
  entry: RiverTile,
  answers: Record<number, ClaimAnswer>,
): RoundEvent[] {
  const tile: ParsedTile = { id: entry.id, red: entry.red }
  const order = seatsFrom(state, discarder)

  for (const other of order) {
    if (!isManual(state, other) || answers[other]) continue
    const claims = claimOptions(state, options, other, tile, discarder)
    // nothing legal to offer is a pass nobody has to be asked about
    if (claims.length === 0) {
      answers[other] = { kind: 'pass' }
      continue
    }
    state.claim = { seat: other, from: discarder, tile: entry, options: claims, answers }
    return []
  }
  state.claim = undefined

  const events: RoundEvent[] = []
  for (const other of order) {
    const answer = answers[other]
    const wants = isManual(state, other) ? answer?.kind === 'ron' : true
    const win = wants ? tryWin(state, other, options, tile, false, discarder) : null
    if (win) {
      entry.win = true
      return [...events, ...endWith(state, win)]
    }
    // declining a win that was there is what makes a player temporarily furiten — for a manual
    // seat that passed just as much as for an AI seat, whose algorithm was genuinely asked.
    // A manual seat is the one case that can be skipped *without* being asked: with `claims` off
    // the engine never offers it a ron at all, so it cannot have declined one, and marking it
    // furiten would poison its hand over a decision nobody was given. Same rule `reconsiderClaim`
    // follows when it refuses to invent a pass on the reader's behalf.
    const asked = options.claims || !isManual(state, other)
    if (options.wins && asked && couldHaveWon(state, other, tile.id)) {
      state.players[other].missedWin = true
    }
  }

  if (options.calls) {
    for (const other of order) {
      const caller = state.players[other]
      if (caller.riichiAt !== undefined) continue
      // a manual seat's algorithm is never consulted here — it was asked instead
      const answer = answers[other]
      const call: Call | null =
        caller.algorithm === 'manual'
          ? answer && (answer.kind === 'pon' || answer.kind === 'chi')
            ? { kind: answer.kind, from: answer.from }
            : null
          : ALGORITHMS[caller.algorithm].call(
              seatView(state, options, other),
              tile.id,
              other === (discarder + 1) % state.players.length,
            )
      if (!call) continue

      const meldTiles: ParsedTile[] = [{ id: tile.id, red: tile.red }]
      for (const id of call.from) {
        const held: ParsedTile = { id, red: caller.concealed.some((t) => t.id === id && t.red) }
        meldTiles.push(held)
        removeTile(caller.hand, id)
        removeConcealed(caller, held)
      }
      meldTiles.sort((a, b) => a.id - b.id)
      const meld: Meld = { kind: call.kind, tiles: meldTiles }
      caller.melds.push(meld)
      caller.hand.melds++
      state.log.push({ kind: 'call', seat: other, from: discarder, call })
      // the claimed tile leaves the river and lives in the meld from here on — leaving it in
      // both is a duplicate copy of that tile on the table
      state.players[discarder].river.pop()
      // the called tile was already counted as visible when it was discarded
      for (const id of call.from) state.visible[id]++
      // a call kills every outstanding ippatsu
      for (const p of state.players) p.ippatsu = false

      state.seat = other
      state.pendingDraw = false
      events.push({ kind: 'call', seat: other, from: discarder, meld })
      return events
    }
  }

  state.seat = (discarder + 1) % state.players.length
  if (state.seat === state.match.dealer) state.turn++
  return events
}

/** Everything `seat` could legally do with `tile`, just discarded by `from`. Ron is offered only
 *  when it would really be awarded — `tryWin` already carries the yaku and furiten rules — so the
 *  UI never shows a button that turns out not to be a win. A seat in riichi is offered its ron
 *  and nothing else: it cannot open its hand. */
export function claimOptions(
  state: RoundState,
  options: RoundOptions,
  seat: number,
  tile: ParsedTile,
  from: number,
): ClaimOption[] {
  if (!options.claims) return []
  const player = state.players[seat]
  const claims: ClaimOption[] = []
  if (tryWin(state, seat, options, tile, false, from)) claims.push({ kind: 'ron', from: [] })
  if (options.calls && player.riichiAt === undefined) {
    const fromKamicha = seat === (from + 1) % state.players.length
    for (const call of availableCalls(player.hand, tile.id, fromKamicha)) {
      claims.push({ kind: call.kind, from: call.from })
    }
  }
  return claims
}

/**
 * Answers the claim the board is waiting on and carries the turn forward — into another seat's
 * claim, into a win, into a call, or simply on to the next seat's draw. A no-op when nothing is
 * pending, so a double-tap on the pass button cannot skip the next seat's question.
 */
export function answerClaim(
  state: RoundState,
  options: RoundOptions,
  answer: ClaimAnswer,
): RoundEvent[] {
  const claim = state.claim
  if (!claim) return []
  claim.answers[claim.seat] = answer
  state.claim = undefined
  return resolveReactions(state, options, claim.from, claim.tile, claim.answers)
}

/** Re-resolves the claim the board is waiting on from scratch, without adding an answer — for
 *  when the seat currently being asked stops being manual while its answer is still pending
 *  (a live algorithm flip, `useTableRound.ts`/`useFoldingRound.ts`): nobody will ever call
 *  `answerClaim` for it now, so the new algorithm has to decide instead, through the exact same
 *  restartable path `answerClaim` itself uses. Never invents a pass — that would set `missedWin`,
 *  poisoning the hand with furiten over a decision the reader never made. A no-op when nothing is
 *  pending. */
export function reconsiderClaim(state: RoundState, options: RoundOptions): RoundEvent[] {
  const claim = state.claim
  if (!claim) return []
  delete claim.answers[claim.seat]
  state.claim = undefined
  return resolveReactions(state, options, claim.from, claim.tile, claim.answers)
}

/**
 * Replays `log` from wherever `state` stands, driving every seat exactly as recorded — discard,
 * pon/chi, kita, closed kan, riichi, tsumo accept/decline — never asking an algorithm (this is
 * what makes a link immune to a later algorithm change): every seat's `algorithm` is forced to
 * `'manual'` for the duration, which is what makes `finishTurn`'s `discard`/`declareRiichi`
 * arguments, `answerClaim` and `beginTurn`'s `declineTsumo` the *only* things any decision can come
 * from. Restored to each seat's real algorithm before returning, live-flip style (same
 * override-then-restore shape `useTableRound.ts`'s ADR-0008 sync effect already uses).
 *
 * Stops quietly rather than throwing whenever the
 * hand ends, the log runs out, or the next entry doesn't describe what the hand is actually doing
 * (a caller feeding it a log that doesn't match `state`). Two things are deliberately never read
 * from the log because they're derivable from its *absence*: a claim (ron/pon/chi) nobody answered
 * is a pass, and a tsumo the log doesn't show accepted at this exact draw is declined — see
 * `resolveClaims` and the `acceptsTsumo` peek below. The one case that's neither "answer" nor
 * "silently pass" is the log running out exactly *while* a claim is pending: that means the
 * original recording stopped there because nothing had been decided yet, not because the answer
 * was a pass, so replay stops with `state.claim` still set for the live UI to resume — it must
 * never invent a pass there (a pass sets `missedWin`, poisoning the hand with furiten over a
 * decision nobody made).
 *
 * `options.claims` is forced on for the duration too, alongside `algorithm`: `resolveReactions`'s
 * ask-loop — and `claimOptions` underneath it — only ever suspends for a manual seat when
 * `claims` is set, which is exactly the machinery a log-driven answer needs to hook into. Without
 * it, a live match played entirely by algorithms (the ordinary case — nothing manual, `claims`
 * off, `resolveReactions` resolves ron/call inline in the same `finishTurn` call) would replay
 * with every claim silently auto-passed, since forcing `algorithm` alone doesn't reach the ask
 * loop at all. The caller's real `options` (including its real `claims`) is what every seat is
 * restored to read afterward — this override never escapes `replayLog` itself.
 *
 * Resumable by construction, with no cursor of its own to thread back in: every entry `replayLog`
 * ever consumes corresponds to exactly one push onto `state.log` (a discard, a kan/kita, a ron, an
 * accepted tsumo — the only things `i` ever advances past), and a decline or a synthesized pass
 * advances neither. So `state.log.length` *is* how far replay has gotten, whether that's from an
 * earlier call on this same `state` or from real live play before `replayLog` was ever called —
 * calling it again with the same (or a longer) `log` simply picks up from there.
 *
 * Returns how many log entries have now been consumed in total, so a caller can tell a replay
 * fell short of what it asked for.
 */
export function replayLog(
  state: RoundState,
  options: RoundOptions,
  log: readonly LogEntry[],
  onEvent?: (event: RoundEvent) => void,
): number {
  /** Forwards whatever a replayed step really emitted. Restored turns produce the *same* events a
   *  live turn does — that is the point of replaying through the engine rather than patching state
   *  — so a consumer can rebuild from one event stream instead of needing a second path for links
   *  (ADR-0012). Synthesizing these from `LogEntry` was impossible anyway: a logged call carries a
   *  `Call`, not the `Meld` it becomes, and a logged win carries no `WinRecord` at all. */
  const emit = (events: RoundEvent[]): RoundEvent[] => {
    if (onEvent) for (const event of events) onEvent(event)
    return events
  }
  const originalAlgorithms = state.players.map((p) => p.algorithm)
  for (const player of state.players) player.algorithm = 'manual'
  const replayOptions: RoundOptions = { ...options, claims: true }
  let i = state.log.length

  // drains every claim `state` is currently suspended on, feeding each seat's answer from the log
  // when present and synthesizing a pass when the log has more to say but not about this claim
  // (ADR-0021) — but never past the log's own end, per the doc comment above.
  const resolveClaims = (): boolean => {
    // once a real, log-matched ron or call has settled *this* discard, every seat still to be
    // asked is provably irrelevant to the outcome — seat-order priority means the confirmed ron
    // wins regardless of what a later seat would have said, and a confirmed call means the
    // ron-loop already found nobody, so a later seat's own call preference never gets reached
    // either. The original live match (almost always no seats manual, `claims` off) never even
    // asked them — its non-manual ron/call loops `return` the instant a winner or caller is
    // found, without ever touching a later seat's `couldHaveWon`. So once `resolved`, a pass is
    // safe to synthesize even past the log's own end; before that, running out of log genuinely
    // means "not decided yet" (see the doc comment above) — with two more exceptions. An empty
    // live wall: passing a claim nobody has claimed simply hands the turn to the next seat, and if
    // the wall is already dry that seat's next `beginTurn` sets `state.ended = 'exhaustive'` on its
    // own, no further log entry required — exactly why the *last* discard of an exhausted hand
    // logs no claim resolution at all today, live or replayed. And the caller's own real
    // `options.claims` (not `replayOptions.claims`, which is always forced on): when it was false,
    // the original recording could never have had a live human mid-decision here at all — every
    // seat's ask-loop suspension is purely this function's own internal mechanism for asking a
    // log instead of a person, so an unresolved claim at the log's end is proof the original
    // resolved it silently within one `finishTurn` call (or never modelled asking about it in the
    // first place), never a genuinely pending share link — safe to auto-pass regardless of the
    // wall. Only when `options.claims` was really on can the log legitimately end exactly here
    // because nobody had answered yet.
    let resolved = false
    while (state.claim) {
      const claim = state.claim
      if (i >= log.length) {
        if (!resolved && options.claims && state.liveWall.length > 0) return false
        emit(answerClaim(state, replayOptions, { kind: 'pass' }))
        continue
      }
      const entry = log[i]
      let answer: ClaimAnswer = { kind: 'pass' }
      if (entry.kind === 'win' && entry.seat === claim.seat && entry.from === claim.from) {
        answer = { kind: 'ron' }
        i++
        resolved = true
      } else if (entry.kind === 'call' && entry.seat === claim.seat && entry.from === claim.from) {
        answer = { kind: entry.call.kind, from: entry.call.from }
        i++
        resolved = true
      }
      emit(answerClaim(state, replayOptions, answer))
    }
    return true
  }

  const restore = () => {
    for (const [seat, algorithm] of originalAlgorithms.entries()) {
      state.players[seat].algorithm = algorithm
    }
  }

  if (!resolveClaims()) {
    restore()
    return i
  }

  // `i < log.length` alone would stop one turn too early on a hand that ran the wall dry: the
  // very last turn of an exhausted hand logs nothing at all (nobody claims, nobody draws again),
  // and `state.ended` only becomes 'exhaustive' once a `beginTurn` call actually finds the wall
  // empty. The `liveWall.length === 0` half of this admits exactly that one extra step and
  // nothing else — an *empty* wall means the next `beginTurn` can only ever end the hand or no-op
  // (never draw a tile the log never recorded), which is what makes it safe to take even past a
  // genuinely truncated log (mid-hand share link, or any other reason a caller stopped feeding
  // entries). A non-empty wall past the log's end has no such guarantee, so it stops here instead.
  while (!state.ended && (i < log.length || state.liveWall.length === 0)) {
    const seat = state.seat
    const next: LogEntry | undefined = log[i]
    const acceptsTsumo = next?.kind === 'win' && next.seat === seat && next.from === undefined
    emit(beginTurn(state, replayOptions, !acceptsTsumo))
    if (state.ended) {
      if (acceptsTsumo) i++
      break
    }

    // a kita/ankan pull draws a replacement, and — for an *AI*-decided seat — `beginTurn`'s own
    // loop prices a tsumo off whatever tile that replacement turns out to be, same as the initial
    // draw. Replaying a seat's own kita/ankan pulls one at a time via `callKita`/`callAnkan` (which
    // never check for a win themselves — a real manual seat's tsumo off a kita pull isn't an
    // engine-level concept at all, only an AI's automatic loop prices it) has to reproduce that
    // same check by hand after each pull, or an AI seat's tsumo-off-a-kita-replacement never fires
    // during replay.
    while (i < log.length) {
      const entry = log[i]
      if (entry.kind === 'kita' && entry.seat === seat) emit(callKita(state, replayOptions, seat))
      else if (entry.kind === 'ankan' && entry.seat === seat)
        emit(callAnkan(state, seat, entry.tile))
      else break
      i++

      const afterPull: LogEntry | undefined = log[i]
      const drawn = state.players[seat].drawn
      if (
        afterPull?.kind === 'win' &&
        afterPull.seat === seat &&
        afterPull.from === undefined &&
        drawn
      ) {
        const win = tryWin(state, seat, replayOptions, drawn, true)
        if (win) {
          emit(endWith(state, win))
          i++
        }
      }
    }
    if (state.ended) break

    const discardEntry = log[i]
    if (!discardEntry || discardEntry.kind !== 'discard' || discardEntry.seat !== seat) break
    emit(
      finishTurn(
        state,
        replayOptions,
        { tile: discardEntry.tile, fromDrawn: discardEntry.fromDrawn },
        discardEntry.riichi,
      ),
    )
    i++
    if (!resolveClaims()) break
  }

  restore()
  return i
}

/** Seats in claim order starting after `seat` — the order ron and calls are resolved in. */
function seatsFrom(state: RoundState, seat: number): number[] {
  const order: number[] = []
  for (let k = 1; k < state.players.length; k++) order.push((seat + k) % state.players.length)
  return order
}

/** A win this seat passed up, ignoring furiten — the test for *entering* temporary furiten. */
function couldHaveWon(state: RoundState, seat: number, tile: TileId): boolean {
  const player = state.players[seat]
  // same tenpai gate as tryWin, for the same reason
  if (shanten(player.hand) !== 0) return false
  addTile(player.hand, tile)
  const complete = decompose(player.hand.counts, player.melds).length > 0
  removeTile(player.hand, tile)
  return complete
}

/** The held copy of `id` to discard — an explicit policy over `concealed` now that it names each
 *  copy directly: with more than one held, the plain one goes and the red one stays; with exactly
 *  one, whichever it is leaves. Read-only, same as before — `finishTurn` still does the actual
 *  removal once it has the resolved tile. */
function pickTile(player: PlayerState, id: TileId): ParsedTile {
  const copies = player.concealed.filter((t) => t.id === id)
  if (copies.length === 0) return { id, red: false }
  return copies.length > 1 ? (copies.find((t) => !t.red) ?? copies[0]) : copies[0]
}

export interface RoundOutcome {
  state: RoundState
  events: RoundEvent[]
  ended: 'win' | 'exhaustive' | 'stopped'
}

/**
 * The one stepper: turn after turn, yielding every event as it happens. Being a generator is the
 * whole point — the caller decides when to stop simply by not asking for the next event, and
 * nothing further runs, so "play a whole hand", "play until someone declares riichi" and "play up
 * to the next seat a person has to decide for" stop being three loops and become three callers.
 *
 * `canAct` is asked once per turn, *before* anything is drawn, and is the only stop condition that
 * cannot be expressed by the caller walking away: by the time an event has been yielded its turn
 * has already run, so a caller that wants to refuse a turn has to say so before it starts.
 * `goRound` (`core/table.ts`) passes the manual-seat check through it. Omitted, every seat is
 * played — including a `'manual'` one, which `finishTurn` covers by borrowing `'efficiency'`'s
 * discard; `playRound` has always relied on that and a baked-in manual check would break it.
 *
 * The bound is a backstop against a rule bug spinning forever — a hand is ~18 turns. `ended` and
 * `claim` are re-checked each turn rather than trusted from the last one: `beginTurn` can end the
 * hand on a tsumo, and a claim suspends everything until `answerClaim` resolves it.
 *
 * The `drawn` check is what makes the generator safe to *resume* into a turn somebody else
 * started: a seat that stopped being manual mid-turn, or one `replayLog` left holding its 14th
 * tile, already has its draw sitting there, and `beginTurn` would happily take a second one on top
 * (`pendingDraw` only comes back down after the next `finishTurn`). One guard here rather than a
 * copy in each driver that can land mid-turn.
 */
export function* stepRound(
  state: RoundState,
  options: RoundOptions,
  canAct?: (state: RoundState) => boolean,
): Generator<RoundEvent> {
  for (let guard = 0; guard < 400; guard++) {
    if (state.ended || state.claim) return
    if (canAct && !canAct(state)) return
    if (state.players[state.seat].drawn === undefined) yield* beginTurn(state, options)
    yield* finishTurn(state, options)
  }
}

/** Plays `state` out from wherever it stands, accumulating every event. `stop` ends it early —
 *  that is how a generator asks for "the first match that reaches X" without knowing anything
 *  about how a hand is played. Shared by `playRound` (seeded, dealt fresh) and `playWall` (an
 *  explicit wall, already dealt). Note what `stop` sees: `beginTurn`/`finishTurn` each build their
 *  whole event array before `stepRound` yields any of it, so by the time a predicate fires on the
 *  riichi event that turn's discard and reactions have already been applied to `state` — stopping
 *  here never leaves a half-stepped turn behind. */
function playFrom(
  state: RoundState,
  options: RoundOptions,
  stop?: (event: RoundEvent, state: RoundState) => boolean,
): RoundOutcome {
  const events: RoundEvent[] = []
  for (const event of stepRound(state, options)) {
    events.push(event)
    if (stop?.(event, state)) return { state, events, ended: 'stopped' }
  }
  return { state, events, ended: state.ended ?? 'exhaustive' }
}

/** Plays a whole hand out from a seeded deal. */
export function playRound(
  seed: string,
  players: number,
  options: RoundOptions,
  stop?: (event: RoundEvent, state: RoundState) => boolean,
): RoundOutcome {
  return playFrom(createRound([], players, options, seed), options, stop)
}

/** Plays a whole hand out from an explicit wall — the scoring trainer's random-wall search
 *  (ADR-0005): unlike `playRound`'s seed suffixing, a fresh wall is dealt per attempt by handing in a
 *  short/empty wall each time, and the wall actually dealt (`outcome.state.wall`) is what gets
 *  shared, not a seed. */
export function playWall(
  wall: ParsedTile[],
  players: number,
  options: RoundOptions,
  stop?: (event: RoundEvent, state: RoundState) => boolean,
): RoundOutcome {
  return playFrom(createRound(wall, players, options), options, stop)
}

/**
 * Replays a seed, then `seed#1`, `seed#2`… until `accept` takes one. Same suffixing the trainers
 * use for restarts, so the accepted attempt's seed alone reproduces the whole match from a URL.
 */
export function findRound<T>(
  seed: string,
  players: number,
  options: RoundOptions,
  accept: (outcome: RoundOutcome) => T | null,
  maxAttempts = 40,
): { result: T; seed: string } | null {
  for (let i = 0; i < maxAttempts; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const result = accept(playRound(attemptSeed, players, options))
    if (result !== null) return { result, seed: attemptSeed }
  }
  return null
}

/** `findRound`, yielding between attempts so a trainer can paint a "dealing" state. */
export async function findRoundAsync<T>(
  seed: string,
  players: number,
  options: RoundOptions,
  accept: (outcome: RoundOutcome) => T | null,
  maxAttempts = 40,
): Promise<{ result: T; seed: string } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const result = accept(playRound(attemptSeed, players, options))
    if (result !== null) return { result, seed: attemptSeed }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return null
}
