import { parseTenhou, serializeTenhouOrdered, type ParsedTile } from '../../core/tiles'

export type Wind = 'E' | 'S' | 'W' | 'N'
export const WINDS: Wind[] = ['E', 'S', 'W', 'N']

export interface Situation {
  seed: string
  hand: ParsedTile[]
  /** Wall prefix in draw order — consumed by whoever draws next (opponents included);
   *  unspecified draws come from the seeded pool. */
  wall: ParsedTile[]
  /** The user's own past discards, replayed from the deal to reach the situation's
   *  decision point. Not extra tiles: each one must already be in hand/wall. */
  river: ParsedTile[]
  round: Wind
  seat: Wind
  /** Per-round overrides of the corresponding settings, pinned so a shared link
   *  reproduces the same round regardless of the receiver's preferences. */
  opponents?: boolean
  deadWall?: boolean
  aka?: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats. */
  sanma?: boolean
}

const FLAGS = ['opponents', 'deadWall', 'aka', 'sanma'] as const

export function emptySituation(): Situation {
  return {
    seed: '',
    hand: [],
    wall: [],
    river: [],
    round: 'E',
    seat: 'E',
  }
}

export function decodeSituation(params: URLSearchParams): Situation {
  const s = emptySituation()
  s.seed = params.get('seed') ?? ''
  s.hand = parseTenhou(params.get('hand') ?? '')
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
  return s
}

/** Query string with defaults/empties omitted, e.g. "hand=123m&seed=x". */
export function encodeSituation(s: Situation): string {
  const params = new URLSearchParams()
  if (s.seed) params.set('seed', s.seed)
  if (s.hand.length) params.set('hand', serializeTenhouOrdered(s.hand))
  if (s.wall.length) params.set('wall', serializeTenhouOrdered(s.wall))
  if (s.river.length) params.set('river', serializeTenhouOrdered(s.river))
  if (s.round !== 'E') params.set('round', s.round)
  if (s.seat !== 'E') params.set('seat', s.seat)
  for (const flag of FLAGS) {
    if (s[flag] !== undefined) params.set(flag.toLowerCase(), s[flag] ? '1' : '0')
  }
  return params.toString()
}

/** All tiles the situation pins down (hand + wall). The river is a replay of
 *  discards drawn from these, not additional tiles. */
export function allTiles(s: Situation): ParsedTile[] {
  return [...s.hand, ...s.wall]
}
