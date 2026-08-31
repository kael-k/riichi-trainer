import { decompose, type Meld } from './agari'
import { ALGORITHMS, type AIAlgorithm, type SeatView, type WinCandidate } from './algorithm'
import { DEFAULT_EV_SEAT, type EvSeat } from './ev'
import type { ThreatView } from './danger'
import { addTile, createHand, removeTile, type Hand } from './hand'
import type { MatchState, RoundResult } from './match'
import {
  availableCalls,
  chooseDiscard,
  isFuriten,
  KYUUSHU_KINDS,
  kyuushuKinds,
  waits,
  type Call,
  type SeatAlgorithm,
} from './policy'
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
  /** Round a 4-han/30-fu or 3-han/60-fu win up to a flat mangan (`ScoringRules.kiriageMangan`,
   *  `core/score.ts`). Defaults to off, matching every trainer that predates the setting. */
  kiriageMangan?: boolean
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
  /** Seeds each player's `PlayerState.ev` — how an `'ev'` seat prices, model and objective — the
   *  same way `algorithms` seeds the algorithm itself, and with the same rule: seeding only, the
   *  live value moves on the player. A seat with no entry starts on `DEFAULT_EV_SEAT`, and every
   *  non-`'ev'` seat carries one and ignores it. */
  ev?: readonly (EvSeat | undefined)[]
  /** Let a seat abort the hand on kyuushu kyuuhai — nine or more distinct terminals and honours
   *  in an opening hand nobody has called on. **On by default**, because it is a rule of the game
   *  rather than a permission: the graded drills turn it off for the same reason they turn `wins`
   *  off, an ending the reader did not cause. The frozen golden hashes do not move for it either
   *  way — `efficiency`, `defense` and `tsumogiri` all decline, so only an `'ev-*'` seat (or a
   *  manual one, which is *asked*) ever aborts a hand. */
  abortiveDraws?: boolean
  /** Ask manual seats what to do with *other* seats' discards — ron, pon, chi. Off by default,
   *  and deliberately: the graded drills ask one question per turn ("what do you discard"), and a
   *  trainer that interrupted every ponnable tile with a prompt would be grading a different
   *  skill. The free-play boards turn it on. Independent of `calls`, which is about the AI. */
  claims?: boolean
  /** Called kan — daiminkan (kan on a discard, via `claimOptions`/`answerClaim`) and kakan (a
   *  seat's own added kan on a pon it already holds, via `callKakan`). **Ruleset, not permission**
   *  (a ruleset switch, not a permission): defaults `false`, set `true` only by the match trainer's own
   *  `RoundOptions`, so every graded drill's golden hash is untouched. `chooseCall` never sees the
   *  flag at all, so an AI seat never takes a minkan regardless of its value. Chankan (ron on a
   *  kakan's added tile) is **not** modelled — `callKakan`'s own doc comment names the gap. */
  calledKan?: boolean
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
   *  before any algorithm decision reads it. Replaces the old `Hand.drawn` (whose
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
  /** How this seat prices when its algorithm is `'ev'`. LIVE, exactly like `algorithm`: change the
   *  model or the objective mid-hand and the next decision obeys, no redeal. Always set, on every
   *  seat, so nothing downstream has to default an optional field. */
  ev: EvSeat
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
 *  own tiles that would join it — empty for a ron, two tiles for a pon or chi, three for a
 *  minkan. Daiminkan only ever appears here under `RoundOptions.calledKan` (match-only,
 *  `chooseCall` never offers one to an AI seat regardless of the flag, so offering it
 *  to a manual seat alone would be the one call the AI seats cannot answer everywhere else. */
export interface ClaimOption {
  kind: 'ron' | 'pon' | 'chi' | 'minkan'
  from: TileId[]
}

/** A manual seat's reply to `ClaimOption`s. `'pass'` gives up every claim on that discard, ron
 *  included — which is what puts the seat in temporary furiten, exactly as declining costs an AI
 *  seat its ron. It is also the decline for the two offers that are nobody's reaction to a
 *  discard, `'abort'`'s and `'tsumo'`'s, neither of which costs the seat anything. */
export type ClaimAnswer =
  | { kind: 'pass' }
  | { kind: 'ron' }
  | { kind: 'pon' | 'chi' | 'minkan'; from: TileId[] }
  | { kind: 'abort' }
  | { kind: 'tsumo' }

/**
 * The decision the board is waiting on. While `RoundState.claim` is set the turn is suspended:
 * nobody draws, nobody discards, and `answerClaim` is the only way forward.
 *
 * Three shapes, because there are three moments the engine has to stop and ask a manual seat
 * something it cannot decide for itself — a reaction to somebody else's discard, the acting seat's
 * own abortive draw, and its own completed hand. They share the suspension and `answerClaim`, not
 * their contents.
 */
export type PendingClaim = PendingDiscardClaim | PendingAbort | PendingWin

export interface PendingDiscardClaim {
  kind: 'discard'
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

/** The acting seat's own kyuushu kyuuhai offer, raised by `beginTurn` the moment its first draw
 *  lands. One seat, one question: nobody else reacts to it, so there is no `answers` map and no
 *  restart — `answerClaim` either ends the hand or hands the turn straight back, still mid-draw. */
export interface PendingAbort {
  kind: 'abort'
  /** Seat being asked — always the seat whose turn it is. */
  seat: number
  /** How many distinct terminals and honours the hand holds. It is what makes the offer legal,
   *  and it is the one number a prompt wants to show. */
  kinds: number
}

/**
 * The acting seat's own completed hand, priced and offered rather than taken. One seat,
 * one question, like `PendingAbort`: nobody else reacts to a tile you drew yourself.
 *
 * Raised only for a **manual** seat under `RoundOptions.claims` — an AI seat has already answered
 * through `Algorithm.win`, which is the same question asked of something that can price it, and a
 * board that never asks anybody (the graded drills, all of which run `wins: false` anyway) still
 * ends the instant the hand completes. A ron is never offered here: `claimOptions` already asked,
 * and by the time `tryWin` awards one the reader has said yes.
 */
export interface PendingWin {
  kind: 'win'
  /** Seat being asked — always the seat whose turn it is. */
  seat: number
  /** The tile that completed the hand: the draw, or the replacement off a kan or a kita. */
  tile: ParsedTile
  /** Already priced, so a prompt can show what declining costs and `answerClaim` can end the hand
   *  without asking twice. */
  win: WinRecord
}

export type RoundEvent =
  | { kind: 'draw'; seat: number; tile: ParsedTile }
  | { kind: 'discard'; seat: number; tile: RiverTile }
  | { kind: 'riichi'; seat: number }
  | { kind: 'call'; seat: number; from: number; meld: Meld }
  | { kind: 'win'; win: WinRecord }
  | { kind: 'exhaustive' }
  /** An abortive draw: the hand is over with nobody winning and nobody noten. `reason` is the
   *  only one modelled, and it is named rather than implied so a second one can be added without
   *  every reader having to guess which. */
  | { kind: 'abort'; seat: number; reason: 'kyuushu' }
  | { kind: 'kita'; seat: number; tile: ParsedTile | undefined }
  | { kind: 'ankan'; seat: number; tile: TileId; replacement: ParsedTile | undefined }
  /** A kakan — `seat`'s own added kan on a pon it already holds (`callKakan`), match-only
   *  (`RoundOptions.calledKan`). `'call'` above already carries daiminkan (a called kan is just
   *  another `Call.kind`); this is the acting seat's own-turn action, so it mirrors `'ankan'`
   *  rather than `'call'`. */
  | { kind: 'kakan'; seat: number; tile: TileId; replacement: ParsedTile | undefined }

/** One seat's decision, logged the instant it's made — discard (with `fromDrawn`/`riichi`, the
 *  ground truth Phase 1 put on `Hand.drawn`), pon/chi/minkan (`Call` reused verbatim from
 *  `policy.ts`, since it's already the exact shape a replayed claim answer needs), kita, closed
 *  kan, kakan, and a win (tsumo when `from` is absent). An `abort` entry is the one decision that
 *  ends the hand without anyone winning, and it is logged for the same reason a win is: nothing
 *  else in the log says the hand stopped there rather than being truncated.
 *
 *  `pass` is a manual seat's own declined ron/pon/chi/minkan, and it is the one entry kind that is
 *  never *required* to reproduce a hand — a claim nobody answered is otherwise derivable by
 *  comparing who *could* have claimed against who's in the log (`resolveReactions` already does
 *  exactly this for `missedWin`). It exists so a link cut exactly at a decline lands *past* the
 *  decision instead of re-offering it: without it, replay's own forced `claims: true` has no way
 *  to tell "genuinely not yet answered" (stop and wait) from "answered no" (move on), and asked
 *  the same question twice (#2). `answerClaim` writes one only for a `'pass'` it was actually
 *  asked to record; `resolveReactions`' own auto-pass for a seat with nothing legal to offer never
 *  reaches `answerClaim` at all, so it stays unlogged — nobody was asked. */
export type LogEntry =
  | { kind: 'discard'; seat: number; tile: ParsedTile; fromDrawn: boolean; riichi: boolean }
  | { kind: 'call'; seat: number; from: number; call: Call }
  | { kind: 'kita'; seat: number }
  | { kind: 'ankan'; seat: number; tile: TileId }
  | { kind: 'kakan'; seat: number; tile: TileId }
  | { kind: 'win'; seat: number; from?: number }
  | { kind: 'abort'; seat: number }
  | { kind: 'pass'; seat: number }

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
  /** `'abort'` is a ryuukyoku that is **not** an exhaustive draw: no seat is noten and nobody
   *  pays, so it stays a value of its own rather than borrowing `'exhaustive'`, which a future
   *  settlement would price wrongly. */
  ended?: 'win' | 'exhaustive' | 'abort'
  win?: WinRecord
}

function createPlayer(algorithm: SeatAlgorithm = 'efficiency', ev = DEFAULT_EV_SEAT): PlayerState {
  return {
    hand: createHand(),
    concealed: [],
    melds: [],
    river: [],
    ippatsu: false,
    nuki: [],
    missedWin: false,
    algorithm,
    ev,
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
    players: Array.from({ length: players }, (_, seat) =>
      createPlayer(options.algorithms?.[seat], options.ev?.[seat]),
    ),
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
    // the dealer leads, in this round and every round after it. The *deal* is index-order
    // (`dealtSeat`) and stays that way — this is play order, which is the dealer's, and
    // it is what `state.turn`'s own increment already assumes (`resolveReactions` steps the
    // counter when the turn comes back round to `match.dealer`). Every trainer but `/match` runs
    // `createMatch`'s `dealer: 0` default, so nothing else moves.
    seat: options.match.dealer,
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
    return [{ seat, discards, passed, riichiTurn: declarer.riichiTurn }]
  })
}

/** Builds `seat`'s `SeatView` (`core/algorithm.ts`) as `state` stands right now — call it again
 *  after the board moves on rather than reusing an old one, since `seen`/`threats`/`furiten` cache
 *  only their own first read (same discipline as `core/table.ts#analysisOf`'s `TableAnalysis`).
 *  Lives here rather than in `algorithm.ts` itself so that module never has to import `RoundState`
 *  back from this one — `algorithm.ts` imports nothing from `round.ts`, `round.ts` imports
 *  `ALGORITHMS` from `algorithm.ts`, and importing back would be a cycle.
 *
 *  Exported for `core/table.ts#evOf`: the EV layer prices the seat the same way an algorithm sees
 *  it, and a screen showing that arithmetic must be reading the same view the decision does. */
export function seatView(state: RoundState, options: RoundOptions, seat: number): SeatView {
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
    kiriageMangan: options.kiriageMangan ?? false,
    calledKan: options.calledKan ?? false,
    match: state.match,
    ev: player.ev,
    get seen() {
      return (seenCache ??= seenBy(state, player))
    },
    get threats() {
      return (threatsCache ??= threatViews(state))
    },
    get furiten() {
      return (furitenCache ??=
        isFuriten(seatWaits(player, options.sanma), player.river) || player.missedWin)
    },
  }
}

function buildContext(
  state: RoundState,
  seat: number,
  winTile: TileId,
  tsumo: boolean,
  rinshan: boolean,
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
    // rinshan kaihou: passed in rather than derived, because "this tile came off the dead wall"
    // is known only at the call site — `replacementWin` and the daiminkan's own replacement check
    // are the two, and every other caller is an ordinary draw or a ron. It was hardcoded `false`
    // while no replacement was ever win-checked at all; they all are now,
    // so leaving it false would quietly score every rinshan tsumo one han short.
    // **Chankan is still a real gap**: kakan exists (`callKakan`) but nothing offers other seats a
    // ron on the tile it adds — see that function's own doc comment.
    rinshan,
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
  /** The tile came off the dead wall — a kan's or a kita's replacement. Only the two callers that
   *  know it pass it; rinshan kaihou is worth a han and nothing else here depends on it. */
  rinshan = false,
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

  const ctx = buildContext(state, seat, tile.id, tsumo, rinshan)
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
    rules: {
      kiriageMangan: options.kiriageMangan ?? false,
      honba: state.match.honba,
      sanma: options.sanma,
    },
  })
  if (!score) return null

  // a human's own win is never an explicit choice here — riichi.wiki agrees a legal tsumo always
  // ends the hand, and a manual seat's own ron only ever reaches this function because the reader
  // already asked for it (`answerClaim`). Every other seat's algorithm gets to see the priced
  // candidate and decline it — an algorithm that can't see what it declines can't price it.
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

/**
 * Ends the hand on `win`, or — for a manual seat the board is allowed to ask (`RoundOptions.claims`)
 * — suspends and offers it. Every **self-drawn** win goes through
 * here: the turn's own draw, and the replacement off a kan or a kita.
 *
 * A ron does not, and must not: `claimOptions` already put the question to the reader and
 * `answerClaim` only reaches `tryWin` once they have said yes, so routing it through here would
 * ask the same question twice. An AI seat does not either — `tryWin` has already consulted
 * `Algorithm.win`, which is the same decision asked of something that can price it.
 *
 * `tile` is what completed the hand; the prompt draws it, and `reconsiderClaim` re-prices from it
 * if the seat stops being manual before it answers.
 */
function offerOrEnd(
  state: RoundState,
  options: RoundOptions,
  win: WinRecord,
  tile: ParsedTile,
): RoundEvent[] {
  if (!options.claims || !isManual(state, win.seat)) return endWith(state, win)
  state.claim = { kind: 'win', seat: win.seat, tile, win }
  return []
}

/** Draws for the seat whose turn it is, and settles the tsumo if there is one — ending the hand,
 *  or offering it to a manual seat the board may ask (`offerOrEnd`).
 *
 *  `declineTsumo` skips the question entirely, and `replayLog` is its only caller: every seat is
 *  forced manual there, so the *original* live play's own answer — an AI seat on `defense` that
 *  declined, or a person who played on — is only representable by asking `beginTurn` not to raise
 *  it at all. Where the log does record the win, replay leaves this `false` and answers the offer
 *  it gets back. Every other caller omits the argument. */
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
  const tile = take(state, player)!
  events.push({ kind: 'draw', seat: state.seat, tile })

  // the tsumo is priced on the tile just drawn, and nothing runs before it: a seat's own kita and
  // kans are `finishTurn`'s, which is what stops a kita from spending a tile that had
  // already completed the hand. This used to be the other way round — the kita loop ran here and
  // `tryWin` saw only the last replacement.
  const win = tryWin(state, state.seat, options, tile, true)
  if (win && !declineTsumo) return [...events, ...offerOrEnd(state, options, win, tile)]

  // kyuushu kyuuhai, asked *after* the tsumo check: a dealt thirteen-orphan kokushi is nine
  // distinct terminals and a completed hand at once, and the win outranks the abort. A manual
  // seat is asked rather than decided for, exactly like riichi, which suspends the turn with its
  // fourteenth tile still in hand — `answerClaim` either ends the hand or hands the turn back.
  if (canDeclareKyuushu(state, options, state.seat)) {
    if (player.algorithm === 'manual') {
      state.claim = { kind: 'abort', seat: state.seat, kinds: kyuushuKinds(player.hand) }
      return events
    }
    if (ALGORITHMS[player.algorithm].abort(seatView(state, options, state.seat))) {
      return [...events, ...abortRound(state, state.seat)]
    }
  }
  return events
}

/**
 * Whether `seat` may abort the hand on kyuushu kyuuhai right now: its own first draw of the hand,
 * with nobody having called anything, holding nine or more distinct terminals and honours.
 *
 * The legality half only — same split `canDeclareRiichi` makes, so a UI button can never offer a
 * declaration `answerClaim` would then refuse. Read *after* the draw, with the fourteenth tile
 * still in hand.
 *
 * "First draw, uninterrupted" is `river.length === 0` on this seat plus no melds anywhere, not
 * `state.turn === 1`: the counter names the go-around, so it reads `1` for every seat's opening
 * turn and says nothing about whether anybody has acted since. Nukidora is deliberately not
 * disqualifying — a kita is not a call, and it leaves no meld behind.
 */
export function canDeclareKyuushu(state: RoundState, options: RoundOptions, seat: number): boolean {
  const player = state.players[seat]
  return (
    (options.abortiveDraws ?? true) &&
    player.drawn !== undefined &&
    player.river.length === 0 &&
    state.players.every((p) => p.melds.length === 0) &&
    kyuushuKinds(player.hand) >= KYUUSHU_KINDS
  )
}

/** Ends the hand with nobody winning and nobody noten. */
function abortRound(state: RoundState, seat: number): RoundEvent[] {
  state.ended = 'abort'
  state.log.push({ kind: 'abort', seat })
  return [{ kind: 'abort', seat, reason: 'kyuushu' }]
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

/**
 * The win a replacement draw completes — rinshan kaihou's own moment. Every kan and every kita
 * ends here, so the three `call*` functions below each price the tile they just drew rather than
 * leaving it to whoever called them: the turn loop used to do it for an AI seat and nobody did it
 * at all for a manual one, which is why a reader's rinshan tsumo simply vanished.
 *
 * Returns `[]` when the replacement completes nothing, which is the overwhelmingly common case.
 */
function replacementWin(
  state: RoundState,
  options: RoundOptions,
  seat: number,
  tile: ParsedTile,
): RoundEvent[] {
  const win = tryWin(state, seat, options, tile, true, undefined, true)
  return win ? offerOrEnd(state, options, win, tile) : []
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
  const events: RoundEvent[] = [
    { kind: 'kita', seat, tile },
    ...(tile ? [{ kind: 'draw', seat, tile } as const] : []),
  ]
  return tile ? [...events, ...replacementWin(state, options, seat, tile)] : events
}

/** A manual (or replayed) seat calling a closed kan on a held quad — same reasoning as `callKita`:
 *  mutation and log entry together, formerly hand-mutated by `useTableRound.ts#kan`. No `options`
 *  parameter — unlike every other decision point here, nothing about ankan's legality or effect
 *  depends on any `RoundOptions` field (no wait-preserving-kan rule is modelled) — so it is
 *  deliberately absent rather than threaded in unused. Ankan is legal regardless of
 *  `RoundOptions.calledKan`, which only gates the two genuinely *new* meld types below
 *  (`callKakan`, and daiminkan inside `resolveReactions`) — closed kan was always in this engine. */
export function callAnkan(
  state: RoundState,
  options: RoundOptions,
  seat: number,
  id: TileId,
): RoundEvent[] {
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
  const events: RoundEvent[] = [
    { kind: 'ankan', seat, tile: id, replacement },
    ...(replacement ? [{ kind: 'draw', seat, tile: replacement } as const] : []),
  ]
  return replacement ? [...events, ...replacementWin(state, options, seat, replacement)] : events
}

/**
 * A manual (or replayed) seat upgrading its own open pon into a kan (kakan/加槓) by adding the
 * fourth copy it now holds — match-only (`RoundOptions.calledKan`), same reasoning as daiminkan.
 * Mirrors `callAnkan`'s shape (mutate, log, flip a kan dora, draw a replacement) but upgrades an
 * existing meld rather than building a fresh one, and does **not** touch `hand.melds` — the pon
 * already counted as one completed block; kakan only changes what that block is worth.
 *
 * **Chankan is not modelled.** A real kakan briefly exposes the added tile to every other seat's
 * ron before the kan completes; this engine skips straight to completing it. The gap is narrow
 * (chankan is rare) but real — see `docs/model/limits.md#not-modelled`. Wiring a
 * third `PendingClaim` shape through `answerClaim`/`reconsiderClaim`/`replayLog` for one rare yaku
 * is a second, much larger change (`buildContext`'s own comment names the other half). The meld
 * is replaced, never mutated in place, because `core/table.ts#snapshotTable` shallow-copies
 * `melds` per seat but keeps the same `Meld` objects — mutating one in place would silently
 * corrupt an already-taken snapshot still holding that reference.
 */
export function callKakan(
  state: RoundState,
  options: RoundOptions,
  seat: number,
  id: TileId,
): RoundEvent[] {
  if (!options.calledKan || state.ended || state.claim || seat !== state.seat) return []
  const player = state.players[seat]
  const idx = player.melds.findIndex((m) => m.kind === 'pon' && m.tiles[0].id === id)
  if (idx < 0 || player.hand.counts[id] < 1) return []

  const added: ParsedTile = { id, red: player.concealed.some((t) => t.id === id && t.red) }
  removeTile(player.hand, id)
  removeConcealed(player, added)
  const meld = player.melds[idx]
  player.melds[idx] = { kind: 'minkan', tiles: [...meld.tiles, added].sort((a, b) => a.id - b.id) }
  state.visible[id]++

  const indicator = state.doraStack.shift()
  if (indicator) {
    state.doraIndicators.push(indicator)
    state.visible[indicator.id]++
  }
  state.log.push({ kind: 'kakan', seat, tile: id })
  const replacement = drawReplacement(state, player)
  const events: RoundEvent[] = [
    { kind: 'kakan', seat, tile: id, replacement },
    ...(replacement ? [{ kind: 'draw', seat, tile: replacement } as const] : []),
  ]
  return replacement ? [...events, ...replacementWin(state, options, seat, replacement)] : events
}

/** How many tiles have left `liveWallSnapshot` from the front — real draws, as opposed to the
 *  `replacements` more that left off the tail to backfill the dead wall after a kan. Derived
 *  rather than stored: `liveWall.length` already nets both out, so front-only is what's left
 *  once `replacements` is subtracted back out. What the wall-reveal display greys. */
export function wallDrawnCount(state: RoundState): number {
  return state.liveWallSnapshot.length - state.liveWall.length - state.replacements
}

/** The ended round's result in the shape `settleRound` (`core/match.ts`) consumes.
 *  `undefined` while the hand is still running. Tenpai (exhaustive draw only) is read straight
 *  off every seat's 13-tile hand — nobody has a pending draw at that point, `beginTurn` sets
 *  `state.ended` the moment it finds the wall dry, before drawing. */
export function roundResult(state: RoundState): RoundResult | undefined {
  if (state.ended === 'win' && state.win) {
    const { seat, from, score } = state.win
    return { ended: 'win', win: { seat, from, payments: score.payments } }
  }
  if (state.ended === 'exhaustive') {
    const tenpai = state.players
      .map((player, seat) => (shanten(player.hand) === 0 ? seat : -1))
      .filter((seat) => seat >= 0)
    return { ended: 'exhaustive', tenpai }
  }
  if (state.ended === 'abort') return { ended: 'abort' }
  return undefined
}

/** Four kans and four kita is the whole of what one turn can physically hold. The bound is a
 *  backstop against a rule bug spinning forever, the same posture `stepRound`'s own 400 takes. */
const MAX_TURN_ACTIONS = 8

/**
 * Asks the seat's algorithm what to do with its own turn, over and over, until it answers with a
 * discard — the kita and the kans of one turn, ranked by the algorithm rather than by this
 * function's loop order. Returns the tile kind to throw, or `undefined` when the hand
 * ended here on a replacement draw.
 *
 * Three rules it keeps, each one an existing one:
 *
 * - **A manual seat never reaches it.** A manual seat is drawn for but never decided for
 *: its kita and kans come in through `callKita`/`callAnkan`/`callKakan`
 *   from the UI, and `finishTurn` calls this only for a seat an algorithm really owns.
 * - **A seat in riichi may pull a north and nothing else.** Nukidora is legal under a declared
 *   hand and the engine has always allowed it — the pull replaces the tile the seat is locked to
 *   and leaves the wait exactly where it was. A *kan* is refused: no wait-preserving-kan rule is
 *   modelled here, so a declared seat declares none. This is why the loop runs before
 *   `finishTurn` reads `forcedTsumogiri` rather than after — the locked tile is whatever the last
 *   replacement turned out to be.
 * - **An illegal action is a no-op, not a throw.** `callKita`/`callAnkan`/`callKakan` each check
 *   their own legality and return no events, which is this loop's signal to stop asking and fall
 *   through to a discard — the same untrusted-caller posture `finishTurn` and `answerClaim` hold.
 *
 * A fresh `SeatView` every iteration, same discipline as `analysisOf`'s own doc comment: the hand
 * and `state.visible` just changed underneath it, so a reused view's cached `seen` would go stale.
 * And every replacement is win-checked here, because `callAnkan`/`callKakan`/`callKita` never do
 * it themselves — without this a rinshan tsumo would vanish silently (the yaku itself is still
 * unimplemented, so the win is taken without it, exactly as a kita's replacement has always been).
 */
function takeTurn(
  state: RoundState,
  options: RoundOptions,
  seat: number,
  algorithm: AIAlgorithm,
  events: RoundEvent[],
): TileId | undefined {
  const player = state.players[seat]
  for (let guard = 0; guard < MAX_TURN_ACTIONS; guard++) {
    const action = ALGORITHMS[algorithm].turn(seatView(state, options, seat))
    if (action.kind === 'discard') return action.tile
    if (player.riichiAt !== undefined && action.kind !== 'kita') break
    const applied =
      action.kind === 'kita'
        ? callKita(state, options, seat)
        : action.kind === 'ankan'
          ? callAnkan(state, options, seat, action.tile)
          : callKakan(state, options, seat, action.tile)
    if (applied.length === 0) break
    events.push(...applied)
    // the replacement is priced by `call*` itself (`replacementWin`) rather than here, so the one
    // rinshan check covers a manual seat's own pull too. The hand may therefore be over already
    if (state.ended) return undefined
    // read off the events rather than `player.drawn`: with the dead wall spent there is no
    // replacement at all, and the hand is left at thirteen tiles with nothing to rank
    if (!applied.some((e) => e.kind === 'draw')) break
  }
  // the loop stopped without a discard — an action the engine refused, a dead wall that ran out,
  // or the bound. The seat still owes a tile, so it borrows `'efficiency'`'s, exactly as a manual
  // seat caught by the branch below does.
  return chooseDiscard(player.hand, seenBy(state, player), options.sanma).discard
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

  // A seat an algorithm owns takes the whole of its own turn here — its kita and its kans ranked
  // against its discard in one place, *before* the locked-tile read below, since a
  // nukidora pull replaces the tile a declared seat is locked to.
  const decided =
    !discard && player.algorithm !== 'manual'
      ? takeTurn(state, options, seat, player.algorithm, events)
      : undefined
  // the loop can end the hand on a rinshan tsumo, and then there is nothing left to throw
  if (state.ended) return events

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
    // discard to keep the simulation moving, so it borrows 'efficiency''s — and only its
    // discard: the turn loop is not run for it, since a manual seat is never auto-kita'd or
    // auto-kanned.
    const picked =
      decided ?? chooseDiscard(player.hand, seenBy(state, player), options.sanma).discard
    tile = pickTile(player, picked)
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
  // **`!declaring` is load-bearing**: `riichiAt` was set a few lines above, on *this* discard, so
  // without it the clause reads true for the first time on the declaring turn and freezes a
  // temporary furiten from the previous go-around into a permanent one — `tryWin` then refuses
  // every ron for the rest of the hand. The rule is about a seat that was *already* declared when
  // it passed the win, not about the declaration that ends the turn the furiten expires on.
  player.missedWin = !declaring && player.riichiAt !== undefined && player.missedWin
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
    state.claim = {
      kind: 'discard',
      seat: other,
      from: discarder,
      tile: entry,
      options: claims,
      answers,
    }
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
          ? answer && (answer.kind === 'pon' || answer.kind === 'chi' || answer.kind === 'minkan')
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

      events.push({ kind: 'call', seat: other, from: discarder, meld })
      // a minkan is a kan like any other: it flips a kan dora and draws a replacement before the
      // caller owes its discard — same tail `callAnkan`/`callKakan` run, folded in here rather
      // than duplicated a third time
      if (call.kind === 'minkan') {
        const indicator = state.doraStack.shift()
        if (indicator) {
          state.doraIndicators.push(indicator)
          state.visible[indicator.id]++
        }
        const replacement = drawReplacement(state, caller)
        if (replacement) {
          events.push({ kind: 'draw', seat: other, tile: replacement })
          // and the same win check every other replacement gets. `drawReplacement`
          // never runs one itself, and this is the one kan path no caller was covering: the turn
          // loop checks the replacements it draws, `replayLog` checks a replayed pull, and a
          // daiminkan's landed in neither — so a hand completed here vanished instead of ending
          // the round. Scored as an ordinary tsumo: rinshan kaihou the yaku is still unmodelled.
          const win = tryWin(state, other, options, replacement, true, undefined, true)
          if (win) {
            const resolved = offerOrEnd(state, options, win, replacement)
            // a *declined* offer leaves the caller holding its replacement and owing a discard, so
            // the turn has to be handed over before this returns — the fall-through below is
            // unreachable once a claim is pending
            if (state.claim) {
              state.seat = other
              state.pendingDraw = false
            }
            return [...events, ...resolved]
          }
        }
      }

      state.seat = other
      state.pendingDraw = false
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
    for (const call of availableCalls(player.hand, tile.id, fromKamicha, options.calledKan)) {
      claims.push({ kind: call.kind, from: call.from })
    }
  }
  return claims
}

/**
 * Answers the claim the board is waiting on and carries the turn forward — into another seat's
 * claim, into a win, into a call, or simply on to the next seat's draw. A no-op when nothing is
 * pending, so a double-tap on the pass button cannot skip the next seat's question.
 *
 * `record` (default `true`) is `replayLog`'s own knob: a `'pass'` it read off a real logged entry
 * is written back (a no-op the second time through, since replay never revisits a resolved
 * discard), while a pass it merely *infers* — nothing in the log named this seat's answer — must
 * not be, or replaying an old link would invent `LogEntry`s live play never produced. Live callers
 * (`useRound.ts`) always take the default: every answer a person actually gives is real.
 */
export function answerClaim(
  state: RoundState,
  options: RoundOptions,
  answer: ClaimAnswer,
  record = true,
): RoundEvent[] {
  const claim = state.claim
  if (!claim) return []
  if (claim.kind === 'win') {
    state.claim = undefined
    // declining costs the seat nothing — furiten is a rule about a *ron* you passed up, and this
    // tile was self-drawn. It is still in hand, and the seat still owes the discard `beginTurn`
    // (or the kan/kita that drew it) suspended before, which is exactly where this returns to
    return answer.kind === 'tsumo' ? endWith(state, claim.win) : []
  }
  if (claim.kind === 'abort') {
    state.claim = undefined
    // anything but an abort carries the turn straight on: the seat still holds its fourteenth
    // tile and still owes a discard, which is exactly where `beginTurn` suspended it. Nothing
    // else has to be undone, and declining costs the seat nothing — unlike a passed ron, an
    // abortive draw nobody took leaves no furiten behind
    return answer.kind === 'abort' ? abortRound(state, claim.seat) : []
  }
  // logged *before* `resolveReactions` runs, so a declining seat's pass sits ahead of whatever
  // entry a later seat's ron/call appends on the same discard
  if (record && answer.kind === 'pass') state.log.push({ kind: 'pass', seat: claim.seat })
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
  if (claim.kind === 'win') {
    // still manual: the question is still theirs, so the offer stays on the table
    if (isManual(state, claim.seat)) return []
    state.claim = undefined
    // re-priced rather than taken from the claim: `tryWin` skipped `Algorithm.win` while the seat
    // was manual, and the algorithm it has just been given is entitled to decline
    const win = tryWin(state, claim.seat, options, claim.tile, true)
    return win ? endWith(state, win) : []
  }
  if (claim.kind === 'abort') {
    // still manual: the question is still theirs, so the offer stays on the table
    if (isManual(state, claim.seat)) return []
    state.claim = undefined
    const algorithm = state.players[claim.seat].algorithm as AIAlgorithm
    return ALGORITHMS[algorithm].abort(seatView(state, options, claim.seat))
      ? abortRound(state, claim.seat)
      : []
  }
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
 * override-then-restore shape `useTableRound.ts`'s own algorithm-sync effect already uses).
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
   *. Synthesizing these from `LogEntry` was impossible anyway: a logged call carries a
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
  // — but never past the log's own end, per the doc comment above.
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
    // Consumed out of order, relative to `i`: `resolveReactions` asks every manual seat before
    // resolving anything (`round.ts`'s own "ask every manual seat, then rons, then calls" rule),
    // but replay forces *every* seat manual, so it asks seats live never asked at all. A seat
    // asked early in `seatsFrom(discarder)` order can have its own log entry sitting *behind* a
    // seat asked later — e.g. live's one manual seat passes, is logged, and only then does an AI
    // seat two-hops-later reach the call it actually made — so a straight `log[i]` peek would read
    // that pass as "not for me" and quietly drop the later seat's real, recorded call.
    const used = new Set<number>()
    const advance = (at: number) => {
      used.add(at)
      while (used.has(i)) {
        used.delete(i)
        i++
      }
    }
    // an abort offer is nobody's reaction to a discard, so it is not this loop's to answer: it is
    // raised by `beginTurn` and answered in the turn body below, which is also where a resumed
    // replay picks one up
    while (state.claim?.kind === 'discard') {
      const claim = state.claim
      // the run of entries that could possibly answer *any* seat's reaction to this one discard:
      // zero or more passes, then at most one terminal ron/call — bounded by the first entry that
      // isn't one of those, which can only be the next turn's own discard/kita/ankan/kakan/abort.
      let end = i
      while (
        end < log.length &&
        (log[end].kind === 'pass' || log[end].kind === 'call' || log[end].kind === 'win')
      ) {
        end++
      }
      let at = -1
      for (let k = i; k < end; k++) {
        if (used.has(k)) continue
        const entry = log[k]
        if (
          (entry.kind === 'pass' && entry.seat === claim.seat) ||
          ((entry.kind === 'win' || entry.kind === 'call') &&
            entry.seat === claim.seat &&
            entry.from === claim.from)
        ) {
          at = k
          break
        }
      }
      if (at === -1) {
        // truncation is about the *whole* log having nothing left, never about this one window:
        // a seat asked earlier than the actual ron/call (e.g. seat 0 in `seatsFrom` order when the
        // real reaction was seat 1's, logged after seat 0's own unlogged silent decline) still has
        // that later entry sitting unconsumed past this window's own match search — `i` (not
        // `end`) is what proves nothing else is coming.
        if (i >= log.length) {
          if (!resolved && options.claims && state.liveWall.length > 0) return false
        }
        // nothing in the window named this seat's answer — an inferred pass, not a recorded one
        emit(answerClaim(state, replayOptions, { kind: 'pass' }, false))
        continue
      }
      const entry = log[at]
      advance(at)
      if (entry.kind === 'win') {
        resolved = true
        emit(answerClaim(state, replayOptions, { kind: 'ron' }))
      } else if (entry.kind === 'call') {
        resolved = true
        emit(answerClaim(state, replayOptions, { kind: entry.call.kind, from: entry.call.from }))
      } else {
        // a logged decline (#2) — consumed and re-recorded, same as any other replayed entry
        emit(answerClaim(state, replayOptions, { kind: 'pass' }))
      }
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
    // every replayed seat is forced manual and `claims` is forced on, so a tsumo the log *does*
    // record comes back as an offer rather than an ending. `declineTsumo` above already
    // suppressed the ones it does not record, so anything pending here is a yes
    if (state.claim?.kind === 'win') emit(answerClaim(state, replayOptions, { kind: 'tsumo' }))
    if (state.ended) {
      if (acceptsTsumo) i++
      break
    }

    // every replayed seat is forced manual, so `beginTurn` raises the kyuushu offer for seats
    // that were on an algorithm in live play and declined it silently. The log says which took
    // it; nothing at all is a decline, exactly the way a claim nobody answered is a pass. The one
    // case that is not a decline is the log running out here with the seat *really* manual — the
    // original recording stopped with the offer still on the table, and inventing an answer for
    // it would land past the decision the link was shared at.
    if (state.claim?.kind === 'abort') {
      const offered = log[i]
      const taken = offered?.kind === 'abort' && offered.seat === seat
      if (!taken && i >= log.length && originalAlgorithms[seat] === 'manual') break
      emit(answerClaim(state, replayOptions, { kind: taken ? 'abort' : 'pass' }))
      if (taken) i++
      if (state.ended) break
    }

    // a kita/ankan/kakan pull draws a replacement, and `callKita`/`callAnkan`/`callKakan` price a
    // tsumo off it themselves (`replacementWin`). Every replayed seat is manual, so what they
    // raise is an offer: the log says whether it was taken, and — exactly as with the kyuushu
    // offer above and a claim nobody answered — nothing at all is a decline.
    while (i < log.length) {
      const entry = log[i]
      if (entry.kind === 'kita' && entry.seat === seat) emit(callKita(state, replayOptions, seat))
      else if (entry.kind === 'ankan' && entry.seat === seat)
        emit(callAnkan(state, replayOptions, seat, entry.tile))
      else if (entry.kind === 'kakan' && entry.seat === seat)
        emit(callKakan(state, replayOptions, seat, entry.tile))
      else break
      i++

      if (state.claim?.kind === 'win') {
        const afterPull: LogEntry | undefined = log[i]
        const takes =
          afterPull?.kind === 'win' && afterPull.seat === seat && afterPull.from === undefined
        emit(answerClaim(state, replayOptions, { kind: takes ? 'tsumo' : 'pass' }))
        if (takes) i++
      }
      if (state.ended) break
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

/**
 * This seat's waits, read off the thirteen it is *keeping* rather than off whatever it happens to
 * be holding right now.
 *
 * `policy.ts#waits` is documented for a 13-tile hand and means it: `shanten()` scores blocks and
 * never counts tiles, so a fourteen-tile hand mid-turn still answers `0`, and `improvingTiles`
 * then probes a *fifteen*-tile hand. What comes back is not this hand's wait — it is the union of
 * the waits of every discard that would leave the seat tenpai. `123m456m789m 11p 22p 3p` reads as
 * 1p/2p/4p, because throwing the 3p waits 1p/2p and throwing a 2p waits 1p/4p. Any one of that
 * union sitting in the seat's own river lit the furiten mark for the whole time the reader was
 * deciding, and cleared it the instant they discarded.
 *
 * Mutate-and-restore, the same shape `tryWin` and `couldHaveWon` already use on this hand.
 */
export function seatWaits(player: PlayerState, sanma: boolean): TileId[] {
  const drawn = player.drawn
  if (!drawn) return waits(player.hand, sanma)
  removeTile(player.hand, drawn.id)
  const held = waits(player.hand, sanma)
  addTile(player.hand, drawn.id)
  return held
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
  ended: 'win' | 'exhaustive' | 'abort' | 'stopped'
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
  /** Forwarded verbatim to `finishTurn`. The one moment a driver can observe a discard sitting on
   *  the river with nobody having reacted to it yet: `finishTurn` resolves the whole turn before
   *  it yields anything, so by the time the `discard` event arrives the pon that took that tile
   *  has already popped it back off. A paced board commits that frame, so a claimed tile is seen
   *  where it landed rather than only in the meld it ends up in. */
  beforeReactions?: (state: RoundState) => void,
): Generator<RoundEvent> {
  for (let guard = 0; guard < 400; guard++) {
    if (state.ended || state.claim) return
    if (canAct && !canAct(state)) return
    if (state.players[state.seat].drawn === undefined) yield* beginTurn(state, options)
    yield* finishTurn(state, options, undefined, false, beforeReactions)
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
 *: unlike `playRound`'s seed suffixing, a fresh wall is dealt per attempt by handing in a
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
