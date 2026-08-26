import { createMatch } from '../../core/match'
import { NORTH, type RoundOptions } from '../../core/round'
import { HONOR } from '../../core/tiles'
import { resolveSeatConfig, type SeatConfig } from '../settings/tableSettings'
import { matchOverrides, WINDS, type Situation } from '../situation/urlCodec'
import { useEfficiencyDrill } from './useEfficiencyDrill'

export { NORTH }
export type { TurnResult } from './grade'

/** Options that change how a round plays out; resolved from settings with per-situation
 *  overrides so shared links reproduce exactly. */
export interface EfficiencyOptions {
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma: boolean
  /** Who plays which seat, from the board's seat panel; `null` is the shipped default (you at
   *  the link's own seat, every other seat on the efficiency AI). Page state (ADR-0015), not settings
   *  — see `EfficiencyPage`. */
  seats: SeatConfig | null
  /** The seat panel's "show tenpai/waits" setting — threaded to `useRound`, which is where the
   *  per-seat cost of computing it is actually paid. */
  showSeatWaits: boolean
  /** The board's reveal switch. Only reaches `useRound` (as half of `showReads`): the page draws
   *  the faces itself. A seat whose tiles are already on screen gets its `SeatRead` too, since a
   *  furiten mark says nothing the hand does not. */
  showOpponentHands: boolean
}

/** Drives one efficiency round for the full table on `useEfficiencyDrill` — dealing, grading and
 *  session state all live there; this hook only decides this app's own `RoundOptions` (opponents
 *  call but never win, no danger to read, claims live) and adds the board-only fields
 *  `useEfficiencyDrill` has no opinion about, such as every seat's hands/melds and the claim
 *  prompt. Which seat is graded is decided here and nowhere else: `useRound` reports every seat's
 *  events and the drill ignores the ones that are not `seatIndex`'s, which is what lets a second
 *  manual seat be *played* without being *scored* (ADR-0013, ADR-0032). */
export function useEfficiencyRound(situation: Situation, options: EfficiencyOptions) {
  const players = options.sanma ? 3 : 4
  // a shared ?seat=N link built under yonma can name a seat sanma doesn't have (North)
  const linkSeat = Math.min(Math.max(0, WINDS.indexOf(situation.seat)), players - 1)
  // the graded seat is decided by the link alone, never by the seat panel: flipping your own
  // seat's algorithm live must freeze grading in place (ADR-0008), not move it to whichever other seat
  // the panel happens to have marked manual — so this never goes through `options.seats`
  const seatIndex = linkSeat
  const algorithms = resolveSeatConfig(options.seats, players, seatIndex).modes
  const manualSeats = algorithms.flatMap((a, seat) => (a === 'manual' ? [seat] : []))
  const prevalentWind = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const roundOptions: RoundOptions = {
    sanma: options.sanma,
    aka: options.aka,
    match: createMatch(options.sanma, { prevalentWind, ...matchOverrides(situation) }),
    // opponents may open their hands and call, but nobody wins: a hand that ended on someone
    // else's tsumo would cut this per-turn drill short on a result the player did not cause
    calls: true,
    // efficiency reads no danger, so an opponent's riichi here was decoration, not signal
    riichi: false,
    wins: false,
    algorithms,
    // always on: a manual seat is simply asked about another seat's discard (ADR-0034) — dropped
    // the reader-facing checkbox, which read as confusing rather than as a real choice
    claims: true,
  }

  const drill = useEfficiencyDrill({
    situation,
    players,
    seatIndex,
    options: roundOptions,
    showReads: options.showSeatWaits || options.showOpponentHands,
  })
  const { table, snapshot } = drill

  return {
    ...drill,
    hands: snapshot?.hands ?? [],
    /** Per-seat melds/nuki (calls included), so the table can show every seat's — not just your
     *  own — pon/chi/kan and nukidora. `kans` stays the narrower, ankan-only view your own seat's
     *  corner already used. */
    melds: snapshot?.melds ?? [],
    nuki: snapshot?.nuki ?? [],
    /** Every seat a person plays: their hands are always face-up, whatever the reveal setting
     *  says, since they are the reader's own. */
    manualSeats,
    drawnSeat: snapshot?.drawn?.seat,
    claim: snapshot?.claim,
    seatReads: snapshot?.seatReads ?? [],
    match: snapshot?.match ?? createMatch(options.sanma),
    answer: table.answer,
    riichiTiles: table.riichiTiles,
    riichiArmed: table.riichiArmed,
    armRiichi: table.armRiichi,
    kita: table.kita,
    kan: table.kan,
  }
}
