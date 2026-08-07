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
 * Lowest shanten reachable by discarding one tile, and every discard that reaches it.
 *
 * `evaluateDiscards` computes ukeire for all fourteen candidates, and ukeire costs 34 shanten
 * probes each — but a ranking only ever needs ukeire for the discards already tied on shanten,
 * which is usually two or three. Simulated players use this first and price only the survivors,
 * which is roughly a 4x cut in the simulator's dominant cost.
 */
export function bestDiscards(hand: Hand): { shanten: number; discards: TileId[] } {
  let best = Infinity
  const discards: TileId[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (hand.counts[id] === 0) continue
    removeTile(hand, id)
    const value = shanten(hand)
    addTile(hand, id)
    if (value < best) {
      best = value
      discards.length = 0
    }
    if (value === best) discards.push(id)
  }
  return { shanten: best, discards }
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
