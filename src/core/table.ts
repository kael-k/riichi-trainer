import type { Meld } from './agari'
import { assessDiscards, type TileDanger } from './danger'
import { evaluateDiscards, type DiscardOption } from './efficiency'
import {
  beginTurn,
  concealedTiles,
  finishTurn,
  isHuman,
  seenBy as seenByMatch,
  threatViews,
  wallDrawnCount,
  type MatchOptions,
  type MatchState,
  type PendingClaim,
  type WinRecord,
} from './match'
import type { ParsedTile, RiverTile } from './tiles'
import { INITIAL_HAND_SIZE } from './wall'

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
  const { match, options, seatIndex } = core
  if (match.claim) return match.claim.seat
  return isHuman(options, match.seat) ? match.seat : seatIndex
}

/** What the seat being played can see: every face-up tile plus its own hand. Thin wrapper over
 *  `match.ts`'s exported `seenBy` — the canonical computation lives there (not here) because this
 *  module imports the stepper from `match.ts`, and `match.ts` must not import back. */
export function seenBy(core: TableCore): Uint8Array {
  return seenByMatch(core.match, core.match.players[actingSeat(core)])
}

/** Plays every seat the engine decides for, stopping at the next seat a person plays — or when
 *  the hand ends, or when a discard leaves a human seat a claim to answer. One full go-round is
 *  the bound — a call hands the turn sideways but never backwards, so eight begin/finish pairs
 *  (two per seat on a four-seat table) is enough, and it also backstops a rule bug that would
 *  otherwise spin forever. A no-op when it is already a human seat's turn, e.g. a one-seat solo
 *  match. It carries no opponents-on/off branch and no next-draw of its own: each consumer layers
 *  its own stop condition and its own `beginTurn` on top (efficiency stops at tenpai, folding
 *  stops when the hand ends).
 *
 *  "The seat that stops it" is `options.humans`, not `core.seatIndex`: with several manual seats
 *  every one of them has to get its turn, and `seatIndex` is only where the board is drawn from.
 *  Callers keep at least one human seat, or this simply plays its eight pairs and returns. */
export function goRound(core: TableCore): void {
  for (let guard = 0; guard < 8; guard++) {
    const { match, options } = core
    if (match.ended || match.claim || isHuman(options, match.seat)) return
    beginTurn(match, options)
    finishTurn(match, options)
  }
}

/** Every tile `core`'s own seat has thrown, in order, from `core.match.discards` rather than its
 *  river: `finishTurn` pops a claimed discard out of the river, and it is still a tile that seat
 *  threw, so a replay built off the river would arrive at a different board. `from` skips the
 *  leading ones a caller has already accounted for (e.g. folding's handed-over-at index). */
export function yourDiscards(core: TableCore, from = 0): ParsedTile[] {
  return core.match.discards
    .filter((d) => d.seat === core.seatIndex)
    .slice(from)
    .map((d) => ({ id: d.tile.id, red: d.tile.red }))
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
}

/** Builds a `TableSnapshot` for `core` as the match stands right now. */
export function snapshotTable(core: TableCore): TableSnapshot {
  const { match, seatIndex } = core
  const acting = actingSeat(core)
  const player = match.players[acting]
  let hand = concealedTiles(player)
  if (match.drawn) {
    const i = hand.findIndex((t) => t.id === match.drawn!.id && t.red === match.drawn!.red)
    if (i >= 0) hand = [...hand.slice(0, i), ...hand.slice(i + 1)]
  }
  return {
    hand,
    drawn: match.drawn,
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
  }
}

/** Fast-forwards `core`'s own seat through a recorded list of `discards`, generalising the two
 *  identical fast-forward loops both hooks wrote. Stops quietly — returning the tiles it actually
 *  played rather than throwing — when the match has ended, when the seat no longer holds that
 *  kind, or when `step` itself returns `false`. Redness is derived the same way both hooks derive
 *  it: the seat's own red copy only survives onto the replayed tile when it still holds that kind's
 *  red five. `step` is what actually advances the board (a discard alone does nothing without it) —
 *  that indirection is how efficiency keeps its tenpai stop and folding its hand-ended stop without
 *  this function knowing about either. The StrictMode-dedup mutable-ref guard that decides whether
 *  a replay gets *logged* stays in each React hook — that is a React concern, and this module is
 *  React-free. */
export function replayDiscards(
  core: TableCore,
  discards: ParsedTile[],
  step: (core: TableCore, tile: ParsedTile) => boolean | void,
): ParsedTile[] {
  const played: ParsedTile[] = []
  for (const t of discards) {
    const player = core.match.players[core.seatIndex]
    if (core.match.ended || player.hand.counts[t.id] === 0) break
    const red = player.reds.has(t.id) && (t.red || player.hand.counts[t.id] === 1)
    const tile: ParsedTile = { id: t.id, red }
    const keepGoing = step(core, tile)
    played.push(tile)
    if (keepGoing === false) break
  }
  return played
}

/** Per-turn analysis for `core`'s own seat, computed lazily and cached per object (D-05): the
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
