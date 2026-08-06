import { describe, expect, it } from 'vitest'
import { parseTenhou, serializeTenhouOrdered } from '../../core/tiles'
import { decodeSituation, emptySituation, encodeSituation, validateSituation } from './urlCodec'

describe('serializeTenhouOrdered', () => {
  it('preserves order and red fives', () => {
    const s = '3m1z2m05p'
    expect(serializeTenhouOrdered(parseTenhou(s))).toBe(s)
  })
  it('merges adjacent same-suit tiles', () => {
    expect(serializeTenhouOrdered(parseTenhou('123m77z'))).toBe('123m77z')
  })
})

describe('urlCodec', () => {
  it('round-trips a full situation', () => {
    const s = emptySituation()
    s.seed = 'abc'
    s.hand = parseTenhou('123m456p789s1122z')
    s.wall = parseTenhou('9m1z5s')
    s.river = parseTenhou('1z9p')
    s.round = 'S'
    s.seat = 'W'
    s.opponents = true
    s.deadWall = false
    s.aka = true
    expect(decodeSituation(new URLSearchParams(encodeSituation(s)))).toEqual(s)
  })

  it('decodes empty params to the empty situation', () => {
    expect(decodeSituation(new URLSearchParams(''))).toEqual(emptySituation())
    expect(encodeSituation(emptySituation())).toBe('')
  })

  it('flags impossible tile counts', () => {
    const s = emptySituation()
    s.hand = parseTenhou('1111m')
    s.wall = parseTenhou('1m')
    expect(validateSituation(s)).toEqual(['more than 4 copies of 1m'])
  })

  it('flags duplicate red fives and oversized hands', () => {
    const s = emptySituation()
    s.hand = parseTenhou('00p123456789m1234s')
    const errors = validateSituation(s)
    expect(errors).toContain('more than 1 red five of p')
    expect(errors).toContain('hand has 15 tiles (max 14)')
  })
})
