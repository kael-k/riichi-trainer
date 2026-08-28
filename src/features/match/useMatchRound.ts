import { useEffect, useRef, useState } from 'react'
import {
  createMatch,
  settleRound,
  type MatchFormat,
  type MatchState,
  type Settlement,
} from '../../core/match'
import { roundResult, type RoundOptions, type RoundState } from '../../core/round'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { completeWall } from '../../core/wall'
import { matchDefaultModes, resolveSeatConfig, type SeatConfig } from '../settings/tableSettings'
import { useLog } from '../../store/log'
import { BACK_TILE } from '../folding/useFoldingRound'
import { encodeSituation, matchOverrides, WINDS, type Situation } from '../situation/urlCodec'
import { splitDrawn } from '../../core/table'
import { type MatchResultParams } from '../i18n/formatLogEntry'
import { useRound, type RoundEventContext } from '../table/useRound'

/**
 * Sequences rounds into a match on top of `useRound` — the same layer every board trainer sits
 * on, plus `core/match.ts#settleRound` between deals (ADR-0040). No grading, like the lab: the
 * points ARE the score. A new round is a fresh wall/match pair, and that new *wall array
 * identity* is what makes `useRound` redeal — see `nextRound` below.
 */

export interface MatchOptions {
  format: MatchFormat
  sanma: boolean
  aka: boolean
  kiriageMangan: boolean
  /** Who plays which seat, live — same schema and same "flip mid-hand, no redeal" rule as every
   *  other trainer's seat panel (ADR-0008). The setup screen only seeds `MatchBoard`'s own
   *  `useState` with this; it is not re-read here after the match starts. */
  seats: SeatConfig | null
  showOpponentHands: boolean
  showSeatWaits: boolean
  /** How long a seat nobody plays holds before its action is committed (`useRound`'s `pace`). */
  pace: number
}

/** One settled round: what it decided, what it paid, and the match state on both sides of it —
 *  everything the round-end card needs, and everything the log row was built from. */
export interface RoundSettlement {
  result: MatchResultParams
  deltas: number[]
  settlement: Settlement
}

export function useMatchRound(options: MatchOptions, situation: Situation) {
  const players = options.sanma ? 3 : 4
  // `requireManual: false` is what lets an explicit all-bot cast (every seat moved off manual on
  // the setup screen) actually stick — see `matchDefaultModes`'s own doc comment
  const seats = resolveSeatConfig(options.seats, players, 0, matchDefaultModes(players), false)
  const algorithms = seats.modes
  const manualSeats = algorithms.flatMap((a, seat) => (a === 'manual' ? [seat] : []))
  const seatIndex = manualSeats[0] ?? 0

  // the ruleset (players, red fives) is fixed for the whole match at Start (`MatchOptions.sanma`/
  // `.aka` never change out from under a running match) — only the carry-in state steps, via
  // `nextRound` below, never re-derived from `options` on a later render
  const [match, setMatch] = useState<MatchState>(() => createMatch(options.sanma))
  const [wall, setWall] = useState<ParsedTile[]>(() => completeWall([], options.sanma, options.aka))
  const [settlement, setSettlement] = useState<RoundSettlement | null>(null)

  // a link names one round of the match, not every round from here on — same rule every other
  // trainer's own hand link follows (CLAUDE.md). `situation`'s identity changes only on a real
  // navigation: the log's own rewind, the undo button, or a shared match-round link opened fresh.
  // `nextRound`'s own local wall/match advance never touches the URL, so it never trips this —
  // "adjust state while rendering" (the same pattern `useLinkedHand` and `LabPage`'s own
  // `lastSituation` check use), not an effect, so the resync lands before anything below reads
  // `wall`/`match` this render.
  const [lastSituation, setLastSituation] = useState(situation)
  if (situation !== lastSituation) {
    setLastSituation(situation)
    if (situation.wall.length > 0) {
      setMatch(createMatch(options.sanma, matchOverrides(situation)))
      setWall(situation.wall)
    }
    setSettlement(null)
  }

  const log = useLog((s) => s.log)
  const loggedWall = useRef<ParsedTile[] | undefined>(undefined)
  // guards the settlement (and its log row) against StrictMode's double effect-invoke reporting
  // the same round's end twice — same reasoning as `useLabRound`'s `loggedDeal`, keyed on the
  // `RoundState` object itself since a fresh one is what a new wall identity builds
  const settledFor = useRef<RoundState | undefined>(undefined)

  const roundOptions: RoundOptions = {
    sanma: options.sanma,
    aka: options.aka,
    kiriageMangan: options.kiriageMangan,
    match,
    calls: true,
    riichi: true,
    wins: true,
    algorithms,
    ev: seats.ev,
    // free play against bots, same as the lab (ADR-0034) — a manual seat is asked about every
    // other seat's discard rather than silently skipped
    claims: true,
    // daiminkan/kakan — match-only (ADR-0010's amendment); `chooseCall` never sees the flag, so
    // no bot anywhere else ever takes a minkan regardless of this being on
    calledKan: true,
  }

  function onEvent({ event, core, replaying, logLength }: RoundEventContext) {
    if (replaying) return
    if (event.kind === 'win' || event.kind === 'exhaustive' || event.kind === 'abort') {
      if (settledFor.current === core.round) return
      settledFor.current = core.round

      const ended = core.round.match // the round that just finished, before it steps
      const rr = roundResult(core.round)
      if (!rr) return
      const stepped = settleRound(ended, rr, { sanma: options.sanma, format: options.format })
      const result: MatchResultParams = {
        roundWind: WINDS[ended.prevalentWind - HONOR] ?? 'E',
        roundNumber: ended.round,
        honba: ended.honba,
        kind: rr.ended,
        seat: rr.win?.seat,
        from: rr.win?.from,
      }
      setSettlement({ result, deltas: stepped.deltas, settlement: stepped })

      log({
        key: 'log.match.result',
        params: { ...result },
        detail: stepped.deltas
          .map((delta, seat) => ({ seat, delta }))
          .filter((d) => d.delta !== 0)
          .map(({ seat, delta }) => ({
            key: 'log.match.delta',
            params: { seat, amount: (delta >= 0 ? '+' : '') + delta.toLocaleString() },
          })),
        situation: encodeSituation(table.situation(seatIndex, core.round.log.slice(0, logLength))),
      })
      return
    }

    // every seat's own action, bots included — a full transcript of the hand. Only a *manual*
    // seat's own row carries a `situation`: a bot's move is not a decision a reader can usefully
    // step back to — undoing "to right before it" just replays the same deterministic wall and
    // the bot immediately redecides the identical thing, which is what left `useLogBack` stuck in
    // place on the last bot turn forever during manual testing. Every other trainer sidesteps
    // this by only ever logging its own manual seat's actions at all (`useLabRound.ts`); this one
    // wants bot rows visible too (a full transcript), just not as undo points.
    const situationAt = (seat: number) =>
      manualSeats.includes(seat)
        ? encodeSituation(table.situation(seatIndex, core.round.log.slice(0, logLength)))
        : undefined
    switch (event.kind) {
      case 'discard':
        log({
          key: 'log.match.discard',
          params: {
            turn: core.round.turn,
            seat: event.seat,
            tile: tileCode(event.tile.id, event.tile.red),
          },
          situation: situationAt(event.seat),
        })
        break
      case 'riichi':
        log({
          key: 'log.match.riichi',
          params: { seat: event.seat },
          situation: situationAt(event.seat),
        })
        break
      case 'call':
        log({
          key: 'log.match.call',
          params: { seat: event.seat, from: event.from, kind: event.meld.kind },
          situation: situationAt(event.seat),
        })
        break
      case 'kita':
        log({
          key: 'log.match.kita',
          params: { seat: event.seat },
          situation: situationAt(event.seat),
        })
        break
      case 'ankan':
      case 'kakan':
        log({
          key: 'log.match.kan',
          params: { seat: event.seat, tile: tileCode(event.tile) },
          situation: situationAt(event.seat),
        })
        break
    }
  }

  const table = useRound({
    wall,
    players,
    options: roundOptions,
    // this round's log only applies while `wall` is still the exact array `situation` handed us
    // — `nextRound`'s own fresh wall (a new identity) means ordinary play, no replay
    replay: wall === situation.wall ? situation.log : undefined,
    showReads: options.showSeatWaits || options.showOpponentHands,
    pace: options.pace,
    onEvent,
  })

  /** The deal itself, as its own log row — one per board, keyed on wall identity (the round
   *  build effect below runs more than once per mount, StrictMode included). */
  useEffect(() => {
    if (loggedWall.current === wall) return
    loggedWall.current = wall
    log({ key: 'log.dealt', situation: encodeSituation(table.situation(seatIndex, [])) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wall])

  /** Deals the next round: a fresh wall (new array identity — the trick `useRound` redeals on)
   *  and the match state `settleRound` already stepped to. Both land in the same commit, so the
   *  very next render rebuilds the board on the new round. */
  function nextRound() {
    if (!settlement) return
    setMatch(settlement.settlement.match)
    setWall(completeWall([], options.sanma, options.aka))
    setSettlement(null)
  }

  const snapshot = table.snapshot
  const acting = snapshot?.seat ?? seatIndex
  const { tiles: hand, drawn } = splitDrawn(
    snapshot?.hands[acting] ?? [],
    snapshot?.drawn?.seat === acting ? snapshot.drawn.tile : undefined,
  )
  const finished = snapshot?.ended !== undefined

  const boardHands: ParsedTile[][] = (snapshot?.hands ?? []).map((seatHand, seat) =>
    manualSeats.includes(seat) || finished || options.showOpponentHands
      ? seatHand
      : seatHand.map(() => BACK_TILE),
  )

  return {
    callBanner: table.callBanner,
    tedashi: table.tedashi,
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
    match: snapshot?.match ?? match,
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
    finished,
    boardHands,
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
    kakan: table.kakan,
    /** The last settled round — what to show on the round-end card. `undefined` while the round
     *  in progress hasn't ended yet. */
    settlement,
    /** The match is over: a seat busted, or the format's last round has been played past. */
    over: settlement?.settlement.over ?? false,
    nextRound,
    situationQuery: () => encodeSituation(table.situation(seatIndex)),
  }
}
