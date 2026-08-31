import type { Meld } from './agari'
import type { ThreatView } from './danger'
import { evaluateDiscards, isBestDiscard } from './efficiency'
import {
  abortWorthIt,
  bestCall,
  DEFAULT_EV_SEAT,
  foldEv,
  rankDiscards,
  kitaWorthIt,
  riichiWorthIt,
  winWorthIt,
  type DiscardEv,
  type EvOptions,
  type EvSeat,
} from './ev'
import { EV_MODELS } from './evModel'
import type { Hand } from './hand'
import type { MatchState } from './match'
import {
  chooseCall,
  chooseDiscard,
  chooseFold,
  kanOptions,
  type Call,
  type KanOption,
  type SeatAlgorithm,
} from './policy'
import type { ScoreResult } from './score'
import { HONOR, type ParsedTile, type RiverTile, type TileId } from './tiles'

/** AI-decided algorithms — every `SeatAlgorithm` except `'manual'`, which is not a style at all
 *  but the absence of one: the engine asks instead of deciding for it, so it is never a key here
 *  (`round.ts` short-circuits on `isManual` before ever reaching `ALGORITHMS`). */
export type AIAlgorithm = Exclude<SeatAlgorithm, 'manual'>

/** North — mirrors `round.ts`'s own `NORTH` constant. Duplicated rather than imported: `round.ts`
 *  imports `ALGORITHMS` from this module, so an import the other way would be a cycle — the same
 *  reasoning `core/table.ts` already gives for why it may not import back into `round.ts`. */
const NORTH: TileId = HONOR + 3

/**
 * What an algorithm is allowed to know when deciding: public information (every seat's river,
 * melds, riichi and nuki count) plus its own hand and the board — never `RoundState` itself, which
 * would let an algorithm read concealed hands. `seen`/`threats`/`furiten` are lazy getters (the
 * same trick `core/table.ts`'s `TableAnalysis` uses): the call gate builds one of these for every
 * seat on every discard, and all three cost real work (`seenBy`, `threatViews`, and `furiten`'s own
 * `waits` call is ~34 shanten probes) that a non-lazy view would put on that hot path even for the
 * algorithms — today, all of them — that never read one or more.
 */
export interface SeatView {
  /** This player. */
  readonly seat: number
  readonly hand: Hand
  /** Concealed tiles as held, redness included — `hand` is counts-only. */
  readonly concealed: readonly ParsedTile[]
  /** The 14th tile currently held, if any — `hand`/`concealed` still count it; this just names
   *  it, the same role `Hand.drawn` used to play before redness moved off `Hand` (T1). */
  readonly drawn?: ParsedTile
  readonly melds: readonly Meld[]
  readonly river: readonly RiverTile[]
  readonly riichi: boolean
  readonly nuki: number

  /** Everyone, in seat order, public information only. */
  readonly players: readonly {
    readonly river: readonly RiverTile[]
    readonly melds: readonly Meld[]
    readonly riichi: boolean
    readonly nuki: number
  }[]

  /** Board. */
  readonly prevalentWind: TileId
  readonly seatWind: TileId
  /** Whether this seat is the dealer this hand — `seatWind === HONOR`, free off `seatWind`
   *  itself, added so no algorithm has to re-derive it. */
  readonly dealer: boolean
  readonly turn: number
  readonly wallLeft: number
  readonly doraIndicators: readonly ParsedTile[]
  readonly sanma: boolean
  /** Whether this table rounds a 4-han/30-fu or 3-han/60-fu win up to a flat mangan
   *  (`RoundOptions.kiriageMangan`). A rule of the match, the same kind of field as `sanma`: an
   *  `'ev'` seat prices its own wins with the real scorer at the DP's leaf, so it has to price
   *  them under the ruleset the table is actually playing. */
  readonly kiriageMangan: boolean
  /** Whether this table allows a called kan — daiminkan and kakan (`RoundOptions.calledKan`).
   *  A rule of the match, on the same shelf as `sanma` and `kiriageMangan`, so an algorithm can
   *  never propose a kakan the engine would then refuse. Ankan needs no flag: it is legal under
   *  every ruleset this engine models. */
  readonly calledKan: boolean
  /** Points, honba, riichi sticks, dealer seat, which round — the match this round sits inside.
   *  Live, not carry-in: a riichi declaration mid-round mutates `points`/`riichiSticks`, and this
   *  is the same object `RoundState.match` holds, not a snapshot taken at deal time. Nothing in
   *  this wave reads it — it exists so a future algorithm (EV) has somewhere real to. */
  readonly match: MatchState

  /** How this seat prices, when it is an `'ev'` seat: which model supplies the costs and what it
   *  is maximising. Live, like `algorithm` itself — flip either mid-hand and the next decision
   *  obeys. Every other algorithm carries it and ignores it, which is cheaper than an optional
   *  field every reader has to default. */
  readonly ev: EvSeat

  readonly seen: Uint8Array
  readonly threats: readonly ThreatView[]
  /** Own-river or `missedWin` — the cost of declining a ron. */
  readonly furiten: boolean
}

/**
 * What a seat does with its own turn. One type rather than three booleans and a tile, because the
 * actions **compete**: "is pulling this north worth more than kanning" is a question three
 * independent methods cannot ask, and leaving it to the engine's loop order made loop order into
 * policy.
 *
 * `'kita'` carries no tile — north is the only one there is (`round.ts#NORTH`).
 */
export type TurnAction =
  { kind: 'discard'; tile: TileId; fromDrawn: boolean } | { kind: 'kita' } | KanOption

/** A win offered to `win()`: the tile, the discarder on a ron (absent on a tsumo), and how much
 *  it scores. `tryWin` (`round.ts`) has already computed all three by the time it asks — an
 *  algorithm that can't see what it declines can't price it. */
export interface WinCandidate {
  tile: ParsedTile
  /** Discarder's seat on a ron; absent on a tsumo. */
  from?: number
  score: ScoreResult
}

/**
 * How a simulated player decides, one method per decision point in `round.ts`. Pure and total,
 * same discipline as the `policy.ts` functions these are written in terms of: the same `SeatView`
 * must always produce the same choice, and every ranking is a total order — explicit tie-breaks,
 * never sort stability — which is what lets a whole match be reproduced from its seed.
 */
export interface Algorithm {
  /**
   * The whole of a seat's own turn, ranked in one place: throw something, pull a north, or
   * declare a kan. Asked repeatedly until it answers with a discard — a turn may hold several
   * kans and several kita, and each one draws a replacement the next answer sees.
   *
   * On the `'discard'` variant, `fromDrawn` says whether the algorithm sees no difference between
   * the kind it chose and the one just drawn — advisory, not authoritative: `round.ts`'s own
   * `finishTurn` re-derives the river's actual tsumogiri flag from the tile it really discards,
   * since resolving *which* physical copy of a kind leaves (redness included) is `pickTile`'s
   * job, not the algorithm's — an algorithm decides at the kind level and never sees redness.
   *
   * An action the engine would refuse is a no-op, not a throw: `callKita`/`callAnkan`/`callKakan`
   * each check their own legality and return nothing, and the loop falls through to a discard.
   */
  turn(view: SeatView): TurnAction
  /** Someone else discarded `tile`: pon/chi it, or decline. */
  call(view: SeatView, tile: TileId, fromKamicha: boolean): Call | null
  /** The discard just made reaches tenpai and riichi is legal: declare? */
  riichi(view: SeatView): boolean
  /** A legal, scored win is on the table: take it? */
  win(view: SeatView, candidate: WinCandidate): boolean
  /**
   * The opening hand holds nine or more distinct terminals and honours and nobody has called:
   * abort it? `round.ts` has already checked the legality (`canDeclareKyuushu`), so this is the
   * choice alone.
   *
   * The three hand-written algorithms all decline, and that is the reason `round.golden.test.ts`'s
   * frozen hashes do not move for the rule existing: none of them has anything to price the two
   * branches with. Only an EV seat does.
   */
  abort(view: SeatView): boolean
}

/** Whether pulling a held north costs nothing: north's own `evaluateDiscards` entry ties the best
 *  discard on offer, the same comparison the efficiency trainer grades a manual seat's own pull
 *  against. Shared by `efficiency` and `ev` — the EV version prices the dora against the tempo,
 *  and that is the EV seat's job, not this one's. */
function pullsNorth(view: SeatView): boolean {
  if (!view.sanma || view.hand.counts[NORTH] === 0) return false
  const ranked = evaluateDiscards(view.hand, view.seen, view.sanma)
  const north = ranked.find((o) => o.discard === NORTH)
  return north !== undefined && isBestDiscard(north, ranked[0])
}

const efficiency: Algorithm = {
  // `fromDrawn` here is advisory only (see the `Algorithm.turn` doc comment) — this algorithm
  // has no preference between two identical tiles, so reporting "the kind I picked is the kind I
  // drew" is honest, even though `round.ts` still re-derives the river flag from the tile it
  // actually resolves through `pickTile`.
  //
  // No kan: ukeire ranks the discards of whatever hand it is handed and has no opinion on whether
  // to change the hand's shape — the same reasoning `abort` below gives.
  turn: (view) => {
    if (pullsNorth(view)) return { kind: 'kita' }
    const { discard: tile } = chooseDiscard(view.hand, view.seen, view.sanma)
    return { kind: 'discard', tile, fromDrawn: tile === view.drawn?.id }
  },
  call: (view, tile, fromKamicha) =>
    chooseCall(view.hand, view.melds, tile, fromKamicha, view.prevalentWind, view.seatWind),
  riichi: () => true,
  win: () => true,
  // ukeire says nothing about whether a hand is worth playing at all — it ranks the discards of
  // whatever hand it is handed. Declining is this algorithm staying inside its own definition.
  abort: () => false,
}

const defense: Algorithm = {
  // no kita and no kan: a folding seat is leaving the hand, not developing it or raising its stakes
  turn: (view) => {
    const tile = chooseFold(view.hand, view.threats, view.seen, view.sanma)
    return { kind: 'discard', tile, fromDrawn: tile === view.drawn?.id }
  },
  // every meld opened is one more shape to defend a wait with, and a folding seat is trying to
  // leave the hand, not develop it
  call: () => null,
  riichi: () => false,
  // a folding seat is leaving the hand, not chasing dora
  win: () => false,
  // it would gladly be out of this hand, but it has no way to price what aborting gives up
  abort: () => false,
}

/** Lowest-id tile currently held — dependency-free, deterministic fallback for `tsumogiri` on the
 *  one turn it has nothing to tsumogiri: no `drawn` at all. Reachable only by flipping a seat to
 *  `tsumogiri` mid-hand right after it called (algorithms are live, so the flip can land
 *  between a pon and this seat's own next draw). */
function lowestHeld(hand: Hand): TileId {
  for (let id = 0; id < hand.counts.length; id++) if (hand.counts[id] > 0) return id
  throw new Error('lowestHeld: empty hand')
}

/** Discards whatever it just drew, every turn — no hand management at all. Proves the seam's
 *  input, not just its shape: `SeatView.drawn` is what makes "throw what I drew" expressible
 *  in the first place (T1). Never calls, never declares, never wins — `win: false` is deliberate:
 *  declining sets `missedWin`, so a tsumogiri seat goes furiten early and shows the badge for it.
 *  Harmless, since it never wins anyway, but it does mean this seat overlaps `defense` on that one
 *  axis. */
const tsumogiri: Algorithm = {
  turn: (view) =>
    view.drawn
      ? { kind: 'discard', tile: view.drawn.id, fromDrawn: true }
      : { kind: 'discard', tile: lowestHeld(view.hand), fromDrawn: false },
  call: () => null,
  riichi: () => false,
  win: () => false,
  abort: () => false,
}

/** What the identity is asked with, read off the seat rather than baked into the algorithm: the
 *  model supplying the prices and the currency it is pricing in. */
function evOptions(view: SeatView): EvOptions {
  const seat = view.ev ?? DEFAULT_EV_SEAT
  return { model: EV_MODELS[seat.model], objective: seat.objective }
}

/**
 * Push or fold by expected value, priced through `core/ev.ts`'s identity.
 *
 * One algorithm, not four: which model prices it and which currency it prices in are the seat's
 * own `EvSeat`, read fresh on every decision, so both are live in exactly the way the algorithm
 * itself is.
 *
 * **Every decision point is priced through the identity**
 * (`docs/model/push-fold.md#every-decision-is-priced`). Each one is one line
 * here and a named function in `ev.ts`, so this file holds no arithmetic of its own:
 *
 * - `turn` is `rankDiscards` against `foldEv`, with `bestKan` reading the same ranking.
 * - `call` is `bestCall` — every branch open at claim time, the pass included, priced as a hand.
 *   It is what lets this seat take a daiminkan: `chooseCall` never could, since every open kan is
 *   shanten-neutral and its rule demands a strict improvement.
 * - `riichi` is `riichiWorthIt`, `abort` is `abortWorthIt` (`EV(keep) < 0`, the identity read
 *   against a branch worth exactly nothing).
 * - `win` is `winWorthIt`: the payment against what the hand is worth if it plays on instead.
 *
 * The remaining stand-in is the kita half of `turn`, which still reuses `efficiency`'s comparison
 * (`pullsNorth`). Each priced function carries the ceilings its own answer ships with — read
 * `bestCall` and `abortWorthIt` before trusting either near its edges.
 */
const ev: Algorithm = {
  turn: (view) => {
    // A declared hand has nothing left to rank: every later discard is the drawn tile, and the only
    // choice still open is whether to pull a north. Short-circuited here rather than in `round.ts`
    // because this is the one algorithm the DP would cost a whole ranking a turn to ask.
    //
    // And in riichi it pulls only a north it has just *drawn*. That is the pull nukidora is free
    // on — the locked thirteen are untouched and the wait cannot move. Pulling one out of the
    // thirteen would change the wait, which riichi forbids; `callKita` checks only that a north is
    // held, so the restraint has to be here.
    if (view.riichi) {
      if (view.sanma && view.drawn?.id === NORTH) return { kind: 'kita' }
      return view.drawn
        ? { kind: 'discard', tile: view.drawn.id, fromDrawn: true }
        : { kind: 'discard', tile: lowestHeld(view.hand), fromDrawn: false }
    }
    const opts = evOptions(view)
    // one ranking for the whole turn: the kan rule reads the same best push the discard does, so
    // asking twice would double this seat's own most expensive call (~35ms a turn, and a whole
    // ranking of it at 2-shanten)
    const ranked = rankDiscards(view, opts)
    const kan = bestKan(view, ranked[0])
    if (kan) return kan
    if (kitaWorthIt(view, opts)) return { kind: 'kita' }
    const push = ranked[0]
    const fold = foldEv(view, opts)
    // a fold is a real branch, not the tail of the ranking: it gives up the win term entirely
    // and spends the hand's safe tiles in order, so it can beat every push without any single
    // discard looking wrong
    const tile = push !== undefined && push.ev >= fold.ev ? push.tile : fold.tile
    return { kind: 'discard', tile, fromDrawn: tile === view.drawn?.id }
  },
  call: (view, tile, fromKamicha) => bestCall(view, tile, fromKamicha, evOptions(view)),
  riichi: (view) => riichiWorthIt(view, evOptions(view)),
  win: (view, candidate) => winWorthIt(view, candidate, evOptions(view)),
  abort: (view) => abortWorthIt(view, evOptions(view)),
}

/**
 * Which kan to declare on this turn, if any — decided by the **sign of the scaled terms**, which
 * is why it needs no constant of its own.
 *
 * A kan flips one more dora indicator, and that multiplies every hand at the table by the same
 * expected han — yours and every threat's alike. So
 * `EV(kan) − EV(no kan) = m × Σ(the terms whose value is a hand's worth)` for some `m > 0`, and a
 * binary decision needs only the sign: `m` cancels, and nothing has to be estimated.
 *
 * `'notWinning'` is excluded, and that is the stated approximation: `EvModel.giveUpCost` is
 * opponents' tsumo payments (which scale with the dora) plus the noten penalty (which does not),
 * and the interface cannot split them. `'tenpai'` is excluded because the tenpai payment is a
 * fixed rule amount.
 *
 * **The ceiling, stated the way `abortWorthIt` states its own.** With nobody in riichi the cost
 * side is *zero* — `dealIn.ts` refuses to speak about a seat that has not declared
 * — so the sum is the win term alone and an `'ev'` seat **kans every legal kan
 * on an undeclared board**. That is arithmetic under a stated refusal rather than a judgement, and
 * it stops being one when the model can price a threat nobody has declared.
 *
 * There used to be a second ceiling cutting the opposite way — above `maxShanten` the collapsed
 * chain priced no win, the sum was zero, and the kan was declined for a reason that had nothing to
 * do with the kan. `EvModel.winValue` closed it, so a deep hand is now priced rather than passed
 * over. What survives is smaller and worth naming: the win term's value still carries the riichi
 * sticks on the table, and a dora indicator does not multiply those any more than it multiplies
 * the two terms excluded above. It is one term of one row, always the same sign as the win term it
 * rides on, and correcting it would need the win value split out of a number the identity keeps
 * whole.
 *
 * Tie-break: kakan before ankan — the fourth copy of a melded pon is a dead tile where four
 * concealed copies are not — then the lowest tile id, stated as arbitrary because the model sees
 * no difference between one indicator and another.
 */
function bestKan(view: SeatView, best: DiscardEv | undefined): KanOption | undefined {
  const options = kanOptions(view.hand, view.melds, view.calledKan)
  if (options.length === 0) return undefined
  const scaled =
    best?.terms
      .filter((t) => t.kind === 'win' || t.kind === 'dealIn' || t.kind === 'danger')
      .reduce((sum, t) => sum + t.points, 0) ?? 0
  if (scaled <= 0) return undefined
  // `kanOptions` is already in tile order, so the first of either kind is the lowest id
  return options.find((o) => o.kind === 'kakan') ?? options[0]
}

/** One object per AI algorithm. Adding a new one is this object plus its own `AIAlgorithm` member
 *  — nothing in `round.ts` changes. */
export const ALGORITHMS: Record<AIAlgorithm, Algorithm> = {
  efficiency,
  defense,
  tsumogiri,
  ev,
}
