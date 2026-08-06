import { describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, PIN } from '../../core/tiles'
import { decodeScoringUrl, encodeScoringUrl } from './scoringUrl'
import type { ScoringSituation } from '../../core/generateHand'

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

describe('scoringUrl', () => {
  it('round-trips a full situation through the query string', () => {
    const query = encodeScoringUrl(SITUATION, true)
    const decoded = decodeScoringUrl(new URLSearchParams(query))
    expect(decoded.sanma).toBe(true)
    expect(decoded.situation).toEqual(SITUATION)
  })

  it('decodes to a null situation (generate mode) when no hand param is present', () => {
    const decoded = decodeScoringUrl(new URLSearchParams('seed=abc'))
    expect(decoded.seed).toBe('abc')
    expect(decoded.situation).toBeNull()
  })

  it('omits sanma entirely when unset, leaving it undefined on decode', () => {
    const query = encodeScoringUrl(SITUATION)
    const decoded = decodeScoringUrl(new URLSearchParams(query))
    expect(decoded.sanma).toBeUndefined()
  })
})
