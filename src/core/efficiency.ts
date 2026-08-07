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
export function evaluateDiscards(hand: Hand, visible?: Uint8Array, sanma = false): DiscardOption[] {
  const options: DiscardOption[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (hand.counts[id] === 0) continue
    removeTile(hand, id)
    const tiles = ukeire(hand, visible, sanma)
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
 * Evaluates every closed kan (ankan) available from a 14-tile hand — any tile held four times.
 * `discard` names the kanned tile; options rank on the same footing as `evaluateDiscards`'s,
 * since a locked quad leaves the same 13-tile-equivalent shape a discard does. A kan never beats
 * the pure discard optimum (it only removes decompositions a live quad could join), so callers
 * keep comparing against `evaluateDiscards(...)[0]`, not this list's own head.
 */
export function evaluateKan(hand: Hand, visible?: Uint8Array, sanma = false): DiscardOption[] {
  const seen = visible ?? hand.counts.slice()
  const options: DiscardOption[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (hand.counts[id] !== 4) continue
    hand.counts[id] -= 4
    hand.melds++
    const tiles = ukeire(hand, seen, sanma)
    options.push({
      discard: id,
      shanten: shanten(hand),
      ukeireTiles: tiles,
      ukeireCount: totalRemaining(tiles),
    })
    hand.melds--
    hand.counts[id] += 4
  }
  return options
}

/** True when `option` ties `best` on shanten and ukeire count. `best` (`options[0]`) is just
 *  whichever tied discard sorted first, so never compare by tile id. */
export function isBestDiscard(option: DiscardOption, best: DiscardOption): boolean {
  return option.shanten === best.shanten && option.ukeireCount === best.ukeireCount
}
