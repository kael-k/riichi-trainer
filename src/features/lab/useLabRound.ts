import { useState } from 'react'
import type { TileDanger } from '../../core/danger'
import type { DiscardOption } from '../../core/efficiency'
import type { MatchOptions } from '../../core/match'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { resolveSeatConfig, type SeatConfig } from '../settings/tableSettings'
import { useLog } from '../../store/log'
import { BACK_TILE } from '../folding/useFoldingRound'
import { encodeSituation, WINDS, type Situation } from '../situation/urlCodec'
import { useTableRound, type UserDrawContext } from '../table/useTableRound'

/**
 * The statistical lab's own round hook: full analysis, zero grading. Built on `useTableRound`
 * exactly like `useEfficiencyRound`, minus every bit of grading that hook layers on top — no
 * score, no correct/incorrect flag, no session counters, and no `useSessionStats` (D-15, D-16).
 * The lab plays the hand out (`stopAtTenpai: false`) rather than stopping at a drill's decision
 * point, since there is no drill here to end early.
 */

export interface RoundOptions {
  deadWall: boolean
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma: boolean
  /** Let the AI opponents actually ron/tsumo — off plays every hand out to the wall instead. */
  opponentWins: boolean
  /** The board's own debug reveal switch — every seat's hand goes real, mid-hand, not just once
   *  the hand ends. */
  showOpponentHands: boolean
  /** Who plays which seat, from the board's seat panel; `null` is the shipped default (you at
   *  the link's own seat, every other seat on the efficiency AI). Page state (D15), not settings
   *  — see `LabPage`. */
  seats: SeatConfig | null
  /** Ask manual seats about other seats' discards (`TableSettings.claims`) — board-wide and
   *  persisted, unlike `seats` itself (D14). */
  claims: boolean
  /** The seat panel's "show tenpai/waits" setting — threaded to `useTableRound`, which is where
   *  the per-seat cost of computing it is actually paid. */
  showSeatWaits: boolean
}

/** The full analysis for the current 14-tile hand: `evaluateDiscards`'s whole ranking and
 *  `assessDiscards`'s whole tier list — the lab is the one consumer that wants both, read once
 *  per turn in `onUserDraw` (D-05) rather than during render. */
export interface LabAnalysis {
  ranked: DiscardOption[]
  danger: TileDanger[]
}

/** Drives one lab round on top of `useTableRound`: dealing, replay, opponents and the go-round
 *  loop all live there — this hook only stashes the per-turn analysis and the reveal gate,
 *  neither of which `useTableRound` itself has an opinion about. */
export function useLabRound(situation: Situation, options: RoundOptions) {
  const players = options.sanma ? 3 : 4
  // a shared ?seat=N link built under yonma can name a seat sanma doesn't have (North)
  const linkSeat = Math.min(Math.max(0, WINDS.indexOf(situation.seat)), players - 1)
  // the graded seat is decided by the link alone, never by the seat panel: flipping your own
  // seat's algorithm live must freeze grading in place (D13), not move it to whichever other seat
  // the panel happens to have marked manual — so this never goes through `options.seats`
  const seatIndex = linkSeat
  const algorithms = resolveSeatConfig(options.seats, players, seatIndex).modes
  const manualSeats = algorithms.flatMap((a, seat) => (a === 'manual' ? [seat] : []))
  const round = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const matchOptions: MatchOptions = {
    sanma: options.sanma,
    aka: options.aka,
    round,
    deadWall: options.deadWall,
    calls: true,
    riichi: true,
    wins: options.opponentWins,
    algorithms,
    claims: options.claims,
  }

  const log = useLog((s) => s.log)
  const [analysis, setAnalysis] = useState<LabAnalysis>({ ranked: [], danger: [] })

  const table = useTableRound({
    wall: situation.wall,
    players,
    seatIndex,
    options: matchOptions,
    replay: situation.log,
    stopAtTenpai: false,
    showSeatWaits: options.showSeatWaits,
    onUserDraw(ctx: UserDrawContext) {
      // read both once here, not from render — evaluateDiscards/assessDiscards are real work
      setAnalysis({ ranked: ctx.analysis.ranked, danger: ctx.analysis.danger })
    },
    onUserDiscard(tile: ParsedTile) {
      // one plain log row naming the tile and the turn — no grade, no partial credit, nothing
      // read off the discard's own stats
      const situationBefore = encodeSituation(table.situation())
      log(
        'log.lab.discard',
        { turn: table.turn, tile: tileCode(tile.id, tile.red) },
        [tile],
        undefined,
        situationBefore,
      )
    },
  })

  const finished = table.ended !== undefined

  // the reveal gate, exactly like folding's: your own seat's real tiles always, every other
  // seat's real tiles once the hand is finished or the board's own reveal switch is on,
  // otherwise face-down filler of the right length — the lab must not become the screen that
  // leaks what the folding drill hides
  const boardHands: ParsedTile[][] = table.hands.map((hand, seat) =>
    // a manual seat is the reader's own, so it is never hidden from them
    manualSeats.includes(seat) || finished || options.showOpponentHands
      ? hand
      : hand.map(() => BACK_TILE),
  )

  return {
    ...table,
    ranked: analysis.ranked,
    danger: analysis.danger,
    finished,
    boardHands,
    /** Every seat a person plays — face-up on the board and playable in turn. */
    manualSeats,
    situationQuery: () => encodeSituation(table.situation()),
  }
}
