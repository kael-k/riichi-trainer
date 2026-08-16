import { describe, expect, it } from 'vitest'
import { HONOR } from './tiles'
import { createMatch, STARTING_POINTS_SANMA, STARTING_POINTS_YONMA } from './match'

describe('createMatch', () => {
  it('defaults to East 1, no honba/sticks/repeat, dealer seat 0', () => {
    const match = createMatch(false)
    expect(match.prevalentWind).toBe(HONOR)
    expect(match.round).toBe(1)
    expect(match.honba).toBe(0)
    expect(match.dealerRepeat).toBe(0)
    expect(match.dealer).toBe(0)
    expect(match.riichiSticks).toBe(0)
  })

  it('starts yonma at 25000 per seat, four seats', () => {
    const match = createMatch(false)
    expect(match.points).toEqual([25000, 25000, 25000, 25000])
    expect(STARTING_POINTS_YONMA).toBe(25000)
  })

  it('starts sanma at 35000 per seat, three seats', () => {
    const match = createMatch(true)
    expect(match.points).toEqual([35000, 35000, 35000])
    expect(STARTING_POINTS_SANMA).toBe(35000)
  })

  it('applies overrides on top of the defaults', () => {
    const match = createMatch(false, { round: 3, dealer: 2, honba: 1, points: [24000, 26000, 25000, 25000] })
    expect(match.round).toBe(3)
    expect(match.dealer).toBe(2)
    expect(match.honba).toBe(1)
    expect(match.points).toEqual([24000, 26000, 25000, 25000])
    // untouched defaults still apply
    expect(match.prevalentWind).toBe(HONOR)
    expect(match.riichiSticks).toBe(0)
  })
})
