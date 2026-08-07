import { useEffect, useRef, useState } from 'react'
import type { Meld } from '../../core/agari'
import { assessDiscards, type TileDanger } from '../../core/danger'
import {
  beginTurn,
  concealedTiles,
  createMatch,
  finishTurn,
  threatViews,
  type MatchOptions,
  type MatchState,
} from '../../core/match'
import { waits } from '../../core/policy'
import { mulberry32 } from '../../core/rng'
import { shanten } from '../../core/shanten'
import {
  HONOR,
  NUM_TILE_TYPES,
  tileCode,
  type ParsedTile,
  type RiverTile,
  type TileId,
} from '../../core/tiles'
import { TILES_PER_KIND } from '../../core/wall'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import type { Settings } from '../settings/settingsStore'

/** The folding settings section plus the ruleset the round runs under (which a link can pin, so
 *  it is not a plain setting). */
export type RoundOptions = Settings['folding'] & { sanma: boolean }

export interface FoldingUrl {
  seed: string
  sanma?: boolean
  /** Threats the link was generated with; replayed verbatim, since the seed only reproduces the
   *  same board when the search stops at the same declaration. */
  threats?: number
}

export interface TurnResult {
  turn: number
  yours: TileDanger
  /** Every tile tied for safest (rank 0) — ties are genuinely equivalent choices. */
  safest: TileDanger[]
  correct: boolean
}

export interface ThreatReveal {
  seat: number
  hand: ParsedTile[]
  /** What they were actually waiting on. Shape only: `waits` does not ask about yaku. */
  waits: TileId[]
  /** Your discards that were in that wait. Luck, not judgement — a safest-tier pick that lands
   *  here still graded correct, and the panel says so. */
  hits: TileId[]
}

export interface RoundEnd {
  kind: 'dealIn' | 'won' | 'lost' | 'exhaustive' | 'wall'
  /** Winner's seat, on any of the win endings. */
  seat?: number
  points?: number
  threats: ThreatReveal[]
}

/** A real hand of mahjong plus which seat is yours. `threatViews` (from `match.ts`) reads its
 *  genbutsu straight off `match.discards`, so this hook carries no event log of its own. */
interface RoundCore {
  match: MatchState
  options: MatchOptions
  seatIndex: number
}

interface RoundState {
  hand: ParsedTile[]
  drawn: ParsedTile | undefined
  turn: number
  rivers: RiverTile[][]
  melds: Meld[][]
  nuki: ParsedTile[][]
  doraIndicators: ParsedTile[]
  wallCount: number
  seatIndex: number
  round: TileId
  /** Seats currently threatening — everyone in riichi. Grows if someone else declares. */
  threatSeats: number[]
  lastResult: TurnResult | null
  finished: boolean
  end: RoundEnd | null
  elapsed: number
  /** Searching for a hand: the board is not up and the clock has not started. */
  loading: boolean
}

const TICK_MS = 50

/** Rules the drill is always simulated under. Fixed rather than settings, so a link needs only the
 *  seed to reproduce the board — change one of these and old links change meaning. */
const RULES = { aka: true, deadWall: true, calls: true, riichi: true, wins: true } as const

function matchOptions(seed: string, sanma: boolean): MatchOptions {
  // the round wind decides which winds are yakuhai, which is part of reading a threat, so it
  // varies per hand — seeded off the attempt seed itself, so replaying that seed rebuilds it
  const rng = mulberry32(`${seed}:round`)
  return { ...RULES, sanma, round: HONOR + Math.floor(rng() * 4) }
}

function riichiSeats(match: MatchState): number[] {
  return match.players.flatMap((player, seat) => (player.riichiAt === undefined ? [] : [seat]))
}

/** Plays a seed until `threats` seats have declared riichi, stopping at the end of the turn the
 *  last one lands on. Turn granularity is deliberate: `playMatch`'s `stop` fires per event, after
 *  the whole turn has already run, which would leave `match.discards` missing that turn's own
 *  discard and call while the rest of the state already reflects them. */
function playToRiichi(seed: string, options: MatchOptions, players: number, threats: number) {
  const match = createMatch(seed, players, options)
  // a hand is ~18 turns; the bound is a backstop against a rule bug spinning forever
  for (let guard = 0; guard < 400 && !match.ended; guard++) {
    beginTurn(match, options)
    finishTurn(match, options)
    if (riichiSeats(match).length >= threats) {
      // whoever is due to act next inherits the decision, so it is immediate rather than three
      // discards away; the engine only stops deciding for them from here on
      const seatIndex = match.seat
      // the target is met, so everyone still building a hand folds: an opponent left to chase
      // tenpai keeps declaring and floods the table with fresh genbutsu, which is exactly the
      // pressure this drill means to put on the player's own discards, not the AI's
      for (const [seat, player] of match.players.entries()) {
        if (seat !== seatIndex && player.riichiAt === undefined) player.policy = 'defense'
      }
      return { match, options: { ...options, human: seatIndex }, seatIndex }
    }
  }
  return null
}

/** What this seat can see: every face-up tile plus its own hand. */
function seenBy(core: RoundCore): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  const counts = core.match.players[core.seatIndex].hand.counts
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = Math.min(TILES_PER_KIND, core.match.visible[i] + counts[i])
  }
  return seen
}

function rank(core: RoundCore, sanma: boolean): TileDanger[] {
  return assessDiscards(
    core.match.players[core.seatIndex].hand,
    threatViews(core.match),
    seenBy(core),
    sanma,
  )
}

/** A situation only teaches something when the answer is neither forced nor obvious. */
function worthwhile(core: RoundCore, sanma: boolean): boolean {
  const { match, seatIndex } = core
  const player = match.players[seatIndex]
  if (match.ended) return false
  // the seat due to act can itself be an earlier declarer once two riichi are out
  if (player.riichiAt !== undefined) return false
  if (shanten(player.hand) < 1) return false
  if (match.liveWall.length < 4 * match.players.length) return false
  const ranked = rank(core, sanma)
  // a hand with no safe tile has no lesson in it, and one with nothing dangerous has no question
  return (
    ranked[0]?.tier === 'genbutsu' &&
    ranked.some((entry) => entry.tier === 'nonSuji' || entry.tier === 'halfSuji')
  )
}

function buildRound(seed: string, sanma: boolean, threats: number): RoundCore | null {
  const players = sanma ? 3 : 4
  const core = playToRiichi(seed, matchOptions(seed, sanma), players, threats)
  if (!core || !worthwhile(core, sanma)) return null
  beginTurn(core.match, core.options)
  return core
}

/**
 * Searches `seed`, `seed#1`, `seed#2`… for a hand worth drilling, yielding between attempts so
 * the page can paint a dealing state. Falls back to fewer threats rather than failing: three
 * simultaneous riichi in a four-player hand is rare enough that no sane attempt budget finds one
 * every time, and the board says how many are out without needing to be told.
 */
async function findRound(
  seed: string,
  sanma: boolean,
  threats: number,
): Promise<{ core: RoundCore; seed: string; threats: number } | null> {
  for (let i = 0; i < 40 * threats; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const core = buildRound(attemptSeed, sanma, threats)
    if (core) return { core, seed: attemptSeed, threats }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return threats > 1 ? findRound(seed, sanma, threats - 1) : null
}

/** Your discard, then every other seat back round to you, then your next draw. */
function advanceAfterDiscard(core: RoundCore, tile: ParsedTile): void {
  const { match, options, seatIndex } = core
  finishTurn(match, options, tile)
  // one full go-round is the bound; a call hands the turn sideways but never backwards
  for (let guard = 0; guard < 8 && match.seat !== seatIndex && !match.ended; guard++) {
    beginTurn(match, options)
    finishTurn(match, options)
  }
  if (!match.ended && match.liveWall.length > 0) {
    beginTurn(match, options)
  }
}

/** The reveal: what each threat was really holding, and which of your discards were in its wait.
 *  Only ever built once the hand is over — showing it mid-fold would hand over every later turn. */
function revealOf(core: RoundCore, sanma: boolean): ThreatReveal[] {
  const river = core.match.players[core.seatIndex].river
  return riichiSeats(core.match).map((seat) => {
    const player = core.match.players[seat]
    const waitTiles = waits(player.hand, sanma)
    return {
      seat,
      hand: concealedTiles(player),
      waits: waitTiles,
      hits: [...new Set(river.filter((t) => waitTiles.includes(t.id)).map((t) => t.id))],
    }
  })
}

function endOf(core: RoundCore, sanma: boolean): RoundEnd | null {
  const { match, seatIndex } = core
  const threats = revealOf(core, sanma)
  if (match.win) {
    const { seat, from, score } = match.win
    const kind = seat === seatIndex ? 'won' : from === seatIndex ? 'dealIn' : 'lost'
    return { kind, seat, points: score.payments.total, threats }
  }
  if (match.ended === 'exhaustive') return { kind: 'exhaustive', threats }
  if (match.liveWall.length === 0) return { kind: 'wall', threats }
  return null
}

function snapshot(core: RoundCore, sanma: boolean, prev?: RoundState): RoundState {
  const { match, seatIndex } = core
  const player = match.players[seatIndex]
  let hand = concealedTiles(player)
  if (match.drawn) {
    const i = hand.findIndex((t) => t.id === match.drawn!.id && t.red === match.drawn!.red)
    if (i >= 0) hand = [...hand.slice(0, i), ...hand.slice(i + 1)]
  }
  const end = endOf(core, sanma)
  return {
    hand,
    drawn: match.drawn,
    turn: match.turn,
    rivers: match.players.map((p) => [...p.river]),
    melds: match.players.map((p) => [...p.melds]),
    nuki: match.players.map((p) => [...p.nuki]),
    doraIndicators: [...match.doraIndicators],
    wallCount: match.liveWall.length,
    seatIndex,
    round: core.options.round,
    threatSeats: riichiSeats(match),
    lastResult: prev?.lastResult ?? null,
    finished: end !== null,
    end,
    elapsed: 0,
    loading: false,
  }
}

export function decodeFoldingUrl(params: URLSearchParams): FoldingUrl {
  const sanma = params.get('sanma')
  const threats = Number(params.get('threats'))
  return {
    seed: params.get('seed') ?? '',
    sanma: sanma === null ? undefined : sanma !== '0',
    threats: Number.isInteger(threats) && threats > 0 ? threats : undefined,
  }
}

/** A match replays from its seed, rivers and all, so a link carries no tiles — just the seed and
 *  the two things that change what that seed builds. */
export function encodeFoldingUrl(seed: string, sanma: boolean, threats: number): string {
  const params = new URLSearchParams()
  params.set('seed', seed)
  params.set('sanma', sanma ? '1' : '0')
  params.set('threats', String(threats))
  return params.toString()
}

/**
 * Drives one folding round: someone is in riichi, you are not tenpai, and every discard from here
 * to the end of the hand is graded on how safe it was **given what is face up**. Safe tiles run
 * out as the hand goes on, which is the lesson; what the threat actually held is revealed only
 * once the hand is over.
 */
export function useFoldingRound(urlData: FoldingUrl, options: RoundOptions) {
  const [handIndex, setHandIndex] = useState(0)
  const stats = useSessionStats()
  const core = useRef<RoundCore>(undefined)
  const roundSeed = useRef('')
  const roundThreats = useRef(options.threats)
  const [state, setState] = useState<RoundState | null>(null)
  const [failed, setFailed] = useState(false)
  const log = useLog((s) => s.log)
  // a round that resolves after the seed moved on belongs to a hand nobody is looking at
  const request = useRef(0)

  useEffect(() => {
    const id = ++request.current
    setFailed(false)
    setState((prev) => (prev ? { ...prev, loading: true } : prev))
    const base = urlData.seed || stats.randomSeed
    const seed = urlData.seed && handIndex === 0 ? base : `${base}:${handIndex}`
    const threats = urlData.threats ?? options.threats

    // a link's seed is already an accepted attempt, so replay it as-is; only a hand-edited one
    // falls through to a search
    const pinned = urlData.seed && handIndex === 0 ? buildRound(seed, options.sanma, threats) : null
    const found = pinned
      ? Promise.resolve({ core: pinned, seed, threats })
      : findRound(seed, options.sanma, threats)

    void found.then((result) => {
      if (id !== request.current) return
      if (!result) {
        setFailed(true)
        return
      }
      core.current = result.core
      roundSeed.current = result.seed
      roundThreats.current = result.threats
      stats.startClock()
      setState(snapshot(result.core, options.sanma))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlData, handIndex, options.sanma, options.threats])

  useEffect(() => {
    if (!state || state.finished || state.loading || !options.timerEnabled) return
    const id = setInterval(
      () => setState((s) => (s ? { ...s, elapsed: stats.elapsedNow() } : s)),
      TICK_MS,
    )
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.finished, state?.loading, options.timerEnabled])

  function discard(index: number) {
    const r = core.current
    if (!r || !state || state.finished || state.loading) return
    const tile = index === state.hand.length ? state.drawn : state.hand[index]
    if (!tile) return

    const ranked = rank(r, options.sanma)
    const yours = ranked.find((entry) => entry.tile === tile.id)!
    const safest = ranked.filter((entry) => entry.rank === 0)
    const correct = yours.rank === 0
    const result: TurnResult = { turn: r.match.turn, yours, safest, correct }
    const elapsed = stats.elapsedNow()

    // logged here, not from an effect watching round state: effect-based logging inverts entry
    // order and duplicates under StrictMode. Raw params, so a language switch re-translates.
    log(
      'log.folding.discard',
      {
        turn: r.match.turn,
        tile: tileCode(tile.id, tile.red),
        tier: yours.tier,
        best: tileCode(safest[0].tile),
        bestTier: safest[0].tier,
        correct,
      },
      correct ? [tile] : [tile, { id: safest[0].tile, red: false }],
    )
    stats.record(correct, elapsed)

    advanceAfterDiscard(r, tile)
    const next = snapshot(r, options.sanma, state)
    if (next.end?.kind === 'dealIn') {
      log(
        'log.folding.dealIn',
        { seat: next.end.seat, points: next.end.points, tile: tileCode(tile.id, tile.red) },
        [tile],
      )
    }
    stats.startClock()
    setState({ ...next, lastResult: result })
  }

  return {
    ...(state ?? {
      hand: [],
      drawn: undefined,
      turn: 1,
      rivers: [],
      melds: [],
      nuki: [],
      doraIndicators: [],
      wallCount: 0,
      seatIndex: 0,
      round: HONOR,
      threatSeats: [],
      lastResult: null,
      finished: false,
      end: null,
      elapsed: 0,
    }),
    loading: !failed && (state === null || state.loading),
    /** No seed in the budget produced a drillable hand — the page offers another deal. */
    failed,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    /** The hand ranked as it stands. Deliberately not rendered before the answer — markers on the
     *  tiles turn the drill into reading a hint — but it is what `discard` grades against. */
    ranked: (): TileDanger[] => (core.current ? rank(core.current, options.sanma) : []),
    discard,
    next: () => setHandIndex((n) => n + 1),
    situationQuery: () =>
      roundSeed.current
        ? encodeFoldingUrl(roundSeed.current, options.sanma, roundThreats.current)
        : '',
  }
}
