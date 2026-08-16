import { addTile, createHand, type Hand } from './hand'
import { mulberry32, shuffle } from './rng'
import {
  HONOR,
  inTileSet,
  MAN,
  NUM_TILE_TYPES,
  PIN,
  SOU,
  type ParsedTile,
  type TileId,
} from './tiles'

export const TILES_PER_KIND = 4
export const DEAD_WALL_SIZE = 14
export const INITIAL_HAND_SIZE = 13

/** Full wall in draw order, deterministically shuffled from `seed`: 136 tiles (34 kinds),
 *  or 108 (27 kinds) with `sanma` — 2m-8m never enter the wall. */
export function buildWall(seed: string, sanma = false): TileId[] {
  const tiles: TileId[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (!inTileSet(id, sanma)) continue
    for (let copy = 0; copy < TILES_PER_KIND; copy++) tiles.push(id)
  }
  return shuffle(tiles, mulberry32(seed))
}

/** Deals a hand off the front of a seeded wall — the shanten trainer's whole round. Rounds that
 *  keep drawing (the efficiency trainer) build their own wall split from `buildWall`. */
export function deal(seed: string, handSize = INITIAL_HAND_SIZE, sanma = false): Hand {
  const wall = buildWall(seed, sanma)
  const hand = createHand()
  for (let i = 0; i < handSize; i++) addTile(hand, wall[i])
  return hand
}

/** Kinds that carry a red five under this ruleset — sanma has no 5m at all. */
export function redFiveIds(sanma: boolean): TileId[] {
  return sanma ? [PIN + 4, SOU + 4] : [MAN + 4, PIN + 4, SOU + 4]
}

/** Tile count of a complete wall: 136 (34 kinds) yonma, 108 (27 kinds) sanma. */
export function fullWallSize(sanma: boolean): number {
  let kinds = 0
  for (let id = 0; id < NUM_TILE_TYPES; id++) if (inTileSet(id, sanma)) kinds++
  return kinds * TILES_PER_KIND
}

/** Completes a wall `prefix` to `fullWallSize(sanma)` tiles: `prefix` verbatim, then a remainder
 *  drawn from a random (or `seed`-built, for reproducible tests/random-fallback generation) wall
 *  with `prefix`'s own copies already filtered out — the "used" idiom `createRound` used to apply
 *  to its pinned prefix, generalized to the whole wall. When `aka` is on, one red copy per suit not
 *  already named red by `prefix` is marked into the remainder; when it's off the remainder carries
 *  no red of its own (a red already inside `prefix` is left exactly as given — the link said so). */
export function completeWall(
  prefix: ParsedTile[],
  sanma: boolean,
  aka: boolean,
  seed?: string,
): ParsedTile[] {
  const used = new Uint8Array(NUM_TILE_TYPES)
  const prefixReds = new Set<TileId>()
  for (const t of prefix) {
    used[t.id]++
    if (t.red) prefixReds.add(t.id)
  }

  const remainder: ParsedTile[] = buildWall(seed ?? String(Math.random()), sanma)
    .filter((id) => {
      if (used[id] === 0) return true
      used[id]--
      return false
    })
    .map((id) => ({ id, red: false }))

  if (aka) {
    for (const redId of redFiveIds(sanma)) {
      if (prefixReds.has(redId)) continue
      const i = remainder.findIndex((t) => t.id === redId)
      if (i >= 0) remainder[i] = { id: redId, red: true }
    }
  }

  return [...prefix, ...remainder]
}

/** A rejected wall, naming where the fault sits and never repaired into a playable one (ADR-0005):
 *  `zone` is which part of the wall the offending tile sits in, `seat` is set only for
 *  `zone: 'hand'`, and `tile` is unset only for a `'length'` fault, which has no single tile. */
export interface WallError {
  zone: 'hand' | 'wall' | 'deadWall'
  seat?: number
  tile?: TileId
  reason: 'length' | 'copies' | 'red' | 'tileSet'
}

function zoneAt(
  index: number,
  length: number,
  players: number,
  sanma: boolean,
): { zone: WallError['zone']; seat?: number } {
  const handSize = players * INITIAL_HAND_SIZE
  if (index < handSize) return { zone: 'hand', seat: Math.floor(index / INITIAL_HAND_SIZE) }
  // "trailing 14 of a full wall" only applies once the wall actually reaches its full length —
  // a short/partial wall has no dead wall yet, positionally
  if (length >= fullWallSize(sanma) && index >= length - DEAD_WALL_SIZE) return { zone: 'deadWall' }
  return { zone: 'wall' }
}

/** Untrusted-input gate for a `wall=` link (ADR-0005): length within bounds, no kind exceeding four
 *  copies (exactly four once the wall reaches full length), at most one red per suit, no 2m-8m
 *  under sanma. Returns the first fault found, naming its zone and tile — never mutates `tiles`
 *  and never returns a repaired wall, since a repaired wall is a different board than the one the
 *  link claimed to share. `null` means `tiles` is a valid full wall or a valid short prefix. */
export function validateWall(
  tiles: ParsedTile[],
  players: number,
  sanma: boolean,
): WallError | null {
  const max = fullWallSize(sanma)
  if (tiles.length > max) return { zone: 'wall', reason: 'length' }

  const counts = new Uint8Array(NUM_TILE_TYPES)
  const redSeen = new Set<TileId>()
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    const { zone, seat } = zoneAt(i, tiles.length, players, sanma)
    if (!inTileSet(tile.id, sanma)) return { zone, seat, tile: tile.id, reason: 'tileSet' }
    if (tile.red) {
      const isFive = tile.id % 9 === 4 && tile.id < HONOR
      if (!isFive || redSeen.has(tile.id)) return { zone, seat, tile: tile.id, reason: 'red' }
      redSeen.add(tile.id)
    }
    counts[tile.id]++
    if (counts[tile.id] > TILES_PER_KIND) return { zone, seat, tile: tile.id, reason: 'copies' }
  }

  if (tiles.length === max) {
    for (let id = 0; id < NUM_TILE_TYPES; id++) {
      if (inTileSet(id, sanma) && counts[id] !== TILES_PER_KIND) {
        return { zone: 'wall', tile: id, reason: 'copies' }
      }
    }
  }

  return null
}

/** A wall pinning one seat's starting hand: a random (or `seed`-built) full wall with `hand`'s
 *  copies removed, then `hand` spliced in at that seat's dealing offset. What a link pinning one
 *  seat's hand encodes, and what the lab's hand-authoring surface builds its walls with. */
export function wallWithHand(
  seat: number,
  hand: ParsedTile[],
  sanma: boolean,
  aka: boolean,
  seed?: string,
): ParsedTile[] {
  const used = new Uint8Array(NUM_TILE_TYPES)
  for (const t of hand) used[t.id]++
  const padding = completeWall([], sanma, aka, seed).filter((t) => {
    if (used[t.id] === 0) return true
    used[t.id]--
    return false
  })
  const offset = seat * INITIAL_HAND_SIZE
  return [...padding.slice(0, offset), ...hand, ...padding.slice(offset)]
}
