import { describe, expect, it } from 'vitest'
import { handFromTenhou } from './hand'
import { shanten } from './shanten'
import { HONOR, NUM_TILE_TYPES, suitOf, type ParsedTile } from './tiles'
import { dealFlushHand, flushFallback, type FlushSuit } from './flush'
import { karatenTiles, readWaits } from './waits'

function countsOf(tiles: ParsedTile[]): Uint8Array {
  const counts = new Uint8Array(NUM_TILE_TYPES)
  for (const t of tiles) counts[t.id]++
  return counts
}

/** What every posed hand must be: thirteen legal tiles, tenpai, on honest waits only. */
function expectPoseable(tiles: ParsedTile[]) {
  expect(tiles).toHaveLength(13)
  const counts = countsOf(tiles)
  expect(Math.max(...counts)).toBeLessThanOrEqual(4)
  const hand = handFromTenhou('')
  hand.counts.set(counts)
  expect(shanten(hand)).toBe(0)
  expect(karatenTiles(counts)).toEqual([])
  expect(readWaits(counts).length).toBeGreaterThan(0)
}

describe('dealFlushHand', () => {
  it('is deterministic per seed and options', () => {
    expect(dealFlushHand('a', 'p', 'both')).toEqual(dealFlushHand('a', 'p', 'both'))
    expect(dealFlushHand('a', 'p', 'both')).not.toEqual(dealFlushHand('b', 'p', 'both'))
  })

  it.each<FlushSuit>(['m', 'p', 's'])('deals a tenpai chinitsu in %s, sorted', (suit) => {
    for (let i = 0; i < 40; i++) {
      const tiles = dealFlushHand(`chinitsu-${i}`, suit, 'chinitsu')
      expectPoseable(tiles)
      expect(tiles.every((t) => suitOf(t.id) === suit)).toBe(true)
      expect(tiles.map((t) => t.id)).toEqual([...tiles.map((t) => t.id)].sort((a, b) => a - b))
    }
  })

  it('deals a tenpai honitsu: the suit plus at least one honour, nothing else', () => {
    for (let i = 0; i < 40; i++) {
      const tiles = dealFlushHand(`honitsu-${i}`, 's', 'honitsu')
      expectPoseable(tiles)
      expect(tiles.some((t) => t.id >= HONOR)).toBe(true)
      expect(tiles.every((t) => t.id >= HONOR || suitOf(t.id) === 's')).toBe(true)
    }
  })

  it('mixes both kinds when asked for both', () => {
    const kinds = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const tiles = dealFlushHand(`both-${i}`, 'p', 'both')
      expectPoseable(tiles)
      kinds.add(tiles.some((t) => t.id >= HONOR) ? 'honitsu' : 'chinitsu')
    }
    expect(kinds).toEqual(new Set(['chinitsu', 'honitsu']))
  })

  it('leans toward many-sided waits without ruling out a single one', () => {
    const waitCounts = Array.from({ length: 200 }, (_, i) => {
      const counts = countsOf(dealFlushHand(`spread-${i}`, 'p', 'chinitsu'))
      return readWaits(counts).length
    })
    const single = waitCounts.filter((n) => n === 1).length
    expect(single).toBeGreaterThan(0)
    // uniform over tenpai thirteens a third are single-wait; half of those are thrown back
    expect(single / waitCounts.length).toBeLessThan(0.3)
  })

  it.each([false, true])('falls back to a poseable hand (honitsu: %s)', (honitsu) => {
    for (const suit of ['m', 'p', 's'] as const) expectPoseable(flushFallback(suit, honitsu))
  })
})
