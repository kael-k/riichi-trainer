import { addTile, removeTile, type Hand } from './hand'
import { shanten } from './shanten'
import { totalRemaining, ukeire, type UkeireTile } from './ukeire'
import { NUM_TILE_TYPES, type TileId } from './tiles'

export interface DiscardOption {
  discard: TileId
  shanten: number
  ukeireTiles: UkeireTile[]
  ukeireCount: number
}

/**
 * Evaluates every distinct discard from a 14-tile hand, ranked best first
 * (lowest resulting shanten, then highest ukeire count).
 */
export function evaluateDiscards(hand: Hand, visible?: Uint8Array): DiscardOption[] {
  const options: DiscardOption[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (hand.counts[id] === 0) continue
    removeTile(hand, id)
    const tiles = ukeire(hand, visible)
    options.push({
      discard: id,
      shanten: shanten(hand),
      ukeireTiles: tiles,
      ukeireCount: totalRemaining(tiles),
    })
    addTile(hand, id)
  }
  options.sort((a, b) => a.shanten - b.shanten || b.ukeireCount - a.ukeireCount)
  return options
}

/**
 * True when `option` ties the top of a ranked `evaluateDiscards` list — same shanten and
 * same ukeire count as `best`. `best` (e.g. `options[0]`) is just whichever tied discard
 * sorted first, so comparing by tile id instead of by these two fields would wrongly mark
 * every other equally-good discard as a mistake.
 */
export function isBestDiscard(option: DiscardOption, best: DiscardOption): boolean {
  return option.shanten === best.shanten && option.ukeireCount === best.ukeireCount
}
