import { describe, expect, it } from 'vitest'
import { parseTenhou, NUM_TILE_TYPES } from './tiles'
import {
  buildWall,
  completeWall,
  deal,
  dealtIndices,
  dealtSeat,
  fullWallSize,
  INITIAL_HAND_SIZE,
  TILES_PER_KIND,
  validateWall,
  wallWithHand,
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

describe('wallWithHand', () => {
  it('pins a hand at the named seat, keeping the rest of the wall a valid full wall', () => {
    const hand = parseTenhou('1112345678999m')
    const wall = wallWithHand(1, hand, false, true, 'with-hand-seed')
    expect(wall).toHaveLength(fullWallSize(false))
    // the seat's thirteen sit in the slots it is actually dealt (4/4/4+1), not in one block
    expect(dealtIndices(1, 4).map((i) => wall[i])).toEqual(hand)
    expect(validateWall(wall, 4, false)).toBeNull()
  })
})

describe('validateWall', () => {
  it('rejects a wall longer than a full wall, naming the wall zone', () => {
    const tooLong = [...completeWall([], false, true, 'too-long'), { id: 0, red: false }]
    expect(validateWall(tooLong, 4, false)).toEqual({ zone: 'wall', reason: 'length' })
  })

  it('rejects a fifth copy of one kind, naming its position', () => {
    // the fifth 1m is wall index 4, which the 4/4/4+1 deal hands to seat 1, not seat 0
    const error = validateWall(parseTenhou('11111m'), 4, false)
    expect(error).toEqual({ zone: 'hand', seat: 1, tile: 0, reason: 'copies' })
  })

  it('rejects a full-length wall missing a copy of some kind', () => {
    const full = completeWall([], false, false, 'missing-copy')
    const short = [...full.slice(0, -1), { id: full[0].id, red: false }]
    const error = validateWall(short, 4, false)
    expect(error?.reason).toBe('copies')
  })

  it('rejects two red fives of the same suit', () => {
    expect(validateWall(parseTenhou('00p'), 4, false)).toEqual({
      zone: 'hand',
      seat: 0,
      tile: 13,
      reason: 'red',
    })
  })

  it('rejects a red tile that is not a five', () => {
    const error = validateWall([{ id: 0, red: true }], 4, false)
    expect(error).toEqual({ zone: 'hand', seat: 0, tile: 0, reason: 'red' })
  })

  it('rejects 2m-8m under sanma', () => {
    expect(validateWall(parseTenhou('2m'), 3, true)).toEqual({
      zone: 'hand',
      seat: 0,
      tile: 1,
      reason: 'tileSet',
    })
  })

  it('reports the deadWall zone for a tile in the trailing 14 of a full wall', () => {
    const full = completeWall([], false, true, 'deadwall-zone')
    // corrupt the last tile into a fifth copy of the first tile's kind to trigger a 'copies'
    // fault positioned inside the trailing 14
    const corrupted = [...full.slice(0, -1), { id: full[0].id, red: false }]
    const error = validateWall(corrupted, 4, false)
    expect(error?.zone).toBe('deadWall')
  })

  it('reports the hand zone with the right seat for a fault inside a later starting hand', () => {
    // 13 harmless tiles, then a non-five red at index 13 — the fourth seat's first block of four
    const wall = [...parseTenhou('123456789m1122z'), { id: 5, red: true }]
    const error = validateWall(wall, 4, false)
    expect(error).toEqual({ zone: 'hand', seat: 3, tile: 5, reason: 'red' })
  })

  it('walks the deal in blocks of four, one tile each at the end', () => {
    expect([0, 3, 4, 7, 12, 15, 16, 47, 48, 49, 51, 52].map((i) => dealtSeat(i, 4))).toEqual([
      0, 0, 1, 1, 3, 3, 0, 3, 0, 1, 3, -1,
    ])
    expect(dealtIndices(0, 4)).toEqual([0, 1, 2, 3, 16, 17, 18, 19, 32, 33, 34, 35, 48])
    expect(dealtIndices(2, 3)).toHaveLength(INITIAL_HAND_SIZE)
    // a solo round is dealt straight off the front, nothing interleaved
    expect(dealtIndices(0, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('accepts a valid full wall and a valid short prefix', () => {
    expect(validateWall(completeWall([], false, true, 'valid-full'), 4, false)).toBeNull()
    expect(validateWall(parseTenhou('123456789m'), 4, false)).toBeNull()
  })
})
