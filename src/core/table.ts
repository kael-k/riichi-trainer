import {
  beginTurn,
  finishTurn,
  seenBy as seenByMatch,
  type MatchOptions,
  type MatchState,
} from './match'
import type { ParsedTile } from './tiles'

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

/** What `core`'s own seat can see: every face-up tile plus its own hand. Thin wrapper over
 *  `match.ts`'s exported `seenBy` — the canonical computation lives there (not here) because this
 *  module imports the stepper from `match.ts`, and `match.ts` must not import back. */
export function seenBy(core: TableCore): Uint8Array {
  return seenByMatch(core.match, core.match.players[core.seatIndex])
}

/** Plays every seat back around to `core`'s own seat, or until the hand ends. One full go-round is
 *  the bound — a call hands the turn sideways but never backwards, so eight begin/finish pairs
 *  (two per seat on a four-seat table) is enough, and it also backstops a rule bug that would
 *  otherwise spin forever. A no-op when it is already your turn, e.g. a one-seat solo match. It
 *  carries no opponents-on/off branch and no next-draw of its own: each consumer layers its own
 *  stop condition and its own `beginTurn` on top (efficiency stops at tenpai, folding stops when
 *  the hand ends). */
export function goRound(core: TableCore): void {
  for (
    let guard = 0;
    guard < 8 && core.match.seat !== core.seatIndex && !core.match.ended;
    guard++
  ) {
    beginTurn(core.match, core.options)
    finishTurn(core.match, core.options)
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
