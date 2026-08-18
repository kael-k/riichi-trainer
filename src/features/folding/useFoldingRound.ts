import { useEffect, useRef, useState } from 'react'
import { decodeLog, encodeLog } from '../../core/actionLog'
import { dangerScore, type TileDanger } from '../../core/danger'
import { createMatch } from '../../core/match'
import {
  beginTurn,
  concealedTiles,
  createRound,
  finishTurn,
  isManual,
  type LogEntry,
  type RoundOptions,
  type RoundState,
} from '../../core/round'
import { waits } from '../../core/policy'
import { mulberry32 } from '../../core/rng'
import { shanten } from '../../core/shanten'
import { analysisOf, splitDrawn, type TableCore } from '../../core/table'
import {
  HONOR,
  parseTenhou,
  serializeTenhouOrdered,
  tileCode,
  type ParsedTile,
  type TileId,
} from '../../core/tiles'
import { completeWall, validateWall, type WallError } from '../../core/wall'
import { useSessionStats } from '../../lib/useSessionStats'
import { useRound, type RoundCommand, type RoundEventContext } from '../table/useRound'
import { useLog } from '../../store/log'
import { resolveSanma } from '../situation/urlCodec'
import type { Settings } from '../settings/settingsStore'
import type { SeatConfig } from '../settings/tableSettings'
import type { VerdictSeverity } from '../table/Verdict'

/** The folding settings section plus the ruleset the round runs under (which a link can pin, so
 *  it is not a plain setting) and the two table settings (`threats`, `opponentWins`) that moved
 *  out of `Settings['folding']` into the shared `table` section (`tableSettings.ts`, ADR-0015) but
 *  are still resolved per-round here, same as before the move. */
export type FoldingOptions = Settings['folding'] & {
  sanma: boolean
  threats: number
  opponentWins: boolean
  /** The board's own debug reveal switch (`useTableSettings`'s `showOpponentHands`): every seat's
   *  hand goes real, riichi declarer included — same as `finished` already does, just earlier.
   *  Not a folding-only concept and not a drill mechanic, which is why it lives beside `threats`/
   *  `opponentWins` here rather than in `Settings['folding']` itself. */
  showOpponentHands: boolean
  /** Same board-wide, non-advanced reveal reasoning as `showOpponentHands`, for tenpai/waits
   *  instead of hands — not carved out for folding's own answer key either, so switching it on is
   *  the reader choosing to spoil their own drill. */
  showSeatWaits: boolean
  /** Per-seat algorithm from the board's seat panel. Every seat can be set to `'manual'`, same as
   *  efficiency/lab — the drill's own generated seat (`RoundCore.seatIndex`) is just the one the
   *  handover always includes, not the only one that may be manual. Page state (ADR-0015), not
   *  settings — see `FoldingPage`. Read at generation time to seed the handover, and live
   *  thereafter (ADR-0008): a change here never rebuilds the round. */
  seats: SeatConfig | null
  /** Ask manual seats about other seats' discards (`TableSettings.claims`) — board-wide and
   *  persisted, unlike `seats` itself (ADR-0015). */
  claims: boolean
}

export interface FoldingUrl {
  /** Explicit wall in draw order, same format as the situation codec's — the board a link shares
   *  (ADR-0005). Empty means "deal something fresh" rather than "replay this exact board". */
  wall: ParsedTile[]
  /** Set when `wall` failed `validateWall` (ADR-0005) — `wall` is then empty and must never reach
   *  `createRound`. */
  wallError?: WallError
  sanma?: boolean
  /** Whether the threats could win at all; pinned, since a board where nobody rons plays on past
   *  a deal-in and diverges from the same wall played for keeps. */
  wins?: boolean
  /** Threats the link was generated with; replayed verbatim, since the same wall only reproduces
   *  the same board when the search stops at the same declaration. */
  threats?: number
  /** Every seat's decision since the board was handed to you, replayed via `replayLog` — which
   *  consults no algorithm at all — to reach a mid-hand turn. Not extra tiles: the wall already
   *  dealt them. */
  log?: LogEntry[]
}

export interface TurnResult {
  turn: number
  yours: TileDanger
  /** Every tile tied for safest (rank 0) — ties are genuinely equivalent choices. */
  safest: TileDanger[]
  correct: boolean
  /** Partial credit against the turn's own worst option, 0-1 — what `useSessionStats.record`
   *  averages into `averageQuality` and what the compact mobile verdict bands into red/yellow
   *  when `correct` is false. */
  quality: number
}

/** The compact mobile verdict's severity, banded off the same partial credit the session score
 *  already averages — red for the bottom half (a real mistake), yellow above it (a tile that
 *  tied a worse tier than the safest but was still a defensible push away from the worst option). */
export function foldingVerdictSeverity(result: TurnResult): VerdictSeverity {
  if (result.correct) return 'ok'
  return result.quality < 0.5 ? 'error' : 'warning'
}

/** The i18n key for each severity's compact verdict text. */
export const FOLDING_VERDICT_TEXT_KEY: Record<VerdictSeverity, string> = {
  ok: 'folding.verdictOk',
  warning: 'folding.verdictWarning',
  error: 'folding.verdictError',
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

/** Everything generation settles about a board, and nothing about how it is then played. The
 *  match itself is rebuilt by `useRound` from exactly these four things — the wall it was dealt
 *  from, the algorithms each seat ended up on, the seat the drill grades, and generation's own log
 *  — which is what lets folding share the one React match layer instead of stepping turns itself
 *  (ADR-0012). `replayLog` consults no algorithm, so replaying that log reproduces the handed-over
 *  board exactly rather than re-deciding it. */
interface RoundBoard {
  wall: ParsedTile[]
  board: BoardOptions
  options: RoundOptions
  seatIndex: number
  /** `match.log.length` at handover — everything before it was generation's doing, so only what
   *  follows belongs in a mid-hand link. */
  handedOverAt: number
  /** Generation's own log, then the link's decisions since: what `useRound` replays. */
  replay: LogEntry[]
}

/** Face-down filler: a back has no identity, and mid-hand the board must not be holding one.
 *  Exported so the lab's own reveal gate (`useLabRound.ts`) reuses this exact filler rather than
 *  redefining it — one definition of "no identity" for both trainers. */
export const BACK_TILE: ParsedTile = { id: 0, red: false }

/** `splitDrawn` for a hand that may be `BACK_TILE` filler rather than real tiles (any seat
 *  `boardHandsOf`/the lab's own reveal gate has not yet revealed): every slot is identical there,
 *  so identity matching against `drawn` either can't find it or, worse, could false-match a real
 *  tile id against filler that happens to share it. Detected by reference — `boardHandsOf` maps
 *  every hidden slot to this exact `BACK_TILE` object, never a copy — rather than a second
 *  `concealed` flag a caller could pass out of step with which array it actually built. The last
 *  slot is split off positionally instead there — which of several identical backs it is doesn't
 *  matter, only that one is. Real hands fall straight through to `splitDrawn`. Exported for the
 *  lab's own bottom-hand split (`useLabRound.ts`'s `boardHands` uses the same filler). */
export function splitConcealedDrawn(
  tiles: ParsedTile[],
  drawn: ParsedTile | undefined,
): { tiles: ParsedTile[]; drawn: ParsedTile | undefined } {
  if (!drawn) return { tiles, drawn: undefined }
  if (tiles[0] !== BACK_TILE) return splitDrawn(tiles, drawn)
  return { tiles: tiles.slice(0, -1), drawn: tiles[tiles.length - 1] }
}

/** Gating only a `concealed` display flag would leave a threat's real tile ids sitting in the
 *  component props (inspectable via devtools) the moment the hand is dealt — that reveal has to
 *  be withheld from the data itself, not just from how it is drawn, since it is the drill's own
 *  answer key. A bystander (any seat that never declared) isn't part of the answer being graded,
 *  so it carries real data like every other trainer's opponents do. `reveal` is `finished ||
 *  showOpponentHands`: the hand ending unlocks it same as always, and so does the board's own
 *  debug reveal switch — that switch is a "show me everything" toggle, not a "show me everything
 *  except the answer key" one, so it does not carve the declarer out. */
function boardHandsOf(match: RoundState, reveal: boolean): ParsedTile[][] {
  const threats = new Set(riichiSeats(match))
  return match.players.map((player, seat) => {
    // `isManual` rather than "the drill's own seat": a seat the reader plays is their own hand
    // wherever it sits, and there can be more than one of them (see `FoldingOptions.seats`)
    if (isManual(match, seat) || reveal || !threats.has(seat)) return concealedTiles(player)
    return concealedTiles(player).map(() => BACK_TILE)
  })
}

/** Rules the drill is always simulated under. Fixed rather than settings, so a link carries as
 *  little as possible — change one of these and old links change meaning. */
const RULES = { aka: true, deadWall: true, calls: true, riichi: true } as const

/** What a board is built from: everything that changes what a given wall deals, and so everything
 *  a link has to carry alongside the wall. */
export interface BoardOptions {
  sanma: boolean
  threats: number
  /** Let the threats actually ron and tsumo. Off turns the drill into a rehearsal: the same
   *  ranking, the same grading, but a mistake costs points nobody collects. */
  wins: boolean
}

/** The wall itself, as a string key for seeding everything else this board needs to be
 *  reproducible from the wall alone (ADR-0005): the round wind, the handover offset. */
function wallKey(wall: ParsedTile[]): string {
  return serializeTenhouOrdered(wall)
}

function roundOptions(wall: ParsedTile[], options: BoardOptions): RoundOptions {
  // the round wind decides which winds are yakuhai, which is part of reading a threat, so it
  // varies per hand — seeded off the wall itself, so replaying the same wall rebuilds it
  const rng = mulberry32(`${wallKey(wall)}:round`)
  return {
    ...RULES,
    sanma: options.sanma,
    wins: options.wins,
    match: createMatch(options.sanma, { prevalentWind: HONOR + Math.floor(rng() * 4) }),
  }
}

function riichiSeats(match: RoundState): number[] {
  return match.players.flatMap((player, seat) => (player.riichiAt === undefined ? [] : [seat]))
}

/** Plays a wall until `threats` seats have declared riichi, stopping at the end of a turn (never
 *  mid-turn: `playRound`'s `stop` fires per event, after the whole turn has already run, which
 *  would leave `match.discards` missing that turn's own discard and call while the rest of the
 *  state already reflects them). The board is then handed over a seeded number of seats later, so
 *  your position relative to the declarer varies: taking the seat due to act the instant the
 *  declaration lands makes you its shimocha every single time, and defending from shimocha is a
 *  narrower skill than defending from anywhere at the table. */
function playToRiichi(
  wall: ParsedTile[],
  options: RoundOptions,
  players: number,
  threats: number,
  seats: SeatConfig | null,
  claims: boolean,
) {
  const match = createRound(wall, players, options)
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
      if (player.riichiAt === undefined) player.algorithm = 'defense'
    }
    // an explicit per-seat choice outranks the drill's own blanket fold: the panel is read off
    // the raw config, not the resolved one, so a seat nobody touched keeps folding
    seats?.modes.forEach((mode, seat) => {
      if (match.players[seat]) match.players[seat].algorithm = mode
    })
    // seeded off the wall like the round wind, so replaying the wall seats you the same way and
    // a shared link stays exact
    const rng = mulberry32(`${wallKey(wall)}:seat`)
    for (let extra = Math.floor(rng() * (players - 1)); extra > 0 && !match.ended; extra--) {
      beginTurn(match, options)
      finishTurn(match, options)
    }
    if (match.ended) return null

    const seatIndex = match.seat
    // the drill's own generated seat always joins the manual seats the panel named, even if the
    // config said otherwise for it — this is the seat `worthwhile`/`handedOverAt`/`endOf` anchor
    // to, so it is never left to an algorithm at generation time
    match.players[seatIndex].algorithm = 'manual'
    return {
      match,
      options: { ...options, claims },
      seatIndex,
      handedOverAt: match.log.length,
    }
  }
  return null
}

/** A situation only teaches something when the answer is neither forced nor obvious. */
function worthwhile(core: TableCore, seatIndex: number): boolean {
  const { round: match } = core
  const player = match.players[seatIndex]
  if (match.ended) return false
  // the seat due to act can itself be an earlier declarer once two riichi are out
  if (player.riichiAt !== undefined) return false
  if (shanten(player.hand) < 1) return false
  if (match.liveWall.length < 4 * match.players.length) return false
  const ranked = analysisOf(core, seatIndex).danger
  // a hand with no safe tile has no lesson in it, and one with nothing dangerous has no question
  return (
    ranked[0]?.tier === 'genbutsu' &&
    ranked.some((entry) => entry.tier === 'nonSuji' || entry.tier === 'halfSuji')
  )
}

function buildRound(
  wall: ParsedTile[],
  options: BoardOptions,
  seats: SeatConfig | null = null,
  claims = false,
): RoundBoard | null {
  const { sanma, threats } = options
  const players = sanma ? 3 : 4
  const generated = playToRiichi(wall, roundOptions(wall, options), players, threats, seats, claims)
  if (!generated) return null
  const { match, options: matchOpts, seatIndex } = generated
  if (!worthwhile({ round: match, options: matchOpts }, seatIndex)) return null
  return {
    wall,
    board: options,
    // the algorithms each seat actually ended up on — the blanket fold `playToRiichi` applied to
    // every non-declarer, with the panel's own choices layered over it — seeded back through
    // `RoundOptions` so the rebuilt match starts exactly where generation left off. The flip
    // itself never needs replaying: `replayLog` puts every seat on manual for the duration, so
    // only the *starting* algorithms of live play matter
    options: { ...matchOpts, algorithms: match.players.map((p) => p.algorithm) },
    seatIndex,
    handedOverAt: match.log.length,
    replay: [...match.log],
  }
}

/**
 * Searches fresh random walls for a hand worth drilling, yielding between attempts so the page
 * can paint a dealing state. Falls back to fewer threats rather than failing: three simultaneous
 * riichi in a four-player hand is rare enough that no sane attempt budget finds one every time,
 * and the board says how many are out without needing to be told.
 */
async function findRound(
  options: BoardOptions,
  seats: SeatConfig | null = null,
  claims = false,
): Promise<RoundBoard | null> {
  const { threats } = options
  for (let i = 0; i < 40 * threats; i++) {
    const wall = completeWall([], options.sanma, RULES.aka)
    const built = buildRound(wall, options, seats, claims)
    // the search stays a plain loop rather than being driven through `useRound`'s `{ restart }`
    // command: rejection here is `worthwhile` failing at the handover point, not a hand ending,
    // and running up to 120 full simulations through React state would cost a render apiece
    if (built) return { ...built, board: { ...options, threats } }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return threats > 1 ? findRound({ ...options, threats: threats - 1 }, seats, claims) : null
}

/** The reveal: what each threat was really holding, and which of your discards were in its wait.
 *  Only ever built once the hand is over — showing it mid-fold would hand over every later turn. */
function revealOf(match: RoundState, seatIndex: number, sanma: boolean): ThreatReveal[] {
  const river = match.players[seatIndex].river
  return riichiSeats(match).map((seat) => {
    const player = match.players[seat]
    const waitTiles = waits(player.hand, sanma)
    return {
      seat,
      hand: concealedTiles(player),
      waits: waitTiles,
      hits: [...new Set(river.filter((t) => waitTiles.includes(t.id)).map((t) => t.id))],
    }
  })
}

function endOf(match: RoundState, seatIndex: number, sanma: boolean): RoundEnd | null {
  const threats = revealOf(match, seatIndex, sanma)
  if (match.win) {
    const { seat, from, score } = match.win
    const kind = seat === seatIndex ? 'won' : from === seatIndex ? 'dealIn' : 'lost'
    return { kind, seat, points: score.payments.total, threats }
  }
  if (match.ended === 'exhaustive') return { kind: 'exhaustive', threats }
  if (match.liveWall.length === 0) return { kind: 'wall', threats }
  return null
}

export function decodeFoldingUrl(params: URLSearchParams): FoldingUrl {
  const flag = (name: string): boolean | undefined => {
    const value = params.get(name)
    return value === null ? undefined : value !== '0'
  }
  const threats = Number(params.get('threats'))
  const log = decodeLog(params.get('log') ?? '')
  const sanmaFlag = flag('sanma')
  const wall = parseTenhou(params.get('wall') ?? '')

  // untrusted input: reject a malformed/over-counted wall by name rather than let it reach
  // createRound — the same ADR-0005 gate `urlCodec.ts#decodeSituation` runs for the other wall-based
  // trainers. A partial wall with no explicit sanma flag validates against yonma; a full wall's
  // own length already settles the ruleset either way.
  const sanma = resolveSanma(wall, sanmaFlag, false)
  const error = validateWall(wall, sanma ? 3 : 4, sanma)

  const result: FoldingUrl = {
    wall: error ? [] : wall,
    sanma: sanmaFlag,
    wins: flag('wins'),
    threats: Number.isInteger(threats) && threats > 0 ? threats : undefined,
    log: log.length > 0 ? log : undefined,
  }
  if (error) result.wallError = error
  return result
}

/** A match replays from its wall and every seat's log entries since handover, so a link carries
 *  no tiles of its own beyond the wall itself — the two things that change what that wall deals,
 *  and what's happened since, which are what make a mid-hand turn shareable (and a log row
 *  rewindable). */
export function encodeFoldingUrl(
  wall: ParsedTile[],
  options: BoardOptions,
  log: LogEntry[] = [],
): string {
  const params = new URLSearchParams()
  params.set('wall', serializeTenhouOrdered(wall))
  params.set('sanma', options.sanma ? '1' : '0')
  params.set('threats', String(options.threats))
  params.set('wins', options.wins ? '1' : '0')
  if (log.length > 0) params.set('log', encodeLog(log))
  return params.toString()
}

/**
 * Drives one folding round: someone is in riichi, you are not tenpai, and every discard from here
 * to the end of the hand is graded on how safe it was **given what is face up**. Safe tiles run
 * out as the hand goes on, which is the lesson; what the threat actually held is revealed only
 * once the hand is over.
 */
/** What `useRound` is handed before the search has produced anything: one manual seat, so its
 *  driver stops immediately instead of playing a whole throwaway hand while the page shows its
 *  dealing state. */
const IDLE: RoundOptions = {
  ...RULES,
  sanma: false,
  wins: false,
  match: createMatch(false),
  algorithms: ['manual'],
}
const NO_WALL: ParsedTile[] = []

export function useFoldingRound(urlData: FoldingUrl, options: FoldingOptions) {
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
  // the board the search settled on. Identity-stable per round, which is what keeps `useRound`
  // from rebuilding underneath it every render
  const [round, setRound] = useState<RoundBoard | null>(null)
  // a search is running: the board on screen (if any) belongs to the hand being replaced, so the
  // page must show its dealing state rather than letting the old one read as the new one
  const [searching, setSearching] = useState(true)
  const [failed, setFailed] = useState(false)
  const [lastResult, setLastResult] = useState<TurnResult | null>(null)
  const [results, setResults] = useState<TurnResult[]>([])
  const log = useLog((s) => s.log)
  // a round that resolves after the seed moved on belongs to a hand nobody is looking at
  const request = useRef(0)
  // the link whose replayed discards are already on the log; see `logReplay`
  const loggedReplay = useRef<FoldingUrl>(undefined)
  // rows waiting for the hand to end, under `feedbackAtEnd`; see `writeLog`
  const held = useRef<[string, Record<string, unknown>, ParsedTile[], string][]>([])
  // graded discards made in *this* hand, for the end-of-hand panel's own average — distinct from
  // `stats.averageTime`, which keeps running across every hand until the log is cleared
  const roundActionCount = useRef(0)
  const roundTotalMs = useRef(0)

  // `options.seats`/`options.claims` are read below only as the *initial* algorithm/claims seed
  // for a freshly generated hand (`playToRiichi`'s own handover logic) — deliberately absent from
  // this effect's deps: a later change to either must never re-search for a new hand (ADR-0008,
  // ADR-0015). `useRound`'s own live-sync effect carries later changes onto the running match.
  useEffect(() => {
    const id = ++request.current
    setFailed(false)
    setSearching(true)
    setLastResult(null)
    setResults([])
    // a hand left behind (rewind, new deal) takes its held rows with it: they belong to a board
    // nobody is looking at any more
    held.current = []
    // a link pins the rules its board was built under; without them the same wall deals a
    // different hand for the reader
    const board: BoardOptions = {
      sanma: options.sanma,
      threats: urlData.threats ?? options.threats,
      wins: urlData.wins ?? options.opponentWins,
    }

    // a link's wall is already an accepted board, so replay it as-is; only a hand-edited one (or a
    // fresh "new situation" request) falls through to a search
    const pinned =
      urlData.wall.length > 0 && handIndex === 0
        ? buildRound(urlData.wall, board, options.seats, options.claims)
        : null
    const found = pinned ? Promise.resolve(pinned) : findRound(board, options.seats, options.claims)

    void found.then((result) => {
      if (id !== request.current) return
      if (!result) {
        setFailed(true)
        setSearching(false)
        return
      }
      // the link's own post-handover decisions are appended to generation's log: `replayLog`'s
      // cursor is an absolute position in the whole log, so the two replay as one
      setRound({ ...result, replay: [...result.replay, ...(urlData.log ?? [])] })
      setSearching(false)
      stats.startClock()
      roundActionCount.current = 0
      roundTotalMs.current = 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlData, handIndex, options.sanma, options.threats, options.opponentWins])

  const seatIndex = round?.seatIndex ?? 0

  /** Grades this drill's own seat and nothing else, on danger rather than efficiency. */
  function onEvent({
    event,
    core,
    replaying,
    analysis,
    logLength,
  }: RoundEventContext): RoundCommand {
    if (replaying || !round) return
    // the log names each turn's safest tile, so under `feedbackAtEnd` it is one more place the
    // answer leaks: the rows wait with the panel and land in play order once the hand is over
    if (event.kind === 'win' || event.kind === 'exhaustive') {
      flushLog()
      return
    }
    if (event.kind !== 'discard' || event.seat !== seatIndex || !analysis) return

    const situationBefore = encodeFoldingUrl(
      round.wall,
      round.board,
      core.round.log.slice(round.handedOverAt, logLength),
    )
    const tile = event.tile
    const ranked = analysis.danger
    const yours = ranked.find((entry) => entry.tile === tile.id)!
    const safest = ranked.filter((entry) => entry.rank === 0)
    const correct = yours.rank === 0
    const elapsed = stats.elapsedNow()
    // partial credit against the turn's own worst option: right/wrong alone calls a suji throw
    // when a genbutsu was there the same mistake as throwing the live non-suji 5. A hand where
    // everything is genbutsu has nothing to be wrong about, so it scores full marks
    const worst = Math.max(...ranked.map(dangerScore))
    const quality = worst > 0 ? (worst - dangerScore(yours)) / worst : 1
    const result: TurnResult = { turn: core.round.turn, yours, safest, correct, quality }

    writeLog(
      'log.folding.discard',
      {
        turn: core.round.turn,
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
    roundActionCount.current++
    roundTotalMs.current += elapsed

    const end = endOf(core.round, seatIndex, options.sanma)
    if (end?.kind === 'dealIn') {
      writeLog(
        'log.folding.dealIn',
        { seat: end.seat, points: end.points, tile: tileCode(tile.id, tile.red) },
        [tile],
        situationBefore,
      )
    }
    stats.startClock()
    setLastResult(result)
    setResults((prev) => [...prev, result])
  }

  // the panel's own per-seat choices, laid over the algorithms generation settled on. Only the
  // seats it actually names are overridden: a generic default would stomp the blanket fold
  // `playToRiichi` applied to every seat nobody touched (ADR-0008's "one algorithm changes"
  // means nobody else's does). `useRound`'s live-sync effect is what carries a later change onto
  // the running match — this never rebuilds the round.
  const liveOptions: RoundOptions | undefined = round
    ? {
        ...round.options,
        algorithms: (round.options.algorithms ?? []).map(
          (algorithm, seat) => options.seats?.modes[seat] ?? algorithm,
        ),
        claims: options.claims,
      }
    : undefined

  const table = useRound({
    wall: round?.wall ?? NO_WALL,
    players: options.sanma ? 3 : 4,
    options: liveOptions ?? IDLE,
    replay: round?.replay,
    showReads: options.showSeatWaits || options.showOpponentHands,
    onEvent,
  })

  const snapshot = round ? table.snapshot : undefined
  const match = round ? table.core?.round : undefined
  const end = match ? endOf(match, seatIndex, options.sanma) : null
  const finished = end !== null
  const loading = !failed && (searching || !round || !snapshot)

  // the reveal gate is recomputed every render off the live match, not baked into a snapshot, so
  // toggling the board's own reveal switch takes effect at once rather than waiting for the next
  // discard — a debug switch that only sometimes shows the board isn't one you can trust
  const boardHands: ParsedTile[][] = match
    ? boardHandsOf(match, finished || options.showOpponentHands)
    : []

  // the bottom-of-page hand belongs to whichever seat is acting, split like any other seat's
  const acting = snapshot?.seat ?? seatIndex
  const { tiles: hand, drawn } = splitConcealedDrawn(
    boardHands[acting] ?? [],
    snapshot?.drawn?.seat === acting ? snapshot.drawn.tile : undefined,
  )

  /** Writes one log row per *your own* discard the link was fast-forwarded through, so a shared
   *  link (or a rewind) arrives with the turns behind it on the record instead of a blank log —
   *  each row's rewind link is the full since-handover log truncated to that discard's actual
   *  position: a mid-hand rewind has to reproduce a threat's own melds and discards exactly as
   *  they were. Keyed on the link's identity, since the build effect runs several times per mount
   *  for one and the same board. */
  function logReplay(built: RoundBoard) {
    if (loggedReplay.current === urlData) return
    loggedReplay.current = urlData
    // the board as handed over, as its own row — see the table hook's own `logReplay` for why
    // every deal needs one now that the page's own share pill is gone (T3)
    log('log.dealt', undefined, undefined, undefined, encodeFoldingUrl(built.wall, built.board, []))
    const sinceHandover = built.replay.slice(built.handedOverAt)
    sinceHandover.forEach((entry, i) => {
      if (entry.kind !== 'discard' || entry.seat !== built.seatIndex) return
      log(
        'log.replay',
        { tile: tileCode(entry.tile.id, entry.tile.red) },
        [entry.tile],
        undefined,
        encodeFoldingUrl(built.wall, built.board, sinceHandover.slice(0, i)),
      )
    })
  }

  useEffect(() => {
    if (round) logReplay(round)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

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
    turn: snapshot?.turn ?? 1,
    doraIndicators: snapshot?.doraIndicators ?? [],
    rivers: snapshot?.rivers ?? [],
    hands: snapshot?.hands ?? [],
    melds: snapshot?.melds ?? [],
    nuki: snapshot?.nuki ?? [],
    riichi: snapshot?.riichi ?? [],
    liveWall: snapshot?.liveWall ?? [],
    deadWall: snapshot?.deadWall ?? [],
    liveWallSnapshot: snapshot?.liveWallSnapshot ?? [],
    liveWallDrawn: snapshot?.liveWallDrawn ?? 0,
    deadWallSnapshot: snapshot?.deadWallSnapshot ?? [],
    replacements: snapshot?.replacements ?? 0,
    dealtTiles: snapshot?.dealtTiles ?? [],
    wall: snapshot?.wall ?? [],
    ended: snapshot?.ended,
    win: snapshot?.win,
    claim: snapshot?.claim,
    seatReads: snapshot?.seatReads ?? [],
    hand,
    drawn,
    seatIndex,
    acting,
    drawnSeat: snapshot?.drawn?.seat,
    round: round?.options.match.prevalentWind ?? HONOR,
    match: snapshot?.match ?? round?.options.match ?? createMatch(options.sanma),
    /** Seats currently threatening — everyone in riichi. Grows if someone else declares. */
    threatSeats: match ? riichiSeats(match) : [],
    lastResult,
    /** Every graded turn of this hand, oldest first — what the end-of-hand review reads when
     *  feedback is held back until then. */
    results,
    finished,
    end,
    loading,
    /** No seed in the budget produced a drillable hand — the page offers another deal. */
    failed,
    boardHands,
    /** Seats a person plays: the drill's own generated seat, plus any other seat set to manual. */
    manualSeats: snapshot
      ? snapshot.algorithms.flatMap((a, seat) => (a === 'manual' ? [seat] : []))
      : [],
    /** How the board is actually playing each seat right now — the algorithm `finishTurn` reads
     *  (which flips non-declarers to `'defense'` at handover), not the generic default
     *  `resolveSeatConfig` would show while a seat is unconfigured. Fed to `SeatButton` as
     *  `fallbackModes` so the panel never lies about what the seat is doing. */
    algorithms: snapshot?.algorithms ?? [],
    elapsedNow: stats.elapsedNow,
    /** Whether the clock is ticking: a board is up, unfinished and unpaused. */
    running: !!snapshot && !finished && !loading && !stats.paused,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    /** Mean time per graded discard in *this* hand alone, ms — what the end-of-hand panel shows,
     *  as opposed to `averageTime`'s running session mean. */
    roundAverageTime:
      roundActionCount.current > 0 ? roundTotalMs.current / roundActionCount.current : 0,
    /** Mean partial credit across the session's throws, 0-1 — how safe your discards were
     *  relative to the safest and the most dangerous tile each hand actually held. */
    accuracy: stats.averageQuality,
    /** The hand ranked as it stands. Deliberately not rendered before the answer — markers on the
     *  tiles turn the drill into reading a hint — but it is what `onEvent` grades against. */
    ranked: (): TileDanger[] => (table.core && round ? analysisOf(table.core, acting).danger : []),
    discard: (index: number, declareRiichi?: boolean) => {
      if (finished || loading) return
      const fromDrawn = index === hand.length
      const tile = fromDrawn ? drawn : hand[index]
      if (tile) table.discard(tile, fromDrawn, declareRiichi)
    },
    answer: table.answer,
    riichiTiles: table.riichiTiles,
    riichiArmed: table.riichiArmed,
    armRiichi: table.armRiichi,
    next: () => setHandIndex((n) => n + 1),
    paused: stats.paused,
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    situationQuery,
  }

  /** The round as it stands right now: the accepted wall, the rules it was built under, and the
   *  discards played since handover — enough to replay a mid-hand turn. */
  function situationQuery(): string {
    if (!round) return ''
    return encodeFoldingUrl(
      round.wall,
      round.board,
      match ? match.log.slice(round.handedOverAt) : [],
    )
  }
}
