import { describe, expect, it } from 'vitest'
import { handFromTenhou } from '../../core/hand'
import { createMatch } from '../../core/match'
import { createRound, type LogEntry, type RoundOptions } from '../../core/round'
import { HONOR, PIN, parseTenhou, serializeTenhouOrdered } from '../../core/tiles'
import { completeWall, wallWithHand } from '../../core/wall'
import {
  allTiles,
  decodeSituation,
  emptySituation,
  encodeSituation,
  matchOverrides,
  resolveSanma,
} from './urlCodec'

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  calls: true,
  riichi: true,
  wins: true,
}

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
    s.log = [
      {
        kind: 'discard',
        seat: 0,
        tile: { id: HONOR, red: false },
        fromDrawn: false,
        riichi: false,
      },
      {
        kind: 'discard',
        seat: 1,
        tile: { id: PIN + 8, red: false },
        fromDrawn: true,
        riichi: true,
      },
    ] satisfies LogEntry[]
    s.round = 'S'
    s.seat = 'W'
    s.aka = true
    s.sanma = true
    s.kyoku = 3
    s.honba = 2
    s.dealerRepeat = 1
    s.dealer = 2
    s.riichiSticks = 1
    s.points = [24000, 26000, 25000]
    expect(decodeSituation(new URLSearchParams(encodeSituation(s)))).toEqual(s)
  })

  it('omits match-context fields at their createMatch default', () => {
    const s = emptySituation()
    s.kyoku = 1
    s.honba = 0
    s.dealerRepeat = 0
    s.dealer = 0
    s.riichiSticks = 0
    s.points = [25000, 25000, 25000, 25000]
    expect(encodeSituation(s)).toBe('')

    const decoded = decodeSituation(new URLSearchParams(''))
    expect(matchOverrides(decoded)).toEqual({})
    expect(createMatch(false, matchOverrides(decoded))).toEqual(createMatch(false))
  })

  it('round-trips a non-default match context through matchOverrides into createMatch', () => {
    const s = emptySituation()
    s.kyoku = 2
    s.honba = 1
    s.dealer = 1
    const decoded = decodeSituation(new URLSearchParams(encodeSituation(s)))
    expect(createMatch(false, matchOverrides(decoded))).toEqual(
      createMatch(false, { round: 2, honba: 1, dealer: 1 }),
    )
  })

  it('decodes empty params to the empty situation', () => {
    expect(decodeSituation(new URLSearchParams(''))).toEqual(emptySituation())
    expect(encodeSituation(emptySituation())).toBe('')
  })

  it('round-trips the wall exactly', () => {
    const s = emptySituation()
    s.wall = completeWall(parseTenhou('123m'), false, true, 'round-trip-seed')
    const decoded = decodeSituation(new URLSearchParams(encodeSituation(s)))
    expect(decoded.wall).toEqual(s.wall)
  })

  it('allTiles returns the wall', () => {
    const s = emptySituation()
    s.wall = parseTenhou('123m456p')
    expect(allTiles(s)).toEqual(s.wall)
  })

  it('resolveSanma: a full wall length settles it regardless of flag/global', () => {
    expect(resolveSanma(completeWall([], true, false, 'sanma-full'), false, false)).toBe(true)
    expect(resolveSanma(completeWall([], false, false, 'yonma-full'), true, true)).toBe(false)
  })

  it('resolveSanma: a partial wall falls back to the flag, then the global setting', () => {
    const partial = parseTenhou('123m')
    expect(resolveSanma(partial, true, false)).toBe(true)
    expect(resolveSanma(partial, undefined, true)).toBe(true)
    expect(resolveSanma(partial, undefined, false)).toBe(false)
  })

  it('a ?wall= string opens the exact board it names: seat 0 gets exactly the pinned hand', () => {
    const wall = wallWithHand(0, parseTenhou('1112345678999m'), false, true, 'end-to-end-seed')
    const s = emptySituation()
    s.wall = wall

    const decoded = decodeSituation(new URLSearchParams(encodeSituation(s)))
    const state = createRound(decoded.wall, 4, YONMA)

    expect(state.players[0].hand.counts).toEqual(handFromTenhou('1112345678999m').counts)
  })

  it('rejects an invalid wall by name: the wall is emptied and never reaches createRound', () => {
    const decoded = decodeSituation(new URLSearchParams('wall=11111m'))
    expect(decoded.wall).toHaveLength(0)
    // the fifth 1m is wall index 4, which the 4/4/4+1 deal hands to seat 1
    expect(decoded.wallError).toEqual({ zone: 'hand', seat: 1, tile: 0, reason: 'copies' })
  })

  it('a valid full or partial wall carries no wallError', () => {
    const valid = decodeSituation(new URLSearchParams('wall=123456789m'))
    expect(valid.wallError).toBeUndefined()
    expect(valid.wall).toEqual(parseTenhou('123456789m'))
  })
})
