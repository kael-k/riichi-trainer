import { describe, expect, it } from 'vitest'
import { addTile, createHand, handFromTenhou, removeTile, tileCount } from './hand'

describe('Hand', () => {
  it('builds counts from tenhou notation', () => {
    const hand = handFromTenhou('11123m')
    expect(hand.counts[0]).toBe(3) // 1m
    expect(hand.counts[1]).toBe(1) // 2m
    expect(hand.counts[2]).toBe(1) // 3m
    expect(tileCount(hand)).toBe(5)
  })

  it('accounts for melds in tileCount', () => {
    const hand = handFromTenhou('11m', 2)
    expect(tileCount(hand)).toBe(2 + 2 * 3)
  })

  it('adds and removes tiles', () => {
    const hand = createHand()
    addTile(hand, 0)
    addTile(hand, 0)
    expect(hand.counts[0]).toBe(2)
    removeTile(hand, 0)
    expect(hand.counts[0]).toBe(1)
  })

  it('throws when removing a tile the hand does not have', () => {
    const hand = createHand()
    expect(() => removeTile(hand, 0)).toThrow()
  })
})
