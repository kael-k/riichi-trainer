import { useEffect, useRef, useState } from 'react'
import type { Meld } from '../../core/agari'
import {
  evaluateDiscards,
  evaluateKan,
  isBestDiscard,
  type DiscardOption,
} from '../../core/efficiency'
import { removeTile, tileCount } from '../../core/hand'
import {
  beginTurn,
  concealedTiles,
  createMatch,
  drawReplacement,
  finishTurn,
  NORTH,
  type MatchOptions,
  type MatchState,
} from '../../core/match'
import { shanten } from '../../core/shanten'
import {
  HONOR,
  NUM_TILE_TYPES,
  tileCode,
  type ParsedTile,
  type RiverTile,
  type TileId,
} from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import { encodeSituation, WINDS, type Situation } from '../situation/urlCodec'

export { NORTH }

/** Options that change how a round plays out; resolved from settings with
 *  per-situation overrides so shared links reproduce exactly. */
export interface RoundOptions {
  opponents: boolean
  deadWall: boolean
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma: boolean
}

export interface TurnResult {
  turn: number
  yours: DiscardOption
  best: DiscardOption
  /** 'kita' / 'kan' when this grades a nukidora pull or an ankan rather than a discard; it only
   *  changes the DiscardFeedback labels, since both reuse the `DiscardOption` shape. */
  kind: 'discard' | 'kita' | 'kan'
  /** 'error' when the chosen action itself loses shanten/ukeire vs. the true best.
   *  'warning' only applies to a plain discard that ties the best line while passing up a
   *  same-value kan/kita call — no ukeire is lost, so it's a softer nudge than 'error'. */
  grade: 'ok' | 'warning' | 'error'
  /** Set alongside a 'warning' grade: which call was available for free and skipped. */
  missed?: { kind: 'kan' | 'kita'; tile: TileId }
}

/** The round is a real hand of mahjong from `core/match`; this is just which seat is yours. */
interface RoundCore {
  match: MatchState
  options: MatchOptions
  seatIndex: number
}

interface RoundState {
  /** Sorted hand without the separated drawn tile (all 14 when `drawn` is unset). */
  hand: ParsedTile[]
  drawn: ParsedTile | undefined
  turn: number
  doraIndicators: ParsedTile[]
  rivers: RiverTile[][]
  nuki: ParsedTile[]
  kans: ParsedTile[][]
  seatIndex: number
  liveWall: ParsedTile[]
  deadWall: ParsedTile[]
  lastResult: TurnResult | null
  cumulativeLost: number
  /** Sum of best.ukeireCount across every graded choice — the ceiling cumulativeLost is measured against. */
  cumulativeTotal: number
  finished: boolean
  /** Finished because the hand reached tenpai (rather than the wall drying up). */
  tenpai: boolean
  elapsed: number
  paused: boolean
}

function you(core: RoundCore) {
  return core.match.players[core.seatIndex]
}

/** Ranked discards for the hand as it stands, counting the hand itself plus every face-up tile
 *  as seen. `seen` comes back too, for the kan comparison that needs the same visibility. */
function rankDiscards(core: RoundCore, sanma: boolean) {
  const player = you(core)
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = player.hand.counts[i] + core.match.visible[i]
  }
  return { seen, ranked: evaluateDiscards(player.hand, seen, sanma) }
}

/** Ukeire given up by playing `yours` instead of `best`. Counts only compare directly at the
 *  same shanten (options are sorted shanten-first), so a worse shanten forfeits the whole gap. */
function lostVs(yours: DiscardOption, best: DiscardOption): number {
  return yours.shanten > best.shanten ? best.ukeireCount : best.ukeireCount - yours.ukeireCount
}

/** Runs every seat between you and your next turn. With opponents off they are simply skipped:
 *  their hands still exist and still hold tiles, they just never act. */
function runOpponents(core: RoundCore, opponents: boolean): void {
  const { match, options, seatIndex } = core
  if (!opponents) {
    match.seat = seatIndex
    match.pendingDraw = true
    return
  }
  // one full go-round is the bound; a call hands the turn sideways but never backwards
  for (let guard = 0; guard < 8 && match.seat !== seatIndex && !match.ended; guard++) {
    beginTurn(match, options)
    finishTurn(match, options)
  }
}

/** Discards `tile` for you, lets the table play round to you, and draws your next tile. Returns
 *  false when the drill is over instead — either the discard reached tenpai or the wall ran dry. */
function advanceAfterDiscard(core: RoundCore, tile: ParsedTile, opponents: boolean): boolean {
  const { match, options } = core
  finishTurn(match, options, tile)

  // tenpai is the goal, so stop here: the hand stays at 13 tiles, which is what "finished" is
  // derived from, and the opponents and wall are left untouched
  if (shanten(you(core).hand) <= 0) {
    match.drawn = undefined
    return false
  }
  runOpponents(core, opponents)
  if (match.liveWall.length === 0 || match.ended) {
    match.drawn = undefined
    return false
  }
  if (match.seat === 0) match.turn++
  beginTurn(match, options)
  return true
}

function matchOptions(options: RoundOptions, round: TileId, seatIndex: number): MatchOptions {
  return {
    sanma: options.sanma,
    aka: options.aka,
    round,
    deadWall: options.deadWall,
    // opponents may open their hands, but nobody wins: a hand that ended on someone else's tsumo
    // would cut this per-turn drill short on a result you did not cause
    calls: options.opponents,
    riichi: options.opponents,
    wins: false,
    human: seatIndex,
  }
}

/** Builds the round: a real deal, the seats before yours acting first, then a replay of the
 *  situation's river to fast-forward to its decision point. */
function createRound(situation: Situation, options: RoundOptions, seed: string): RoundCore {
  const players = options.sanma ? 3 : 4
  // a shared ?seat=N link built under yonma can name a seat sanma doesn't have (North)
  const seatIndex = Math.min(Math.max(0, WINDS.indexOf(situation.seat)), players - 1)
  const round = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const opts = matchOptions(options, round, seatIndex)
  const match = createMatch(seed, players, opts, {
    seat: seatIndex,
    hand: situation.hand,
    wall: situation.wall,
  })
  const core: RoundCore = { match, options: opts, seatIndex }

  // a situation that pins all fourteen tiles has already had its draw; anything else starts the
  // hand normally, with the seats before yours acting first (East leads)
  if (tileCount(match.players[seatIndex].hand) < 14) {
    runOpponents(core, options.opponents)
    beginTurn(match, opts)
  } else {
    match.seat = seatIndex
    match.pendingDraw = false
  }

  // fast-forward the recorded discards; stops quietly on an impossible one
  for (const t of situation.river) {
    const counts = you(core).hand.counts
    if (counts[t.id] === 0) break
    const red = you(core).reds.has(t.id) && (t.red || counts[t.id] === 1)
    if (!advanceAfterDiscard(core, { id: t.id, red }, options.opponents)) break
  }
  return core
}

function snapshot(core: RoundCore, prev?: RoundState): RoundState {
  const { match, seatIndex } = core
  const player = you(core)
  const finished = tileCount(player.hand) < 14
  let hand = concealedTiles(player)
  if (match.drawn) {
    const i = hand.findIndex((t) => t.id === match.drawn!.id && t.red === match.drawn!.red)
    if (i >= 0) hand = [...hand.slice(0, i), ...hand.slice(i + 1)]
  }
  return {
    hand,
    drawn: match.drawn,
    turn: match.turn,
    doraIndicators: [...match.doraIndicators],
    rivers: match.players.map((p) => [...p.river]),
    nuki: [...player.nuki],
    kans: player.melds.filter((m) => m.kind === 'ankan').map((m) => [...m.tiles]),
    seatIndex,
    liveWall: [...match.liveWall],
    deadWall: [...match.deadWall],
    finished,
    tenpai: finished && shanten(player.hand) <= 0,
    lastResult: prev?.lastResult ?? null,
    cumulativeLost: prev?.cumulativeLost ?? 0,
    cumulativeTotal: prev?.cumulativeTotal ?? 0,
    elapsed: prev?.elapsed ?? 0,
    paused: prev?.paused ?? false,
  }
}

/** Drives one efficiency round: deal, discard, draw, repeat, until the wall runs dry. */
export function useEfficiencyRound(
  situation: Situation,
  options: RoundOptions,
  timerEnabled: boolean,
) {
  const [restartCount, setRestartCount] = useState(0)
  // stable per mount, so an unspecified seed still gets a fresh deal each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const core = useRef<RoundCore>(undefined)
  const effectiveSeed = useRef('')
  // round.elapsed at the last choice, so each choice's time is a delta of the same
  // pause-aware clock rather than a second, unpaused one
  const lastChoiceElapsed = useRef(0)
  const [state, setState] = useState<RoundState>(() => startRound())
  const log = useLog((s) => s.log)
  const stats = useSessionStats()

  function startRound(): RoundState {
    // no suffix on first load, so a URL whose seed came from situationQuery() (already
    // suffixed or not) rebuilds the identical round instead of hashing differently
    const base = situation.seed || randomSeed
    effectiveSeed.current = restartCount === 0 ? base : `${base}:${restartCount}`
    core.current = createRound(situation, options, effectiveSeed.current)
    lastChoiceElapsed.current = 0
    return snapshot(core.current)
  }

  /** Records one choice (discard/kita/kan) toward the session's average decision time. */
  function recordChoice(isBest: boolean) {
    stats.record(isBest, (state.elapsed - lastChoiceElapsed.current) * 1000)
    lastChoiceElapsed.current = state.elapsed
  }

  useEffect(() => {
    setState(startRound())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, options.opponents, options.deadWall, options.aka, options.sanma, restartCount])

  useEffect(() => {
    if (state.finished || state.paused || !timerEnabled) return
    const id = setInterval(() => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })), 1000)
    return () => clearInterval(id)
  }, [state.finished, state.paused, timerEnabled])

  function discard(index: number) {
    const r = core.current
    if (!r || state.finished) return
    const tile = index === state.hand.length ? state.drawn : state.hand[index]
    if (!tile) return

    const { seen, ranked } = rankDiscards(r, options.sanma)
    const yours = ranked.find((o) => o.discard === tile.id)!
    const best = ranked[0]
    const lost = lostVs(yours, best)
    const isBest = isBestDiscard(yours, best)

    // isBest doesn't mean nothing was left on the table: a kan/kita tied for best too, and
    // was passed up for a plain discard — no ukeire lost, so it's a warning, not an error.
    let missed: TurnResult['missed']
    if (isBest) {
      const northOption = options.sanma ? ranked.find((o) => o.discard === NORTH) : undefined
      if (northOption && isBestDiscard(northOption, best)) {
        missed = { kind: 'kita', tile: NORTH }
      } else {
        const kanOption = evaluateKan(you(r).hand, seen, options.sanma).find((o) =>
          isBestDiscard(o, best),
        )
        if (kanOption) missed = { kind: 'kan', tile: kanOption.discard }
      }
    }
    const grade: TurnResult['grade'] = !isBest ? 'error' : missed ? 'warning' : 'ok'
    const lastResult: TurnResult = {
      turn: r.match.turn,
      yours,
      best,
      kind: 'discard',
      grade,
      missed,
    }

    // one entry per turn, logged here (not from a page effect) so entries stay in play order.
    // Keys carry raw params (tile notation is locale-invariant) rather than formatted text, so
    // a later language switch re-translates the whole log instead of leaving stale fragments.
    const drewCode = state.drawn ? tileCode(state.drawn.id, state.drawn.red) : undefined
    const drewTiles = state.drawn ? [state.drawn] : []
    if (isBest) {
      log(
        drewCode ? 'log.efficiency.discardBestDrew' : 'log.efficiency.discardBest',
        {
          turn: r.match.turn,
          drawn: drewCode,
          tile: tileCode(tile.id, tile.red),
          ukeire: yours.ukeireCount,
          shanten: yours.shanten,
        },
        [...drewTiles, tile],
      )
    } else {
      log(
        drewCode ? 'log.efficiency.discardMistakeDrew' : 'log.efficiency.discardMistake',
        {
          turn: r.match.turn,
          drawn: drewCode,
          tile: tileCode(tile.id, tile.red),
          yours: yours.ukeireCount,
          best: tileCode(best.discard),
          bestUkeire: best.ukeireCount,
          shanten: yours.shanten,
        },
        [...drewTiles, tile, { id: best.discard, red: false }],
      )
    }
    if (missed) {
      log(
        missed.kind === 'kita' ? 'log.efficiency.missedKita' : 'log.efficiency.missedKan',
        { turn: r.match.turn, tile: tileCode(missed.tile) },
        [{ id: missed.tile, red: false }],
      )
    }
    if (yours.shanten <= 0) {
      log(
        'log.efficiency.tenpai',
        { turn: r.match.turn },
        yours.ukeireTiles.map((t) => ({ id: t.tile, red: false })),
      )
    }

    recordChoice(isBest)
    advanceAfterDiscard(r, tile, options.opponents)
    setState((s) => ({
      ...snapshot(r, s),
      lastResult,
      cumulativeLost: s.cumulativeLost + lost,
      cumulativeTotal: s.cumulativeTotal + best.ukeireCount,
    }))
  }

  /** Pulls a held north (sanma only). Graded like a discard by reusing north's own
   *  evaluateDiscards entry (id `NORTH`) — that entry already IS "shanten/ukeire with this
   *  north removed", which is exactly what pulling it costs. A pair of norths serving as the
   *  hand's head costs shanten/ukeire in that entry the same way a bad discard would, so it's
   *  correctly graded a mistake rather than always recommending the pull. */
  function kita() {
    const r = core.current
    if (!r || state.finished || !options.sanma || you(r).hand.counts[NORTH] === 0) return

    const { ranked } = rankDiscards(r, options.sanma)
    const yours = ranked.find((o) => o.discard === NORTH)!
    const best = ranked[0]
    const lost = lostVs(yours, best)
    const isBest = isBestDiscard(yours, best)
    const lastResult: TurnResult = {
      turn: r.match.turn,
      yours,
      best,
      kind: 'kita',
      grade: isBest ? 'ok' : 'error',
    }

    const player = you(r)
    const northTile: ParsedTile = { id: NORTH, red: false }
    removeTile(player.hand, NORTH)
    player.nuki.push(northTile)
    r.match.visible[NORTH]++
    const drawn = drawReplacement(r.match, player)
    r.match.drawn = drawn
    const tiles = drawn ? [northTile, drawn] : [northTile]

    if (isBest) {
      log(
        'log.efficiency.kitaBest',
        { turn: r.match.turn, ukeire: yours.ukeireCount, shanten: yours.shanten },
        tiles,
      )
    } else {
      log(
        'log.efficiency.kitaMistake',
        {
          turn: r.match.turn,
          yours: yours.ukeireCount,
          best: tileCode(best.discard),
          bestUkeire: best.ukeireCount,
          shanten: yours.shanten,
        },
        tiles,
      )
    }

    recordChoice(isBest)
    setState((s) => ({
      ...snapshot(r, s),
      lastResult,
      cumulativeLost: s.cumulativeLost + lost,
      cumulativeTotal: s.cumulativeTotal + best.ukeireCount,
    }))
  }

  /** Calls a closed kan on a held quad. Graded by comparing `evaluateKan`'s entry for `id`
   *  (the hand shape with that quad locked as a meld) against the same best discard `discard`
   *  uses — shapes that only decompose losslessly by keeping the quad flexible (e.g. `788889s`,
   *  where kanning the 8s stray the 7s/9s into a dead kanchan) come out worse there and are
   *  correctly graded an error rather than a free call. */
  function kan(id: TileId) {
    const r = core.current
    if (!r || state.finished || you(r).hand.counts[id] !== 4) return

    const { seen, ranked } = rankDiscards(r, options.sanma)
    const best = ranked[0]
    const player = you(r)
    const yours = evaluateKan(player.hand, seen, options.sanma).find((o) => o.discard === id)!
    const lost = lostVs(yours, best)
    const isBest = isBestDiscard(yours, best)
    const lastResult: TurnResult = {
      turn: r.match.turn,
      yours,
      best,
      kind: 'kan',
      grade: isBest ? 'ok' : 'error',
    }

    const red = player.reds.has(id)
    const kanTile: ParsedTile = { id, red }
    for (let k = 0; k < 4; k++) removeTile(player.hand, id)
    player.hand.melds++
    player.reds.delete(id)
    r.match.visible[id] += 4
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

    const indicator = r.match.doraStack.shift()
    if (indicator) {
      r.match.doraIndicators.push(indicator)
      r.match.visible[indicator.id]++
    }
    const drawn = drawReplacement(r.match, player)
    r.match.drawn = drawn
    const tiles = drawn ? [kanTile, drawn] : [kanTile]

    if (isBest) {
      log(
        'log.efficiency.kanBest',
        { turn: r.match.turn, tile: tileCode(id), ukeire: yours.ukeireCount, shanten: yours.shanten },
        tiles,
      )
    } else {
      log(
        'log.efficiency.kanMistake',
        {
          turn: r.match.turn,
          tile: tileCode(id),
          yours: yours.ukeireCount,
          best: tileCode(best.discard),
          bestUkeire: best.ukeireCount,
          shanten: yours.shanten,
        },
        tiles,
      )
    }

    recordChoice(isBest)
    setState((s) => ({
      ...snapshot(r, s),
      lastResult,
      cumulativeLost: s.cumulativeLost + lost,
      cumulativeTotal: s.cumulativeTotal + best.ukeireCount,
    }))
  }

  /** Current round as a shareable query string: same seed, original hand/wall, the
   *  user's discards so far as the replay river, and the round options pinned. */
  function situationQuery(): string {
    const r = core.current
    return encodeSituation({
      ...situation,
      seed: effectiveSeed.current,
      river: r ? you(r).river.map((t) => ({ id: t.id, red: t.red })) : [],
      ...options,
    })
  }

  return {
    ...state,
    averageTime: stats.averageTime,
    discard,
    kita,
    kan,
    situationQuery,
    togglePause: () => setState((s) => ({ ...s, paused: !s.paused })),
    restart: () => setRestartCount((n) => n + 1),
  }
}
