import { useEffect, useRef, useState } from 'react'
import { NORTH, type MatchOptions } from '../../core/match'
import { shanten } from '../../core/shanten'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { resolveSeatConfig, type SeatConfig } from '../settings/tableSettings'
import { useLog } from '../../store/log'
import { useTableRound, type DiscardStats, type UserDrawContext } from '../table/useTableRound'
import { encodeSituation, WINDS, type Situation } from '../situation/urlCodec'
import { efficiencyLogRows, gradeAction, handFromSnapshot, lostVs, type TurnResult } from './grade'

export { NORTH }
export type { TurnResult } from './grade'

/** Options that change how a round plays out; resolved from settings with per-situation
 *  overrides so shared links reproduce exactly. */
export interface RoundOptions {
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
  /** The seat panel's "show tenpai/waits" setting — threaded to `useTableRound`, which is where
   *  the per-seat cost of computing it is actually paid. */
  showSeatWaits: boolean
}

/** Drives one efficiency round on top of `useTableRound`: dealing, replay, opponents and the
 *  go-round loop all live there now — this hook only grades, logs and carries session state
 *  (`cumulativeLost`/`cumulativeTotal`/`lastResult`/the clock) that `useTableRound` itself has no
 *  opinion about. */
export function useEfficiencyRound(
  situation: Situation,
  options: RoundOptions,
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
  const round = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const matchOptions: MatchOptions = {
    sanma: options.sanma,
    aka: options.aka,
    round,
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

  const table = useTableRound({
    wall: situation.wall,
    players,
    seatIndex,
    options: matchOptions,
    replay: situation.log,
    stopAtTenpai: true,
    showSeatWaits: options.showSeatWaits,
    onUserDraw(ctx: UserDrawContext) {
      if (!pending.current) return
      const { result, tile, situationBefore } = pending.current
      pending.current = undefined
      writeRows(result, ctx.drawn, tile, situationBefore)
      setCumulativeLost((n) => n + lostVs(result.yours, result.best))
      setCumulativeTotal((n) => n + result.best.ukeireCount)
      setLastResult(result)
      recordChoice(result)
    },
    onUserDiscard(tile: ParsedTile, discardStats: DiscardStats) {
      // captured before anything below mutates match/hand state, so it reproduces the situation
      // exactly as it stood right before this action
      const situationBefore = encodeSituation(table.situation())
      const hand = handFromSnapshot(table.hand, table.drawn, table.melds[table.seatIndex].length)
      const result = gradeAction(discardStats, table.turn, hand, options.sanma)

      if (discardStats.kind !== 'discard') {
        // kita/kan: the replacement draw isn't known yet — resolved by the onUserDraw above
        pending.current = { result, tile, situationBefore }
        return
      }
      writeRows(result, table.drawn, tile, situationBefore)
      setCumulativeLost((n) => n + lostVs(result.yours, result.best))
      setCumulativeTotal((n) => n + result.best.ukeireCount)
      setLastResult(result)
      recordChoice(result)
    },
  })

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
    const base = table.situation()
    table.replayed.forEach((entry, i) => {
      if (entry.kind !== 'discard' || entry.seat !== seatIndex) return
      log(
        'log.replay',
        { tile: tileCode(entry.tile.id, entry.tile.red) },
        [entry.tile],
        undefined,
        encodeSituation({ ...base, log: table.replayed.slice(0, i) }),
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
  const finished =
    table.hand.length + (table.drawn ? 1 : 0) + table.melds[table.seatIndex].length * 3 < 14
  const tenpai =
    finished &&
    shanten(handFromSnapshot(table.hand, table.drawn, table.melds[table.seatIndex].length)) <= 0

  return {
    hand: table.hand,
    drawn: table.drawn,
    turn: table.turn,
    doraIndicators: table.doraIndicators,
    rivers: table.rivers,
    hands: table.hands,
    riichi: table.riichi,
    /** Per-seat melds/nuki (calls included), so the table can show every seat's — not just your
     *  own — pon/chi/kan and nukidora. `kans` below stays the narrower, ankan-only view your own
     *  seat's corner already used. */
    melds: table.melds,
    nuki: table.nuki,
    kans: table.melds[table.acting].filter((m) => m.kind === 'ankan').map((m) => m.tiles),
    seatIndex: table.seatIndex,
    /** Whose hand is on screen — `seatIndex` unless a second seat was set to manual. */
    acting: table.acting,
    /** Every seat a person plays: their hands are always face-up, whatever the reveal setting
     *  says, since they are the reader's own. */
    manualSeats,
    drawnSeat: table.drawnSeat,
    claim: table.claim,
    seatReads: table.seatReads,
    liveWall: table.liveWall,
    deadWall: table.deadWall,
    liveWallSnapshot: table.liveWallSnapshot,
    liveWallDrawn: table.liveWallDrawn,
    deadWallSnapshot: table.deadWallSnapshot,
    dealtTiles: table.dealtTiles,
    replacements: table.replacements,
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
    discard: table.discard,
    answer: table.answer,
    riichiTiles: table.riichiTiles,
    riichiArmed: table.riichiArmed,
    armRiichi: table.armRiichi,
    kita: table.kita,
    kan: table.kan,
    situationQuery: () => encodeSituation(table.situation()),
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    restart: () => {
      table.restart()
      setRestartCount((n) => n + 1)
    },
  }
}
