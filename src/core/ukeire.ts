import { addTile, removeTile, type Hand } from './hand'
import { shanten } from './shanten'
import { inTileSet, NUM_TILE_TYPES, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

export interface UkeireTile {
  tile: TileId
  /** How many of this tile are still unaccounted for, given a visibility count. */
  remaining: number
}

/** Tile kinds that lower the hand's shanten if drawn. `sanma` excludes 2m-8m, which
 *  aren't in the wall and so can never actually be drawn. */
export function improvingTiles(hand: Hand, sanma = false): TileId[] {
  const current = shanten(hand)
  const result: TileId[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (!inTileSet(id, sanma) || hand.counts[id] >= TILES_PER_KIND) continue
    addTile(hand, id)
    if (shanten(hand) < current) result.push(id)
    removeTile(hand, id)
  }
  return result
}

/**
 * Ukeire for `hand`, with remaining counts computed against `visible` (a 34-length count of
 * every copy of each tile kind already accounted for: this hand, other hands/melds, rivers,
 * dora indicators). Defaults to just this hand, i.e. `TILES_PER_KIND - hand.counts[tile]`.
 */
export function ukeire(hand: Hand, visible?: Uint8Array, sanma = false): UkeireTile[] {
  const seen = visible ?? hand.counts
  return improvingTiles(hand, sanma).map((tile) => ({
    tile,
    remaining: TILES_PER_KIND - seen[tile],
  }))
}

export function totalRemaining(tiles: UkeireTile[]): number {
  return tiles.reduce((sum, t) => sum + Math.max(0, t.remaining), 0)
}
