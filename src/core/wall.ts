import { addTile, createHand, type Hand } from './hand'
import { mulberry32, shuffle } from './rng'
import { inTileSet, NUM_TILE_TYPES, type TileId } from './tiles'

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
