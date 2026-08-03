import { describe, expect, it } from 'vitest'
import { handFromTenhou } from './hand'
import { chiitoiShanten, kokushiShanten, shanten, standardShanten } from './shanten'

describe('standardShanten', () => {
  it('is -1 (agari) for a complete hand', () => {
    const hand = handFromTenhou('123456789m123p11s')
    expect(standardShanten(hand)).toBe(-1)
  })

  it('is 0 (tenpai) for a tanki wait', () => {
    const hand = handFromTenhou('123456789m123p1s')
    expect(standardShanten(hand)).toBe(0)
  })

  it('is 0 (tenpai) for a ryanmen wait', () => {
    const hand = handFromTenhou('12345678m123p11s')
    expect(standardShanten(hand)).toBe(0)
  })

  it('accounts for fixed melds as complete sets', () => {
    const hand = handFromTenhou('123p1s', 3)
    expect(standardShanten(hand)).toBe(0)
  })

  it('is higher for a scattered hand', () => {
    const hand = handFromTenhou('147m147p147s1234z')
    expect(standardShanten(hand)).toBe(8)
  })
})

describe('chiitoiShanten', () => {
  it('is 0 (tenpai) one pair short of seven pairs', () => {
    const hand = handFromTenhou('1122334455667m')
    expect(chiitoiShanten(hand)).toBe(0)
  })

  it('is -1 (agari) for seven complete pairs', () => {
    const hand = handFromTenhou('11223344556677m')
    expect(chiitoiShanten(hand)).toBe(-1)
  })

  it('penalizes duplicate kinds beyond a pair', () => {
    // four of a kind only ever contributes one pair toward chiitoi
    const hand = handFromTenhou('1111223344556m')
    expect(chiitoiShanten(hand)).toBeGreaterThan(0)
  })

  it('ignores melds; the formula only reads the concealed counts', () => {
    const hand = handFromTenhou('1122334455667m', 1)
    expect(chiitoiShanten(hand)).toBe(0)
  })
})

describe('kokushiShanten', () => {
  it('is 0 (tenpai) with all 13 kinds and no pair (13-sided wait)', () => {
    const hand = handFromTenhou('19m19p19s1234567z')
    expect(kokushiShanten(hand)).toBe(0)
  })

  it('is 0 (tenpai) with 12 kinds plus a pair (single wait)', () => {
    const hand = handFromTenhou('119m19p19s123456z')
    expect(kokushiShanten(hand)).toBe(0)
  })

  it('is 1-shanten with 11 kinds plus a pair', () => {
    const hand = handFromTenhou('119m19p19s12345z')
    expect(kokushiShanten(hand)).toBe(1)
  })

  it('ignores melds; the formula only reads the concealed counts', () => {
    const hand = handFromTenhou('19m19p19s1234567z', 1)
    expect(kokushiShanten(hand)).toBe(0)
  })
})

describe('shanten (combined)', () => {
  it('is 0 for a ryanpeikou shape, tenpai via both standard and chiitoi', () => {
    const hand = handFromTenhou('1122334455667m')
    expect(standardShanten(hand)).toBe(0)
    expect(chiitoiShanten(hand)).toBe(0)
    expect(kokushiShanten(hand)).toBe(11)
    expect(shanten(hand)).toBe(0)
  })

  it('picks chiitoi when it is genuinely ahead of standard', () => {
    const hand = handFromTenhou('1199m1199p11s112z')
    expect(chiitoiShanten(hand)).toBe(0)
    expect(standardShanten(hand)).toBe(3)
    expect(kokushiShanten(hand)).toBe(5)
    expect(shanten(hand)).toBe(0)
  })

  it('excludes chiitoi and kokushi once melds are called', () => {
    const hand = handFromTenhou('114477p299s', 1)
    expect(shanten(hand)).toBe(standardShanten(hand))
    expect(shanten(hand)).toBe(2)
  })
})
