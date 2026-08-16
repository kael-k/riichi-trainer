import type { Meld } from './agari'
import { assessDiscards, type TileDanger } from './danger'
import { evaluateDiscards, type DiscardOption } from './efficiency'
import {
  concealedTiles,
  isManual,
  seenBy as seenByMatch,
  stepMatch,
  threatViews,
  wallDrawnCount,
  type MatchOptions,
  type MatchState,
  type PendingClaim,
  type WinRecord,
} from './match'
import { isFuriten, waits } from './policy'
import type { ParsedTile, RiverTile, TileId } from './tiles'
import { INITIAL_HAND_SIZE, TILES_PER_KIND } from './wall'

/**
 * Pure, React-free primitives for stepping a match, reading what a seat can see, and replaying its
 * own discards. Every trainer (`useEfficiencyRound`, `useFoldingRound`, and this phase's later
 * additions) composes these instead of reimplementing them — three separate implementations of
 * "what this seat can see" and two of "run every seat back round to me" was the duplication a
 * pre-Phase-1 audit found. Grading, session state and everything React-specific stay with each
 * consumer; this module holds only the mechanics every consumer shares.
 */

/** The three fields every consumer needs to step or read a match: the state itself, the rules it
 *  is running under, and which seat is "yours". */
export interface TableCore {
  match: MatchState
  options: MatchOptions
  seatIndex: number
}

/** The seat being played right now, which is `core.seatIndex` in the ordinary single-manual-seat
 *  setup and stays so for every existing trainer. It differs only once more than one seat is set
 *  to manual: the board is still drawn from `seatIndex`, but the hand on screen, the analysis and
 *  the discard all belong to whichever manual seat the turn has reached. A pending claim wins
 *  over the turn order — the seat being asked is the one holding the decision. */
export function actingSeat(core: TableCore): number {
  const { match, seatIndex } = core
  if (match.claim) return match.claim.seat
  return isManual(match, match.seat) ? match.seat : seatIndex
}

/** What the seat being played can see: every face-up tile plus its own hand. Thin wrapper over
 *  `match.ts`'s exported `seenBy` — the canonical computation lives there (not here) because this
 *  module imports the stepper from `match.ts`, and `match.ts` must not import back. */
export function seenBy(core: TableCore): Uint8Array {
  return seenByMatch(core.match, core.match.players[actingSeat(core)])
}

/** Plays every seat the engine decides for, stopping at the next manual seat — or when the hand
 *  ends, or when a discard leaves a manual seat a claim to answer. A no-op when it is already a
 *  manual seat's turn, e.g. a one-seat solo match. It carries no opponents-on/off branch and no
 *  next-draw of its own: each consumer layers its own stop condition and its own `beginTurn` on
 *  top (efficiency stops at tenpai, folding stops when the hand ends).
 *
 *  "The seat that stops it" is each player's own `algorithm`, never a designated seat: with
 *  several manual seats every one of them has to get its turn, and which seat a board is *drawn*
 *  from is a page's own business the engine never sees.
 *
 *  With no manual seat at all this now plays the hand out rather than stopping after one circuit.
 *  That is the point rather than an oversight — it is what lets a reader put every seat on an
 *  algorithm and watch a hand play itself (ADR-0011) — and `stepMatch`'s own 400-turn backstop is
 *  what catches a rule bug that would otherwise spin forever. Events are dropped here because a
 *  caller that wants them consumes `stepMatch` directly. */
export function goRound(core: TableCore): void {
  for (const _event of stepMatch(core.match, core.options, (s) => !isManual(s, s.seat)));
}

/** A render-ready mirror of the match, seat-index-first, with `core`'s own seat's drawn tile
 *  separated out into `drawn`. Every array is a fresh copy — mutating the match after a snapshot
 *  was taken never mutates that snapshot — except `liveWallSnapshot`/`deadWallSnapshot`/`wall`,
 *  passed through by reference since `createMatch` never mutates them once the deal is done.
 *  Carries no trainer-specific field — no score, no clock, no grading result and no `finished`
 *  flag: each consumer derives its own end condition (efficiency: hand below 14 tiles; folding:
 *  `match.ended`/wall-out). `melds`/`nuki` are per-seat here, where the efficiency hook keeps only
 *  its own — that hook indexes its seat out of these. */
export interface TableSnapshot {
  hand: ParsedTile[]
  drawn: ParsedTile | undefined
  turn: number
  doraIndicators: ParsedTile[]
  rivers: RiverTile[][]
  hands: ParsedTile[][]
  melds: Meld[][]
  nuki: ParsedTile[][]
  riichi: boolean[]
  seatIndex: number
  liveWall: ParsedTile[]
  deadWall: ParsedTile[]
  liveWallSnapshot: ParsedTile[]
  liveWallDrawn: number
  deadWallSnapshot: ParsedTile[]
  replacements: number
  ended: MatchState['ended']
  win: WinRecord | undefined
  wall: ParsedTile[]
  /** Every seat's starting 13 tiles, in dealing order — the front slice of `wall` the wall-reveal
   *  display draws greyed-out ahead of the live pool, so it can show the whole wall as built rather
   *  than just what is left to draw. */
  dealtTiles: ParsedTile[]
  /** Whose hand `hand`/`drawn` above actually are — `seatIndex` in every single-manual-seat
   *  setup, and some other manual seat only once the reader is playing more than one. */
  acting: number
  /** The claim the board is waiting on, if any: while it is set nothing draws and nothing
   *  discards until it is answered. */
  claim: PendingClaim | undefined
  /** Whose turn `drawn` belongs to — `undefined` whenever nothing is currently drawn (mid-claim,
   *  or between hands). A page drawing a seat other than `acting` needs this to know whether
   *  *that* seat's 14th tile should be shown split out: `hands[seat]` always has it mixed in
   *  (`concealedTiles`, sorted), since only `hand`/`drawn` above ever get it spliced out. */
  drawnSeat: number | undefined
  /** Each seat's own tenpai/waits/furiten (`seatRead`). Always present for a seat the reader
   *  plays — a manual seat's own furiten is legitimate information a real client shows, and one
   *  more `waits` call is negligible next to the analysis that seat's own turn already pays for
   *  — `undefined` for every other seat unless `showSeatWaits` is on, since `waits` runs
   *  `improvingTiles` (~34 shanten probes) per seat and nobody asked to pay that for opponents. */
  seatReads: (SeatRead | undefined)[]
}

/** Separates a drawn tile out of a hand for display — the 14th tile shown apart from the rest,
 *  which is how tedashi/tsumogiri reads on a felt. `drawn` is returned exactly as given (even when
 *  it isn't found in `tiles`, which should not normally happen): only whether `tiles` itself gets
 *  spliced depends on the lookup. Shared by `snapshotTable` (the acting seat) and any page that
 *  wants the same split for another seat, keyed off `TableSnapshot.drawnSeat`. */
export function splitDrawn(
  tiles: ParsedTile[],
  drawn: ParsedTile | undefined,
): { tiles: ParsedTile[]; drawn: ParsedTile | undefined } {
  if (!drawn) return { tiles, drawn: undefined }
  const i = tiles.findIndex((t) => t.id === drawn.id && t.red === drawn.red)
  return { tiles: i >= 0 ? [...tiles.slice(0, i), ...tiles.slice(i + 1)] : tiles, drawn }
}

/** Builds a `TableSnapshot` for `core` as the match stands right now. */
export function snapshotTable(core: TableCore, showSeatWaits = false): TableSnapshot {
  const { match, seatIndex, options } = core
  const acting = actingSeat(core)
  const player = match.players[acting]
  const { tiles: hand, drawn } = splitDrawn(concealedTiles(player), player.hand.drawn)
  return {
    hand,
    drawn,
    turn: match.turn,
    doraIndicators: [...match.doraIndicators],
    rivers: match.players.map((p) => [...p.river]),
    hands: match.players.map((p) => concealedTiles(p)),
    melds: match.players.map((p) => [...p.melds]),
    nuki: match.players.map((p) => [...p.nuki]),
    riichi: match.players.map((p) => p.riichiAt !== undefined),
    seatIndex,
    liveWall: [...match.liveWall],
    deadWall: [...match.deadWall],
    liveWallSnapshot: match.liveWallSnapshot,
    liveWallDrawn: wallDrawnCount(match),
    deadWallSnapshot: match.deadWallSnapshot,
    replacements: match.replacements,
    ended: match.ended,
    win: match.win,
    wall: match.wall,
    dealtTiles: match.wall.slice(0, match.players.length * INITIAL_HAND_SIZE),
    acting,
    claim: match.claim,
    drawnSeat: match.players[match.seat].hand.drawn ? match.seat : undefined,
    seatReads: match.players.map((_, seat) =>
      showSeatWaits || isManual(match, seat) ? seatRead(match, seat, options.sanma) : undefined,
    ),
  }
}

/** Per-turn analysis for `core`'s own seat, computed lazily and cached per object (ADR-0012): the
 *  solitaire trainer never reads `danger`, the folding trainer never reads `ranked`, and
 *  `evaluateDiscards` costs roughly 476 shanten probes per turn — nobody should pay for analysis
 *  they never read. An analysis object is a snapshot of one moment: a consumer captures it at draw
 *  time and hands the *same* object to its discard grading, which is what stops the numbers being
 *  recomputed against an already-13-tile hand after the throw. */
export interface TableAnalysis {
  readonly seen: Uint8Array
  readonly ranked: DiscardOption[]
  readonly danger: TileDanger[]
}

/** What a seat's own tenpai/waits/furiten reads as, from that seat's point of view — the seat
 *  panel's `showSeatWaits` badge, and its more expensive cousin: `waits` runs `improvingTiles`,
 *  ~34 shanten probes, so a caller gates this on the setting being on and computes it inside its
 *  own snapshot builder, never per render and never when the setting is off. */
export interface SeatRead {
  tenpai: boolean
  /** Wait tiles with copies still unseen from *this* seat's own point of view. */
  waits: { tile: TileId; remaining: number }[]
  /** Permanent (a wait sitting in the seat's own river) or temporary (`missedWin`) — either way,
   *  a furiten seat cannot ron (`tryWin`, guarded by a regression test in `match.test.ts`). */
  furiten: boolean
}

/** Builds `seat`'s own `SeatRead` from `state` as it stands right now. */
export function seatRead(state: MatchState, seat: number, sanma: boolean): SeatRead {
  const player = state.players[seat]
  const waitTiles = waits(player.hand, sanma)
  const seen = seenByMatch(state, player)
  return {
    tenpai: waitTiles.length > 0,
    waits: waitTiles.map((tile) => ({ tile, remaining: TILES_PER_KIND - seen[tile] })),
    furiten: isFuriten(waitTiles, player.river) || player.missedWin,
  }
}

/** Builds a fresh `TableAnalysis` for `core` as it stands right now — call it again after the
 *  board moves on rather than reusing an old one, since each object's members cache only their own
 *  first read. */
export function analysisOf(core: TableCore): TableAnalysis {
  const player = core.match.players[actingSeat(core)]
  let seenCache: Uint8Array | undefined
  let rankedCache: DiscardOption[] | undefined
  let dangerCache: TileDanger[] | undefined
  const getSeen = () => (seenCache ??= seenBy(core))

  return {
    get seen() {
      return getSeen()
    },
    get ranked() {
      return (rankedCache ??= evaluateDiscards(player.hand, getSeen(), core.options.sanma))
    },
    get danger() {
      return (dangerCache ??= assessDiscards(
        player.hand,
        threatViews(core.match),
        getSeen(),
        core.options.sanma,
      ))
    },
  }
}
