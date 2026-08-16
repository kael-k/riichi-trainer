import { decodeLog, encodeLog } from '../../core/actionLog'
import {
  STARTING_POINTS_SANMA,
  STARTING_POINTS_YONMA,
  type MatchState,
} from '../../core/match'
import type { LogEntry } from '../../core/round'
import { parseTenhou, serializeTenhouOrdered, type ParsedTile } from '../../core/tiles'
import { validateWall, type WallError } from '../../core/wall'

export type Wind = 'E' | 'S' | 'W' | 'N'
export const WINDS: Wind[] = ['E', 'S', 'W', 'N']

export interface Situation {
  /** Seed backing the shanten trainer's continuous hand stream, and a pinned hand for its
   *  one-shot reveal. The shanten trainer is the only one left on this seed+hand format —
   *  every wall-based trainer (efficiency, folding, scoring, the lab) shares a board via the
   *  explicit `wall` below instead. Optional rather than removed: `useShantenRound.ts` shares
   *  this codec and is out of this phase's scope. */
  seed?: string
  hand?: ParsedTile[]
  /** Explicit wall in draw order for wall-based trainers: seat 0's 13 tiles, seat 1's 13, …,
   *  then the live draws, then the last 14 tiles as the dead wall (dora indicator first). A
   *  short wall is a prefix — the remainder is completed at random from the copies it leaves
   *  (ADR-0005). This is the deal itself, not a "prefix consumed on next draw" the way `wall` used
   *  to mean before this phase (ADR-0005). */
  wall: ParsedTile[]
  /** Set when `wall` failed `validateWall` (ADR-0005) — `wall` is then empty and must never reach
   *  `createRound`. This is the one codec in the repo that rejects rather than silently drops
   *  (contrast `parseTenhou`, which drops a malformed digit): a wall is positionally meaningful,
   *  so repairing it would hand back a different board than the link claimed to share. */
  wallError?: WallError
  /** Every seat's decision from the deal to the situation's decision point — replayed by
   *  `replayLog` (`core/round.ts`), which consults no algorithm at all, so a shared link
   *  reproduces the exact hand that was played regardless of what any seat's algorithm is set to
   *  today. Not extra tiles: everything named here is already accounted for by `wall`. */
  log: LogEntry[]
  round: Wind
  seat: Wind
  /** Per-round overrides of the corresponding settings, pinned so a shared link
   *  reproduces the same round regardless of the receiver's preferences. */
  deadWall?: boolean
  aka?: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma?: boolean
  /** The match context a round starts from (`core/match.ts`) — carry-in only, nothing here steps
   *  it. Named apart from `round`/`seat` (the Wind letters above) since `MatchState.round` is a
   *  different thing (which kyoku within the prevalent wind), not a rename of either. Each is
   *  omitted from the query string at its `createMatch` default, same as `round`/`seat` are at
   *  `'E'`, so an unmodified link stays exactly as short as before this field existed. */
  kyoku?: number
  honba?: number
  dealerRepeat?: number
  dealer?: number
  riichiSticks?: number
  points?: number[]
}

const FLAGS = ['deadWall', 'aka', 'sanma'] as const

export function emptySituation(): Situation {
  return {
    wall: [],
    log: [],
    round: 'E',
    seat: 'E',
  }
}

export function decodeSituation(params: URLSearchParams): Situation {
  const s = emptySituation()
  const seed = params.get('seed')
  if (seed !== null) s.seed = seed
  const hand = params.get('hand')
  if (hand !== null) s.hand = parseTenhou(hand)
  s.wall = parseTenhou(params.get('wall') ?? '')
  s.log = decodeLog(params.get('log') ?? '')
  const round = params.get('round') as Wind
  const seat = params.get('seat') as Wind
  if (WINDS.includes(round)) s.round = round
  if (WINDS.includes(seat)) s.seat = seat
  for (const flag of FLAGS) {
    const v = params.get(flag.toLowerCase())
    if (v !== null) s[flag] = v !== '0'
  }
  for (const key of ['kyoku', 'honba', 'dealerRepeat', 'dealer', 'riichiSticks'] as const) {
    const v = params.get(key.toLowerCase())
    if (v === null) continue
    const n = Number(v)
    if (Number.isFinite(n)) s[key] = n
  }
  const points = params.get('points')
  if (points !== null) {
    const parsed = points.split(',').map(Number)
    if (parsed.every(Number.isFinite)) s.points = parsed
  }

  // untrusted input: reject a malformed/over-counted wall by name rather than let it reach
  // createRound. No global setting is available at this pure-codec boundary, so a partial wall
  // with no explicit sanma flag validates against yonma — the reader's own trainer resolves the
  // real ruleset (and, for a full wall, length alone already settles it either way)
  const sanma = resolveSanma(s.wall, s.sanma, false)
  const error = validateWall(s.wall, sanma ? 3 : 4, sanma)
  if (error) {
    s.wallError = error
    s.wall = []
  }
  return s
}

/** Query string with defaults/empties omitted, e.g. "hand=123m&seed=x". */
export function encodeSituation(s: Situation): string {
  const params = new URLSearchParams()
  if (s.seed) params.set('seed', s.seed)
  if (s.hand?.length) params.set('hand', serializeTenhouOrdered(s.hand))
  if (s.wall.length) params.set('wall', serializeTenhouOrdered(s.wall))
  if (s.log.length) params.set('log', encodeLog(s.log))
  if (s.round !== 'E') params.set('round', s.round)
  if (s.seat !== 'E') params.set('seat', s.seat)
  for (const flag of FLAGS) {
    if (s[flag] !== undefined) params.set(flag.toLowerCase(), s[flag] ? '1' : '0')
  }
  if (s.kyoku !== undefined && s.kyoku !== 1) params.set('kyoku', String(s.kyoku))
  if (s.honba) params.set('honba', String(s.honba))
  if (s.dealerRepeat) params.set('dealerrepeat', String(s.dealerRepeat))
  if (s.dealer) params.set('dealer', String(s.dealer))
  if (s.riichiSticks) params.set('riichisticks', String(s.riichiSticks))
  if (s.points && !pointsAtDefault(s.points, resolveSanma(s.wall, s.sanma, false))) {
    params.set('points', s.points.join(','))
  }
  return params.toString()
}

/** Whether `points` is exactly `createMatch`'s starting array for `sanma` — the comparison
 *  `encodeSituation` uses to omit an unmodified match context, same as `round`/`seat` stay out of
 *  the query string at `'E'`. */
function pointsAtDefault(points: number[], sanma: boolean): boolean {
  const start = sanma ? STARTING_POINTS_SANMA : STARTING_POINTS_YONMA
  return points.every((p) => p === start)
}

/** The `MatchState` overrides a decoded `Situation` carries, for a caller building
 *  `createMatch(sanma, { prevalentWind, ...matchOverrides(situation) })`. Only the fields the
 *  situation actually named — `createMatch`'s own defaults fill the rest, so a key present here
 *  with value `undefined` would wrongly overwrite one of those (`{ ...overrides }` is a shallow
 *  merge), which is why this builds the object key-by-key instead of a blanket spread. */
export function matchOverrides(
  s: Situation,
): Partial<Pick<MatchState, 'round' | 'honba' | 'dealerRepeat' | 'dealer' | 'riichiSticks' | 'points'>> {
  const out: ReturnType<typeof matchOverrides> = {}
  if (s.kyoku !== undefined) out.round = s.kyoku
  if (s.honba !== undefined) out.honba = s.honba
  if (s.dealerRepeat !== undefined) out.dealerRepeat = s.dealerRepeat
  if (s.dealer !== undefined) out.dealer = s.dealer
  if (s.riichiSticks !== undefined) out.riichiSticks = s.riichiSticks
  if (s.points !== undefined) out.points = s.points
  return out
}

/** All tiles the situation pins down for a wall-based trainer. */
export function allTiles(s: Situation): ParsedTile[] {
  return s.wall
}

/** Ruleset a wall-based trainer runs under: a full wall's own length settles it (108 = sanma,
 *  136 = yonma) — a loaded wall wins over the reader's own setting. A short/partial wall can't be
 *  inferred from length alone, so it falls back to `flag` (the situation's own `sanma` override,
 *  when a link carries one) and then to `global` (the reader's setting). */
export function resolveSanma(
  wall: ParsedTile[],
  flag: boolean | undefined,
  global: boolean,
): boolean {
  if (wall.length === 108) return true
  if (wall.length === 136) return false
  return flag ?? global
}
