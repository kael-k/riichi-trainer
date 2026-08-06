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

export interface Deal {
  hand: Hand
  liveWall: TileId[]
  deadWall: TileId[]
  doraIndicators: TileId[]
}

/** Deals a fresh hand from a seed, splitting off the dead wall and first dora indicator. */
export function deal(seed: string, handSize = INITIAL_HAND_SIZE, sanma = false): Deal {
  const wall = buildWall(seed, sanma)
  const hand = createHand()
  for (let i = 0; i < handSize; i++) addTile(hand, wall[i])

  const deadWall = wall.slice(wall.length - DEAD_WALL_SIZE)
  const liveWall = wall.slice(handSize, wall.length - DEAD_WALL_SIZE)
  return { hand, liveWall, deadWall, doraIndicators: [deadWall[0]] }
}

export function draw(liveWall: TileId[]): { tile: TileId; rest: TileId[] } {
  if (liveWall.length === 0) throw new Error('wall is empty')
  return { tile: liveWall[0], rest: liveWall.slice(1) }
}
