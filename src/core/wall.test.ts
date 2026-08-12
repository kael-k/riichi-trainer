import { describe, expect, it } from 'vitest'
import { parseTenhou, NUM_TILE_TYPES } from './tiles'
import {
  buildWall,
  completeWall,
  deal,
  fullWallSize,
  INITIAL_HAND_SIZE,
  TILES_PER_KIND,
} from './wall'
import { tileCount } from './hand'

describe('buildWall', () => {
  it('contains exactly 4 of each of the 34 kinds', () => {
    const wall = buildWall('seed-a')
    expect(wall).toHaveLength(NUM_TILE_TYPES * TILES_PER_KIND)
    const counts = new Array(NUM_TILE_TYPES).fill(0)
    for (const id of wall) counts[id]++
    expect(counts.every((c) => c === TILES_PER_KIND)).toBe(true)
  })

  it('is deterministic for the same seed', () => {
    expect(buildWall('same')).toEqual(buildWall('same'))
  })

  it('differs for different seeds', () => {
    expect(buildWall('seed-x')).not.toEqual(buildWall('seed-y'))
  })

  it('drops 2m-8m in sanma: 27 kinds, 108 tiles, still deterministic per seed', () => {
    const wall = buildWall('sanma-seed', true)
    expect(wall).toHaveLength(27 * TILES_PER_KIND)
    expect(wall.some((id) => id >= 1 && id <= 7)).toBe(false)
    expect(buildWall('sanma-seed', true)).toEqual(wall)
  })
})

describe('deal', () => {
  it('produces a reproducible hand for the same seed', () => {
    expect(deal('reproduce-me').counts).toEqual(deal('reproduce-me').counts)
  })

  it('deals the requested hand size', () => {
    expect(tileCount(deal('sizes'))).toBe(INITIAL_HAND_SIZE)
    expect(tileCount(deal('sizes', 14))).toBe(14)
  })

  it('deals from the 108-tile sanma wall: no 2m-8m', () => {
    const hand = deal('sanma-deal', INITIAL_HAND_SIZE, true)
    expect(tileCount(hand)).toBe(INITIAL_HAND_SIZE)
    expect(hand.counts.slice(1, 8).every((c) => c === 0)).toBe(true)
  })
})

describe('fullWallSize', () => {
  it('is 136 for yonma, 108 for sanma', () => {
    expect(fullWallSize(false)).toBe(136)
    expect(fullWallSize(true)).toBe(108)
  })
})

describe('completeWall', () => {
  it('keeps the prefix verbatim and fills the rest to a full wall', () => {
    const prefix = parseTenhou('1112345678999m')
    const wall = completeWall(prefix, false, true, 'complete-seed')
    expect(wall).toHaveLength(fullWallSize(false))
    expect(wall.slice(0, prefix.length)).toEqual(prefix)
  })

  it('is deterministic for the same fill seed, and every kind still totals 4 copies', () => {
    const prefix = parseTenhou('123m')
    const a = completeWall(prefix, false, true, 'same-fill')
    const b = completeWall(prefix, false, true, 'same-fill')
    expect(a).toEqual(b)

    const counts = new Array(NUM_TILE_TYPES).fill(0)
    for (const t of a) counts[t.id]++
    expect(counts.every((c) => c === TILES_PER_KIND)).toBe(true)
  })

  it('seeds no red when aka is off, even leaving a prefix-named red alone', () => {
    const prefix = parseTenhou('0p') // red 5p, named explicitly
    const wall = completeWall(prefix, false, false, 'no-aka-seed')
    expect(wall.filter((t) => t.red)).toEqual([{ id: 13, red: true }])
  })
})
