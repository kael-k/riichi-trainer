import { describe, expect, it } from 'vitest'
import type { ScoringSituation } from '../../core/generateHand'
import { HONOR, parseTenhou, PIN } from '../../core/tiles'
import { completeWall, wallWithHand } from '../../core/wall'
import { decodeScoringUrl, encodeScoringUrl, encodeScoringWallUrl } from './scoringUrl'

const SITUATION: ScoringSituation = {
  concealed: parseTenhou('234567m456678p33s'),
  melds: [{ kind: 'pon', tiles: parseTenhou('555s') }],
  ctx: {
    round: HONOR + 1,
    seat: HONOR + 2,
    tsumo: true,
    riichi: true,
    doubleRiichi: false,
    ippatsu: true,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    winTile: PIN + 7,
  },
  doraIndicators: [HONOR + 5],
  uraIndicators: [HONOR],
  kita: 2,
  honba: 1,
}

const WALL_OPTIONS = { sanma: false, aka: true, openHands: true, honba: true }

describe('scoringUrl', () => {
  it('round-trips a full situation through the query string', () => {
    const query = encodeScoringUrl(SITUATION, true)
    const decoded = decodeScoringUrl(new URLSearchParams(query))
    expect(decoded.sanma).toBe(true)
    expect(decoded.situation).toEqual(SITUATION)
  })

  it('decodes to a null situation (generate mode) when no wall param is present', () => {
    const decoded = decodeScoringUrl(new URLSearchParams(''))
    expect(decoded.wall).toEqual([])
    expect(decoded.situation).toBeNull()
  })

  it('omits sanma entirely when unset, leaving it undefined on decode', () => {
    const query = encodeScoringUrl(SITUATION)
    const decoded = decodeScoringUrl(new URLSearchParams(query))
    expect(decoded.sanma).toBeUndefined()
  })

  it('round-trips a wall exactly through encodeScoringWallUrl/decodeScoringUrl', () => {
    const wall = completeWall(parseTenhou('123456789m1122z'), false, true, 'scoring-wall-seed')
    const query = encodeScoringWallUrl(wall, WALL_OPTIONS)
    const decoded = decodeScoringUrl(new URLSearchParams(query))
    expect(decoded.wall).toEqual(wall)
    expect(decoded.wallError).toBeUndefined()
    expect(decoded.sanma).toBe(false)
    expect(decoded.aka).toBe(true)
    expect(decoded.calls).toBe(true)
    expect(decoded.honba).toBe(true)
  })

  it('surfaces a wallError and empties wall on an invalid wall= (five copies of a kind)', () => {
    const decoded = decodeScoringUrl(new URLSearchParams('wall=11111m'))
    expect(decoded.wallError).toBeDefined()
    expect(decoded.wallError?.reason).toBe('copies')
    expect(decoded.wall).toEqual([])
  })

  it('a valid short wall prefix decodes with no wallError', () => {
    const prefix = wallWithHand(0, parseTenhou('123456789m1122z'), false, false, 'seed').slice(
      0,
      13,
    )
    const decoded = decodeScoringUrl(
      new URLSearchParams(encodeScoringWallUrl(prefix, WALL_OPTIONS)),
    )
    expect(decoded.wallError).toBeUndefined()
    expect(decoded.wall).toEqual(prefix)
  })
})
