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
 * Evaluates every closed kan (ankan) available from a 14-tile hand — any tile held
 * four times. Locking the quad as a fixed meld leaves a 10-tile concealed hand plus
 * one meld, the same "13-tile-equivalent, about to draw" shape a discard produces
 * (`Hand.melds` feeds `shanten()`/`ukeire()` exactly like a called meld would), so the
 * resulting `DiscardOption`s (`discard` here means "the kanned tile") rank on identical
 * footing against `evaluateDiscards`'s output. A kan never beats the pure discard
 * optimum — it only removes decompositions a live quad could still take part in — so
 * callers keep comparing against `evaluateDiscards(...)[0]`, not this list's own head.
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

/**
 * True when `option` ties the top of a ranked `evaluateDiscards` list — same shanten and
 * same ukeire count as `best`. `best` (e.g. `options[0]`) is just whichever tied discard
 * sorted first, so comparing by tile id instead of by these two fields would wrongly mark
 * every other equally-good discard as a mistake.
 */
export function isBestDiscard(option: DiscardOption, best: DiscardOption): boolean {
  return option.shanten === best.shanten && option.ukeireCount === best.ukeireCount
}
