import { describe, expect, it } from 'vitest'
import { handFromTenhou, tileCount } from './hand'
import { evaluateDiscards, evaluateKan, isBestDiscard } from './efficiency'
import { HONOR, SOU } from './tiles'

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

describe('isBestDiscard', () => {
  it('treats every tied top discard as best, not just whichever sorted first', () => {
    // 123456789m11p is already complete (3 runs + pair); E/S/W are interchangeable dead
    // weight, so discarding any one of them should tie for the top of the ranking.
    const hand = handFromTenhou('123456789m11p123z')
    const options = evaluateDiscards(hand)
    const honorDiscards = options.filter((o) => [27, 28, 29].includes(o.discard))
    expect(honorDiscards).toHaveLength(3)

    for (const honor of honorDiscards) {
      expect(isBestDiscard(honor, options[0])).toBe(true)
    }

    // breaking the complete 9m run is a genuinely worse discard, not a tie
    const breaksRun = options.find((o) => o.discard === 4)! // 5m
    expect(isBestDiscard(breaksRun, options[0])).toBe(false)
  })
})

describe('evaluateKan', () => {
  it('penalizes kanning a quad that was pulling double duty in a run and a triplet', () => {
    // 788889s decomposes losslessly as 789s + 888s; kanning the four 8s strands the
    // 7s/9s as a dead kanchan since all four 8s just left the game in their own meld.
    const hand = handFromTenhou('123456m788889s19p')
    const best = evaluateDiscards(hand)[0]
    expect(best.shanten).toBe(0) // tenpai discarding the 1p or 9p tanki

    const kan = evaluateKan(hand).find((o) => o.discard === SOU + 7)! // 8s
    expect(kan.shanten).toBe(1)
    expect(isBestDiscard(kan, best)).toBe(false)
  })

  it('does not penalize kanning an isolated honor quad with the pair already elsewhere', () => {
    // 123456m + 22p (pair) + 78s (ryanmen) already fill the other four blocks, so the
    // fourth 3z is genuinely spare either way — discarding it or kanning it leaves the
    // identical resulting shape.
    const hand = handFromTenhou('123456m78s22p3333z')
    const best = evaluateDiscards(hand)[0]
    expect(best.shanten).toBe(0)
    expect(best.discard).toBe(HONOR + 2) // the spare 3z

    const kan = evaluateKan(hand).find((o) => o.discard === HONOR + 2)!
    expect(isBestDiscard(kan, best)).toBe(true)
  })

  it('leaves the hand unmodified after evaluation', () => {
    const hand = handFromTenhou('123456m788889s19p')
    const before = hand.counts.slice()
    evaluateKan(hand)
    expect(hand.counts).toEqual(before)
    expect(hand.melds).toBe(0)
  })
})
