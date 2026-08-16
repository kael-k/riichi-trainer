import { useEffect, useRef, useState } from 'react'
import { createMatch } from '../../core/match'
import { NORTH, type RoundOptions } from '../../core/round'
import { shanten } from '../../core/shanten'
import { splitDrawn } from '../../core/table'
import { HONOR, tileCode, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import { useRound, type RoundCommand, type RoundEventContext } from '../table/useRound'
import { encodeSituation, WINDS, type Situation } from '../situation/urlCodec'
import {
  actionStats,
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
export interface SoloOptions {
  deadWall: boolean
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), nukidora. Solo is always one seat regardless. */
  sanma: boolean
}

/** Drives one solitaire efficiency round on `useRound` — the table app's own thin hook
 *  (`useEfficiencyRound`) mirrored with exactly three differences: one seat, no calls, no riichi.
 *  Grading and log-row shaping are imported from `features/efficiency/grade`, never re-implemented
 *  here, so a solitaire mistake and a table mistake score identically. */
export function useEfficiencySoloRound(
  situation: Situation,
  options: SoloOptions,
  timerEnabled: boolean,
) {
  const players = 1
  const seatIndex = 0
  const prevalentWind = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const roundOptions: RoundOptions = {
    sanma: options.sanma,
    aka: options.aka,
    match: createMatch(options.sanma, { prevalentWind }),
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

  function settle(
    result: TurnResult,
    drawn: ParsedTile | undefined,
    tile: ParsedTile,
    before: string,
  ) {
    for (const [key, params, tiles] of efficiencyLogRows(result, drawn, tile)) {
      log(key, params, tiles, undefined, before)
    }
    setCumulativeLost((n) => n + lostVs(result.yours, result.best))
    setCumulativeTotal((n) => n + result.best.ukeireCount)
    setLastResult(result)
    recordChoice(result)
  }

  /** One seat, so every event is this seat's own; grading only ever skips replayed turns. */
  function onEvent({
    event,
    core,
    replaying,
    analysis,
    logLength,
  }: RoundEventContext): RoundCommand {
    // a kita/kan is graded when it happens but logged only once its replacement draw is known
    if (event.kind === 'draw') {
      if (replaying || !pending.current) return
      const { result, tile, situationBefore } = pending.current
      pending.current = undefined
      settle(result, event.tile, tile, situationBefore)
      return
    }
    if (replaying || !analysis) return
    if (event.kind !== 'discard' && event.kind !== 'kita' && event.kind !== 'ankan') return

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
      // graded now, logged once the rinshan/replacement draw is known
      pending.current = { result, tile, situationBefore }
      return
    }
    settle(result, analysis.drawn, tile, situationBefore)

    // the drill is one turn at a time: reaching tenpai ends it, leaving 13 tiles so it reads as
    // finished. Derived here rather than flagged into `useRound` — where a round stops is this
    // trainer's business, not the match layer's
    if (shanten(core.round.players[seatIndex].hand) <= 0) return { stop: true }
  }

  const table = useRound({
    wall: situation.wall,
    players,
    options: roundOptions,
    replay: situation.log,
    onEvent,
  })

  const snapshot = table.snapshot
  const seatMelds = snapshot?.melds[seatIndex] ?? []
  const { tiles: hand, drawn } = splitDrawn(
    snapshot?.hands[seatIndex] ?? [],
    snapshot?.drawn?.seat === seatIndex ? snapshot.drawn.tile : undefined,
  )

  // one seat, so every replayed discard is already this seat's own — see the table hook's own
  // `logReplay` for why the rewind link is the full log truncated to that discard's position
  function logReplay() {
    if (loggedReplay.current === situation) return
    loggedReplay.current = situation
    const base = table.situation(seatIndex)
    table.replayed().forEach((entry, i) => {
      if (entry.kind !== 'discard') return
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
  const finished = hand.length + (drawn ? 1 : 0) + seatMelds.length * 3 < 14
  const tenpai = finished && shanten(handFromSnapshot(hand, drawn, seatMelds.length)) <= 0

  return {
    hand,
    drawn,
    turn: snapshot?.turn ?? 1,
    doraIndicators: snapshot?.doraIndicators ?? [],
    rivers: snapshot?.rivers ?? [],
    riichi: snapshot?.riichi ?? [],
    nuki: snapshot?.nuki[seatIndex] ?? [],
    kans: seatMelds.filter((m) => m.kind === 'ankan').map((m) => m.tiles),
    seatIndex,
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
    /** Discards by index into `hand`, or `hand.length` for the drawn tile — the page's own
     *  click target, translated here rather than in `useRound`, which knows no privileged seat. */
    discard: (index: number) => {
      const fromDrawn = index === hand.length
      const tile = fromDrawn ? drawn : hand[index]
      if (tile) table.discard(tile, fromDrawn)
    },
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
