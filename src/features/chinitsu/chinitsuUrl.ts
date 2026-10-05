import {
  NUM_TILE_TYPES,
  parseTenhou,
  serializeTenhouOrdered,
  type ParsedTile,
} from '../../core/tiles'
import { INITIAL_HAND_SIZE, TILES_PER_KIND } from '../../core/wall'

/** What a chinitsu link names: one hand, and optionally the seed the stream carries on dealing
 *  from after it. Its own codec rather than `urlCodec.ts`'s `Situation`, whose `seed`/`hand` are
 *  the shanten trainer's alone — this trainer has no wall, no log and no match context. */
export interface ChinitsuLink {
  seed?: string
  /** Thirteen tiles, at most four of a kind. A link naming anything else is dropped here, the
   *  same as an absent one: the stream deals from the seed instead of posing a hand that cannot
   *  exist. Not required to be a flush, or even tenpai — the trainer poses whatever it names. */
  hand?: ParsedTile[]
}

function validHand(tiles: ParsedTile[]): boolean {
  if (tiles.length !== INITIAL_HAND_SIZE) return false
  const counts = new Uint8Array(NUM_TILE_TYPES)
  for (const t of tiles) if (++counts[t.id] > TILES_PER_KIND) return false
  return true
}

export function decodeChinitsuLink(params: URLSearchParams): ChinitsuLink {
  const link: ChinitsuLink = {}
  const seed = params.get('seed')
  if (seed) link.seed = seed
  const hand = parseTenhou(params.get('hand') ?? '')
  if (validHand(hand)) link.hand = hand
  return link
}

/** Query string with empties omitted, e.g. "hand=1112345678999p". */
export function encodeChinitsuLink(link: ChinitsuLink): string {
  const params = new URLSearchParams()
  if (link.seed) params.set('seed', link.seed)
  if (link.hand?.length) params.set('hand', serializeTenhouOrdered(link.hand))
  return params.toString()
}
