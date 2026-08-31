import { useEffect, useRef, useState } from 'react'
import {
  answerClaim,
  beginTurn,
  callAnkan,
  callKakan,
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
import type { MeldKind } from '../../core/agari'
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
 * has no opinion about what any of it means. Every trainer built on a real match —
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
 *  `replayLog` rather than played live: the board really did reach this state, so a
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
   *  makes it immune to a later algorithm change, and adds no tiles: everything named
   *  is already accounted for by `wall`. */
  replay?: readonly LogEntry[]
  /** "The reader can see everyone's tiles" — `showSeatWaits || showOpponentHands` at every call
   *  site. Threaded straight to `snapshotTable`, which is where the per-seat `waits` cost is paid
   *  and which widens it once more with `round.ended`. */
  showReads?: boolean
  /** Milliseconds to hold the board before a seat nobody plays has its action committed — the
   *  "thinking" beat that stops three opponents' whole go-around appearing in one frame. **0 (the
   *  default) keeps the driver fully synchronous**: no `await` is evaluated and no per-event
   *  snapshot is taken, so the entire AI burst still lands in the one terminal commit it always
   *  did, and every caller that settles a round inside a synchronous `act()` still does. Read
   *  through a ref, so changing it mid-hand takes effect on the next turn. */
  pace?: number
  onEvent?: RoundEventHandler
}

/** The call a seat has just made, for as long as the board should say so. Produced here because
 *  only the driver knows *when* — `Table` is handed this as board truth and never derives which
 *  call a meld represents. */
export interface CallBanner {
  seat: number
  kind: MeldKind | 'riichi' | 'ron' | 'tsumo'
}

/** A tile a seat has just thrown out of its hand — the hole it left, for as long as whoever owns
 *  this keeps it set. Produced here for the same reason `CallBanner` is: only the driver knows
 *  when the tile lands. */
export interface Tedashi {
  seat: number
  tile: ParsedTile
}

/** How long a raised banner stays up. Independent of `pace`: it is how long the word takes to
 *  read, not how long the seat took to decide. */
const BANNER_MS = 1200

/** How long a seat's hand keeps the slot of a tile it just threw open — the flight time of the
 *  discard animation (`--animate-discard-*` in `index.css`; the two are held in step by hand, a
 *  CSS custom property being no easier to read back than this constant is to keep). It is the
 *  whole tedashi read on the felt: the tile is off the river's own end either way, but only a
 *  tedashi leaves a hole behind it in the hand it came from. */
const DISCARD_FLIGHT_MS = 260

/** The beat between a discard landing on the river and the call that takes it back off. Short,
 *  and capped by `pace` so turning the delay down never lengthens anything: the reader is already
 *  looking at that tile, they only need to see it arrive before it moves. */
const CALL_BEAT_MS = 600

const hold = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The word a paced board puts up for one event, or nothing where there is no announcement to
 *  make. A kita is deliberately silent: pulling a north is a bookkeeping move nobody calls out at
 *  a real table, and it happens on almost every sanma turn. A riichi is not here either — it is
 *  raised with the discard it rides on, in `show`. */
function bannerFor(event: RoundEvent): CallBanner | undefined {
  switch (event.kind) {
    case 'call':
      return { seat: event.seat, kind: event.meld.kind }
    case 'ankan':
      return { seat: event.seat, kind: 'ankan' }
    case 'kakan':
      return { seat: event.seat, kind: 'minkan' }
    case 'win':
      return { seat: event.win.seat, kind: event.win.from === undefined ? 'tsumo' : 'ron' }
    default:
      return undefined
  }
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
  // same reasoning, and same effect: an `'ev'` seat's model and objective are live board state,
  // not a redeal
  const evKey = input.options.ev?.map((seat) => `${seat?.model}/${seat?.objective}`).join()

  const handler = useRef<RoundEventHandler | undefined>(input.onEvent)
  handler.current = input.onEvent

  // read through a ref for the same reason `handler` is: a page rebuilds its input object every
  // render, and the driver has to see the value as it stands at the turn it is about to pace, not
  // the one captured when the drive started
  const pace = useRef(input.pace ?? 0)
  pace.current = input.pace ?? 0

  const [callBanner, setCallBanner] = useState<CallBanner | undefined>(undefined)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [tedashi, setTedashi] = useState<Tedashi | undefined>(undefined)
  const tedashiTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // the board with the discard on the river and nobody having reacted to it yet, written by the
  // `beforeReactions` seam and committed as that discard's own frame. `finishTurn` resolves the
  // whole turn before it yields, so this is the only way the tile a pon takes is ever on screen
  const preReaction = useRef<TableSnapshot | undefined>(undefined)
  // a riichi event is yielded immediately before the discard that carries it, so the banner waits
  // for that discard's own frame rather than going up while the seat is still "thinking"
  const declaring = useRef(false)

  useEffect(
    () => () => {
      clearTimeout(bannerTimer.current)
      clearTimeout(tedashiTimer.current)
    },
    [],
  )

  /** Holds the slot a tedashi came out of open for the tile's flight, then closes it. Passing
   *  `undefined` just closes whatever is open — which is what a tsumogiri does: it left no hole,
   *  and a hole still standing from the previous seat's throw is a lie about this one. */
  function vacate(next: Tedashi | undefined): void {
    clearTimeout(tedashiTimer.current)
    setTedashi(next)
    if (next) tedashiTimer.current = setTimeout(() => setTedashi(undefined), DISCARD_FLIGHT_MS)
  }

  /** Puts one call up on the board and takes it down again `BANNER_MS` later. */
  function raise(banner: CallBanner): void {
    clearTimeout(bannerTimer.current)
    setCallBanner(banner)
    bannerTimer.current = setTimeout(() => setCallBanner(undefined), BANNER_MS)
  }

  /** The frame `beforeReactions` hands the pacer, taken only while the board is actually paced —
   *  an unpaced board takes no per-event snapshot at all. */
  function capturePreReaction(c: TableCore): void {
    if (pace.current > 0) preReaction.current = snapshotTable(c, input.showReads)
  }

  /** Holds the board for one event's own beat and commits the frame that event belongs to; false
   *  means the drive it belonged to has been abandoned and the caller must stop.
   *
   *  **Only ever called when `pace > 0`.** The `await`s live in here rather than at the call sites
   *  precisely so an unpaced board evaluates none of them: an `await` on a plain value still
   *  defers to a microtask, which is enough to move a commit outside a synchronous `act()` and
   *  break every trainer hook test. `alive` re-checks the drive generation across each pause, the
   *  same guard the synchronous path already applies after every command — a restart or an unmount
   *  mid-hold must not commit a dead board. */
  async function show(c: TableCore, event: RoundEvent, alive: () => boolean): Promise<boolean> {
    switch (event.kind) {
      case 'riichi':
        // no beat and no frame of its own: the declaration and the tile it rides on are one
        // action, so the banner goes up with the discard below rather than a turn's wait before it
        declaring.current = true
        return true
      case 'discard': {
        // a seat somebody plays discarded because they clicked it — there is nothing to wait for
        if (!isManual(c.round, event.seat)) {
          await hold(pace.current)
          if (!alive()) return false
        }
        setSnapshot(preReaction.current ?? snapshotTable(c, input.showReads))
        preReaction.current = undefined
        // a tile out of the thirteen leaves its slot open until it lands; one straight off the
        // draw leaves nothing behind and closes whatever the last throw opened. `finishTurn`
        // re-derives this flag from the tile `pickTile` really resolved, so it is the river's own
        // truth and not the algorithm's advisory read
        vacate(event.tile.tsumogiri ? undefined : { seat: event.seat, tile: event.tile })
        if (declaring.current) {
          declaring.current = false
          raise({ seat: event.seat, kind: 'riichi' })
        }
        return true
      }
      case 'call':
      case 'ankan':
      case 'kakan':
      case 'kita':
      case 'win': {
        await hold(Math.min(pace.current, CALL_BEAT_MS))
        if (!alive()) return false
        setSnapshot(snapshotTable(c, input.showReads))
        const banner = bannerFor(event)
        if (banner) raise(banner)
        return true
      }
      default:
        setSnapshot(snapshotTable(c, input.showReads))
        return true
    }
  }

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

      const alive = () => generation.current === mine
      let running = true
      for (const event of stepRound(
        current.round,
        current.options,
        (s) => !awaitingManual(s),
        () => capturePreReaction(current),
      )) {
        if (!pump([event])) {
          running = false
          break
        }
        // the whole of what pacing costs an unpaced board: one comparison per event. The `await`
        // is inside `show`, so with `pace` at 0 nothing here ever yields to the event loop and the
        // drive still settles inside its caller's synchronous `act()`
        if (pace.current > 0 && !(await show(current, event, alive))) return
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

    // `replayLog` reconstructs every seat's turn exactly, consulting no algorithm, and
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
      core.current &&
      builtFor.current?.wall === input.wall &&
      builtFor.current?.count === restartCount
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

  // algorithm and claims changes are live: neither may redeal, so both are
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
    input.options.ev?.forEach((ev, seat) => {
      const player = c.round.players[seat]
      if (!ev || !player) return
      if (player.ev.model !== ev.model || player.ev.objective !== ev.objective) {
        player.ev = ev
        // deliberately not `changed`: repricing a seat is not a reason to re-resolve a pending
        // claim or to drive the board on. The next decision that seat makes reads the new value,
        // which is the whole of what "live" means here
      }
    })
    if (!changed) return
    if (c.round.claim && !isManual(c.round, c.round.claim.seat)) {
      reconsiderClaim(c.round, c.options)
    }
    void drive(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithmsKey, evKey, input.options.claims])

  // a reveal setting alone must not rebuild (that would redeal) — re-snapshot the board as it
  // stands, which is what makes toggling one live rather than waiting for the next discard
  useEffect(() => {
    const c = core.current
    if (c) setSnapshot(snapshotTable(c, input.showReads))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.showReads])

  /** The body of `discard` below, kept separate only because it is `async`. */
  async function playDiscard(
    tile: ParsedTile,
    fromDrawn: boolean,
    declareRiichi: boolean,
  ): Promise<void> {
    const c = core.current
    if (!c || c.round.ended || c.round.claim) return
    const seat = actingSeat(c)
    if (!isManual(c.round, seat) || tileCount(c.round.players[seat].hand) !== 14) return
    setRiichiArmed(false)
    const mine = generation.current
    const alive = () => generation.current === mine
    for (const event of finishTurn(c.round, c.options, { tile, fromDrawn }, declareRiichi, () =>
      capturePreReaction(c),
    )) {
      const command = report(c, event, false)
      if (command && 'stop' in command) {
        c.round.players[c.round.seat].drawn = undefined
        setSnapshot(snapshotTable(c, input.showReads))
        return
      }
      if (pace.current > 0 && !(await show(c, event, alive))) return
    }
    void drive(c)
  }

  /** Discards `tile` for the seat currently acting, declaring riichi with it when asked.
   *
   *  Paced only in the sense `drive` is: the reader's own discard is committed the instant they
   *  make it, but the *reactions* to it are somebody else's turn and get the same beat an ordinary
   *  bot turn does. At `pace` 0 no `await` is reached, so the whole thing runs to completion
   *  before this returns.
   *
   *  **Returns `void`, never the promise**, and the same goes for `answer` below: an `async`
   *  function hands back a promise even when its body never awaits, and a thenable returned from
   *  an `act(() => …)` callback switches React's `act` to its asynchronous path — which would
   *  break every caller that settles a turn inside a synchronous `act`, unpaced boards included.
   *  The promise is nobody's to await: a paced turn finishes on its own, and abandoning it is
   *  `generation`'s job, not a cancellation the caller holds. */
  function discard(tile: ParsedTile, fromDrawn: boolean, declareRiichi = riichiArmed): void {
    void playDiscard(tile, fromDrawn, declareRiichi)
  }

  /** The body of `answer` below, kept separate only because it is `async`. */
  async function playAnswer(claimAnswer: ClaimAnswer): Promise<void> {
    const c = core.current
    if (!c || !c.round.claim) return
    const mine = generation.current
    const alive = () => generation.current === mine
    for (const event of answerClaim(c.round, c.options, claimAnswer)) {
      report(c, event, false)
      if (pace.current > 0 && !(await show(c, event, alive))) return
    }
    void drive(c)
  }

  /** Answers the claim the board is waiting on — ron, pon, chi or pass — and plays on. */
  function answer(claimAnswer: ClaimAnswer): void {
    void playAnswer(claimAnswer)
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
    for (const event of callAnkan(c.round, c.options, seat, id)) report(c, event, false)
    capture(c)
    setSnapshot(snapshotTable(c, input.showReads))
  }

  /** Upgrades a held pon into a kan (kakan) — match-only (`RoundOptions.calledKan`); `callKakan`
   *  itself no-ops when the flag is off, same "trust but verify" posture as every other call
   *  here. */
  function kakan(id: TileId): void {
    const c = core.current
    if (!c || c.round.ended || c.round.claim) return
    const seat = actingSeat(c)
    if (!isManual(c.round, seat) || tileCount(c.round.players[seat].hand) !== 14) return
    for (const event of callKakan(c.round, c.options, seat, id)) report(c, event, false)
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
    /** The tile a seat is currently mid-throw with, and whose — the slot a page holds open in
     *  that seat's hand until it reaches the river (`SeatView.tedashi`). Never set for a
     *  tsumogiri, which left no hole, and only ever while the board is paced. */
    tedashi,
    /** The call to draw on the board right now, or nothing. Board truth, produced by the pacer
     *  and passed straight to `Table` — a page never derives it. Only ever set while
     *  the board is paced: with `pace` at 0 there is no frame to put it in. */
    callBanner,
    /** The analysis for the turn currently in progress, if a seat is holding 14 tiles. */
    analysis: pending.current?.analysis,
    discard,
    answer,
    riichiTiles,
    riichiArmed,
    armRiichi: setRiichiArmed,
    kita,
    kan,
    kakan,
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
