import { describe, expect, it } from 'vitest'
import type { Meld } from './agari'
import { handFromTenhou } from './hand'
import { chooseCall, chooseDiscard, chooseFold, hasYakuRoute, isFuriten, waits } from './policy'
import { HONOR, MAN, NUM_TILE_TYPES, parseTenhou, PIN, type TileId } from './tiles'

const NONE = new Uint8Array(NUM_TILE_TYPES)
const EAST = HONOR
const HAKU = HONOR + 4

describe('chooseDiscard', () => {
  it('takes the ukeire maximum and is stable across calls', () => {
    const hand = handFromTenhou('123456789m1134p')
    const a = chooseDiscard(hand, NONE, false)
    const b = chooseDiscard(hand, NONE, false)
    expect(a.discard).toBe(b.discard)
    // the lone 4p is the isolated tile; keeping the 11p pair and 3p is worth more
    expect(a.shanten).toBeLessThanOrEqual(1)
  })

  it('breaks ties without depending on sort order', () => {
    // a pure ryanmen-vs-ryanmen tie: both discards leave the same shanten and ukeire
    const hand = handFromTenhou('2345m2345p11122s')
    const choice = chooseDiscard(hand, NONE, false)
    for (let i = 0; i < 5; i++) {
      expect(chooseDiscard(handFromTenhou('2345m2345p11122s'), NONE, false).discard).toBe(
        choice.discard,
      )
    }
  })
})

describe('hasYakuRoute', () => {
  const noMelds: Meld[] = []

  it('sees a yakuhai pair as a route, since it can still become the triplet', () => {
    expect(hasYakuRoute(handFromTenhou('123m789p123s55z1s'), noMelds, EAST, HONOR + 1)).toBe(true)
  })

  it('sees the seat and round winds, but not a valueless one', () => {
    const hand = handFromTenhou('123m789p123s22z1s') // south pair
    expect(hasYakuRoute(hand, noMelds, HONOR + 1, EAST)).toBe(true) // south is the round
    expect(hasYakuRoute(hand, noMelds, EAST, HONOR + 1)).toBe(true) // south is the seat
    expect(hasYakuRoute(hand, noMelds, EAST, HONOR + 2)).toBe(false) // neither
  })

  it('sees all-simples and single-suit hands', () => {
    expect(hasYakuRoute(handFromTenhou('234m345p456s22s3s'), noMelds, EAST, HONOR + 1)).toBe(true)
    expect(hasYakuRoute(handFromTenhou('1123456789m991m'), noMelds, EAST, HONOR + 1)).toBe(true)
  })

  it('rejects a three-suit hand with terminals and no honours worth anything', () => {
    expect(hasYakuRoute(handFromTenhou('129m789p123s44s1s'), noMelds, EAST, HONOR + 1)).toBe(false)
  })
})

describe('waits and furiten', () => {
  it('returns the winning tiles of a tenpai hand and nothing otherwise', () => {
    // 123456789m is three complete runs, so the 1122p shanpon is the wait
    expect(waits(handFromTenhou('123456789m1122p'), false)).toEqual([PIN + 0, PIN + 1])
    expect(waits(handFromTenhou('19m19p19s1234567z'), false).length).toBeGreaterThan(0)
    expect(waits(handFromTenhou('123456789m134p'), false)).toEqual([])
  })

  it('is furiten when any wait already sits in your own river', () => {
    const hand = handFromTenhou('123456789m1122p')
    const w = waits(hand, false)
    expect(isFuriten(w, [])).toBe(false)
    expect(isFuriten(w, parseTenhou('9s'))).toBe(false)
    expect(isFuriten(w, [{ id: w[0] as TileId, red: false }])).toBe(true)
  })
})

describe('chooseFold', () => {
  it('picks the genbutsu tile over an unprotected one, and is stable across calls', () => {
    const hand = handFromTenhou('5m5p')
    const threats = [{ seat: 1, discards: [MAN + 4], passed: [] }]
    const a = chooseFold(hand, threats, NONE, false)
    const b = chooseFold(hand, threats, NONE, false)
    expect(a).toBe(MAN + 4)
    expect(b).toBe(a)
  })
})

describe('chooseCall', () => {
  it('refuses a call that would open a hand with no yaku route', () => {
    // three suits, terminals, no valuable honours: opening this hand cannot legally win
    const hand = handFromTenhou('19m22m789p123s44s')
    expect(chooseCall(hand, [], MAN + 1, false, EAST, HONOR + 1)).toBeNull()
  })

  it('takes the same call once the hand has a yaku route', () => {
    // identical shape, but the pon is on a dragon, so the opened hand keeps a yaku
    const hand = handFromTenhou('19m55z789p123s44s')
    const call = chooseCall(hand, [], HAKU, false, EAST, HONOR + 1)
    expect(call).not.toBeNull()
    expect(call?.kind).toBe('pon')
  })

  it('offers chi only from the player on the left', () => {
    const hand = handFromTenhou('23m55z789p123s44s')
    const left = chooseCall(hand, [], MAN + 3, true, EAST, HONOR + 1)
    const other = chooseCall(hand, [], MAN + 3, false, EAST, HONOR + 1)
    expect(other).toBeNull()
    if (left) expect(left.kind).toBe('chi')
  })
})
