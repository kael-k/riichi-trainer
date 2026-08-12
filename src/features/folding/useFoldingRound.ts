import { useEffect, useRef, useState } from 'react'
import type { Meld } from '../../core/agari'
import { assessDiscards, dangerScore, type TileDanger } from '../../core/danger'
import {
  beginTurn,
  concealedTiles,
  createMatch,
  finishTurn,
  threatViews,
  wallDrawnCount,
  type MatchOptions,
  type MatchState,
} from '../../core/match'
import { waits } from '../../core/policy'
import { mulberry32 } from '../../core/rng'
import { shanten } from '../../core/shanten'
import {
  HONOR,
  NUM_TILE_TYPES,
  parseTenhou,
  serializeTenhouOrdered,
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
  /** Whether the threats could win at all; pinned, since a board where nobody rons plays on past
   *  a deal-in and diverges from the same seed played for keeps. */
  wins?: boolean
  /** Threats the link was generated with; replayed verbatim, since the seed only reproduces the
   *  same board when the search stops at the same declaration. */
  threats?: number
  /** Your own discards since the board was handed to you, replayed from the declaration to
   *  reach a mid-hand turn. Not extra tiles: the seed already dealt them. */
  discards?: ParsedTile[]
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
  /** How many discards your seat had already made when the drill was handed over — everything
   *  before that was the engine's, so only what follows belongs in a mid-hand link. */
  handedOverAt: number
}

interface RoundState {
  hand: ParsedTile[]
  drawn: ParsedTile | undefined
  turn: number
  rivers: RiverTile[][]
  melds: Meld[][]
  nuki: ParsedTile[][]
  /** Every seat's concealed hand, by seat index — mirrored unconditionally like `rivers`; the
   *  page decides whether to pass any of it to the table (the `showOpponentHands` setting). */
  hands: ParsedTile[][]
  /** Seats currently in riichi, by seat index — for the table's bet stick. */
  riichi: boolean[]
  doraIndicators: ParsedTile[]
  liveWall: ParsedTile[]
  deadWall: ParsedTile[]
  /** Whole live wall as dealt, plus how much of it (front) is already drawn — the wall-reveal
   *  display's data; `liveWall` above stays "what's left", since it also feeds the board's tile
   *  count. See `wallDrawnCount`. */
  liveWallSnapshot: ParsedTile[]
  liveWallDrawn: number
  /** All 14 dead-wall tiles in build order, for the same display; empty when the dead wall is off. */
  deadWallSnapshot: ParsedTile[]
  /** Replacement (rinshan) draws taken so far — greys the tail of both snapshots above. */
  replacements: number
  seatIndex: number
  round: TileId
  /** Seats currently threatening — everyone in riichi. Grows if someone else declares. */
  threatSeats: number[]
  lastResult: TurnResult | null
  /** Every graded turn of this hand, oldest first — what the end-of-hand review reads when
   *  feedback is held back until then. */
  results: TurnResult[]
  finished: boolean
  end: RoundEnd | null
  elapsed: number
  /** Searching for a hand: the board is not up and the clock has not started. */
  loading: boolean
}

const TICK_MS = 50

/** Rules the drill is always simulated under. Fixed rather than settings, so a link carries as
 *  little as possible — change one of these and old links change meaning. */
const RULES = { aka: true, deadWall: true, calls: true, riichi: true } as const

/** What a board is built from: everything that changes what a given seed deals, and so everything
 *  a link has to carry alongside the seed. */
export interface BoardOptions {
  sanma: boolean
  threats: number
  /** Let the threats actually ron and tsumo. Off turns the drill into a rehearsal: the same
   *  ranking, the same grading, but a mistake costs points nobody collects. */
  wins: boolean
}

function matchOptions(seed: string, options: BoardOptions): MatchOptions {
  // the round wind decides which winds are yakuhai, which is part of reading a threat, so it
  // varies per hand — seeded off the attempt seed itself, so replaying that seed rebuilds it
  const rng = mulberry32(`${seed}:round`)
  return {
    ...RULES,
    sanma: options.sanma,
    wins: options.wins,
    round: HONOR + Math.floor(rng() * 4),
  }
}

function riichiSeats(match: MatchState): number[] {
  return match.players.flatMap((player, seat) => (player.riichiAt === undefined ? [] : [seat]))
}

/** Plays a seed until `threats` seats have declared riichi, stopping at the end of a turn (never
 *  mid-turn: `playMatch`'s `stop` fires per event, after the whole turn has already run, which
 *  would leave `match.discards` missing that turn's own discard and call while the rest of the
 *  state already reflects them). The board is then handed over a seeded number of seats later, so
 *  your position relative to the declarer varies: taking the seat due to act the instant the
 *  declaration lands makes you its shimocha every single time, and defending from shimocha is a
 *  narrower skill than defending from anywhere at the table. */
function playToRiichi(seed: string, options: MatchOptions, players: number, threats: number) {
  const match = createMatch([], players, options, seed)
  // a hand is ~18 turns; the bound is a backstop against a rule bug spinning forever
  for (let guard = 0; guard < 400 && !match.ended; guard++) {
    beginTurn(match, options)
    finishTurn(match, options)
    if (riichiSeats(match).length < threats) continue

    // the target is met, so everyone still building a hand folds: an opponent left to chase
    // tenpai keeps declaring and floods the table with fresh genbutsu, which is exactly the
    // pressure this drill means to put on the player's own discards, not the AI's. Applied
    // before the handover turns below, so those turns cannot add a threat the link never
    // promised — the seat that ends up yours is one the engine stops deciding for anyway
    for (const player of match.players) {
      if (player.riichiAt === undefined) player.policy = 'defense'
    }
    // seeded off the attempt seed like the round wind, so replaying the seed seats you the same
    // way and a shared link stays exact
    const rng = mulberry32(`${seed}:seat`)
    for (let extra = Math.floor(rng() * (players - 1)); extra > 0 && !match.ended; extra--) {
      beginTurn(match, options)
      finishTurn(match, options)
    }
    if (match.ended) return null

    const seatIndex = match.seat
    return {
      match,
      options: { ...options, human: seatIndex },
      seatIndex,
      handedOverAt: match.discards.filter((d) => d.seat === seatIndex).length,
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

function buildRound(
  seed: string,
  options: BoardOptions,
  discards: ParsedTile[] = [],
): RoundCore | null {
  const { sanma, threats } = options
  const players = sanma ? 3 : 4
  const core = playToRiichi(seed, matchOptions(seed, options), players, threats)
  if (!core || !worthwhile(core, sanma)) return null
  beginTurn(core.match, core.options)
  // fast-forward the link's own discards; stops quietly on one this board cannot honour
  for (const t of discards) {
    const player = core.match.players[core.seatIndex]
    if (player.hand.counts[t.id] === 0 || core.match.ended) break
    const red = player.reds.has(t.id) && (t.red || player.hand.counts[t.id] === 1)
    advanceAfterDiscard(core, { id: t.id, red })
  }
  return core
}

/** Your own discards since the handover, in order — the mid-hand part of a link. Read off
 *  `match.discards` rather than your river: `finishTurn` pops a claimed discard out of the river,
 *  and a replay that skipped it would arrive at a different board. */
function yourDiscards(core: RoundCore): ParsedTile[] {
  return core.match.discards
    .filter((d) => d.seat === core.seatIndex)
    .slice(core.handedOverAt)
    .map((d) => ({ id: d.tile.id, red: d.tile.red }))
}

/**
 * Searches `seed`, `seed#1`, `seed#2`… for a hand worth drilling, yielding between attempts so
 * the page can paint a dealing state. Falls back to fewer threats rather than failing: three
 * simultaneous riichi in a four-player hand is rare enough that no sane attempt budget finds one
 * every time, and the board says how many are out without needing to be told.
 */
async function findRound(
  seed: string,
  options: BoardOptions,
): Promise<{ core: RoundCore; seed: string; threats: number } | null> {
  const { threats } = options
  for (let i = 0; i < 40 * threats; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const core = buildRound(attemptSeed, options)
    if (core) return { core, seed: attemptSeed, threats }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return threats > 1 ? findRound(seed, { ...options, threats: threats - 1 }) : null
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
    hands: match.players.map((p) => concealedTiles(p)),
    riichi: match.players.map((p) => p.riichiAt !== undefined),
    doraIndicators: [...match.doraIndicators],
    liveWall: [...match.liveWall],
    deadWall: [...match.deadWall],
    liveWallSnapshot: match.liveWallSnapshot,
    liveWallDrawn: wallDrawnCount(match),
    deadWallSnapshot: match.deadWallSnapshot,
    replacements: match.replacements,
    seatIndex,
    round: core.options.round,
    threatSeats: riichiSeats(match),
    lastResult: prev?.lastResult ?? null,
    results: prev?.results ?? [],
    finished: end !== null,
    end,
    elapsed: 0,
    loading: false,
  }
}

export function decodeFoldingUrl(params: URLSearchParams): FoldingUrl {
  const flag = (name: string): boolean | undefined => {
    const value = params.get(name)
    return value === null ? undefined : value !== '0'
  }
  const threats = Number(params.get('threats'))
  const discards = parseTenhou(params.get('discards') ?? '')
  return {
    seed: params.get('seed') ?? '',
    sanma: flag('sanma'),
    wins: flag('wins'),
    threats: Number.isInteger(threats) && threats > 0 ? threats : undefined,
    discards: discards.length > 0 ? discards : undefined,
  }
}

/** A match replays from its seed, rivers and all, so a link carries no tiles of its own — just
 *  the seed, the two things that change what that seed builds, and the discards you have played
 *  since, which are what makes a mid-hand turn shareable (and a log row rewindable). */
export function encodeFoldingUrl(
  seed: string,
  options: BoardOptions,
  discards: ParsedTile[] = [],
): string {
  const params = new URLSearchParams()
  params.set('seed', seed)
  params.set('sanma', options.sanma ? '1' : '0')
  params.set('threats', String(options.threats))
  params.set('wins', options.wins ? '1' : '0')
  if (discards.length > 0) params.set('discards', serializeTenhouOrdered(discards))
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
  // handIndex counts "new situation" presses this mount, but a link (or a rewind out of the log)
  // names one exact board, which only the index-0 build replays verbatim. Reset it whenever the
  // link changes identity — the "adjust state while rendering" pattern the other trainers use
  const [lastUrlData, setLastUrlData] = useState(urlData)
  if (urlData !== lastUrlData) {
    setLastUrlData(urlData)
    setHandIndex(0)
  }
  const stats = useSessionStats()
  const core = useRef<RoundCore>(undefined)
  const roundSeed = useRef('')
  // the board actually built, which is not always the one asked for: the search falls back to
  // fewer threats rather than failing, and a link has to carry what it got
  const roundBoard = useRef<BoardOptions>(undefined)
  const [state, setState] = useState<RoundState | null>(null)
  const [failed, setFailed] = useState(false)
  const log = useLog((s) => s.log)
  // a round that resolves after the seed moved on belongs to a hand nobody is looking at
  const request = useRef(0)
  // the link whose replayed discards are already on the log; see `logReplay`
  const loggedReplay = useRef<FoldingUrl>(undefined)
  // rows waiting for the hand to end, under `feedbackAtEnd`; see `writeLog`
  const held = useRef<[string, Record<string, unknown>, ParsedTile[], string][]>([])

  useEffect(() => {
    const id = ++request.current
    setFailed(false)
    // a hand left behind (rewind, new deal) takes its held rows with it: they belong to a board
    // nobody is looking at any more
    held.current = []
    setState((prev) => (prev ? { ...prev, loading: true } : prev))
    const base = urlData.seed || stats.randomSeed
    const seed = urlData.seed && handIndex === 0 ? base : `${base}:${handIndex}`
    // a link pins the rules its board was built under; without them the same seed deals a
    // different hand for the reader
    const board: BoardOptions = {
      sanma: options.sanma,
      threats: urlData.threats ?? options.threats,
      wins: urlData.wins ?? options.opponentWins,
    }

    // a link's seed is already an accepted attempt, so replay it as-is — discards included; only
    // a hand-edited one falls through to a search
    const pinned =
      urlData.seed && handIndex === 0 ? buildRound(seed, board, urlData.discards) : null
    const found = pinned
      ? Promise.resolve({ core: pinned, seed, threats: board.threats })
      : findRound(seed, board)

    void found.then((result) => {
      if (id !== request.current) return
      if (!result) {
        setFailed(true)
        return
      }
      core.current = result.core
      roundSeed.current = result.seed
      roundBoard.current = { ...board, threats: result.threats }
      logReplay(result.core)
      stats.startClock()
      setState(snapshot(result.core, options.sanma))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlData, handIndex, options.sanma, options.threats, options.opponentWins])

  /** Writes one log row per discard the link was fast-forwarded through, so a shared link (or a
   *  rewind) arrives with the turns behind it on the record instead of a blank log. Keyed on the
   *  link's identity: the effect above runs twice per mount and four times under StrictMode, all
   *  for one and the same board. */
  function logReplay(built: RoundCore) {
    if (loggedReplay.current === urlData) return
    loggedReplay.current = urlData
    const played = yourDiscards(built)
    played.forEach((tile, i) =>
      log(
        'log.replay',
        { tile: tileCode(tile.id, tile.red) },
        [tile],
        undefined,
        encodeFoldingUrl(roundSeed.current, roundBoard.current!, played.slice(0, i)),
      ),
    )
  }

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

    // captured before anything below advances the board, so it reproduces the turn exactly as it
    // stood right before this discard
    const situationBefore = situationQuery()

    const ranked = rank(r, options.sanma)
    const yours = ranked.find((entry) => entry.tile === tile.id)!
    const safest = ranked.filter((entry) => entry.rank === 0)
    const correct = yours.rank === 0
    const result: TurnResult = { turn: r.match.turn, yours, safest, correct }
    const elapsed = stats.elapsedNow()
    // partial credit against the turn's own worst option: right/wrong alone calls a suji throw
    // when a genbutsu was there the same mistake as throwing the live non-suji 5. A hand where
    // everything is genbutsu has nothing to be wrong about, so it scores full marks
    const worst = Math.max(...ranked.map(dangerScore))
    const quality = worst > 0 ? (worst - dangerScore(yours)) / worst : 1

    // logged here, not from an effect watching round state: effect-based logging inverts entry
    // order and duplicates under StrictMode. Raw params, so a language switch re-translates.
    writeLog(
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
      situationBefore,
    )
    stats.record(correct, elapsed, quality)

    advanceAfterDiscard(r, tile)
    const next = snapshot(r, options.sanma, state)
    if (next.end?.kind === 'dealIn') {
      writeLog(
        'log.folding.dealIn',
        { seat: next.end.seat, points: next.end.points, tile: tileCode(tile.id, tile.red) },
        [tile],
        situationBefore,
      )
    }
    // the log names the safest tile of every turn, so under `feedbackAtEnd` it is one more place
    // the answer leaks; the rows wait with the panel and land in play order once the hand is over
    if (next.end) flushLog()
    stats.startClock()
    setState({ ...next, lastResult: result, results: [...state.results, result] })
  }

  /** One log row, held back until the hand ends when the drill is running answers-at-the-end. */
  function writeLog(
    key: string,
    params: Record<string, unknown>,
    tiles: ParsedTile[],
    situation: string,
  ) {
    if (!options.feedbackAtEnd) log(key, params, tiles, undefined, situation)
    else held.current.push([key, params, tiles, situation])
  }

  function flushLog() {
    for (const [key, params, tiles, situation] of held.current) {
      log(key, params, tiles, undefined, situation)
    }
    held.current = []
  }

  return {
    ...(state ?? {
      hand: [],
      drawn: undefined,
      turn: 1,
      rivers: [],
      melds: [],
      nuki: [],
      hands: [],
      riichi: [],
      doraIndicators: [],
      liveWall: [],
      deadWall: [],
      liveWallSnapshot: [],
      liveWallDrawn: 0,
      deadWallSnapshot: [],
      replacements: 0,
      seatIndex: 0,
      round: HONOR,
      threatSeats: [],
      lastResult: null,
      results: [],
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
    /** Mean partial credit across the session's throws, 0-1 — how safe your discards were
     *  relative to the safest and the most dangerous tile each hand actually held. */
    accuracy: stats.averageQuality,
    /** The hand ranked as it stands. Deliberately not rendered before the answer — markers on the
     *  tiles turn the drill into reading a hint — but it is what `discard` grades against. */
    ranked: (): TileDanger[] => (core.current ? rank(core.current, options.sanma) : []),
    discard,
    next: () => setHandIndex((n) => n + 1),
    situationQuery,
  }

  /** The round as it stands right now: the accepted attempt seed, the rules that seed was built
   *  under, and the discards you have played since — enough to replay a mid-hand turn. */
  function situationQuery(): string {
    return roundSeed.current && roundBoard.current
      ? encodeFoldingUrl(
          roundSeed.current,
          roundBoard.current,
          core.current ? yourDiscards(core.current) : [],
        )
      : ''
  }
}
