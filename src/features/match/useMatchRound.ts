import { useEffect, useRef, useState } from 'react'
import {
  createMatch,
  settleRound,
  type MatchFormat,
  type MatchState,
  type Settlement,
} from '../../core/match'
import { roundResult, type RoundOptions, type RoundState } from '../../core/round'
import type { TenhouRoundInput } from '../../core/tenhouLog'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { completeWall } from '../../core/wall'
import { matchDefaultModes, resolveSeatConfig, type SeatConfig } from '../settings/tableSettings'
import { useLog } from '../../store/log'
import { BACK_TILE } from '../folding/useFoldingRound'
import {
  encodeSituation,
  matchOverrides,
  seatWind,
  WINDS,
  type Situation,
  type Wind,
} from '../situation/urlCodec'
import { splitDrawn } from '../../core/table'
import { type MatchResultParams } from '../i18n/formatLogEntry'
import { scoreDetail } from '../scoring/useScoringRound'
import { useRound, type RoundEventContext } from '../table/useRound'

/**
 * Sequences rounds into a match on top of `useRound` — the same layer every board trainer sits
 * on, plus `core/match.ts#settleRound` between deals. No grading, like the lab: the
 * points ARE the score. A new round is a fresh wall/match pair, and that new *wall array
 * identity* is what makes `useRound` redeal — see `nextRound` below.
 */

export interface MatchOptions {
  format: MatchFormat
  sanma: boolean
  aka: boolean
  kiriageMangan: boolean
  /** Who plays which seat, live — same schema and same "flip mid-hand, no redeal" rule as every
   *  other trainer's seat panel. The setup screen only seeds `MatchBoard`'s own
   *  `useState` with this; it is not re-read here after the match starts. */
  seats: SeatConfig | null
  showOpponentHands: boolean
  showSeatWaits: boolean
  /** How long a seat nobody plays holds before its action is committed (`useRound`'s `pace`). */
  pace: number
  /**
   * Seeds every wall this match deals, for a caller that needs the same match twice. Absent in the
   * app — a real match deals at random, and the way a reader reproduces one round is the `?wall=`
   * link, not a seed.
   *
   * It exists because a test that plays a whole hand cannot be written against a random wall.
   * `completeWall` falls back to `String(Math.random())` with no seed, so `useMatchRound.test.ts`
   * was dealing a different match on every run and its own play loop — a fixed iteration cap and a
   * bail-out when it cannot act — met a different board each time. That is a suite that fails
   * about one run in two and passes in isolation, which is worse than a suite that fails.
   */
  seed?: string
}

/** One settled round: what it decided, what it paid, and the match state on both sides of it —
 *  everything the round-end card needs, and everything the log row was built from. */
export interface RoundSettlement {
  result: MatchResultParams
  deltas: number[]
  settlement: Settlement
  /** The wind each seat was sitting in the round that just ended — the dealer has already moved on
   *  inside `settlement.match`, so a card naming the seats has to be told which round it is about
   *  (`urlCodec.ts#seatWind`). */
  winds: Wind[]
}

/** A round's chronological position within its match, as one sortable number — `prevalentWind`
 *  only ever increases and `honba` only ever increases within a repeated (`prevalentWind`,
 *  `round`) pair, so the triple is a valid total order over every round a match plays. Used to
 *  dedupe/truncate the tenhou export history below on a rewind that revisits or steps past an
 *  already-settled round. */
function roundKey(m: Pick<MatchState, 'prevalentWind' | 'round' | 'honba'>): number {
  return m.prevalentWind * 10000 + m.round * 1000 + m.honba
}

/** The cast a link implies: its own `?seat=` plays the hand, every other seat is a bot — what
 *  `/match` opens with when a shared link (or the log's own rewind) names a wall, since there is no
 *  setup left to run for it and running one anyway would reshuffle the seats the link reproduces.
 *
 *  `Situation.seat` is a Wind letter written from a seat *index* (`useRound#situation`) and read
 *  back as one here. The two ends share that convention, so it round-trips even in a round whose
 *  dealer has rotated and whose letter is therefore no longer the wind that seat is really
 *  sitting — which is why this reads it as a position and never through `seatWind`. */
export function linkedSeats(situation: Situation): SeatConfig {
  const players = situation.sanma ? 3 : 4
  const seat = Math.max(0, WINDS.indexOf(situation.seat))
  return { modes: Array.from({ length: players }, (_, i) => (i === seat ? 'manual' : 'ev')) }
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
  // a link that names a wall is picked up **at mount as well as on a later navigation**: the resync
  // below fires on an identity *change*, and the situation a fresh `MatchBoard` opens with has
  // never changed — so seeding from it here is what makes a shared link (or a rewind that remounted
  // the board) deal the round it names instead of a fresh random one. It also makes
  // `wall === situation.wall` below, which is what arms the replay.
  const linked = situation.wall.length > 0
  const [match, setMatch] = useState<MatchState>(() =>
    createMatch(options.sanma, linked ? matchOverrides(situation) : undefined),
  )
  /** A fresh deal for `next`. Unseeded in the app, so every match is its own; with
   *  `MatchOptions.seed` set, keyed on which round it is so consecutive rounds still differ while
   *  the whole match stays reproducible. */
  function dealWall(next: MatchState): ParsedTile[] {
    const seed =
      options.seed === undefined
        ? undefined
        : `${options.seed}-${next.prevalentWind}-${next.round}-${next.honba}`
    return completeWall([], options.sanma, options.aka, seed)
  }

  const [wall, setWall] = useState<ParsedTile[]>(() => (linked ? situation.wall : dealWall(match)))
  const [settlement, setSettlement] = useState<RoundSettlement | null>(null)
  // every settled round, for a tenhou.net/6 export — pushed once per round-end below, keyed on
  // `roundKey` so a rewind that replays an already-settled round overwrites rather than duplicates
  // it, and truncated in the resync block below so a rewind past an already-settled round drops
  // the now-invalid ones rather than exporting a timeline that was never actually played.
  const [tenhouRounds, setTenhouRounds] = useState<TenhouRoundInput[]>([])

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
      const resumed = createMatch(options.sanma, matchOverrides(situation))
      setMatch(resumed)
      setWall(situation.wall)
      // a rewind (or a shared link) landing at or before an already-settled round means that
      // round, and everything after it, is about to be replayed differently — drop them from the
      // export history rather than keep a timeline that no longer matches what gets played
      const resumedKey = roundKey(resumed)
      setTenhouRounds((rounds) => rounds.filter((r) => roundKey(r.match) < resumedKey))
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
    // free play against bots, same as the lab — a manual seat is asked about every
    // other seat's discard rather than silently skipped
    claims: true,
    // daiminkan/kakan — match-only ruleset, not a permission; `chooseCall` never sees the flag, so
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
      const winds = Array.from({ length: players }, (_, seat) =>
        seatWind(seat, ended.dealer, players),
      )
      const result: MatchResultParams = {
        roundWind: WINDS[ended.prevalentWind - HONOR] ?? 'E',
        roundNumber: ended.round,
        honba: ended.honba,
        kind: rr.ended,
        winner: rr.win === undefined ? undefined : winds[rr.win.seat],
        loser: rr.win?.from === undefined ? undefined : winds[rr.win.from],
      }
      setSettlement({ result, deltas: stepped.deltas, settlement: stepped, winds })
      // `match`/`wall` (this render's closure, not `core.round.match`) are this round's own
      // *starting* state — see `TenhouRoundInput.match`'s own doc comment on why it must never be
      // the live, riichi-mutated one
      setTenhouRounds((rounds) => {
        const key = roundKey(match)
        const entry: TenhouRoundInput = {
          match,
          wall,
          log: [...core.round.log],
          deltas: stepped.deltas,
        }
        return [...rounds.filter((r) => roundKey(r.match) !== key), entry]
      })

      log({
        key: 'log.match.result',
        params: { ...result },
        // the winning hand's own breakdown leads, then who paid what — the exact lines the
        // round-end card draws (`MatchPage`'s `WinReport`), off the one `scoreDetail` the scoring
        // trainer also uses, so the row and the card can never tell two stories about one hand
        detail: [
          ...(core.round.win ? scoreDetail(core.round.win.score) : []),
          ...stepped.deltas
            .map((delta, seat) => ({ seat, delta }))
            .filter((d) => d.delta !== 0)
            .map(({ seat, delta }) => ({
              key: 'log.match.delta',
              params: {
                wind: winds[seat],
                amount: (delta >= 0 ? '+' : '') + delta.toLocaleString(),
              },
            })),
        ],
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
    // resolved here rather than at render: the dealer moves between rounds, so a row written in
    // East 2 must keep saying East 2's winds once East 3 is on the felt
    const windAt = (seat: number) => seatWind(seat, core.round.match.dealer, players)
    switch (event.kind) {
      case 'discard':
        log({
          key: 'log.match.discard',
          params: {
            turn: core.round.turn,
            wind: windAt(event.seat),
            tile: tileCode(event.tile.id, event.tile.red),
          },
          situation: situationAt(event.seat),
        })
        break
      case 'riichi':
        log({
          key: 'log.match.riichi',
          params: { wind: windAt(event.seat) },
          situation: situationAt(event.seat),
        })
        break
      case 'call':
        log({
          key: 'log.match.call',
          params: { wind: windAt(event.seat), from: windAt(event.from), kind: event.meld.kind },
          situation: situationAt(event.seat),
        })
        break
      case 'kita':
        log({
          key: 'log.match.kita',
          params: { wind: windAt(event.seat) },
          situation: situationAt(event.seat),
        })
        break
      case 'ankan':
      case 'kakan':
        log({
          key: 'log.match.kan',
          params: { wind: windAt(event.seat), tile: tileCode(event.tile) },
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
    setWall(dealWall(settlement.settlement.match))
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
    /** Every settled round so far, for a tenhou.net/6 export — `MatchPage` builds the log lazily
     *  from this rather than the hook keeping a serialized copy nobody may ever ask for. */
    tenhouRounds,
  }
}
