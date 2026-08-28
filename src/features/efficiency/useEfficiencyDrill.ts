import { useEffect, useRef, useState } from 'react'
import { NORTH, type RoundOptions } from '../../core/round'
import { shanten } from '../../core/shanten'
import { splitDrawn } from '../../core/table'
import { tileCode, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import { useRound, type RoundCommand, type RoundEventContext } from '../table/useRound'
import { encodeSituation, type Situation } from '../situation/urlCodec'
import {
  actionStats,
  efficiencyLogRows,
  gradeAction,
  handFromSnapshot,
  lostVs,
  type TurnResult,
} from './grade'

/**
 * The grading/session core shared by both efficiency routes (table and solitaire) — everything
 * that does not depend on how many seats are dealt or who else is at the table. Each app's own
 * hook builds its own `RoundOptions` (calls/riichi/claims/algorithms differ) and adds the
 * board-only fields its page needs on top of what this returns (ADR-0013, ADR-0032).
 */

export interface EfficiencyDrillInput {
  situation: Situation
  players: number
  /** The graded seat, decided by the caller (the link alone for the table app; always 0 for
   *  solo) and never by this hook. */
  seatIndex: number
  options: RoundOptions
  /** "The reader can see everyone's tiles" — solo has no board to reveal, so it never passes
   *  this. */
  showReads?: boolean
  /** `useRound`'s pacing beat, in milliseconds. Solo never passes it: one seat, no opponents,
   *  nothing to wait for. */
  pace?: number
}

/** Drives one efficiency round on top of `useRound`: dealing, replay and the go-round loop all
 *  live there — this hook only grades, logs and carries session state
 *  (`cumulativeLost`/`cumulativeTotal`/`lastResult`/the clock) the match layer has no opinion
 *  about. */
export function useEfficiencyDrill(input: EfficiencyDrillInput) {
  const { situation, players, seatIndex, options, showReads } = input
  const sanma = options.sanma

  const log = useLog((s) => s.log)
  const stats = useSessionStats()

  const [cumulativeLost, setCumulativeLost] = useState(0)
  const [cumulativeTotal, setCumulativeTotal] = useState(0)
  const [lastResult, setLastResult] = useState<TurnResult | null>(null)

  // the session clock's reading at the last graded choice, so each choice's time is a delta of
  // the same pause-aware clock rather than a second, unpaused one
  const lastChoiceElapsed = useRef(0)
  // a kita/kan's grading happens in onEvent's discard/kita/ankan branch, before its replacement
  // (rinshan) draw is known — stashed here until the onEvent draw that immediately follows
  // resolves it with that draw. A plain discard already knows its "drawn" tile, so it never
  // touches this.
  const pending = useRef<
    { result: TurnResult; tile: ParsedTile; situationBefore: string } | undefined
  >(undefined)
  // the round whose deal (and replayed river) is already on the log; see `logReplay`
  const loggedReplay = useRef<{ situation: Situation; restartCount: number }>(undefined)
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
    for (const row of efficiencyLogRows(result, drawn, tile)) {
      log({ ...row, situation: situationBefore })
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
   *  drill's decision, so they are neither scored nor logged. For solo, `seatIndex` is the only
   *  seat there is, so this filter is always true. */
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
    const result = gradeAction(actionStats(analysis, kind, tile.id, sanma), core.round.turn, sanma)

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
    options,
    replay: situation.log,
    showReads,
    pace: input.pace,
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
  const actingMelds = snapshot?.melds[acting] ?? []
  /** Whether the tiles on screen (the *acting* seat's hand) are a full, decidable 14 — what the
   *  page's `canAct` reads instead of `!finished`. Distinct from `finished`, which stays anchored
   *  to `seatIndex` (the graded seat) and is what freezes that seat's own hand between its own
   *  turns; the two differ only when a second seat is manual, which is exactly the freeze
   *  `NOTE-efficiency-multi-manual-freeze.md` found (ADR-0034): `finished` stays true for the
   *  whole window between the graded seat's discard and its next draw, which is almost the entire
   *  time a second manual seat is playing its own turn. */
  const actingPlayable = hand.length + (drawn ? 1 : 0) + actingMelds.length * 3 === 14

  /** Writes one log row per *your own* discard the round was fast-forwarded through, so a shared
   *  link (or a rewind) arrives with the turns behind it on the record instead of a blank log —
   *  `table.replayed` is every seat's replayed decision now (ADR-0021), filtered down to this
   *  seat's own discards for the row itself, but each row's rewind link is the *full* log
   *  truncated to that discard's actual position, not just "your discards so far": a mid-hand
   *  rewind has to reproduce the opponents' own melds and discards exactly as they were, not
   *  re-simulate them. Keyed on the same pair the effect below is: this runs twice per mount
   *  (initial state, then mount) and four times under StrictMode, all for one round, so the guard
   *  has to absorb that — but a restart is a *new* board under a link that never moved, and keying
   *  on the situation alone left every board after the first with no row to rewind or share it
   *  from. Not the `TableCore` itself, tempting as it looks: `useRound` rebuilds in its own
   *  effect, so the one this render captured is still the outgoing board by the time this runs. */
  function logReplay() {
    if (
      loggedReplay.current?.situation === situation &&
      loggedReplay.current?.restartCount === table.restartCount
    ) {
      return
    }
    loggedReplay.current = { situation, restartCount: table.restartCount }
    const base = table.situation(seatIndex, [])
    // the deal itself, as its own row: its rewind link is the board as dealt, and its share
    // button is the one surface left for sending a fresh board — the page's own share pill is
    // gone (T3), so every deal has to leave a row behind it or the board is unshareable
    log({ key: 'log.dealt', situation: encodeSituation(base) })
    table.replayed().forEach((entry, i) => {
      if (entry.kind !== 'discard' || entry.seat !== seatIndex) return
      log({
        key: 'log.replay',
        params: { tile: tileCode(entry.tile.id, entry.tile.red) },
        situation: encodeSituation({ ...base, log: table.replayed().slice(0, i) }),
      })
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
  }, [situation, table.restartCount])

  // a fixed meld (ankan) counts as 3 tiles toward the 14 even though it isn't in `hand`/`drawn`
  const ownHand = splitDrawn(
    snapshot?.hands[seatIndex] ?? [],
    snapshot?.drawn?.seat === seatIndex ? snapshot.drawn.tile : undefined,
  )
  const finished = ownHand.tiles.length + (ownHand.drawn ? 1 : 0) + seatMelds.length * 3 < 14
  const tenpai =
    finished && shanten(handFromSnapshot(ownHand.tiles, ownHand.drawn, seatMelds.length)) <= 0
  /** The drill is *over* — the tenpai stop fired, or the round genuinely ended. Distinct from
   *  `finished`, which is a tile count: it is true for the whole window between the seat's own
   *  discard and its next draw, and a pending claim holds that window open — the end card would
   *  show over a board still waiting on an answer. The two conditions here are exact, not a
   *  latch: the stop fires in the same turn the seat's 13 tiles read tenpai (and no claim can
   *  pend on a seat whose discard just stopped the drill), and `snapshot.ended` is set only once
   *  every claim has been answered. A replayed link lands on the same derivation, so a board
   *  shared at its last turn opens with the card already up. */
  const drillOver = tenpai || snapshot?.ended !== undefined

  return {
    table,
    snapshot,
    seatIndex,
    callBanner: table.callBanner,
    tedashi: table.tedashi,
    /** Whose hand is on screen — `seatIndex` unless a second seat was set to manual. Always
     *  `seatIndex` in solo, since there is no other seat. */
    acting,
    hand,
    drawn,
    actingPlayable,
    kans: actingMelds.filter((m) => m.kind === 'ankan').map((m) => m.tiles),
    turn: snapshot?.turn ?? 1,
    doraIndicators: snapshot?.doraIndicators ?? [],
    rivers: snapshot?.rivers ?? [],
    riichi: snapshot?.riichi ?? [],
    liveWall: snapshot?.liveWall ?? [],
    deadWall: snapshot?.deadWall ?? [],
    liveWallSnapshot: snapshot?.liveWallSnapshot ?? [],
    liveWallDrawn: snapshot?.liveWallDrawn ?? 0,
    deadWallSnapshot: snapshot?.deadWallSnapshot ?? [],
    dealtTiles: snapshot?.dealtTiles ?? [],
    replacements: snapshot?.replacements ?? 0,
    finished,
    tenpai,
    drillOver,
    lastResult,
    cumulativeLost,
    cumulativeTotal,
    elapsedNow: stats.elapsedNow,
    /** Whether the clock is ticking: the hand is still in play and unpaused. */
    running: !finished && !stats.paused,
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
    situationQuery: () => encodeSituation(table.situation(seatIndex)),
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    restart: table.restart,
  }
}
