import type { Meld } from './agari'
import type { ThreatView } from './danger'
import { evaluateDiscards, isBestDiscard } from './efficiency'
import {
  abortWorthIt,
  DEFAULT_EV_SEAT,
  foldEv,
  rankDiscards,
  riichiWorthIt,
  type EvOptions,
  type EvSeat,
} from './ev'
import { EV_MODELS } from './evModel'
import type { Hand } from './hand'
import type { MatchState } from './match'
import { chooseCall, chooseDiscard, chooseFold, type Call, type SeatAlgorithm } from './policy'
import { shanten } from './shanten'
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

/** A win offered to `win()`: the tile, the discarder on a ron (absent on a tsumo), and how much
 *  it scores. `tryWin` (`round.ts`) has already computed all three by the time it asks — an
 *  algorithm that can't see what it declines can't price it (ADR-0009). */
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
  /** 14-tile hand: which tile goes, and whether the algorithm sees no difference between that
   *  kind and the one just drawn (`fromDrawn`) — advisory, not authoritative: `round.ts`'s own
   *  `finishTurn` re-derives the river's actual tsumogiri flag from the tile it really discards,
   *  since resolving *which* physical copy of a kind leaves (redness included) is `pickTile`'s
   *  job, not the algorithm's — an algorithm decides at the kind level and never sees redness. */
  discard(view: SeatView): { tile: TileId; fromDrawn: boolean }
  /** Someone else discarded `tile`: pon/chi it, or decline. */
  call(view: SeatView, tile: TileId, fromKamicha: boolean): Call | null
  /** The discard just made reaches tenpai and riichi is legal: declare? */
  riichi(view: SeatView): boolean
  /** A legal, scored win is on the table: take it? */
  win(view: SeatView, candidate: WinCandidate): boolean
  /** Sanma only: pull a held north? */
  kita(view: SeatView): boolean
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

const efficiency: Algorithm = {
  // `fromDrawn` here is advisory only (see the `Algorithm.discard` doc comment) — this algorithm
  // has no preference between two identical tiles, so reporting "the kind I picked is the kind I
  // drew" is honest, even though `round.ts` still re-derives the river flag from the tile it
  // actually resolves through `pickTile`
  discard: (view) => {
    const { discard: tile } = chooseDiscard(view.hand, view.seen, view.sanma)
    return { tile, fromDrawn: tile === view.drawn?.id }
  },
  call: (view, tile, fromKamicha) =>
    chooseCall(view.hand, view.melds, tile, fromKamicha, view.prevalentWind, view.seatWind),
  riichi: () => true,
  win: () => true,
  // pulls whenever north's own `evaluateDiscards` entry ties the best discard on offer — the same
  // comparison the efficiency trainer grades a manual seat's own pull against
  kita: (view) => {
    const ranked = evaluateDiscards(view.hand, view.seen, view.sanma)
    const north = ranked.find((o) => o.discard === NORTH)
    return north !== undefined && isBestDiscard(north, ranked[0])
  },
  // ukeire says nothing about whether a hand is worth playing at all — it ranks the discards of
  // whatever hand it is handed. Declining is this algorithm staying inside its own definition.
  abort: () => false,
}

const defense: Algorithm = {
  discard: (view) => {
    const tile = chooseFold(view.hand, view.threats, view.seen, view.sanma)
    return { tile, fromDrawn: tile === view.drawn?.id }
  },
  // every meld opened is one more shape to defend a wait with, and a folding seat is trying to
  // leave the hand, not develop it
  call: () => null,
  riichi: () => false,
  // a folding seat is leaving the hand, not chasing dora
  win: () => false,
  kita: () => false,
  // it would gladly be out of this hand, but it has no way to price what aborting gives up
  abort: () => false,
}

/** Lowest-id tile currently held — dependency-free, deterministic fallback for `tsumogiri` on the
 *  one turn it has nothing to tsumogiri: no `drawn` at all. Reachable only by flipping a seat to
 *  `tsumogiri` mid-hand right after it called (ADR-0008 — algorithms are live, so the flip can land
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
  discard: (view) =>
    view.drawn
      ? { tile: view.drawn.id, fromDrawn: true }
      : { tile: lowestHeld(view.hand), fromDrawn: false },
  call: () => null,
  riichi: () => false,
  win: () => false,
  kita: () => false,
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
 * itself is (ADR-0008).
 *
 * **The discard, the riichi declaration and the abortive draw are priced through the identity.**
 * The other three decision points are honest stand-ins, and each says what it is standing in for:
 *
 * - `call` keeps `chooseCall`'s rule — a meld that lowers shanten and leaves a yaku route — with
 *   one EV-shaped guard on top: a seat facing a declared threat will not open a hand that does not
 *   reach tenpai on the call. Pricing a call properly means re-solving the melded hand through the
 *   DP, and the call gate runs for every seat on every discard (`plans/EV-5` §1.9).
 * - `win` takes every win offered. Declining prices a furiten branch — temporary, or permanent
 *   under riichi — that nothing models yet, and a decider that cannot price the cost of declining
 *   should not decline.
 * - `kita` reuses `efficiency`'s comparison. The EV version prices the dora against the tempo, and
 *   that is `plans/EV-3` §7's, not this wave's.
 *
 * `abort` is `EV(keep) < 0`, which is the identity read against a branch worth exactly nothing —
 * see `abortWorthIt` for the two ceilings that answer ships with.
 */
const ev: Algorithm = {
  discard: (view) => {
    const opts = evOptions(view)
    const push = rankDiscards(view, opts)[0]
    const fold = foldEv(view, opts)
    // a fold is a real branch, not the tail of the ranking: it gives up the win term entirely
    // and spends the hand's safe tiles in order, so it can beat every push without any single
    // discard looking wrong
    const tile = push !== undefined && push.ev >= fold.ev ? push.tile : fold.tile
    return { tile, fromDrawn: tile === view.drawn?.id }
  },
  call: (view, tile, fromKamicha) => {
    const call = chooseCall(
      view.hand,
      view.melds,
      tile,
      fromKamicha,
      view.prevalentWind,
      view.seatWind,
    )
    if (call === null || view.threats.length === 0) return call
    return callReachesTenpai(view, call) ? call : null
  },
  riichi: (view) => riichiWorthIt(view, evOptions(view)),
  win: () => true,
  abort: (view) => abortWorthIt(view, evOptions(view)),
  kita: (view) => {
    const ranked = evaluateDiscards(view.hand, view.seen, view.sanma)
    const north = ranked.find((o) => o.discard === NORTH)
    return north !== undefined && isBestDiscard(north, ranked[0])
  },
}

/** Whether taking this call leaves the hand tenpai — the cheap stand-in for pricing it. The two
 *  tiles the meld uses leave the concealed hand and the claimed tile joins them from outside, so
 *  what is left is one meld heavier and two tiles lighter. */
function callReachesTenpai(view: SeatView, call: Call): boolean {
  const hand = { counts: Uint8Array.from(view.hand.counts), melds: view.hand.melds + 1 }
  for (const own of call.from) {
    if (hand.counts[own] === 0) return false
    hand.counts[own]--
  }
  return shanten(hand) === 0
}

/** One object per AI algorithm. Adding a new one is this object plus its own `AIAlgorithm` member
 *  — nothing in `round.ts` changes. */
export const ALGORITHMS: Record<AIAlgorithm, Algorithm> = {
  efficiency,
  defense,
  tsumogiri,
  ev,
}
