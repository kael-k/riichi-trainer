import type { Meld } from './agari'
import { assessDiscards, type TileDanger } from './danger'
import { evaluateDiscards, type DiscardOption } from './efficiency'
import {
  foldEv,
  foldRanking,
  rankDiscards,
  type DiscardEv,
  type EvObjective,
  type EvOptions,
} from './ev'
import { EV_MODELS, type EvModelName } from './evModel'
import { tileCount, type Hand } from './hand'
import {
  concealedTiles,
  isManual,
  seatView,
  seatWaits,
  seenBy as seenByMatch,
  stepRound,
  threatViews,
  wallDrawnCount,
  type RoundOptions,
  type RoundState,
  type PendingClaim,
  type WinRecord,
} from './round'
import type { MatchState } from './match'
import { isFuriten, type SeatAlgorithm } from './policy'
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

/** The two fields every consumer needs to step or read a match: the state itself and the rules it
 *  is running under. There is deliberately no "your seat" here — which seat a trainer grades and
 *  which seat a page draws the board from are both that consumer's own business, and a layer-1
 *  function that had an opinion about it is what made grading and perspective the same field for
 *  as long as they were. */
export interface TableCore {
  round: RoundState
  options: RoundOptions
}

/** Whose turn it is right now: `round.seat`, except that a pending claim outranks the turn order
 *  — the seat being asked is the one holding the decision, and nothing draws or discards until it
 *  answers. One expression, but the override is easy to re-derive wrongly, and every reader of
 *  "the current seat" has to agree about it. */
export function actingSeat(core: TableCore): number {
  return core.round.claim?.seat ?? core.round.seat
}

/** What `seat` can see: every face-up tile plus its own hand. Thin wrapper over `round.ts`'s
 *  exported `seenBy` — the canonical computation lives there (not here) because this module
 *  imports the stepper from `round.ts`, and `round.ts` must not import back. */
export function seenBy(core: TableCore, seat: number): Uint8Array {
  return seenByMatch(core.round, core.round.players[seat])
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
 *  algorithm and watch a hand play itself (ADR-0011) — and `stepRound`'s own 400-turn backstop is
 *  what catches a rule bug that would otherwise spin forever. Events are dropped here because a
 *  caller that wants them consumes `stepRound` directly. */
export function goRound(core: TableCore): void {
  for (const _event of stepRound(core.round, core.options, (s) => !isManual(s, s.seat)));
}

/** A render-ready mirror of the match. Every array is a fresh copy — mutating the match after a
 *  snapshot was taken never mutates that snapshot — except `liveWallSnapshot`/`deadWallSnapshot`/
 *  `wall`, passed through by reference since `createRound` never mutates them once the deal is
 *  done. Carries no trainer-specific field — no score, no clock, no grading result and no
 *  `finished` flag: each consumer derives its own end condition (efficiency: hand below 14 tiles;
 *  folding: `match.ended`/wall-out).
 *
 *  Uniformly per-seat: there is no `hand`/`drawn` pair naming one privileged seat any more. A page
 *  showing a hand picks the seat it wants and splits its 14th tile itself with `splitDrawn`, which
 *  is what lets perspective move without the snapshot having an opinion about it. */
export interface TableSnapshot {
  turn: number
  doraIndicators: ParsedTile[]
  rivers: RiverTile[][]
  hands: ParsedTile[][]
  melds: Meld[][]
  nuki: ParsedTile[][]
  riichi: boolean[]
  /** What each seat is actually being played by right now, read off the live `PlayerState` — the
   *  seat panel shows it, and folding's reveal gate keys "a seat somebody plays" off it. */
  algorithms: SeatAlgorithm[]
  liveWall: ParsedTile[]
  deadWall: ParsedTile[]
  liveWallSnapshot: ParsedTile[]
  liveWallDrawn: number
  deadWallSnapshot: ParsedTile[]
  replacements: number
  ended: RoundState['ended']
  win: WinRecord | undefined
  wall: ParsedTile[]
  /** Every seat's starting 13 tiles, in dealing order — the front slice of `wall` the wall-reveal
   *  display draws greyed-out ahead of the live pool, so it can show the whole wall as built rather
   *  than just what is left to draw. */
  dealtTiles: ParsedTile[]
  /** Whose turn it is right now (`actingSeat`) — the seat a discard would come from, or the seat
   *  a pending claim is waiting on. Not "your seat": nothing here knows which seat a trainer
   *  grades or which one a page draws at the bottom. */
  seat: number
  /** The claim the board is waiting on, if any: while it is set nothing draws and nothing
   *  discards until it is answered. */
  claim: PendingClaim | undefined
  /** The 14th tile currently in somebody's hand, and whose it is — `undefined` whenever nothing is
   *  drawn (mid-claim, or between hands). `hands[seat]` always has it mixed in (`concealedTiles`,
   *  sorted), so a page that wants it shown apart passes this through `splitDrawn` for the seat it
   *  is drawing. */
  drawn: { seat: number; tile: ParsedTile } | undefined
  /** Each seat's own tenpai/waits/furiten (`seatRead`). Present whenever the reader can already
   *  see that seat's tiles — a seat they play, any seat once the hand is over, and every seat
   *  while the board's own reveal switch is on (`showReads`, which callers pass as
   *  `showSeatWaits || showOpponentHands`) — since a furiten read is nothing the tiles do not
   *  already say. `undefined` otherwise: `waits` runs `improvingTiles` (~34 shanten probes) per
   *  seat, and nobody asked to pay that for a hand they cannot see. Whether the *wait tiles* are
   *  then drawn is `showSeatWaits`' own business, one layer up in `SeatStrip`. */
  seatReads: (SeatRead | undefined)[]
  /** The match this round sits inside — points, honba, dealer, riichi sticks, which round.
   *  One field, not flattened, since it is one thing a table reads together (`core/match.ts`). */
  match: MatchState
}

/** Separates a drawn tile out of a hand for display — the 14th tile shown apart from the rest,
 *  which is how tedashi/tsumogiri reads on a felt. `drawn` is returned exactly as given (even when
 *  it isn't found in `tiles`, which should not normally happen): only whether `tiles` itself gets
 *  spliced depends on the lookup. Every page that shows a hand goes through this, keyed off
 *  `TableSnapshot.drawn` — the snapshot itself no longer splits one privileged seat out. */
export function splitDrawn(
  tiles: ParsedTile[],
  drawn: ParsedTile | undefined,
): { tiles: ParsedTile[]; drawn: ParsedTile | undefined } {
  if (!drawn) return { tiles, drawn: undefined }
  const i = tiles.findIndex((t) => t.id === drawn.id && t.red === drawn.red)
  return { tiles: i >= 0 ? [...tiles.slice(0, i), ...tiles.slice(i + 1)] : tiles, drawn }
}

/** Builds a `TableSnapshot` for `core` as the match stands right now. `showReads` is "the reader
 *  can see everyone's tiles" — `showSeatWaits || showOpponentHands` at every call site — and only
 *  widens which seats get a `SeatRead`. */
export function snapshotTable(core: TableCore, showReads = false): TableSnapshot {
  const { round, options } = core
  const drawnTile = round.players[round.seat].drawn
  return {
    turn: round.turn,
    doraIndicators: [...round.doraIndicators],
    rivers: round.players.map((p) => [...p.river]),
    hands: round.players.map((p) => concealedTiles(p)),
    melds: round.players.map((p) => [...p.melds]),
    nuki: round.players.map((p) => [...p.nuki]),
    riichi: round.players.map((p) => p.riichiAt !== undefined),
    algorithms: round.players.map((p) => p.algorithm),
    liveWall: [...round.liveWall],
    deadWall: [...round.deadWall],
    liveWallSnapshot: round.liveWallSnapshot,
    liveWallDrawn: wallDrawnCount(round),
    deadWallSnapshot: round.deadWallSnapshot,
    replacements: round.replacements,
    ended: round.ended,
    win: round.win,
    wall: round.wall,
    dealtTiles: round.wall.slice(0, round.players.length * INITIAL_HAND_SIZE),
    seat: actingSeat(core),
    claim: round.claim,
    drawn: drawnTile ? { seat: round.seat, tile: drawnTile } : undefined,
    // `round.ended` is in here rather than left to the caller because it is snapshot-time truth:
    // every trainer turns the hands face-up once the hand is over, and a furiten mark on a hand
    // you are already looking at is not a reveal
    seatReads: round.players.map((_, seat) =>
      showReads || round.ended || isManual(round, seat)
        ? seatRead(round, seat, options.sanma)
        : undefined,
    ),
    // a fresh copy, not a reference: `points` mutates in place on a riichi declaration
    // (`round.ts`), and a snapshot must not move under whoever holds it
    match: { ...round.match, points: [...round.match.points] },
  }
}

/** Per-turn analysis for one seat, computed lazily and cached per object (ADR-0012): the
 *  solitaire trainer never reads `danger`, the folding trainer never reads `ranked`, and
 *  `evaluateDiscards` costs roughly 476 shanten probes per turn — nobody should pay for analysis
 *  they never read. An analysis object is a snapshot of one moment in the strong sense: it holds
 *  its own copy of the hand, so its numbers describe the board as it stood when it was built no
 *  matter how much later a getter is first read. That is what lets a discard be graded against the
 *  14-tile hand that made it even though the engine reports the discard once the tile has already
 *  gone. */
export interface TableAnalysis {
  /** The seat's own hand at the moment this was built — a copy, so it still reads as 14 tiles
   *  after the discard it is grading has left the live one. */
  readonly hand: Hand
  /** The 14th tile, captured alongside `hand` rather than on it — `Hand` itself tracks no
   *  redness or draw identity any more (T1), so this is where that moment's answer lives. */
  readonly drawn?: ParsedTile
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
   *  a furiten seat cannot ron (`tryWin`, guarded by a regression test in `round.test.ts`). */
  furiten: boolean
}

/** Builds `seat`'s own `SeatRead` from `state` as it stands right now. */
export function seatRead(state: RoundState, seat: number, sanma: boolean): SeatRead {
  const player = state.players[seat]
  // `seatWaits`, not `waits`: this runs on the live hand, which holds fourteen for the whole time
  // the acting seat is deciding, and `waits` on fourteen answers the union of every discard's
  // wait rather than this hand's own — see its doc comment for what that did to the furiten mark
  const waitTiles = seatWaits(player, sanma)
  const seen = seenByMatch(state, player)
  return {
    tenpai: waitTiles.length > 0,
    waits: waitTiles.map((tile) => ({ tile, remaining: TILES_PER_KIND - seen[tile] })),
    furiten: isFuriten(waitTiles, player.river) || player.missedWin,
  }
}

/** Builds a `TableAnalysis` pinned to `seat`'s hand as it stands right now.
 *
 *  The hand is **copied**, not referenced: `evaluateDiscards`/`assessDiscards` run whenever a
 *  getter is first read, which for a discard is after `finishTurn` has already taken the tile out
 *  of the live hand — ranking that would score 13 tiles and silently mis-grade every throw. A
 *  34-byte `Uint8Array` copy per turn is nothing next to the ~476 shanten probes it protects, and
 *  it turns "read these getters synchronously or else" from a rule every consumer had to remember
 *  into one that cannot be broken. `seen` is likewise read at build time.
 *
 *  Still per-moment: build a new one after the board moves rather than reusing an old one. */
/** One seat's whole push/fold arithmetic, priced under that seat's own EV model and objective —
 *  `plans/EV-3` §9's screen, as data. Both branches, every candidate, every term. */
export interface SeatEv {
  seat: number
  model: EvModelName
  objective: EvObjective
  /** Best first, exactly as the seat itself would rank them. */
  push: DiscardEv[]
  fold: DiscardEv
  /** Which branch the seat would actually take — the same comparison `ALGORITHMS.ev` makes. */
  best: 'push' | 'fold'
  /** Why the model may not speak about this ruleset, when it may not (`plans/EV-5` §2.11). Never
   *  a silent swap: the numbers below it were still produced by the model that was asked. */
  unsupported: string | null
}

/**
 * Prices `seat` through the EV identity, on demand.
 *
 * **On demand, and not from a getter beside `ranked`/`danger`,** because this is not the same
 * order of cost: an exact ranking is hundreds of milliseconds at 2-shanten where the other two are
 * a handful. A board that priced every turn on the chance somebody looked would be a board nobody
 * wants to play on. Whoever renders it asks for it.
 *
 * `null` when the seat is not mid-turn — `rankDiscards` needs the fourteen-tile hand and refuses
 * anything else, for the reason ADR-0037 records.
 */
export function evOf(core: TableCore, seat: number): SeatEv | null {
  const player = core.round.players[seat]
  if (tileCount(player.hand) % 3 !== 2) return null
  const view = seatView(core.round, core.options, seat)
  const { model, objective } = player.ev
  const opts = { model: EV_MODELS[model], objective }
  const push = rankDiscards(view, opts)
  const fold = foldEv(view, opts)
  return {
    seat,
    model,
    objective,
    push,
    fold,
    best: push[0] !== undefined && push[0].ev >= fold.ev ? 'push' : 'fold',
    unsupported: EV_MODELS[model].unsupported(core.options.sanma),
  }
}

/**
 * Every held tile's fold price for `seat`, on demand — the folding trainer's own reading of
 * `core/ev.ts`, never a formula the feature writes itself, so a model change moves what it grades.
 *
 * Unlike `evOf`, `opts.model` is not read off `player.ev`: the graded seat is a person, not an
 * `'ev'` seat, so the trainer's own setting picks the model and passes it in here. `null` under the
 * same rule `evOf` follows — `foldRanking` needs the fourteen-tile hand mid-turn.
 */
export function foldRankingOf(core: TableCore, seat: number, opts?: EvOptions): DiscardEv[] | null {
  const player = core.round.players[seat]
  if (tileCount(player.hand) % 3 !== 2) return null
  const view = seatView(core.round, core.options, seat)
  return foldRanking(view, opts)
}

/**
 * Every held tile's push price for `seat`, on demand — the efficiency trainer's own reading of
 * `core/ev.ts`, on the same terms `foldRankingOf` reads the fold branch on: the trainer's own
 * setting picks the model, never `player.ev`, and `null` under the same mid-turn rule.
 *
 * **Always `exhaustive: true`**, whatever `opts` asks: efficiency's own request is "rate every
 * possible discard", and `rankDiscards`' default candidate union exists to make an `'ev'` seat's
 * own turn cheap, not to answer that question. The cost is real — the DP runs once per held tile
 * rather than once per ~5 candidates — and efficiency's own turns are usually low shanten, where
 * that DP is cheapest.
 */
export function pushRankingOf(core: TableCore, seat: number, opts?: EvOptions): DiscardEv[] | null {
  const player = core.round.players[seat]
  if (tileCount(player.hand) % 3 !== 2) return null
  const view = seatView(core.round, core.options, seat)
  return rankDiscards(view, { ...opts, exhaustive: true })
}

export function analysisOf(core: TableCore, seat: number): TableAnalysis {
  const player = core.round.players[seat]
  const hand: Hand = {
    counts: new Uint8Array(player.hand.counts),
    melds: player.hand.melds,
  }
  const threats = threatViews(core.round)
  const seen = seenBy(core, seat)
  let rankedCache: DiscardOption[] | undefined
  let dangerCache: TileDanger[] | undefined

  return {
    hand,
    drawn: player.drawn,
    seen,
    get ranked() {
      return (rankedCache ??= evaluateDiscards(hand, seen, core.options.sanma))
    },
    get danger() {
      return (dangerCache ??= assessDiscards(hand, threats, seen, core.options.sanma))
    },
  }
}
