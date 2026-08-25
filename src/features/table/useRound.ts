import { useEffect, useRef, useState } from 'react'
import {
  answerClaim,
  beginTurn,
  callAnkan,
  callKita,
  canDeclareRiichi,
  createRound,
  finishTurn,
  isManual,
  NORTH,
  reconsiderClaim,
  replayLog,
  stepRound,
  type ClaimAnswer,
  type LogEntry,
  type RoundEvent,
  type RoundOptions,
  type RoundState,
} from '../../core/round'
import { addTile, removeTile, tileCount } from '../../core/hand'
import {
  actingSeat,
  analysisOf,
  snapshotTable,
  type TableAnalysis,
  type TableCore,
  type TableSnapshot,
} from '../../core/table'
import { HONOR, type ParsedTile, type TileId } from '../../core/tiles'
import { useLinkedHand } from '../situation/useLinkedHand'
import { WINDS, type Situation } from '../situation/urlCodec'

/**
 * The React layer over `core/table.ts`. It drives a match and **reports what the engine did**; it
 * has no opinion about what any of it means (ADR-0012). Every trainer built on a real match —
 * efficiency (both routes), folding, scoring's replay, the lab — subscribes to one callback,
 * `onEvent`, and decides for itself which seat it grades, when a round is over, and whether a
 * board is worth keeping.
 *
 * That is the whole contract. There is no `onUserDraw`/`onUserDiscard`/`onAgariCall` triple and no
 * `stopAtTenpai` flag, because "your seat" and "the drill ends here" were never this layer's to
 * know — a hook that filtered events down to one designated seat is what made folding unable to
 * use it, since folding grades a seat the panel can move and searches for boards by playing them.
 *
 * A handler steers the round by what it returns (`RoundCommand`): nothing to carry on, `{ stop }`
 * to halt where the board stands, `{ restart }` to throw this deal away and take a new wall. The
 * driver is async and yields to the browser between restarts, so a rejection-sampling search
 * (folding's "find me a hand worth drilling") runs through this hook without freezing the page.
 */

/** What a handler returns to steer the round. `undefined` carries on.
 *
 *  `stop` halts the driver where the board stands — a real action rather than the caller simply
 *  declining to continue, since the turn's own draw has to be cleared for the hand to read as
 *  finished. `restart` abandons this deal and builds a fresh one from `wall` (empty means "deal me
 *  a random one"), which is how a search rejects a board it does not want. */
export type RoundCommand = void | { stop: true } | { restart: ParsedTile[] }

/** An engine event plus the context a handler needs to judge it.
 *
 *  `core` is the live `TableCore`, so a handler can call `analysisOf`/`snapshotTable`/`shanten` on
 *  the board as it stands at exactly this moment. `replaying` marks an event reconstructed by
 *  `replayLog` rather than played live (ADR-0021): the board really did reach this state, so a
 *  handler deriving *state* should treat it like any other event, while one that grades or writes
 *  a log row must skip it. Suppressing replayed events outright was this layer deciding a grading
 *  policy on the consumer's behalf, and it left folding unable to see the riichi its own drill is
 *  built around.
 *
 *  `analysis` is present on `discard` events only, and is the one thing a handler genuinely
 *  cannot rebuild for itself: by the time a discard is reported the tile has left the hand, so
 *  ranking it again would score 13 tiles. It is captured before `finishTurn` runs and is lazy —
 *  a handler that ignores it pays nothing. */
export interface RoundEventContext {
  event: RoundEvent
  core: TableCore
  replaying: boolean
  analysis: TableAnalysis | undefined
  /** How long `core.round.log` was when the acting seat's current turn began — the cut a rewind
   *  link needs. By the time any event is reported the whole turn has been applied, reactions
   *  included (`finishTurn` resolves them before returning), so `round.log` already holds this
   *  turn's own discard and anything it triggered; slicing here is what reproduces the board as it
   *  stood *before* the decision being reported. */
  logLength: number
}

export type RoundEventHandler = (ctx: RoundEventContext) => RoundCommand

export interface UseRoundInput {
  wall: ParsedTile[]
  players: number
  options: RoundOptions
  /** Every seat's decisions so far, replayed via `replayLog` to fast-forward to a mid-round
   *  decision point — a shared link or a log rewind. Consults no algorithm at all, which is what
   *  makes it immune to a later algorithm change (ADR-0021), and adds no tiles: everything named
   *  is already accounted for by `wall`. */
  replay?: readonly LogEntry[]
  /** "The reader can see everyone's tiles" — `showSeatWaits || showOpponentHands` at every call
   *  site. Threaded straight to `snapshotTable`, which is where the per-seat `waits` cost is paid
   *  and which widens it once more with `round.ended`. */
  showReads?: boolean
  onEvent?: RoundEventHandler
}

/** Whether `state` is mid-turn for a seat nobody will decide for automatically. */
function awaitingManual(state: RoundState): boolean {
  return isManual(state, state.seat)
}

export function useRound(input: UseRoundInput) {
  const core = useRef<TableCore | undefined>(undefined)
  // `restartCount === 0` (`fromLink`) is "this build owes the link its wall/replay" — a restart
  // moves past it, same rule as every other trainer's own hand counter (`useLinkedHand`). Not
  // aliased to `restart` here: `drive` below has its own block-scoped `restart` (a mid-drive
  // "redeal to this wall" command payload) that would otherwise shadow it.
  const { handIndex: restartCount, fromLink, next: bumpRestart } = useLinkedHand(input.wall)
  // "the next discard declares riichi", armed from the UI's riichi button — the declaration rides
  // on the discard the reader was going to make anyway rather than needing its own call site
  const [riichiArmed, setRiichiArmed] = useState(false)
  // log entries actually replayed on the last build (may fall short of `input.replay` when the
  // recording no longer matches the hand), so a consumer can put one row per replayed decision on
  // its own log without reaching back into `core/round.ts`
  const replayed = useRef<readonly LogEntry[]>([])
  // the analysis captured at the top of the current turn, handed to that turn's discard event so
  // grading measures the pre-throw hand. Keyed by seat: several seats can be manual at once
  const pending = useRef<{ seat: number; analysis: TableAnalysis; logLength: number } | undefined>(
    undefined,
  )
  // guards the mount effect against StrictMode's double invoke for one and the same build
  const builtFor = useRef<{ wall: ParsedTile[]; count: number } | undefined>(undefined)
  // replayed events waiting to be handed to the handler from the mount effect; see `build`
  const queued = useRef<RoundEvent[]>([])
  // a restart mid-drive must abandon the drive it came from
  const generation = useRef(0)

  // joined, not the array itself: a caller builds this fresh from its settings on every render, so
  // an identity dep would redeal the board each time it rendered
  const algorithmsKey = input.options.algorithms?.join()

  const handler = useRef<RoundEventHandler | undefined>(input.onEvent)
  handler.current = input.onEvent

  /** Reports one event and returns whatever the handler wants done about it.
   *
   *  A draw is the moment a hand is complete and untouched, so the turn's analysis is pinned here
   *  — before the handler sees the draw, and once for every seat rather than only the ones a
   *  person plays. Pinning it any later would rank the hand a discard has already left; pinning it
   *  only for manual seats would leave an AI seat's discard reported with a stale one. */
  function report(c: TableCore, event: RoundEvent, replaying: boolean): RoundCommand {
    if (event.kind === 'draw') {
      pending.current = {
        seat: event.seat,
        analysis: analysisOf(c, event.seat),
        logLength: c.round.log.length,
      }
    }
    return handler.current?.({
      event,
      core: c,
      replaying,
      analysis: analysisFor(c, event),
      logLength: pending.current?.logLength ?? c.round.log.length,
    })
  }

  /** The analysis of the seat's own 14-tile hand, on the draw that completed it and on the three
   *  events that spend it — a discard, a kita pull, a closed kan. `undefined` for every other
   *  kind. Read off the capture taken at the draw, so it describes the hand that made the decision
   *  rather than what is left after it. */
  function analysisFor(c: TableCore, event: RoundEvent): TableAnalysis | undefined {
    if (
      event.kind !== 'draw' &&
      event.kind !== 'discard' &&
      event.kind !== 'kita' &&
      event.kind !== 'ankan'
    ) {
      return undefined
    }
    const held = pending.current
    return held && held.seat === event.seat ? held.analysis : analysisOf(c, event.seat)
  }

  /** Captures the acting seat's analysis while its hand is still 14 tiles, so the discard that
   *  follows is graded against the hand that made it. */
  function capture(c: TableCore): void {
    const seat = actingSeat(c)
    const player = c.round.players[seat]
    pending.current =
      tileCount(player.hand) === 14
        ? { seat, analysis: analysisOf(c, seat), logLength: c.round.log.length }
        : undefined
  }

  /**
   * Runs the match forward until a person has to decide, the hand ends, or a handler says stop.
   * Yields to the browser between restarts so a search can run through here without freezing the
   * page — and only between restarts, since a single hand is fast and an await per turn would
   * make every ordinary discard wait a frame.
   */
  async function drive(c: TableCore, replaying = false): Promise<void> {
    const mine = ++generation.current
    let current = c
    for (;;) {
      let restart: ParsedTile[] | undefined
      let halted = false

      /** Feeds one step's events to the handler; false means the drive is over. */
      const pump = (events: RoundEvent[]): boolean => {
        for (const event of events) {
          const command = report(current, event, replaying)
          if (generation.current !== mine) return false
          if (command && 'stop' in command) {
            current.round.players[current.round.seat].drawn = undefined
            halted = true
            return false
          }
          if (command && 'restart' in command) {
            restart = command.restart
            return false
          }
        }
        return true
      }

      let running = true
      for (const event of stepRound(current.round, current.options, (s) => !awaitingManual(s))) {
        if (!pump([event])) {
          running = false
          break
        }
      }

      // `stepRound` stops *before* a manual seat acts, and a manual seat is one the engine draws
      // for but never decides for — so the draw itself still has to happen, or the reader is asked
      // to discard from thirteen tiles. Guarded on `drawn` because a replayed log can leave
      // any seat already holding its 14th.
      if (
        running &&
        !current.round.ended &&
        !current.round.claim &&
        awaitingManual(current.round) &&
        current.round.players[current.round.seat].drawn === undefined
      ) {
        pump(beginTurn(current.round, current.options))
      }
      if (generation.current !== mine) return
      if (halted) {
        setSnapshot(snapshotTable(current, input.showReads))
        return
      }
      if (!restart) break
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (generation.current !== mine) return
      current = {
        round: createRound(restart, input.players, input.options),
        options: input.options,
      }
      core.current = current
    }
    if (generation.current !== mine) return
    capture(current)
    setSnapshot(snapshotTable(current, input.showReads))
  }

  /**
   * Deals and replays the recorded log. Called from the render that first needs a board and then
   * skipped by the mount effect, rather than run in both — the old hook did exactly that and dealt
   * two independently-filled walls per mount when the wall was unpinned (the double-build defect
   * in `docs/STATUS.md`).
   *
   * Replayed events are queued rather than reported: a build has to be able to happen during
   * render (a page needs rivers and a hand on its very first paint), and calling a consumer's
   * handler from there would log and grade mid-render, twice over under StrictMode. The effect
   * drains the queue instead, once per distinct build.
   */
  function build(): TableCore {
    const wall = fromLink ? input.wall : []
    const c: TableCore = {
      round: createRound(wall, input.players, input.options),
      options: input.options,
    }
    core.current = c
    queued.current = []

    // `replayLog` reconstructs every seat's turn exactly, consulting no algorithm (ADR-0021), and
    // hands back the events those turns really emitted — the same shapes a live turn produces, so
    // a consumer rebuilds from one stream rather than needing a second path for links. A command
    // is not honoured mid-replay: the recording says what happened, and a handler cannot stop or
    // redeal a board that already played out this way.
    const log = fromLink ? (input.replay ?? []) : []
    const consumed = replayLog(c.round, c.options, log, (event) => queued.current.push(event))
    replayed.current = log.slice(0, consumed)
    capture(c)
    return c
  }

  /** The board for the current inputs, building it only if this exact round has not been built. */
  function ensureBuilt(): TableCore {
    const already =
      core.current && builtFor.current?.wall === input.wall && builtFor.current?.count === restartCount
    if (already) return core.current!
    builtFor.current = { wall: input.wall, count: restartCount }
    return build()
  }

  const [snapshot, setSnapshot] = useState<TableSnapshot>(() =>
    snapshotTable(ensureBuilt(), input.showReads),
  )

  useEffect(() => {
    const c = ensureBuilt()
    // the replayed decisions reach the handler here, in play order, exactly once per build
    const pending = queued.current
    queued.current = []
    for (const event of pending) report(c, event, true)
    setSnapshot(snapshotTable(c, input.showReads))
    void drive(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input.wall,
    input.replay,
    input.players,
    input.options.sanma,
    input.options.aka,
    input.options.match.prevalentWind,
    input.options.calls,
    input.options.riichi,
    input.options.wins,
    restartCount,
  ])

  // algorithm and claims changes are live (ADR-0008, ADR-0015): neither may redeal, so both are
  // written straight onto the running match. Two cases can't wait for the board to advance on its
  // own: a seat that stopped being manual with its draw already sitting there (`stepRound`'s own
  // `drawn` guard stops it re-drawing), and a claim pending on a seat that stopped being
  // manual — nobody will call `answerClaim` for it now, so it is re-resolved through the same
  // restartable path (`reconsiderClaim`). Never auto-passed: a pass sets `missedWin`, so a
  // dropdown must not poison the hand with furiten over a decision nobody made.
  useEffect(() => {
    const c = core.current
    if (!c || c.round.ended) return
    let changed = c.options.claims !== input.options.claims
    c.options.claims = input.options.claims
    input.options.algorithms?.forEach((algorithm, seat) => {
      const player = c.round.players[seat]
      if (player && player.algorithm !== algorithm) {
        player.algorithm = algorithm
        changed = true
      }
    })
    if (!changed) return
    if (c.round.claim && !isManual(c.round, c.round.claim.seat)) {
      reconsiderClaim(c.round, c.options)
    }
    void drive(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithmsKey, input.options.claims])

  // a reveal setting alone must not rebuild (that would redeal) — re-snapshot the board as it
  // stands, which is what makes toggling one live rather than waiting for the next discard
  useEffect(() => {
    const c = core.current
    if (c) setSnapshot(snapshotTable(c, input.showReads))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.showReads])

  /** Discards `tile` for the seat currently acting, declaring riichi with it when asked. */
  function discard(tile: ParsedTile, fromDrawn: boolean, declareRiichi = riichiArmed): void {
    const c = core.current
    if (!c || c.round.ended || c.round.claim) return
    const seat = actingSeat(c)
    if (!isManual(c.round, seat) || tileCount(c.round.players[seat].hand) !== 14) return
    setRiichiArmed(false)
    for (const event of finishTurn(c.round, c.options, { tile, fromDrawn }, declareRiichi)) {
      const command = report(c, event, false)
      if (command && 'stop' in command) {
        c.round.players[c.round.seat].drawn = undefined
        setSnapshot(snapshotTable(c, input.showReads))
        return
      }
    }
    void drive(c)
  }

  /** Answers the claim the board is waiting on — ron, pon, chi or pass — and plays on. */
  function answer(claimAnswer: ClaimAnswer): void {
    const c = core.current
    if (!c || !c.round.claim) return
    for (const event of answerClaim(c.round, c.options, claimAnswer)) {
      report(c, event, false)
    }
    void drive(c)
  }

  /** Pulls a held north (sanma only). */
  function kita(): void {
    const c = core.current
    if (!c || !c.options.sanma || c.round.ended || c.round.claim) return
    const seat = actingSeat(c)
    if (!isManual(c.round, seat) || tileCount(c.round.players[seat].hand) !== 14) return
    if (c.round.players[seat].hand.counts[NORTH] === 0) return
    for (const event of callKita(c.round, c.options, seat)) report(c, event, false)
    capture(c)
    setSnapshot(snapshotTable(c, input.showReads))
  }

  /** Calls a closed kan on a held quad. */
  function kan(id: TileId): void {
    const c = core.current
    if (!c || c.round.ended || c.round.claim) return
    const seat = actingSeat(c)
    if (!isManual(c.round, seat) || tileCount(c.round.players[seat].hand) !== 14) return
    if (c.round.players[seat].hand.counts[id] !== 4) return
    for (const event of callAnkan(c.round, seat, id)) report(c, event, false)
    capture(c)
    setSnapshot(snapshotTable(c, input.showReads))
  }

  /** Tiles the acting seat could discard *and* declare riichi on, read off the same captured
   *  ranking a discard is graded against so the two can never disagree about which reach tenpai;
   *  the rest of the legality is `canDeclareRiichi`'s, probed against the hand as it will stand. */
  function riichiTiles(): TileId[] {
    const c = core.current
    const held = pending.current
    if (!c || !held || c.round.ended || c.round.claim) return []
    const seat = held.seat
    const player = c.round.players[seat]
    if (tileCount(player.hand) !== 14) return []
    return held.analysis.ranked
      .filter((option) => {
        if (option.shanten !== 0) return false
        removeTile(player.hand, option.discard)
        const legal = canDeclareRiichi(c.round, c.options, seat)
        addTile(player.hand, option.discard)
        return legal
      })
      .map((option) => option.discard)
  }

  /** The round as a shareable `Situation`: the wall actually dealt and every seat's decision
   *  since. Read off the live core rather than a snapshot — a record, not a render artifact. */
  function situation(seatIndex: number, log?: readonly LogEntry[]): Situation {
    const c = core.current
    return {
      wall: c ? [...c.round.wall] : [...input.wall],
      log: [...(log ?? c?.round.log ?? [])],
      round: WINDS[input.options.match.prevalentWind - HONOR] ?? 'E',
      seat: WINDS[seatIndex] ?? 'E',
      aka: input.options.aka,
      sanma: input.options.sanma,
      kyoku: input.options.match.round,
      honba: input.options.match.honba,
      dealerRepeat: input.options.match.dealerRepeat,
      dealer: input.options.match.dealer,
      riichiSticks: input.options.match.riichiSticks,
      points: input.options.match.points,
    }
  }

  return {
    snapshot,
    core: core.current,
    /** The analysis for the turn currently in progress, if a seat is holding 14 tiles. */
    analysis: pending.current?.analysis,
    discard,
    answer,
    riichiTiles,
    riichiArmed,
    armRiichi: setRiichiArmed,
    kita,
    kan,
    restart: bumpRestart,
    /** Bumped by `restart`, reset whenever `input.wall` changes identity — a consumer's own
     *  restart-dedupe key, so it doesn't need a second copy of this same counter. */
    restartCount,
    /** A function, not a value: the log is replayed in the mount effect, which runs *after* the
     *  render that would have captured it — a consumer reading this from its own effect needs the
     *  live ref, not an empty array snapshotted a moment too early. */
    replayed: () => replayed.current,
    situation,
  }
}
