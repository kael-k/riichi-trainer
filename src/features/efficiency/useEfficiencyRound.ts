import { useEffect, useRef, useState } from 'react'
import { createMatch } from '../../core/match'
import { NORTH, type RoundOptions } from '../../core/round'
import { shanten } from '../../core/shanten'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { resolveSeatConfig, type SeatConfig } from '../settings/tableSettings'
import { useLog } from '../../store/log'
import { splitDrawn } from '../../core/table'
import { useRound, type RoundCommand, type RoundEventContext } from '../table/useRound'
import { encodeSituation, matchOverrides, WINDS, type Situation } from '../situation/urlCodec'
import {
  actionStats,
  efficiencyLogRows,
  gradeAction,
  handFromSnapshot,
  lostVs,
  type TurnResult,
} from './grade'

export { NORTH }
export type { TurnResult } from './grade'

/** Options that change how a round plays out; resolved from settings with per-situation
 *  overrides so shared links reproduce exactly. */
export interface EfficiencyOptions {
  deadWall: boolean
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma: boolean
  /** Who plays which seat, from the board's seat panel; `null` is the shipped default (you at
   *  the link's own seat, every other seat on the efficiency AI). Page state (ADR-0015), not settings
   *  — see `EfficiencyPage`. */
  seats: SeatConfig | null
  /** Ask manual seats about other seats' discards (`TableSettings.claims`) — board-wide and
   *  persisted, unlike `seats` itself (ADR-0015). */
  claims: boolean
  /** The seat panel's "show tenpai/waits" setting — threaded to `useRound`, which is where the
   *  per-seat cost of computing it is actually paid. */
  showSeatWaits: boolean
}

/** Drives one efficiency round on top of `useRound`: dealing, replay, opponents and the go-round
 *  loop all live there — this hook only grades, logs and carries session state
 *  (`cumulativeLost`/`cumulativeTotal`/`lastResult`/the clock) the match layer has no opinion
 *  about. Which seat is graded is decided here and nowhere else: `useRound` reports every seat's
 *  events and this handler ignores the ones that are not `seatIndex`'s, which is what lets a second
 *  manual seat be *played* without being *scored*. */
export function useEfficiencyRound(
  situation: Situation,
  options: EfficiencyOptions,
  timerEnabled: boolean,
) {
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
    // opponents may open their hands and call, but nobody wins: a hand that ended on someone
    // else's tsumo would cut this per-turn drill short on a result the player did not cause
    calls: true,
    // efficiency reads no danger, so an opponent's riichi here was decoration, not signal
    riichi: false,
    wins: false,
    algorithms,
    claims: options.claims,
  }

  const log = useLog((s) => s.log)
  const stats = useSessionStats()

  const [restartCount, setRestartCount] = useState(0)
  const [cumulativeLost, setCumulativeLost] = useState(0)
  const [cumulativeTotal, setCumulativeTotal] = useState(0)
  const [lastResult, setLastResult] = useState<TurnResult | null>(null)

  // the session clock's reading at the last graded choice, so each choice's time is a delta of
  // the same pause-aware clock rather than a second, unpaused one
  const lastChoiceElapsed = useRef(0)
  // a kita/kan's grading happens in onUserDiscard, before its replacement (rinshan) draw is
  // known — stashed here until the onUserDraw that immediately follows resolves it with that
  // draw. A plain discard already knows its "drawn" tile, so it never touches this.
  const pending = useRef<
    { result: TurnResult; tile: ParsedTile; situationBefore: string } | undefined
  >(undefined)
  // the situation whose replayed river is already on the log; see `logReplay`
  const loggedReplay = useRef<Situation>(undefined)
  // graded choices made in *this* round, for the round-complete panel's own average — distinct
  // from `stats.averageTime`, which keeps running across every round until the log is cleared
  const roundActionCount = useRef(0)

  function recordChoice(result: TurnResult) {
    const elapsed = stats.elapsedNow()
    stats.record(result.grade !== 'error', elapsed - lastChoiceElapsed.current)
    lastChoiceElapsed.current = elapsed
    roundActionCount.current++
  }

  function writeRows(
    result: TurnResult,
    drawn: ParsedTile | undefined,
    tile: ParsedTile,
    situationBefore: string,
  ) {
    for (const [key, params, tiles] of efficiencyLogRows(result, drawn, tile)) {
      log(key, params, tiles, undefined, situationBefore)
    }
  }

  function settle(
    result: TurnResult,
    drawn: ParsedTile | undefined,
    tile: ParsedTile,
    situationBefore: string,
  ) {
    writeRows(result, drawn, tile, situationBefore)
    setCumulativeLost((n) => n + lostVs(result.yours, result.best))
    setCumulativeTotal((n) => n + result.best.ukeireCount)
    setLastResult(result)
    recordChoice(result)
  }

  /** Grades this trainer's own seat and nothing else. Another manual seat's turns still reach
   *  here — it is played, and its events are reported like any seat's — but they are not this
   *  drill's decision, so they are neither scored nor logged. */
  function onEvent({
    event,
    core,
    replaying,
    analysis,
    logLength,
  }: RoundEventContext): RoundCommand {
    // a kita/kan is graded when it happens but logged only once its replacement draw is known
    if (event.kind === 'draw') {
      if (replaying || event.seat !== seatIndex || !pending.current) return
      const { result, tile, situationBefore } = pending.current
      pending.current = undefined
      settle(result, event.tile, tile, situationBefore)
      return
    }
    if (replaying || !analysis) return
    if (event.kind !== 'discard' && event.kind !== 'kita' && event.kind !== 'ankan') return
    if (event.seat !== seatIndex) return

    const kind = event.kind === 'discard' ? 'discard' : event.kind === 'kita' ? 'kita' : 'kan'
    const tile: ParsedTile =
      event.kind === 'discard'
        ? event.tile
        : event.kind === 'kita'
          ? { id: NORTH, red: false }
          : { id: event.tile, red: false }
    // the log as it stood before this decision, so the row's rewind link reproduces the turn
    // rather than the board that already followed it
    const situationBefore = encodeSituation(
      table.situation(seatIndex, core.round.log.slice(0, logLength)),
    )
    const result = gradeAction(
      actionStats(analysis, kind, tile.id, options.sanma),
      core.round.turn,
      options.sanma,
    )

    if (kind !== 'discard') {
      pending.current = { result, tile, situationBefore }
      return
    }
    settle(result, analysis.drawn, tile, situationBefore)

    // a per-turn drill ends at the discard that reaches tenpai, leaving 13 tiles so it reads as
    // finished. Only this seat's own tenpai: an AI seat reaching tenpai plays on
    if (shanten(core.round.players[seatIndex].hand) <= 0) return { stop: true }
  }

  const table = useRound({
    wall: situation.wall,
    players,
    options: roundOptions,
    replay: situation.log,
    showSeatWaits: options.showSeatWaits,
    onEvent,
  })

  const snapshot = table.snapshot
  const acting = snapshot?.seat ?? seatIndex
  const seatMelds = snapshot?.melds[seatIndex] ?? []
  // the hand on screen belongs to whichever seat is acting — `seatIndex` in the ordinary
  // single-manual-seat setup, some other manual seat once the reader plays more than one
  const { tiles: hand, drawn } = splitDrawn(
    snapshot?.hands[acting] ?? [],
    snapshot?.drawn?.seat === acting ? snapshot.drawn.tile : undefined,
  )

  /** Writes one log row per *your own* discard the round was fast-forwarded through, so a shared
   *  link (or a rewind) arrives with the turns behind it on the record instead of a blank log —
   *  `table.replayed` is every seat's replayed decision now (ADR-0021), filtered down to this seat's
   *  own discards for the row itself, but each row's rewind link is the *full* log truncated to
   *  that discard's actual position, not just "your discards so far": a mid-hand rewind has to
   *  reproduce the opponents' own melds and discards exactly as they were, not re-simulate them.
   *  Keyed on the situation's identity: this effect runs twice per mount (initial state, then
   *  mount) and four times under StrictMode, all for the same round. */
  function logReplay() {
    if (loggedReplay.current === situation) return
    loggedReplay.current = situation
    const base = table.situation(seatIndex, [])
    table.replayed().forEach((entry, i) => {
      if (entry.kind !== 'discard' || entry.seat !== seatIndex) return
      log(
        'log.replay',
        { tile: tileCode(entry.tile.id, entry.tile.red) },
        [entry.tile],
        undefined,
        encodeSituation({ ...base, log: table.replayed().slice(0, i) }),
      )
    })
  }

  useEffect(() => {
    setCumulativeLost(0)
    setCumulativeTotal(0)
    setLastResult(null)
    stats.startClock()
    lastChoiceElapsed.current = 0
    roundActionCount.current = 0
    pending.current = undefined
    logReplay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, restartCount])

  // a fixed meld (ankan) counts as 3 tiles toward the 14 even though it isn't in `hand`/`drawn`
  const ownHand = splitDrawn(
    snapshot?.hands[seatIndex] ?? [],
    snapshot?.drawn?.seat === seatIndex ? snapshot.drawn.tile : undefined,
  )
  const finished = ownHand.tiles.length + (ownHand.drawn ? 1 : 0) + seatMelds.length * 3 < 14
  const tenpai =
    finished && shanten(handFromSnapshot(ownHand.tiles, ownHand.drawn, seatMelds.length)) <= 0

  return {
    hand,
    drawn,
    turn: snapshot?.turn ?? 1,
    doraIndicators: snapshot?.doraIndicators ?? [],
    rivers: snapshot?.rivers ?? [],
    hands: snapshot?.hands ?? [],
    riichi: snapshot?.riichi ?? [],
    /** Per-seat melds/nuki (calls included), so the table can show every seat's — not just your
     *  own — pon/chi/kan and nukidora. `kans` below stays the narrower, ankan-only view your own
     *  seat's corner already used. */
    melds: snapshot?.melds ?? [],
    nuki: snapshot?.nuki ?? [],
    kans: (snapshot?.melds[acting] ?? []).filter((m) => m.kind === 'ankan').map((m) => m.tiles),
    seatIndex,
    /** Whose hand is on screen — `seatIndex` unless a second seat was set to manual. */
    acting,
    /** Every seat a person plays: their hands are always face-up, whatever the reveal setting
     *  says, since they are the reader's own. */
    manualSeats,
    drawnSeat: snapshot?.drawn?.seat,
    claim: snapshot?.claim,
    seatReads: snapshot?.seatReads ?? [],
    liveWall: snapshot?.liveWall ?? [],
    deadWall: snapshot?.deadWall ?? [],
    liveWallSnapshot: snapshot?.liveWallSnapshot ?? [],
    liveWallDrawn: snapshot?.liveWallDrawn ?? 0,
    deadWallSnapshot: snapshot?.deadWallSnapshot ?? [],
    dealtTiles: snapshot?.dealtTiles ?? [],
    replacements: snapshot?.replacements ?? 0,
    finished,
    tenpai,
    lastResult,
    cumulativeLost,
    cumulativeTotal,
    elapsedNow: stats.elapsedNow,
    /** Whether the clock is ticking: the hand is still in play and unpaused. */
    running: !finished && !stats.paused && timerEnabled,
    paused: stats.paused,
    averageTime: stats.averageTime,
    /** Mean time per graded choice in *this* round alone, ms — what the round-complete panel
     *  shows, as opposed to `averageTime`'s running session mean. */
    roundAverageTime:
      roundActionCount.current > 0 ? lastChoiceElapsed.current / roundActionCount.current : 0,
    /** Discards by index into the on-screen `hand`, or `hand.length` for the drawn tile. */
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
    situationQuery: () => encodeSituation(table.situation(seatIndex)),
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    restart: () => {
      table.restart()
      setRestartCount((n) => n + 1)
    },
  }
}
