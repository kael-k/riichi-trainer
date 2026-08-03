import { describe, expect, it } from 'vitest'
import { handFromTenhou, tileCount } from './hand'
import { evaluateDiscards } from './efficiency'

describe('evaluateDiscards', () => {
  it('ranks discarding an isolated honor above breaking a good shape', () => {
    // 12345678m123p11s is tenpai on its own; the lone E honor is dead weight.
    const hand = handFromTenhou('12345678m123p11s1z')
    expect(tileCount(hand)).toBe(14)

    const options = evaluateDiscards(hand)
    expect(options[0].discard).toBe(27) // E
    expect(options[0].shanten).toBe(0)
    expect(options.every((o) => o.shanten >= options[0].shanten)).toBe(true)
  })

  it('returns one option per distinct held tile kind', () => {
    const hand = handFromTenhou('11223344556677m')
    const distinctKinds = hand.counts.filter((c) => c > 0).length
    expect(evaluateDiscards(hand)).toHaveLength(distinctKinds)
  })

  it('leaves the hand unmodified after evaluation', () => {
    const hand = handFromTenhou('12345678m123p11s1z')
    const before = hand.counts.slice()
    evaluateDiscards(hand)
    expect(hand.counts).toEqual(before)
  })
})
