import { describe, expect, it } from 'vitest'
import { NUM_TILE_TYPES } from './tiles'
import { buildWall, deal, draw, DEAD_WALL_SIZE, INITIAL_HAND_SIZE, TILES_PER_KIND } from './wall'
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
  it('produces a reproducible situation for the same seed', () => {
    const a = deal('reproduce-me')
    const b = deal('reproduce-me')
    expect(a.hand.counts).toEqual(b.hand.counts)
    expect(a.liveWall).toEqual(b.liveWall)
    expect(a.doraIndicators).toEqual(b.doraIndicators)
  })

  it('deals the requested hand size and reserves the dead wall', () => {
    const { hand, liveWall, deadWall } = deal('sizes')
    expect(tileCount(hand)).toBe(INITIAL_HAND_SIZE)
    expect(deadWall).toHaveLength(DEAD_WALL_SIZE)
    expect(liveWall).toHaveLength(
      NUM_TILE_TYPES * TILES_PER_KIND - INITIAL_HAND_SIZE - DEAD_WALL_SIZE,
    )
  })

  it('draws the dora indicator from the dead wall', () => {
    const { deadWall, doraIndicators } = deal('dora')
    expect(doraIndicators).toEqual([deadWall[0]])
  })

  it('deals from the 108-tile sanma wall', () => {
    const { hand, liveWall } = deal('sanma-deal', INITIAL_HAND_SIZE, true)
    expect(tileCount(hand)).toBe(INITIAL_HAND_SIZE)
    expect(liveWall).toHaveLength(27 * TILES_PER_KIND - INITIAL_HAND_SIZE - DEAD_WALL_SIZE)
  })
})

describe('draw', () => {
  it('takes the next tile off the live wall', () => {
    const { liveWall } = deal('draw-test')
    const { tile, rest } = draw(liveWall)
    expect(tile).toBe(liveWall[0])
    expect(rest).toEqual(liveWall.slice(1))
  })

  it('throws when the wall is empty', () => {
    expect(() => draw([])).toThrow()
  })
})
