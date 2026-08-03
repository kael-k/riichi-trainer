import { describe, expect, it } from 'vitest'
import { parseTenhou, serializeTenhou, tileName, isTerminal, isTerminalOrHonor } from './tiles'

describe('parseTenhou', () => {
  it('parses a mixed hand', () => {
    const tiles = parseTenhou('123m456p789s11z')
    expect(tiles.map((t) => tileName(t.id))).toEqual([
      '1m',
      '2m',
      '3m',
      '4p',
      '5p',
      '6p',
      '7s',
      '8s',
      '9s',
      'E',
      'E',
    ])
  })

  it('parses red fives as id 4/13/22 with red flag', () => {
    const tiles = parseTenhou('0m0p0s')
    expect(tiles).toEqual([
      { id: 4, red: true },
      { id: 13, red: true },
      { id: 22, red: true },
    ])
  })

  it('parses all seven honor kinds', () => {
    const tiles = parseTenhou('1234567z')
    expect(tiles.map((t) => tileName(t.id))).toEqual(['E', 'S', 'W', 'N', 'haku', 'hatsu', 'chun'])
  })

  it('returns empty array for empty input', () => {
    expect(parseTenhou('')).toEqual([])
  })
})

describe('serializeTenhou', () => {
  it('round-trips a parsed hand', () => {
    const input = '123m456p789s11z'
    expect(serializeTenhou(parseTenhou(input))).toBe(input)
  })

  it('serializes red fives as 0', () => {
    expect(serializeTenhou(parseTenhou('0m'))).toBe('0m')
  })

  it('sorts tiles within a suit regardless of input order', () => {
    expect(serializeTenhou(parseTenhou('321m'))).toBe('123m')
  })

  it('omits empty suit groups', () => {
    expect(serializeTenhou(parseTenhou('11z'))).toBe('11z')
  })
})

describe('isTerminal / isTerminalOrHonor', () => {
  it('flags 1 and 9 of each suit as terminal', () => {
    expect(isTerminal(0)).toBe(true) // 1m
    expect(isTerminal(8)).toBe(true) // 9m
    expect(isTerminal(4)).toBe(false) // 5m
    expect(isTerminal(27)).toBe(false) // honor is not "terminal"
  })

  it('flags terminals and honors together', () => {
    expect(isTerminalOrHonor(0)).toBe(true)
    expect(isTerminalOrHonor(8)).toBe(true)
    expect(isTerminalOrHonor(27)).toBe(true)
    expect(isTerminalOrHonor(4)).toBe(false)
  })
})
