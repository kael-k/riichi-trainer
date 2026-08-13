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
   *  (D-11). This is the deal itself, not a "prefix consumed on next draw" the way `wall` used
   *  to mean before this phase (D-10). */
  wall: ParsedTile[]
  /** Set when `wall` failed `validateWall` (D-12) — `wall` is then empty and must never reach
   *  `createMatch`. This is the one codec in the repo that rejects rather than silently drops
   *  (contrast `parseTenhou`, which drops a malformed digit): a wall is positionally meaningful,
   *  so repairing it would hand back a different board than the link claimed to share. */
  wallError?: WallError
  /** The user's own past discards, replayed from the deal to reach the situation's
   *  decision point. Not extra tiles: each one must already be in hand/wall. */
  river: ParsedTile[]
  round: Wind
  seat: Wind
  /** Per-round overrides of the corresponding settings, pinned so a shared link
   *  reproduces the same round regardless of the receiver's preferences. */
  deadWall?: boolean
  aka?: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma?: boolean
}

const FLAGS = ['deadWall', 'aka', 'sanma'] as const

export function emptySituation(): Situation {
  return {
    wall: [],
    river: [],
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
  s.river = parseTenhou(params.get('river') ?? '')
  const round = params.get('round') as Wind
  const seat = params.get('seat') as Wind
  if (WINDS.includes(round)) s.round = round
  if (WINDS.includes(seat)) s.seat = seat
  for (const flag of FLAGS) {
    const v = params.get(flag.toLowerCase())
    if (v !== null) s[flag] = v !== '0'
  }

  // untrusted input: reject a malformed/over-counted wall by name rather than let it reach
  // createMatch. No global setting is available at this pure-codec boundary, so a partial wall
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
  if (s.river.length) params.set('river', serializeTenhouOrdered(s.river))
  if (s.round !== 'E') params.set('round', s.round)
  if (s.seat !== 'E') params.set('seat', s.seat)
  for (const flag of FLAGS) {
    if (s[flag] !== undefined) params.set(flag.toLowerCase(), s[flag] ? '1' : '0')
  }
  return params.toString()
}

/** All tiles the situation pins down for a wall-based trainer. */
export function allTiles(s: Situation): ParsedTile[] {
  return s.wall
}

/** Ruleset a wall-based trainer runs under: a full wall's own length settles it (108 = sanma,
 *  136 = yonma) — a loaded wall wins over the reader's own setting. A short/partial wall can't be
 *  inferred from length alone, so it falls back to `flag` (the situation's own `sanma` override,
 *  when a link carries one) and then to `global` (the reader's setting). */
export function resolveSanma(wall: ParsedTile[], flag: boolean | undefined, global: boolean): boolean {
  if (wall.length === 108) return true
  if (wall.length === 136) return false
  return flag ?? global
}
