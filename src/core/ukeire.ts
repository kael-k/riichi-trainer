import { addTile, removeTile, type Hand } from './hand'
import { shanten } from './shanten'
import { NUM_TILE_TYPES, type TileId } from './tiles'

export interface UkeireTile {
  tile: TileId
  /** How many of this tile are still unaccounted for, given a visibility count. */
  remaining: number
}

/** Tile kinds that lower the hand's shanten if drawn. */
export function improvingTiles(hand: Hand): TileId[] {
  const current = shanten(hand)
  const result: TileId[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (hand.counts[id] >= 4) continue
    addTile(hand, id)
    if (shanten(hand) < current) result.push(id)
    removeTile(hand, id)
  }
  return result
}

/**
 * Ukeire for `hand`, with remaining counts computed against `visible` (a 34-length count of
 * every copy of each tile kind already accounted for: this hand, other hands/melds, rivers,
 * dora indicators). Defaults to just this hand, i.e. `4 - hand.counts[tile]`.
 */
export function ukeire(hand: Hand, visible?: Uint8Array): UkeireTile[] {
  const seen = visible ?? hand.counts
  return improvingTiles(hand).map((tile) => ({ tile, remaining: 4 - seen[tile] }))
}

export function totalRemaining(tiles: UkeireTile[]): number {
  return tiles.reduce((sum, t) => sum + Math.max(0, t.remaining), 0)
}
