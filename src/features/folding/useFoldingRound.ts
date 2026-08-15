import { useEffect, useMemo, useRef, useState } from 'react'
import { dangerScore, type TileDanger } from '../../core/danger'
import { addTile, removeTile, tileCount } from '../../core/hand'
import {
  answerClaim,
  beginTurn,
  canDeclareRiichi,
  concealedTiles,
  createMatch,
  finishTurn,
  isManual,
  reconsiderClaim,
  type ClaimAnswer,
  type MatchOptions,
  type MatchState,
} from '../../core/match'
import { waits } from '../../core/policy'
import { mulberry32 } from '../../core/rng'
import { shanten } from '../../core/shanten'
import {
  actingSeat,
  analysisOf,
  goRound,
  replayDiscards,
  snapshotTable,
  splitDrawn,
  yourDiscards,
  type TableCore,
  type TableSnapshot,
} from '../../core/table'
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
import { useLog } from '../../store/log'
import { resolveSanma } from '../situation/urlCodec'
import type { Settings } from '../settings/settingsStore'
import type { SeatConfig } from '../settings/tableSettings'
import type { VerdictSeverity } from '../table/Verdict'

/** The folding settings section plus the ruleset the round runs under (which a link can pin, so
 *  it is not a plain setting) and the two table settings (`threats`, `opponentWins`) that moved
 *  out of `Settings['folding']` into the shared `table` section (`tableSettings.ts`, REQ-04) but
 *  are still resolved per-round here, same as before the move. */
export type RoundOptions = Settings['folding'] & {
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
   *  handover always includes, not the only one that may be manual. Page state (D15), not
   *  settings — see `FoldingPage`. Read at generation time to seed the handover, and live
   *  thereafter (D6): a change here never rebuilds the round. */
  seats: SeatConfig | null
  /** Ask manual seats about other seats' discards (`TableSettings.claims`) — board-wide and
   *  persisted, unlike `seats` itself (D14). */
  claims: boolean
}

export interface FoldingUrl {
  /** Explicit wall in draw order, same format as the situation codec's — the board a link shares
   *  (D-09). Empty means "deal something fresh" rather than "replay this exact board". */
  wall: ParsedTile[]
  /** Set when `wall` failed `validateWall` (D-12) — `wall` is then empty and must never reach
   *  `createMatch`. */
  wallError?: WallError
  sanma?: boolean
  /** Whether the threats could win at all; pinned, since a board where nobody rons plays on past
   *  a deal-in and diverges from the same wall played for keeps. */
  wins?: boolean
  /** Threats the link was generated with; replayed verbatim, since the same wall only reproduces
   *  the same board when the search stops at the same declaration. */
  threats?: number
  /** Your own discards since the board was handed to you, replayed from the declaration to
   *  reach a mid-hand turn. Not extra tiles: the wall already dealt them. */
  discards?: ParsedTile[]
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

/** A real hand of mahjong plus which seat is yours — `core/table.ts`'s `TableCore` plus the one
 *  field that is folding's own. `threatViews` (from `match.ts`, read inside `analysisOf`) reads
 *  its genbutsu straight off `match.discards`, so this hook carries no event log of its own. */
interface RoundCore extends TableCore {
  /** How many discards your seat had already made when the drill was handed over — everything
   *  before that was the engine's, so only what follows belongs in a mid-hand link. */
  handedOverAt: number
}

/** `TableSnapshot` plus folding's own grading/session fields. */
interface RoundState extends TableSnapshot {
  round: TileId
  /** Seats currently threatening — everyone in riichi. Grows if someone else declares. */
  threatSeats: number[]
  lastResult: TurnResult | null
  /** Every graded turn of this hand, oldest first — what the end-of-hand review reads when
   *  feedback is held back until then. */
  results: TurnResult[]
  finished: boolean
  end: RoundEnd | null
  /** Searching for a hand: the board is not up and the clock has not started. */
  loading: boolean
  /** Every seat's hand as the board may show it right now (D-14): your own seat and, once
   *  `finished`, every seat, get `concealedTiles` — everyone else gets `BACK_TILE` filler at the
   *  same count. The gate lives here, below the settings layer, so no reveal setting or override
   *  can put a threat's real tile ids on screen before the hand is over. */
  boardHands: ParsedTile[][]
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
function boardHandsOf(core: RoundCore, reveal: boolean): ParsedTile[][] {
  const threats = new Set(riichiSeats(core.match))
  return core.match.players.map((player, seat) => {
    // `isManual` rather than `seat === core.seatIndex`: a seat the reader plays is their own hand
    // wherever it sits, and there can be more than one of them (see `RoundOptions.seats`)
    if (isManual(core.match, seat) || reveal || !threats.has(seat)) return concealedTiles(player)
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
 *  reproducible from the wall alone (D-09): the round wind, the handover offset. */
function wallKey(wall: ParsedTile[]): string {
  return serializeTenhouOrdered(wall)
}

function matchOptions(wall: ParsedTile[], options: BoardOptions): MatchOptions {
  // the round wind decides which winds are yakuhai, which is part of reading a threat, so it
  // varies per hand — seeded off the wall itself, so replaying the same wall rebuilds it
  const rng = mulberry32(`${wallKey(wall)}:round`)
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

/** Plays a wall until `threats` seats have declared riichi, stopping at the end of a turn (never
 *  mid-turn: `playMatch`'s `stop` fires per event, after the whole turn has already run, which
 *  would leave `match.discards` missing that turn's own discard and call while the rest of the
 *  state already reflects them). The board is then handed over a seeded number of seats later, so
 *  your position relative to the declarer varies: taking the seat due to act the instant the
 *  declaration lands makes you its shimocha every single time, and defending from shimocha is a
 *  narrower skill than defending from anywhere at the table. */
function playToRiichi(
  wall: ParsedTile[],
  options: MatchOptions,
  players: number,
  threats: number,
  seats: SeatConfig | null,
  claims: boolean,
) {
  const match = createMatch(wall, players, options)
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
      handedOverAt: match.discards.filter((d) => d.seat === seatIndex).length,
    }
  }
  return null
}

/** A situation only teaches something when the answer is neither forced nor obvious. */
function worthwhile(core: RoundCore): boolean {
  const { match, seatIndex } = core
  const player = match.players[seatIndex]
  if (match.ended) return false
  // the seat due to act can itself be an earlier declarer once two riichi are out
  if (player.riichiAt !== undefined) return false
  if (shanten(player.hand) < 1) return false
  if (match.liveWall.length < 4 * match.players.length) return false
  const ranked = analysisOf(core).danger
  // a hand with no safe tile has no lesson in it, and one with nothing dangerous has no question
  return (
    ranked[0]?.tier === 'genbutsu' &&
    ranked.some((entry) => entry.tier === 'nonSuji' || entry.tier === 'halfSuji')
  )
}

function buildRound(
  wall: ParsedTile[],
  options: BoardOptions,
  discards: ParsedTile[] = [],
  seats: SeatConfig | null = null,
  claims = false,
): RoundCore | null {
  const { sanma, threats } = options
  const players = sanma ? 3 : 4
  const core = playToRiichi(wall, matchOptions(wall, options), players, threats, seats, claims)
  if (!core || !worthwhile(core)) return null
  beginTurn(core.match, core.options)
  // fast-forward the link's own discards; stops quietly on one this board cannot honour
  replayDiscards(core, discards, (_c, tile) => {
    advanceAfterDiscard(core, tile)
    return !core.match.ended
  })
  return core
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
): Promise<{ core: RoundCore; wall: ParsedTile[]; threats: number } | null> {
  const { threats } = options
  for (let i = 0; i < 40 * threats; i++) {
    const wall = completeWall([], options.sanma, RULES.aka)
    const core = buildRound(wall, options, [], seats, claims)
    if (core) return { core, wall, threats }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return threats > 1 ? findRound({ ...options, threats: threats - 1 }, seats, claims) : null
}

/** Your discard, then every other seat back round to you, then your next draw — or, once a
 *  discard leaves another manual seat a claim to answer, stops right there: `goRound` already
 *  returns immediately with `match.claim` set, and drawing into a suspended turn would corrupt
 *  it, so `settleAfterClaim` is what resumes this same tail once the claim is answered. */
function advanceAfterDiscard(core: RoundCore, tile: ParsedTile, declareRiichi = false): void {
  const { match, options } = core
  finishTurn(match, options, tile, declareRiichi)
  settleAfterClaim(core)
}

/** The shared tail of a turn: run the AI seats round, then draw for whichever seat is up next —
 *  unless a claim is now pending, in which case nothing draws until `answer` resolves it. Shared
 *  by `advanceAfterDiscard`, `answer` and the live algorithm sync below, so a claim resolved
 *  mid-turn rejoins the identical path. `match.drawn === undefined` is always true already at the
 *  first two call sites (`finishTurn`/`answerClaim` both leave it cleared) — the guard exists for
 *  the third: a live algorithm flip can land here with the acting seat's tile already drawn, and
 *  `beginTurn` has no drawn-tile guard of its own. */
function settleAfterClaim(core: RoundCore): void {
  const { match, options } = core
  goRound(core)
  if (!match.ended && !match.claim && match.drawn === undefined && match.liveWall.length > 0) {
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

function snapshot(
  core: RoundCore,
  sanma: boolean,
  showSeatWaits: boolean,
  prev?: RoundState,
): RoundState {
  const end = endOf(core, sanma)
  const finished = end !== null
  return {
    ...snapshotTable(core, showSeatWaits),
    round: core.options.round,
    threatSeats: riichiSeats(core.match),
    lastResult: prev?.lastResult ?? null,
    results: prev?.results ?? [],
    finished,
    end,
    loading: false,
    // baked off `finished` alone — the live board's own reveal switch overrides this at the
    // hook's return below, off `core.current` rather than a stale snapshot, so toggling it
    // mid-hand doesn't wait for the next discard to take effect
    boardHands: boardHandsOf(core, finished),
  }
}

export function decodeFoldingUrl(params: URLSearchParams): FoldingUrl {
  const flag = (name: string): boolean | undefined => {
    const value = params.get(name)
    return value === null ? undefined : value !== '0'
  }
  const threats = Number(params.get('threats'))
  const discards = parseTenhou(params.get('discards') ?? '')
  const sanmaFlag = flag('sanma')
  const wall = parseTenhou(params.get('wall') ?? '')

  // untrusted input: reject a malformed/over-counted wall by name rather than let it reach
  // createMatch — the same D-12 gate `urlCodec.ts#decodeSituation` runs for the other wall-based
  // trainers. A partial wall with no explicit sanma flag validates against yonma; a full wall's
  // own length already settles the ruleset either way.
  const sanma = resolveSanma(wall, sanmaFlag, false)
  const error = validateWall(wall, sanma ? 3 : 4, sanma)

  const result: FoldingUrl = {
    wall: error ? [] : wall,
    sanma: sanmaFlag,
    wins: flag('wins'),
    threats: Number.isInteger(threats) && threats > 0 ? threats : undefined,
    discards: discards.length > 0 ? discards : undefined,
  }
  if (error) result.wallError = error
  return result
}

/** A match replays from its wall, rivers and all, so a link carries no tiles of its own beyond
 *  the wall itself — the two things that change what that wall deals, and the discards you have
 *  played since, which are what makes a mid-hand turn shareable (and a log row rewindable). */
export function encodeFoldingUrl(
  wall: ParsedTile[],
  options: BoardOptions,
  discards: ParsedTile[] = [],
): string {
  const params = new URLSearchParams()
  params.set('wall', serializeTenhouOrdered(wall))
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
  const roundWall = useRef<ParsedTile[]>([])
  // the board actually built, which is not always the one asked for: the search falls back to
  // fewer threats rather than failing, and a link has to carry what it got
  const roundBoard = useRef<BoardOptions>(undefined)
  const [state, setState] = useState<RoundState | null>(null)
  const [failed, setFailed] = useState(false)
  // "the next discard declares riichi", armed from the UI's riichi button — same trick
  // `useTableRound` uses, so the declaration rides on the discard the reader was going to make
  // anyway rather than needing its own call site
  const [riichiArmed, setRiichiArmed] = useState(false)
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
  // this effect's deps, same reasoning as the dropped `orientation`: a later change to either must
  // never re-search for a new hand (D6/D15). The live-sync effect further down is what actually
  // carries a later change onto the running match.
  useEffect(() => {
    const id = ++request.current
    setFailed(false)
    // a hand left behind (rewind, new deal) takes its held rows with it: they belong to a board
    // nobody is looking at any more
    held.current = []
    setState((prev) => (prev ? { ...prev, loading: true } : prev))
    // a link pins the rules its board was built under; without them the same wall deals a
    // different hand for the reader
    const board: BoardOptions = {
      sanma: options.sanma,
      threats: urlData.threats ?? options.threats,
      wins: urlData.wins ?? options.opponentWins,
    }

    // a link's wall is already an accepted board, so replay it as-is — discards included; only a
    // hand-edited one (or a fresh "new situation" request) falls through to a search
    const pinned =
      urlData.wall.length > 0 && handIndex === 0
        ? buildRound(urlData.wall, board, urlData.discards, options.seats, options.claims)
        : null
    const found = pinned
      ? Promise.resolve({ core: pinned, wall: urlData.wall, threats: board.threats })
      : findRound(board, options.seats, options.claims)

    void found.then((result) => {
      if (id !== request.current) return
      if (!result) {
        setFailed(true)
        return
      }
      core.current = result.core
      roundWall.current = result.wall
      roundBoard.current = { ...board, threats: result.threats }
      logReplay(result.core)
      stats.startClock()
      roundActionCount.current = 0
      roundTotalMs.current = 0
      setState(snapshot(result.core, options.sanma, options.showSeatWaits))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlData, handIndex, options.sanma, options.threats, options.opponentWins])

  // algorithm changes are live (D6/D15): flipping a seat's mode (or the claims toggle) must never
  // rebuild the round — this writes the latest values straight onto the running match instead, the
  // same live-sync `useTableRound` runs, adapted to folding's own turn-stepping (it drives
  // `beginTurn`/`finishTurn` itself rather than going through that hook). Only the seats the panel
  // actually named are touched, same raw (unresolved) reading `playToRiichi` itself uses at
  // handover — a generic default here would stomp the blanket fold `playToRiichi` already applied
  // to every seat the panel never touched (D6's "one algorithm changes" ⇒ nobody else's does).
  const seatKey = JSON.stringify(options.seats?.modes ?? null)
  useEffect(() => {
    const r = core.current
    if (!r || r.match.ended) return
    let changed = r.options.claims !== options.claims
    r.options.claims = options.claims
    options.seats?.modes.forEach((algorithm, seat) => {
      const player = r.match.players[seat]
      if (player && player.algorithm !== algorithm) {
        player.algorithm = algorithm
        changed = true
      }
    })
    if (!changed) return

    // nobody will ever answer this seat's pending claim now that it has stopped being manual —
    // re-resolve it through the same restartable path `answer` uses, never inventing a pass
    // (which would set `missedWin`, poisoning the hand with furiten over a decision never made)
    if (r.match.claim && !isManual(r.match, r.match.claim.seat)) {
      reconsiderClaim(r.match, r.options)
    }
    settleAfterClaim(r)
    setState((prev) => (prev ? snapshot(r, options.sanma, options.showSeatWaits, prev) : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatKey, options.claims])

  // `showSeatWaits` alone must not rejoin the search effect above (that would deal a new hand) —
  // this re-snapshots the board exactly as it stands, which is what makes toggling the setting
  // live rather than waiting for the next discard to pick it up
  useEffect(() => {
    const r = core.current
    if (r)
      setState((prev) => (prev ? snapshot(r, options.sanma, options.showSeatWaits, prev) : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.showSeatWaits])

  /** Writes one log row per discard the link was fast-forwarded through, so a shared link (or a
   *  rewind) arrives with the turns behind it on the record instead of a blank log. Keyed on the
   *  link's identity: the effect above runs twice per mount and four times under StrictMode, all
   *  for one and the same board. */
  function logReplay(built: RoundCore) {
    if (loggedReplay.current === urlData) return
    loggedReplay.current = urlData
    const played = yourDiscards(built, built.handedOverAt)
    played.forEach((tile, i) =>
      log(
        'log.replay',
        { tile: tileCode(tile.id, tile.red) },
        [tile],
        undefined,
        encodeFoldingUrl(roundWall.current, roundBoard.current!, played.slice(0, i)),
      ),
    )
  }

  function discard(index: number, declareRiichi = riichiArmed) {
    const r = core.current
    if (!r || !state || state.finished || state.loading || state.claim) return
    const tile = index === state.hand.length ? state.drawn : state.hand[index]
    if (!tile) return
    setRiichiArmed(false)

    // captured before anything below advances the board, so it reproduces the turn exactly as it
    // stood right before this discard
    const situationBefore = situationQuery()

    const ranked = analysisOf(r).danger
    const yours = ranked.find((entry) => entry.tile === tile.id)!
    const safest = ranked.filter((entry) => entry.rank === 0)
    const correct = yours.rank === 0
    const elapsed = stats.elapsedNow()
    // partial credit against the turn's own worst option: right/wrong alone calls a suji throw
    // when a genbutsu was there the same mistake as throwing the live non-suji 5. A hand where
    // everything is genbutsu has nothing to be wrong about, so it scores full marks
    const worst = Math.max(...ranked.map(dangerScore))
    const quality = worst > 0 ? (worst - dangerScore(yours)) / worst : 1
    const result: TurnResult = { turn: r.match.turn, yours, safest, correct, quality }

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
    roundActionCount.current++
    roundTotalMs.current += elapsed

    advanceAfterDiscard(r, tile, declareRiichi)
    const next = snapshot(r, options.sanma, options.showSeatWaits, state)
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

  /** Answers the claim the board is waiting on — ron, pon, chi or pass — and plays on. Only ever
   *  pending when a second manual seat's own discard left a third seat a call to make; it never
   *  interrupts the seat being graded, whose own discards are what `discard` above scores. */
  function answer(claimAnswer: ClaimAnswer) {
    const r = core.current
    if (!r || !r.match.claim || !state) return
    answerClaim(r.match, r.options, claimAnswer)
    settleAfterClaim(r)
    const next = snapshot(r, options.sanma, options.showSeatWaits, state)
    if (next.end) flushLog()
    setState(next)
  }

  /** Tiles the acting seat could discard *and* declare riichi on — same computation
   *  `useTableRound#riichiTiles` runs, memoised on the turn/seat/claim rather than recomputed on
   *  every render: `evaluateDiscards` is the app's most expensive call, and this hook (unlike
   *  `useTableRound`) has no draw-time analysis cached to reuse. */
  const riichiTilesMemo = useMemo((): TileId[] => {
    const r = core.current
    if (!r || !state || state.finished || state.claim) return []
    const seat = actingSeat(r)
    const player = r.match.players[seat]
    if (tileCount(player.hand) !== 14) return []
    const analysis = analysisOf(r)
    return analysis.ranked
      .filter((option) => {
        if (option.shanten !== 0) return false
        removeTile(player.hand, option.discard)
        const legal = canDeclareRiichi(r.match, r.options, seat)
        addTile(player.hand, option.discard)
        return legal
      })
      .map((option) => option.discard)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.turn, state?.acting, state?.claim, state?.finished])

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
      acting: 0,
      claim: undefined,
      drawnSeat: undefined,
      ended: undefined,
      win: undefined,
      wall: [],
      dealtTiles: [],
      round: HONOR,
      threatSeats: [] as number[],
      lastResult: null,
      results: [],
      finished: false,
      end: null,
      boardHands: [],
      seatReads: [],
    }),
    loading: !failed && (state === null || state.loading),
    /** No seed in the budget produced a drillable hand — the page offers another deal. */
    failed,
    // recomputed fresh every render (not baked into `state` above) off `core.current`, so
    // toggling the board's own reveal switch takes effect immediately rather than waiting for
    // the next discard to re-snapshot — a debug switch that only sometimes shows the board isn't
    // one you can trust
    boardHands: core.current
      ? boardHandsOf(core.current, (state?.finished ?? false) || options.showOpponentHands)
      : [],
    /** Seats a person plays: the drill's own generated seat, plus any other seat the panel set
     *  to `'manual'`. */
    manualSeats: core.current
      ? core.current.match.players.flatMap((p, seat) => (p.algorithm === 'manual' ? [seat] : []))
      : [],
    /** How the board is actually playing each seat right now — the algorithm `finishTurn` reads
     *  (which flips non-declarers to `'defense'` at handover, `playToRiichi` above), not the
     *  generic default `resolveSeatConfig` would otherwise show while a seat is unconfigured.
     *  Fed to `SeatButton` as `fallbackModes` so the panel never lies about what the seat is
     *  doing. */
    algorithms: core.current ? core.current.match.players.map((p) => p.algorithm) : [],
    elapsedNow: stats.elapsedNow,
    /** Whether the clock is ticking: a board is up, unfinished and unpaused. */
    running: !!state && !state.finished && !state.loading && !stats.paused,
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
     *  tiles turn the drill into reading a hint — but it is what `discard` grades against. */
    ranked: (): TileDanger[] => (core.current ? analysisOf(core.current).danger : []),
    discard,
    answer,
    riichiTiles: () => riichiTilesMemo,
    riichiArmed,
    /** Arms/disarms "the next discard declares riichi"; the discard itself carries it. */
    armRiichi: setRiichiArmed,
    next: () => setHandIndex((n) => n + 1),
    paused: stats.paused,
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    situationQuery,
  }

  /** The round as it stands right now: the accepted wall, the rules it was built under, and the
   *  discards you have played since — enough to replay a mid-hand turn. */
  function situationQuery(): string {
    return roundWall.current.length > 0 && roundBoard.current
      ? encodeFoldingUrl(
          roundWall.current,
          roundBoard.current,
          core.current ? yourDiscards(core.current, core.current.handedOverAt) : [],
        )
      : ''
  }
}
