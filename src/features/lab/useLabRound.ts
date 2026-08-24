import { useEffect, useRef, useState } from 'react'
import type { TileDanger } from '../../core/danger'
import type { DiscardOption } from '../../core/efficiency'
import { createMatch } from '../../core/match'
import type { RoundOptions } from '../../core/round'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { resolveSeatConfig, type SeatConfig } from '../settings/tableSettings'
import { useLog } from '../../store/log'
import { BACK_TILE } from '../folding/useFoldingRound'
import { encodeSituation, matchOverrides, WINDS, type Situation } from '../situation/urlCodec'
import { splitDrawn } from '../../core/table'
import { useRound, type RoundEventContext } from '../table/useRound'

/**
 * The statistical lab's own round hook: full analysis, zero grading. Built on `useRound` exactly
 * like `useEfficiencyRound`, minus every bit of grading that hook layers on top — no score, no
 * correct/incorrect flag, no session counters, and no `useSessionStats` (ADR-0004). It never
 * returns a stop command, so the hand plays out to its natural end rather than stopping at a
 * drill's decision point — there is no drill here to end early.
 */

export interface LabOptions {
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
   *  the link's own seat, every other seat on the efficiency AI). Page state (ADR-0015), not settings
   *  — see `LabPage`. */
  seats: SeatConfig | null
  /** Ask manual seats about other seats' discards (`TableSettings.claims`) — board-wide and
   *  persisted, unlike `seats` itself (ADR-0015). */
  claims: boolean
  /** The seat panel's "show tenpai/waits" setting — threaded to `useRound`, which is where the
   *  per-seat cost of computing it is actually paid. */
  showSeatWaits: boolean
}

/** The full analysis for the current 14-tile hand: `evaluateDiscards`'s whole ranking and
 *  `assessDiscards`'s whole tier list — the lab is the one consumer that wants both, read once
 *  per turn off the draw event's analysis (ADR-0012) rather than during render. */
export interface LabAnalysis {
  ranked: DiscardOption[]
  danger: TileDanger[]
}

/** Drives one lab round on top of `useRound`: dealing, replay, opponents and the go-round loop
 *  all live there — this hook only stashes the per-turn analysis and the reveal gate, neither of
 *  which the match layer has an opinion about. */
export function useLabRound(situation: Situation, options: LabOptions) {
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
    deadWall: options.deadWall,
    calls: true,
    riichi: true,
    wins: options.opponentWins,
    algorithms,
    claims: options.claims,
  }

  const log = useLog((s) => s.log)
  const [analysis, setAnalysis] = useState<LabAnalysis>({ ranked: [], danger: [] })
  // the situation whose deal is already on the log; see `logDealt` below
  const loggedDeal = useRef<Situation>(undefined)

  /** No grading at all — the lab logs the reader's own discards plainly and reads the analysis
   *  for whichever seat is about to act. It never returns a command: the hand plays out. */
  function onEvent({ event, core, replaying, analysis: turn, logLength }: RoundEventContext) {
    if (replaying) return
    if (event.kind === 'discard' && manualSeats.includes(event.seat)) {
      // one plain log row naming the tile and the turn — no grade, no partial credit
      log({
        key: 'log.lab.discard',
        params: { turn: core.round.turn, tile: tileCode(event.tile.id, event.tile.red) },
        tiles: [event.tile],
        situation: encodeSituation(table.situation(seatIndex, core.round.log.slice(0, logLength))),
      })
    }
    // read both once per turn, not from render — evaluateDiscards/assessDiscards are real work
    if (event.kind === 'draw' && manualSeats.includes(event.seat) && turn) {
      setAnalysis({ ranked: turn.ranked, danger: turn.danger })
    }
  }

  const table = useRound({
    wall: situation.wall,
    players,
    options: roundOptions,
    replay: situation.log,
    showReads: options.showSeatWaits || options.showOpponentHands,
    onEvent,
  })

  /** The deal itself, as its own row — see the table hook's own `logReplay` for why every deal
   *  needs one now that the page's own share pill is gone (T3). Keyed on the situation's identity
   *  the same way, since this effect runs more than once per mount for one and the same round.
   *  The lab has no restart control of its own, so unlike the graded trainers there is no second
   *  half to this key. */
  function logDealt() {
    if (loggedDeal.current === situation) return
    loggedDeal.current = situation
    log({ key: 'log.dealt', situation: encodeSituation(table.situation(seatIndex, [])) })
  }

  useEffect(() => {
    logDealt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation])

  const snapshot = table.snapshot
  const acting = snapshot?.seat ?? seatIndex
  const { tiles: hand, drawn } = splitDrawn(
    snapshot?.hands[acting] ?? [],
    snapshot?.drawn?.seat === acting ? snapshot.drawn.tile : undefined,
  )

  const finished = snapshot?.ended !== undefined

  // the reveal gate, exactly like folding's: your own seat's real tiles always, every other
  // seat's real tiles once the hand is finished or the board's own reveal switch is on,
  // otherwise face-down filler of the right length — the lab must not become the screen that
  // leaks what the folding drill hides
  const boardHands: ParsedTile[][] = (snapshot?.hands ?? []).map((seatHand, seat) =>
    // a manual seat is the reader's own, so it is never hidden from them
    manualSeats.includes(seat) || finished || options.showOpponentHands
      ? seatHand
      : seatHand.map(() => BACK_TILE),
  )

  return {
    turn: snapshot?.turn ?? 1,
    doraIndicators: snapshot?.doraIndicators ?? [],
    rivers: snapshot?.rivers ?? [],
    hands: snapshot?.hands ?? [],
    melds: snapshot?.melds ?? [],
    nuki: snapshot?.nuki ?? [],
    riichi: snapshot?.riichi ?? [],
    liveWall: snapshot?.liveWall ?? [],
    deadWall: snapshot?.deadWall ?? [],
    liveWallSnapshot: snapshot?.liveWallSnapshot ?? [],
    liveWallDrawn: snapshot?.liveWallDrawn ?? 0,
    deadWallSnapshot: snapshot?.deadWallSnapshot ?? [],
    dealtTiles: snapshot?.dealtTiles ?? [],
    replacements: snapshot?.replacements ?? 0,
    match: snapshot?.match ?? createMatch(options.sanma),
    wall: snapshot?.wall ?? [],
    ended: snapshot?.ended,
    win: snapshot?.win,
    claim: snapshot?.claim,
    seatReads: snapshot?.seatReads ?? [],
    hand,
    drawn,
    seatIndex,
    acting,
    drawnSeat: snapshot?.drawn?.seat,
    kans: (snapshot?.melds[acting] ?? []).filter((m) => m.kind === 'ankan').map((m) => m.tiles),
    ranked: analysis.ranked,
    danger: analysis.danger,
    finished,
    boardHands,
    /** Every seat a person plays — face-up on the board and playable in turn. */
    manualSeats,
    discard: (index: number, declareRiichi?: boolean) => {
      const fromDrawn = index === hand.length
      const tile = fromDrawn ? drawn : hand[index]
      if (tile) table.discard(tile, fromDrawn, declareRiichi)
    },
    answer: table.answer,
    riichiTiles: table.riichiTiles,
    riichiArmed: table.riichiArmed,
    armRiichi: table.armRiichi,
    kita: table.kita,
    kan: table.kan,
    restart: table.restart,
    situationQuery: () => encodeSituation(table.situation(seatIndex)),
  }
}
