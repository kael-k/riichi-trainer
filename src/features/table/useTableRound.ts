import { useEffect, useRef, useState } from 'react'
import type { Meld } from '../../core/agari'
import type { TileDanger } from '../../core/danger'
import { evaluateKan, type DiscardOption } from '../../core/efficiency'
import { addTile, removeTile, tileCount } from '../../core/hand'
import {
  answerClaim,
  beginTurn,
  canDeclareRiichi,
  createMatch,
  drawReplacement,
  finishTurn,
  NORTH,
  type ClaimAnswer,
  type MatchOptions,
  type PlayerState,
  type WinRecord,
} from '../../core/match'
import { shanten } from '../../core/shanten'
import {
  actingSeat,
  analysisOf,
  goRound,
  replayDiscards,
  snapshotTable,
  yourDiscards,
  type TableAnalysis,
  type TableCore,
  type TableSnapshot,
} from '../../core/table'
import { HONOR, type ParsedTile, type TileId } from '../../core/tiles'
import { WINDS, type Situation } from '../situation/urlCodec'

/**
 * The React hook layer over `core/table.ts`: `useTableRound`. Every trainer built on a real match
 * (the table efficiency app, the statistical lab, and later plans' consumers) drives a round
 * through exactly three callbacks — `onUserDraw`, `onUserDiscard`, `onAgariCall` — rather than
 * each reimplementing the go-round loop, the snapshot mirror and the replay fast-forward
 * `core/table.ts` already centralizes. Scoring and folding are the two exceptions: scoring never
 * re-touches its match after generation (its only entry point is `onAgariCall`, Task 2 of this
 * plan), and folding drives `beginTurn`/`finishTurn` itself through its own thin hook on
 * `core/table.ts`'s primitives (REQ-07, D-08) because its mid-hand policy flip needs
 * turn-granularity control this hook's three-callback contract does not offer.
 */

export interface TableRoundInput {
  wall: ParsedTile[]
  players: number
  seatIndex: number
  options: MatchOptions
  /** Discards already played, replayed silently (D-06) to fast-forward to a mid-round decision
   *  point — a shared link or a log rewind, not extra tiles: each one must already be in hand. */
  replay?: ParsedTile[]
  /** Stops the round the moment your own discard reaches tenpai, leaving the hand at 13 tiles
   *  (the efficiency trainers' drill) rather than playing the wall out. */
  stopAtTenpai?: boolean
  /** The seat panel's "show tenpai/waits" setting — threaded straight to `snapshotTable`, which
   *  is where the per-seat `waits` cost is actually paid, never here. */
  showSeatWaits?: boolean
  onUserDraw?: (ctx: UserDrawContext) => void
  onUserDiscard?: (tile: ParsedTile, stats: DiscardStats) => void
  onAgariCall?: AgariCall
}

export interface UserDrawContext {
  turn: number
  drawn: ParsedTile | undefined
  analysis: TableAnalysis
}

/** `yours`/`best`/`danger` are getters over `analysis` — a consumer that only wants tiers never
 *  triggers the ukeire ranking, and one that only wants ukeire never triggers the danger
 *  assessment (D-05). `analysis` is the *same* object `onUserDraw` handed over: reading these
 *  getters synchronously inside `onUserDiscard`, before returning, is what keeps them measured
 *  against the pre-throw hand — `useTableRound` fires this callback before the discard itself
 *  mutates the board, but a consumer that stashes `DiscardStats` and reads it only after the
 *  board has moved on will read a mutated hand, since `analysis`'s getters close over the live
 *  `Hand` object rather than a frozen copy (see `core/table.ts#analysisOf`). */
export interface DiscardStats {
  /** 'kita' / 'kan' when this grades a nukidora pull or an ankan rather than a plain discard. */
  kind: 'discard' | 'kita' | 'kan'
  analysis: TableAnalysis
  readonly yours: DiscardOption
  readonly best: DiscardOption
  readonly danger: TileDanger | undefined
}

export type AgariCall = (win: WinRecord) => void

/** The seat whose turn this hook is currently handing to the reader — `core.seatIndex` in every
 *  single-manual-seat setup, some other manual seat once there are several (`actingSeat`). */
function you(core: TableCore): PlayerState {
  return core.match.players[actingSeat(core)]
}

/** Builds the `DiscardStats` handed to `onUserDiscard`. `yours`/`best`/`danger` all read off the
 *  stashed draw-time `analysis` — never a fresh `analysisOf` call, which would rank against a hand
 *  that has already lost (or, for kan, already locked) the tile in question. */
function statsFor(
  analysis: TableAnalysis,
  kind: DiscardStats['kind'],
  tile: ParsedTile,
  player: PlayerState,
  sanma: boolean,
): DiscardStats {
  return {
    kind,
    analysis,
    get yours(): DiscardOption {
      if (kind === 'kita') return analysis.ranked.find((o) => o.discard === NORTH)!
      if (kind === 'kan') {
        return evaluateKan(player.hand, analysis.seen, sanma).find((o) => o.discard === tile.id)!
      }
      return analysis.ranked.find((o) => o.discard === tile.id)!
    },
    get best(): DiscardOption {
      return analysis.ranked[0]
    },
    get danger(): TileDanger | undefined {
      return analysis.danger.find((d) => d.tile === tile.id)
    },
  }
}

/** Drives one round of a real `core/match` through the three-callback contract. */
export function useTableRound(input: TableRoundInput) {
  const core = useRef<TableCore | undefined>(undefined)
  // suppresses onUserDraw/onUserDiscard/onAgariCall while a recorded discard list is being fast
  // forwarded (D-06) — the board still advances underneath, only the callbacks stay silent
  const replaying = useRef(false)
  // the analysis handed to the most recent onUserDraw, so onUserDiscard grades the pre-throw hand
  const drawAnalysis = useRef<TableAnalysis | undefined>(undefined)
  // StrictMode double-invokes the mount effect (see Pitfall 4); this dedupes the *initial*
  // onUserDraw/onAgariCall fire to once per distinct (wall identity, restart count) build, the
  // same identity-keyed guard `logReplay` uses for its own log rows
  const builtFor = useRef<{ wall: ParsedTile[]; count: number } | undefined>(undefined)

  // discards actually replayed on the last build (may fall short of `input.replay` when a
  // recorded tile no longer matches the hand) — exposed so a consumer's own `logReplay` can put
  // one log row per replayed discard without reaching back into `core/table.ts` itself
  const replayed = useRef<ParsedTile[]>([])

  // joined, not the arrays themselves: a caller builds these fresh from its settings on every
  // render, so an identity dep would redeal the board each time it rendered
  const humanKey = input.options.humans?.join()
  const policyKey = input.options.policies?.join()

  const [restartCount, setRestartCount] = useState(0)
  // "the next discard declares riichi", armed from the UI's riichi button. Kept here rather than
  // in each page so every trainer's existing `discard(i)` call site keeps working untouched: the
  // declaration rides on the discard the reader was going to make anyway
  const [riichiArmed, setRiichiArmed] = useState(false)
  // a rewind/new-link hands in a brand-new `input.wall` naming its own board; restartCount is
  // per-mount React state a wall swap does not and should not reset on its own, so left alone
  // buildRound() below would treat the new wall as already-restarted-past. Reset while rendering,
  // keyed on wall identity — the caller must hand in an identity-stable `wall` (and `options`),
  // which `useUrlData`'s per-navigation memoisation already provides.
  const [lastWall, setLastWall] = useState(input.wall)
  if (input.wall !== lastWall) {
    setLastWall(input.wall)
    setRestartCount(0)
  }

  /** Stashes `analysisOf(core)` for the seat's current 14-tile hand — always, regardless of
   *  `notify` — and fires `onUserDraw` only when both `notify` and not replaying. The two are
   *  split because StrictMode double-invokes the mount effect below: its second, redundant
   *  `buildRound()` call still moves `core.current` on to a fresh (possibly differently-dealt)
   *  match, and `drawAnalysis.current` has to move with it every time or a discard grades against
   *  the wrong hand's analysis — only the external callback itself may be deduped to one firing
   *  per distinct build. A no-op past the end of the hand or mid-tenpai-stop, where the seat never
   *  reaches 14 tiles again. */
  function fireDraw(c: TableCore, notify = true): void {
    const player = you(c)
    if (c.match.ended || tileCount(player.hand) !== 14) {
      drawAnalysis.current = undefined
      return
    }
    const analysis = analysisOf(c)
    drawAnalysis.current = analysis
    // only ever for the orientation seat: a second manual seat is played, not graded, so its
    // turns must not reach a consumer whose callbacks mean "the drill's own decision"
    if (notify && !replaying.current && actingSeat(c) === c.seatIndex) {
      input.onUserDraw?.({ turn: c.match.turn, drawn: c.match.drawn, analysis })
    }
  }

  /** Fires `onUserDiscard` (unless replaying) from the analysis stashed by the last `fireDraw` —
   *  called before the board itself mutates, which is what keeps a synchronous read of the stats
   *  measured against the still-14-tile hand. */
  function fireDiscard(c: TableCore, tile: ParsedTile, kind: DiscardStats['kind']): void {
    const analysis = drawAnalysis.current
    if (!analysis || replaying.current || actingSeat(c) !== c.seatIndex) return
    input.onUserDiscard?.(tile, statsFor(analysis, kind, tile, you(c), c.options.sanma))
  }

  /** Fires `onAgariCall` once (unless replaying) the instant `match.win` appears, and reports
   *  whether the match has ended either way — the caller stops advancing regardless of whether
   *  the callback itself fired. */
  function maybeFireAgari(c: TableCore): boolean {
    if (c.match.win && !replaying.current) input.onAgariCall?.(c.match.win)
    return c.match.ended !== undefined
  }

  /** Discards `tile` for your seat (or replays one already recorded), grades it, lets the table
   *  play back around to you, and draws your next tile — or stops when the round is over:
   *  `stopAtTenpai` reaching tenpai, the wall running dry, or anyone winning. Shared by `discard()`
   *  and `replayDiscards`'s step, so a live discard and a replayed one advance the board through
   *  the identical path. */
  function advance(
    c: TableCore,
    tile: ParsedTile,
    kind: DiscardStats['kind'] = 'discard',
    declareRiichi = false,
  ): boolean {
    const discarded = actingSeat(c)
    fireDiscard(c, tile, kind)
    finishTurn(c.match, c.options, tile, declareRiichi)
    return settle(c, discarded)
  }

  /** Carries the board from a discard that has just been played to the next thing a person has
   *  to answer: another seat's claim, the next manual seat's draw, or the end of the round.
   *  Shared by `advance` and `answer`, so a claim resolved mid-turn rejoins the identical path. */
  function settle(c: TableCore, discarded: number): boolean {
    if (maybeFireAgari(c)) return false
    // a claim suspends the turn: nothing draws until it is answered
    if (c.match.claim) return true

    // your own tenpai ends the drill; another manual seat reaching tenpai is not the drill's
    // decision point, so it plays on
    if (
      input.stopAtTenpai &&
      discarded === c.seatIndex &&
      shanten(c.match.players[c.seatIndex].hand) <= 0
    ) {
      c.match.drawn = undefined
      return false
    }
    goRound(c)
    if (maybeFireAgari(c)) return false
    if (c.match.claim) return true

    beginTurn(c.match, c.options)
    if (maybeFireAgari(c)) return false

    fireDraw(c)
    return true
  }

  /** Deals (or, past the first build, redeals from an empty wall) and steps to the first live
   *  decision: the seats before yours act (`goRound`), then your own `beginTurn`, then any
   *  `input.replay` fast-forwards silently through `advance`. Never fires a callback itself —
   *  the caller decides whether this build's outcome (a win, or a fresh draw) is worth firing. */
  function buildRound(): TableSnapshot {
    const wall = restartCount === 0 ? input.wall : []
    const match = createMatch(wall, input.players, input.options)
    const c: TableCore = { match, options: input.options, seatIndex: input.seatIndex }
    core.current = c
    goRound(c)
    beginTurn(c.match, c.options) // no-op when goRound already ended the match

    replaying.current = true
    replayed.current = replayDiscards(c, input.replay ?? [], (rc, tile) => advance(rc, tile))
    replaying.current = false

    return snapshotTable(c, input.showSeatWaits)
  }

  const [snapshot, setSnapshot] = useState<TableSnapshot>(() => buildRound())

  useEffect(() => {
    const snap = buildRound()
    setSnapshot(snap)
    const c = core.current!
    const already =
      builtFor.current?.wall === input.wall && builtFor.current?.count === restartCount
    if (!already) builtFor.current = { wall: input.wall, count: restartCount }
    // fireDraw's analysis cache has to track *this* call's build every time, even on the
    // deduped repeat: only the external onAgariCall/onUserDraw callback itself is skipped there
    if (c.match.win) {
      if (!already) input.onAgariCall?.(c.match.win)
    } else {
      fireDraw(c, !already)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input.wall,
    input.replay,
    input.players,
    input.seatIndex,
    input.stopAtTenpai,
    input.options.sanma,
    input.options.aka,
    input.options.round,
    input.options.deadWall,
    input.options.calls,
    input.options.riichi,
    input.options.wins,
    input.options.claims,
    humanKey,
    policyKey,
    restartCount,
  ])

  // `showSeatWaits` alone must not run the rebuild effect above (that would redeal the match) —
  // this re-snapshots the board exactly as it stands instead, which is what makes toggling the
  // setting live rather than waiting for the next discard to pick it up
  useEffect(() => {
    const c = core.current
    if (c) setSnapshot(snapshotTable(c, input.showSeatWaits))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.showSeatWaits])

  /** Discards the tile at `index` into `snapshot.hand` (or the drawn tile, at `hand.length`),
   *  declaring riichi with it when `declareRiichi` is set — the engine never declares one for a
   *  manual seat, since riichi locks every later discard to tsumogiri. An illegal declaration is
   *  simply played as a plain discard (`canDeclareRiichi` gates it engine-side); `riichiTiles()`
   *  is what keeps the UI from offering one. */
  function discard(index: number, declareRiichi = riichiArmed): void {
    const c = core.current
    if (!c || c.match.ended || c.match.claim || tileCount(you(c).hand) !== 14) return
    const tile = index === snapshot.hand.length ? snapshot.drawn : snapshot.hand[index]
    if (!tile) return
    setRiichiArmed(false)
    advance(c, tile, 'discard', declareRiichi)
    setSnapshot(snapshotTable(c, input.showSeatWaits))
  }

  /** Answers the claim the board is waiting on — ron, pon, chi or pass — and plays on. */
  function answer(claimAnswer: ClaimAnswer): void {
    const c = core.current
    if (!c || !c.match.claim) return
    const discarder = c.match.claim.from
    answerClaim(c.match, c.options, claimAnswer)
    settle(c, discarder)
    setSnapshot(snapshotTable(c, input.showSeatWaits))
  }

  /** Tiles the acting seat could discard *and* declare riichi on. Read off the same ranking the
   *  discard grading uses, so the two can never disagree about which discards reach tenpai; the
   *  rest of the legality (menzen, not already declared, enough wall) is `canDeclareRiichi`'s,
   *  probed against the hand as it will stand once one of these has gone. */
  function riichiTiles(): TileId[] {
    const c = core.current
    const analysis = drawAnalysis.current
    if (!c || !analysis || c.match.ended || c.match.claim) return []
    const player = you(c)
    if (tileCount(player.hand) !== 14) return []
    return analysis.ranked
      .filter((option) => {
        if (option.shanten !== 0) return false
        removeTile(player.hand, option.discard)
        const legal = canDeclareRiichi(c.match, c.options, actingSeat(c))
        addTile(player.hand, option.discard)
        return legal
      })
      .map((option) => option.discard)
  }

  /** Pulls a held north (sanma only), graded like a discard via north's own `evaluateDiscards`
   *  entry — the same comparison `discard()` uses. */
  function kita(): void {
    const c = core.current
    if (!c || !c.options.sanma || c.match.ended || c.match.claim) return
    if (tileCount(you(c).hand) !== 14) return
    if (you(c).hand.counts[NORTH] === 0) return
    const northTile: ParsedTile = { id: NORTH, red: false }
    fireDiscard(c, northTile, 'kita')

    const player = you(c)
    removeTile(player.hand, NORTH)
    player.nuki.push(northTile)
    c.match.visible[NORTH]++
    c.match.drawn = drawReplacement(c.match, player)
    fireDraw(c)
    setSnapshot(snapshotTable(c, input.showSeatWaits))
  }

  /** Calls a closed kan on a held quad, graded against `evaluateKan`'s entry for `id` compared to
   *  the same best discard `discard()` uses. */
  function kan(id: TileId): void {
    const c = core.current
    if (!c || c.match.ended || c.match.claim || tileCount(you(c).hand) !== 14) return
    if (you(c).hand.counts[id] !== 4) return
    const player = you(c)
    const red = player.reds.has(id)
    const kanTile: ParsedTile = { id, red }
    fireDiscard(c, kanTile, 'kan')

    for (let k = 0; k < 4; k++) removeTile(player.hand, id)
    player.hand.melds++
    player.reds.delete(id)
    c.match.visible[id] += 4
    const meld: Meld = {
      kind: 'ankan',
      tiles: [
        { id, red },
        { id, red: false },
        { id, red: false },
        { id, red: false },
      ],
    }
    player.melds.push(meld)

    const indicator = c.match.doraStack.shift()
    if (indicator) {
      c.match.doraIndicators.push(indicator)
      c.match.visible[indicator.id]++
    }
    c.match.drawn = drawReplacement(c.match, player)
    fireDraw(c)
    setSnapshot(snapshotTable(c, input.showSeatWaits))
  }

  /** Current round as a shareable `Situation`: the wall actually dealt and the discards your own
   *  seat has played so far, ready for `encodeSituation`. */
  function situation(): Situation {
    const c = core.current
    return {
      wall: c ? [...c.match.wall] : [...input.wall],
      river: c ? yourDiscards(c) : [],
      round: WINDS[input.options.round - HONOR] ?? 'E',
      seat: WINDS[input.seatIndex] ?? 'E',
      deadWall: input.options.deadWall,
      aka: input.options.aka,
      sanma: input.options.sanma,
    }
  }

  return {
    ...snapshot,
    discard,
    answer,
    riichiTiles,
    riichiArmed,
    /** Arms/disarms "the next discard declares riichi"; the discard itself carries it. */
    armRiichi: setRiichiArmed,
    kita,
    kan,
    restart: () => setRestartCount((n) => n + 1),
    replaying: replaying.current,
    replayed: replayed.current,
    situation,
  }
}
