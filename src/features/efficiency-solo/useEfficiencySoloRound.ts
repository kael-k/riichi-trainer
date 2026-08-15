import { useEffect, useRef, useState } from 'react'
import { NORTH, type MatchOptions } from '../../core/match'
import { shanten } from '../../core/shanten'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import { useTableRound, type DiscardStats, type UserDrawContext } from '../table/useTableRound'
import { encodeSituation, WINDS, type Situation } from '../situation/urlCodec'
import {
  efficiencyLogRows,
  gradeAction,
  handFromSnapshot,
  lostVs,
  type TurnResult,
} from '../efficiency/grade'

export { NORTH }
export type { TurnResult } from '../efficiency/grade'

/** Options that change how a round plays out; resolved from settings with per-situation
 *  overrides so shared links reproduce exactly. */
export interface RoundOptions {
  deadWall: boolean
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), nukidora. Solo is always one seat regardless. */
  sanma: boolean
}

/** Drives one solitaire efficiency round on `useTableRound` — the table app's own thin hook
 *  (`useEfficiencyRound`) mirrored with exactly three differences: one seat, no calls, no riichi.
 *  Grading and log-row shaping are imported from `features/efficiency/grade`, never re-implemented
 *  here, so a solitaire mistake and a table mistake score identically. */
export function useEfficiencySoloRound(
  situation: Situation,
  options: RoundOptions,
  timerEnabled: boolean,
) {
  const players = 1
  const seatIndex = 0
  const round = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const matchOptions: MatchOptions = {
    sanma: options.sanma,
    aka: options.aka,
    round,
    deadWall: options.deadWall,
    // nobody else is dealt in, so there is nobody to call or declare from
    calls: false,
    riichi: false,
    wins: false,
    // one seat, and it is always yours: there is no other side to sit at
    algorithms: ['manual'],
  }

  const log = useLog((s) => s.log)
  const stats = useSessionStats()

  const [restartCount, setRestartCount] = useState(0)
  const [cumulativeLost, setCumulativeLost] = useState(0)
  const [cumulativeTotal, setCumulativeTotal] = useState(0)
  const [lastResult, setLastResult] = useState<TurnResult | null>(null)

  const lastChoiceElapsed = useRef(0)
  const pending = useRef<
    { result: TurnResult; tile: ParsedTile; situationBefore: string } | undefined
  >(undefined)
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
      const situationBefore = encodeSituation(table.situation())
      const hand = handFromSnapshot(table.hand, table.drawn, table.melds[table.seatIndex].length)
      const result = gradeAction(discardStats, table.turn, hand, options.sanma)

      if (discardStats.kind !== 'discard') {
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

  // one seat, so every replayed discard is already this seat's own — see the table hook's own
  // `logReplay` for why the rewind link is the full log truncated to that discard's position
  function logReplay() {
    if (loggedReplay.current === situation) return
    loggedReplay.current = situation
    const base = table.situation()
    table.replayed.forEach((entry, i) => {
      if (entry.kind !== 'discard') return
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
    table.hand.length + (table.drawn ? 1 : 0) + table.melds[seatIndex].length * 3 < 14
  const tenpai =
    finished &&
    shanten(handFromSnapshot(table.hand, table.drawn, table.melds[table.seatIndex].length)) <= 0

  return {
    hand: table.hand,
    drawn: table.drawn,
    turn: table.turn,
    doraIndicators: table.doraIndicators,
    rivers: table.rivers,
    riichi: table.riichi,
    nuki: table.nuki[seatIndex],
    kans: table.melds[seatIndex].filter((m) => m.kind === 'ankan').map((m) => m.tiles),
    seatIndex,
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
