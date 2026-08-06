import { describe, expect, it } from 'vitest'
import { handFromTenhou } from './hand'
import { decompose, type Meld } from './agari'
import { parseTenhou } from './tiles'

describe('decompose (standard)', () => {
  it('finds the single arrangement of a plain hand', () => {
    const hand = handFromTenhou('123456789m123p11s')
    const arrangements = decompose(hand.counts, [])
    expect(arrangements).toHaveLength(1)
    expect(arrangements[0].kind).toBe('standard')
  })

  it('finds multiple arrangements for an ambiguous ryanpeikou-shaped hand', () => {
    // 1122334455667m reads as ryanpeikou (four identical-shape runs) among other splits
    const hand = handFromTenhou('112233445566m77p')
    const arrangements = decompose(hand.counts, [])
    expect(arrangements.length).toBeGreaterThan(1)
  })

  it('returns nothing for an incomplete hand', () => {
    const hand = handFromTenhou('123456789m123p1s')
    expect(decompose(hand.counts, [])).toEqual([])
  })

  it('seeds blocks from called melds and only decomposes the concealed remainder', () => {
    const meld: Meld = { kind: 'pon', tiles: parseTenhou('555p') }
    const hand = handFromTenhou('123456789m11s', 1)
    const arrangements = decompose(hand.counts, [meld])
    expect(arrangements).toHaveLength(1)
    const blocks = arrangements[0].kind === 'standard' ? arrangements[0].blocks : []
    expect(blocks.some((b) => b.meld === meld)).toBe(true)
    expect(blocks).toHaveLength(5) // the meld + 3 concealed runs + the pair
  })

  it('leaves counts unmodified after searching', () => {
    const hand = handFromTenhou('112233445566m77p')
    const before = hand.counts.slice()
    decompose(hand.counts, [])
    expect(hand.counts).toEqual(before)
  })
})

describe('decompose (chiitoitsu)', () => {
  it('finds seven pairs', () => {
    const hand = handFromTenhou('11223344556677m')
    const arrangements = decompose(hand.counts, [])
    expect(arrangements.some((a) => a.kind === 'chiitoi')).toBe(true)
  })

  it('rejects four-of-a-kind as two pairs', () => {
    const hand = handFromTenhou('1111223344556m77p')
    const arrangements = decompose(hand.counts, [])
    expect(arrangements.some((a) => a.kind === 'chiitoi')).toBe(false)
  })

  it('is not offered once a meld is called', () => {
    const meld: Meld = { kind: 'pon', tiles: parseTenhou('555p') }
    const hand = handFromTenhou('1122334455667m', 1)
    const arrangements = decompose(hand.counts, [meld])
    expect(arrangements.some((a) => a.kind === 'chiitoi')).toBe(false)
  })
})

describe('decompose (kokushi)', () => {
  it('finds thirteen orphans with a pair', () => {
    const hand = handFromTenhou('119m19p19s1234567z')
    const arrangements = decompose(hand.counts, [])
    expect(arrangements.some((a) => a.kind === 'kokushi')).toBe(true)
  })

  it('rejects a hand missing a kind (chun) even with a pair elsewhere', () => {
    const missing = handFromTenhou('1199m19p19s123456z') // pair of 1m, no chun
    const arrangements = decompose(missing.counts, [])
    expect(arrangements.some((a) => a.kind === 'kokushi')).toBe(false)
  })
})
