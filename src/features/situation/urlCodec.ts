import {
  parseTenhou,
  serializeTenhouOrdered,
  suitOf,
  tileName,
  NUM_TILE_TYPES,
  type ParsedTile,
} from '../../core/tiles'

export type Wind = 'E' | 'S' | 'W' | 'N'
const WINDS: Wind[] = ['E', 'S', 'W', 'N']

export interface Situation {
  seed: string
  turn: number
  hand: ParsedTile[]
  /** Wall prefix in draw order; unspecified draws come from the seeded pool. */
  wall: ParsedTile[]
  /** Discards per seat (0 = East), in discard order. */
  rivers: [ParsedTile[], ParsedTile[], ParsedTile[], ParsedTile[]]
  round: Wind
  seat: Wind
}

export function emptySituation(): Situation {
  return {
    seed: '',
    turn: 0,
    hand: [],
    wall: [],
    rivers: [[], [], [], []],
    round: 'E',
    seat: 'E',
  }
}

export function decodeSituation(params: URLSearchParams): Situation {
  const s = emptySituation()
  s.seed = params.get('seed') ?? ''
  s.turn = Math.max(0, Number(params.get('turn')) || 0)
  s.hand = parseTenhou(params.get('hand') ?? '')
  s.wall = parseTenhou(params.get('wall') ?? '')
  for (let i = 0; i < 4; i++) s.rivers[i] = parseTenhou(params.get(`river${i}`) ?? '')
  const round = params.get('round') as Wind
  const seat = params.get('seat') as Wind
  if (WINDS.includes(round)) s.round = round
  if (WINDS.includes(seat)) s.seat = seat
  return s
}

/** Query string with defaults/empties omitted, e.g. "hand=123m&seed=x". */
export function encodeSituation(s: Situation): string {
  const params = new URLSearchParams()
  if (s.seed) params.set('seed', s.seed)
  if (s.turn > 0) params.set('turn', String(s.turn))
  if (s.hand.length) params.set('hand', serializeTenhouOrdered(s.hand))
  if (s.wall.length) params.set('wall', serializeTenhouOrdered(s.wall))
  s.rivers.forEach((river, i) => {
    if (river.length) params.set(`river${i}`, serializeTenhouOrdered(river))
  })
  if (s.round !== 'E') params.set('round', s.round)
  if (s.seat !== 'E') params.set('seat', s.seat)
  return params.toString()
}

/** All tiles the situation pins down (hand + wall + rivers). */
export function allTiles(s: Situation): ParsedTile[] {
  return [...s.hand, ...s.wall, ...s.rivers.flat()]
}

/** Human-readable validation errors; empty when the situation is legal. */
export function validateSituation(s: Situation): string[] {
  const errors: string[] = []
  const counts = new Uint8Array(NUM_TILE_TYPES)
  const reds: Record<string, number> = { m: 0, p: 0, s: 0 }
  for (const tile of allTiles(s)) {
    counts[tile.id]++
    if (tile.red) reds[suitOf(tile.id)]++
  }
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (counts[id] > 4) errors.push(`more than 4 copies of ${tileName(id)}`)
  }
  for (const suit of ['m', 'p', 's']) {
    if (reds[suit] > 1) errors.push(`more than 1 red five of ${suit}`)
  }
  if (s.hand.length > 14) errors.push(`hand has ${s.hand.length} tiles (max 14)`)
  return errors
}
