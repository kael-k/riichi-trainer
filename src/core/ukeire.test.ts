import { describe, expect, it } from 'vitest'
import { handFromTenhou } from './hand'
import { shanten } from './shanten'
import { improvingTiles, totalRemaining, ukeire } from './ukeire'

describe('improvingTiles', () => {
  it('accepts all 9 man tiles for the nine gates shape (chuuren poutou)', () => {
    const hand = handFromTenhou('1112345678999m')
    expect(shanten(hand)).toBe(0)
    expect(improvingTiles(hand).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('returns no tiles for an already-complete hand', () => {
    const hand = handFromTenhou('123456789m123p11s')
    expect(improvingTiles(hand)).toEqual([])
  })

  it('every returned tile strictly lowers shanten', () => {
    const hand = handFromTenhou('34556788m123p11s')
    const before = shanten(hand)
    for (const tile of improvingTiles(hand)) {
      const trial = handFromTenhou('34556788m123p11s')
      trial.counts[tile]++
      expect(shanten(trial)).toBeLessThan(before)
    }
  })

  it('excludes 2m-8m in sanma — those ids are never in the wall', () => {
    const hand = handFromTenhou('34556788m123p11s')
    expect(improvingTiles(hand, true).some((id) => id >= 1 && id <= 7)).toBe(false)
  })
})

describe('ukeire', () => {
  it('defaults remaining count to 4 minus what is in hand', () => {
    const hand = handFromTenhou('1112345678999m')
    const result = ukeire(hand)
    const oneMan = result.find((t) => t.tile === 0)
    expect(oneMan?.remaining).toBe(1) // 4 total, 3 already in hand
  })

  it('subtracts a supplied visibility count (other hands/rivers/dora)', () => {
    const hand = handFromTenhou('1112345678999m')
    const visible = hand.counts.slice()
    visible[0] = 4 // all four 1m accounted for elsewhere too
    const result = ukeire(hand, visible)
    expect(result.find((t) => t.tile === 0)?.remaining).toBe(0)
  })

  it('totalRemaining sums remaining across all improving tiles', () => {
    const hand = handFromTenhou('1112345678999m')
    expect(totalRemaining(ukeire(hand))).toBeGreaterThan(0)
  })

  it('never reports remaining copies for 2m-8m in sanma', () => {
    const hand = handFromTenhou('34556788m123p11s')
    expect(ukeire(hand, undefined, true).some((t) => t.tile >= 1 && t.tile <= 7)).toBe(false)
  })
})
