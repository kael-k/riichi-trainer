import { describe, expect, it } from 'vitest'
import { mulberry32, shuffle } from './rng'

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32('riichi')
    const b = mulberry32('riichi')
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('produces a different sequence for a different seed', () => {
    const a = mulberry32('riichi')
    const b = mulberry32('mahjong')
    expect(a()).not.toBe(b())
  })

  it('stays within [0, 1)', () => {
    const rng = mulberry32('bounds')
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('shuffle', () => {
  it('is deterministic for a given seed', () => {
    const arr = Array.from({ length: 136 }, (_, i) => i)
    const a = shuffle(arr.slice(), mulberry32('deal-1'))
    const b = shuffle(arr.slice(), mulberry32('deal-1'))
    expect(a).toEqual(b)
  })

  it('preserves the same set of elements', () => {
    const arr = Array.from({ length: 136 }, (_, i) => i)
    const shuffled = shuffle(arr.slice(), mulberry32('deal-2'))
    expect(shuffled.slice().sort((x, y) => x - y)).toEqual(arr)
  })
})
