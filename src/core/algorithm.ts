import type { Meld } from './agari'
import type { ThreatView } from './danger'
import { evaluateDiscards, isBestDiscard } from './efficiency'
import type { Hand } from './hand'
import { chooseCall, chooseDiscard, chooseFold, type Call, type SeatAlgorithm } from './policy'
import type { ScoreResult } from './score'
import { HONOR, type ParsedTile, type RiverTile, type TileId } from './tiles'

/** AI-decided algorithms — every `SeatAlgorithm` except `'manual'`, which is not a style at all
 *  but the absence of one: the engine asks instead of deciding for it, so it is never a key here
 *  (`match.ts` short-circuits on `isManual` before ever reaching `ALGORITHMS`). */
export type AIAlgorithm = Exclude<SeatAlgorithm, 'manual'>

/** North — mirrors `match.ts`'s own `NORTH` constant. Duplicated rather than imported: `match.ts`
 *  imports `ALGORITHMS` from this module, so an import the other way would be a cycle — the same
 *  reasoning `core/table.ts` already gives for why it may not import back into `match.ts`. */
const NORTH: TileId = HONOR + 3

/**
 * What an algorithm is allowed to know when deciding: public information (every seat's river,
 * melds, riichi and nuki count) plus its own hand and the board — never `MatchState` itself, which
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
  readonly reds: ReadonlySet<TileId>
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
  readonly round: TileId
  readonly seatWind: TileId
  /** Whether this seat is the dealer this hand — `seatWind === HONOR`, free off `seatWind`
   *  itself, added so no algorithm has to re-derive it. */
  readonly dealer: boolean
  readonly turn: number
  readonly wallLeft: number
  readonly doraIndicators: readonly ParsedTile[]
  readonly sanma: boolean

  readonly seen: Uint8Array
  readonly threats: readonly ThreatView[]
  /** Own-river or `missedWin` — the cost of declining a ron. */
  readonly furiten: boolean
}

/** A win offered to `win()`: the tile, the discarder on a ron (absent on a tsumo), and how much
 *  it scores. `tryWin` (`match.ts`) has already computed all three by the time it asks — an
 *  algorithm that can't see what it declines can't price it (D9). */
export interface WinCandidate {
  tile: ParsedTile
  /** Discarder's seat on a ron; absent on a tsumo. */
  from?: number
  score: ScoreResult
}

/**
 * How a simulated player decides, one method per decision point in `match.ts`. Pure and total,
 * same discipline as the `policy.ts` functions these are written in terms of: the same `SeatView`
 * must always produce the same choice, and every ranking is a total order — explicit tie-breaks,
 * never sort stability — which is what lets a whole match be reproduced from its seed.
 */
export interface Algorithm {
  /** 14-tile hand: which tile goes, and whether the algorithm sees no difference between that
   *  kind and the one just drawn (`fromDrawn`) — advisory, not authoritative: `match.ts`'s own
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
}

const efficiency: Algorithm = {
  // `fromDrawn` here is advisory only (see the `Algorithm.discard` doc comment) — this algorithm
  // has no preference between two identical tiles, so reporting "the kind I picked is the kind I
  // drew" is honest, even though `match.ts` still re-derives the river flag from the tile it
  // actually resolves through `pickTile`
  discard: (view) => {
    const { discard: tile } = chooseDiscard(view.hand, view.seen, view.sanma)
    return { tile, fromDrawn: tile === view.hand.drawn?.id }
  },
  call: (view, tile, fromKamicha) =>
    chooseCall(view.hand, view.melds, tile, fromKamicha, view.round, view.seatWind),
  riichi: () => true,
  win: () => true,
  // pulls whenever north's own `evaluateDiscards` entry ties the best discard on offer — the same
  // comparison the efficiency trainer grades a manual seat's own pull against
  kita: (view) => {
    const ranked = evaluateDiscards(view.hand, view.seen, view.sanma)
    const north = ranked.find((o) => o.discard === NORTH)
    return north !== undefined && isBestDiscard(north, ranked[0])
  },
}

const defense: Algorithm = {
  discard: (view) => {
    const tile = chooseFold(view.hand, view.threats, view.seen, view.sanma)
    return { tile, fromDrawn: tile === view.hand.drawn?.id }
  },
  // every meld opened is one more shape to defend a wait with, and a folding seat is trying to
  // leave the hand, not develop it
  call: () => null,
  riichi: () => false,
  // a folding seat is leaving the hand, not chasing dora
  win: () => false,
  kita: () => false,
}

/** One object per AI algorithm. Adding a new one is this object plus its own `AIAlgorithm` member
 *  — nothing in `match.ts` changes. */
export const ALGORITHMS: Record<AIAlgorithm, Algorithm> = { efficiency, defense }
