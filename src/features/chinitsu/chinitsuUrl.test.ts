import { describe, expect, it } from 'vitest'
import { parseTenhou } from '../../core/tiles'
import { decodeChinitsuLink, encodeChinitsuLink } from './chinitsuUrl'

const decode = (query: string) => decodeChinitsuLink(new URLSearchParams(query))

describe('chinitsu links', () => {
  it('round-trips a hand and a seed, red five included', () => {
    const link = { seed: 'abc', hand: parseTenhou('1112340678999p') }
    expect(decode(encodeChinitsuLink(link))).toEqual(link)
  })

  it('omits what is empty', () => {
    expect(encodeChinitsuLink({})).toBe('')
    expect(encodeChinitsuLink({ hand: parseTenhou('1112345678999p') })).toBe('hand=1112345678999p')
  })

  it('drops a hand that is not thirteen tiles, or holds a fifth copy', () => {
    expect(decode('hand=111234567899p').hand).toBeUndefined()
    expect(decode('hand=11111234567899p').hand).toBeUndefined()
    expect(decode('hand=1111123456789p').hand).toBeUndefined()
    expect(decode('seed=x&hand=1111').seed).toBe('x')
  })

  it('keeps a hand that is not a flush — the trainer poses what the link names', () => {
    expect(decode('hand=123m456m789m55p34s').hand).toHaveLength(13)
  })
})
