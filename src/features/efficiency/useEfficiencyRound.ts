import { useEffect, useRef, useState } from 'react'
import { NORTH, type MatchOptions } from '../../core/match'
import { shanten } from '../../core/shanten'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
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
  const seatIndex = Math.min(Math.max(0, WINDS.indexOf(situation.seat)), players - 1)
  const round = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const matchOptions: MatchOptions = {
    sanma: options.sanma,
    aka: options.aka,
    round,
    deadWall: options.deadWall,
    // opponents may open their hands and call, but nobody wins: a hand that ended on someone
    // else's tsumo would cut this per-turn drill short on a result the player did not cause
    calls: true,
    riichi: true,
    wins: false,
    human: seatIndex,
  }

  const log = useLog((s) => s.log)
  const stats = useSessionStats()

  const [restartCount, setRestartCount] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [cumulativeLost, setCumulativeLost] = useState(0)
  const [cumulativeTotal, setCumulativeTotal] = useState(0)
  const [lastResult, setLastResult] = useState<TurnResult | null>(null)

  // round.elapsed at the last graded choice, so each choice's time is a delta of the same
  // pause-aware clock rather than a second, unpaused one
  const lastChoiceElapsed = useRef(0)
  // a kita/kan's grading happens in onUserDiscard, before its replacement (rinshan) draw is
  // known — stashed here until the onUserDraw that immediately follows resolves it with that
  // draw. A plain discard already knows its "drawn" tile, so it never touches this.
  const pending = useRef<{ result: TurnResult; tile: ParsedTile; situationBefore: string } | undefined>(
    undefined,
  )
  // the situation whose replayed river is already on the log; see `logReplay`
  const loggedReplay = useRef<Situation>(undefined)

  function recordChoice(result: TurnResult) {
    stats.record(result.grade !== 'error', (elapsed - lastChoiceElapsed.current) * 1000)
    lastChoiceElapsed.current = elapsed
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
    replay: situation.river,
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

  /** Writes one log row per discard the round was fast-forwarded through, so a shared link (or a
   *  rewind) arrives with the turns behind it on the record instead of a blank log. Keyed on the
   *  situation's identity: this effect runs twice per mount (initial state, then mount) and four
   *  times under StrictMode, all for the same round. */
  function logReplay() {
    if (loggedReplay.current === situation) return
    loggedReplay.current = situation
    const base = table.situation()
    table.replayed.forEach((tile, i) =>
      log(
        'log.replay',
        { tile: tileCode(tile.id, tile.red) },
        [tile],
        undefined,
        encodeSituation({ ...base, river: table.replayed.slice(0, i) }),
      ),
    )
  }

  useEffect(() => {
    setCumulativeLost(0)
    setCumulativeTotal(0)
    setLastResult(null)
    setElapsed(0)
    setPaused(false)
    lastChoiceElapsed.current = 0
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

  useEffect(() => {
    if (finished || paused || !timerEnabled) return
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [finished, paused, timerEnabled])

  return {
    hand: table.hand,
    drawn: table.drawn,
    turn: table.turn,
    doraIndicators: table.doraIndicators,
    rivers: table.rivers,
    hands: table.hands,
    riichi: table.riichi,
    nuki: table.nuki[table.seatIndex],
    kans: table.melds[table.seatIndex].filter((m) => m.kind === 'ankan').map((m) => m.tiles),
    seatIndex: table.seatIndex,
    liveWall: table.liveWall,
    deadWall: table.deadWall,
    liveWallSnapshot: table.liveWallSnapshot,
    liveWallDrawn: table.liveWallDrawn,
    deadWallSnapshot: table.deadWallSnapshot,
    replacements: table.replacements,
    finished,
    tenpai,
    lastResult,
    cumulativeLost,
    cumulativeTotal,
    elapsed,
    paused,
    averageTime: stats.averageTime,
    discard: table.discard,
    kita: table.kita,
    kan: table.kan,
    situationQuery: () => encodeSituation(table.situation()),
    togglePause: () => setPaused((p) => !p),
    restart: () => {
      table.restart()
      setRestartCount((n) => n + 1)
    },
  }
}
