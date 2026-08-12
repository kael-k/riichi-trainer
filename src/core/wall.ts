import { addTile, createHand, type Hand } from './hand'
import { mulberry32, shuffle } from './rng'
import { inTileSet, MAN, NUM_TILE_TYPES, PIN, SOU, type ParsedTile, type TileId } from './tiles'

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
 *  with `prefix`'s own copies already filtered out — the "used" idiom `createMatch` used to apply
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
