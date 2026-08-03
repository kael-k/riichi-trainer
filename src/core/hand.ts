import { NUM_TILE_TYPES, parseTenhou, type TileId } from './tiles'

export interface Hand {
  /** Count of each of the 34 tile kinds currently in the concealed hand. */
  counts: Uint8Array
  /** Number of already-fixed (called) melds; each counts as one complete set. */
  melds: number
}

export function createHand(): Hand {
  return { counts: new Uint8Array(NUM_TILE_TYPES), melds: 0 }
}

export function cloneHand(hand: Hand): Hand {
  return { counts: hand.counts.slice(), melds: hand.melds }
}

export function handFromTenhou(input: string, melds = 0): Hand {
  const hand = createHand()
  hand.melds = melds
  for (const tile of parseTenhou(input)) addTile(hand, tile.id)
  return hand
}

export function addTile(hand: Hand, id: TileId): void {
  hand.counts[id]++
}

export function removeTile(hand: Hand, id: TileId): void {
  if (hand.counts[id] === 0) throw new Error(`cannot remove tile ${id}: hand has none`)
  hand.counts[id]--
}

export function tileCount(hand: Hand): number {
  let sum = hand.melds * 3
  for (let i = 0; i < NUM_TILE_TYPES; i++) sum += hand.counts[i]
  return sum
}
