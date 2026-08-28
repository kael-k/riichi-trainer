import { describe, expect, it } from 'vitest'
import type { Payments } from './score'
import { HONOR } from './tiles'
import { createMatch, settleRound, STARTING_POINTS_SANMA, STARTING_POINTS_YONMA } from './match'

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
    const match = createMatch(false, {
      round: 3,
      dealer: 2,
      honba: 1,
      points: [24000, 26000, 25000, 25000],
    })
    expect(match.round).toBe(3)
    expect(match.dealer).toBe(2)
    expect(match.honba).toBe(1)
    expect(match.points).toEqual([24000, 26000, 25000, 25000])
    // untouched defaults still apply
    expect(match.prevalentWind).toBe(HONOR)
    expect(match.riichiSticks).toBe(0)
  })
})

describe('settleRound', () => {
  const YONMA = { sanma: false, format: 'hanchan' as const }
  const TONPUU = { sanma: false, format: 'tonpuu' as const }
  const HANCHAN = { sanma: false, format: 'hanchan' as const }

  it('a dealer win repeats the dealer: repeat and honba up, dealer/round/wind unchanged', () => {
    const match = createMatch(false)
    const payments: Payments = { main: 2000, total: 2000 }
    const { match: next, over } = settleRound(
      match,
      { ended: 'win', win: { seat: 0, from: 1, payments } },
      YONMA,
    )
    expect(next.dealer).toBe(0)
    expect(next.dealerRepeat).toBe(1)
    expect(next.honba).toBe(1)
    expect(next.round).toBe(1)
    expect(next.prevalentWind).toBe(HONOR)
    expect(over).toBe(false)
  })

  it('a non-dealer win rotates the dealer, zeroes honba, advances the round', () => {
    const match = createMatch(false, { honba: 2 })
    const payments: Payments = { main: 1000, total: 1000 }
    const { match: next } = settleRound(
      match,
      { ended: 'win', win: { seat: 1, from: 0, payments } },
      YONMA,
    )
    expect(next.dealer).toBe(1)
    expect(next.dealerRepeat).toBe(0)
    expect(next.honba).toBe(0)
    expect(next.round).toBe(2)
  })

  it('a ron with no sticks on the table conserves points exactly (deltas sum to zero)', () => {
    const match = createMatch(false)
    const payments: Payments = { main: 8000, total: 8000 }
    const { deltas } = settleRound(
      match,
      { ended: 'win', win: { seat: 2, from: 3, payments } },
      YONMA,
    )
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(0)
    expect(deltas[2]).toBe(8000)
    expect(deltas[3]).toBe(-8000)
  })

  it('a non-dealer tsumo charges the dealer double', () => {
    const match = createMatch(false)
    const payments: Payments = { main: 1000, fromDealer: 2000, total: 4000 }
    const { deltas } = settleRound(match, { ended: 'win', win: { seat: 1, payments } }, YONMA)
    expect(deltas[0]).toBe(-2000) // dealer
    expect(deltas[1]).toBe(4000) // winner
    expect(deltas[2]).toBe(-1000)
    expect(deltas[3]).toBe(-1000)
  })

  it('riichi sticks on the table go to the winner and the table clears', () => {
    const match = createMatch(false, { riichiSticks: 2 })
    const payments: Payments = { main: 1000, total: 1000 }
    const { match: next, deltas } = settleRound(
      match,
      { ended: 'win', win: { seat: 0, from: 1, payments } },
      YONMA,
    )
    expect(deltas[0]).toBe(1000 + 2000)
    expect(next.riichiSticks).toBe(0)
  })

  it('an exhaustive draw with two tenpai and two noten pays 1500 each way', () => {
    const match = createMatch(false)
    const { deltas } = settleRound(match, { ended: 'exhaustive', tenpai: [0, 1] }, YONMA)
    expect(deltas).toEqual([1500, 1500, -1500, -1500])
  })

  it('an exhaustive draw with one tenpai and three noten pays 3000 to the one', () => {
    const match = createMatch(false)
    const { deltas } = settleRound(match, { ended: 'exhaustive', tenpai: [0] }, YONMA)
    expect(deltas).toEqual([3000, -1000, -1000, -1000])
  })

  it('an exhaustive draw with the dealer tenpai repeats the dealer', () => {
    const match = createMatch(false)
    const { match: next } = settleRound(match, { ended: 'exhaustive', tenpai: [0, 2] }, YONMA)
    expect(next.dealer).toBe(0)
    expect(next.dealerRepeat).toBe(1)
    expect(next.honba).toBe(1)
  })

  it('an exhaustive draw with the dealer noten rotates the dealer', () => {
    const match = createMatch(false)
    const { match: next } = settleRound(match, { ended: 'exhaustive', tenpai: [1, 2] }, YONMA)
    expect(next.dealer).toBe(1)
    expect(next.dealerRepeat).toBe(0)
    expect(next.honba).toBe(1) // a draw's honba carries forward rather than zeroing
  })

  it('an abort repeats the dealer, bumps honba, and pays nobody', () => {
    const match = createMatch(false)
    const { match: next, deltas } = settleRound(match, { ended: 'abort' }, YONMA)
    expect(deltas).toEqual([0, 0, 0, 0])
    expect(next.dealer).toBe(0)
    expect(next.dealerRepeat).toBe(1)
    expect(next.honba).toBe(1)
  })

  it('a non-dealer win in East 4 ends a tonpuu match', () => {
    const match = createMatch(false, { round: 4, dealer: 0 })
    const payments: Payments = { main: 1000, total: 1000 }
    const { over } = settleRound(
      match,
      { ended: 'win', win: { seat: 1, from: 0, payments } },
      TONPUU,
    )
    expect(over).toBe(true)
  })

  it('a dealer win in East 4 does not end a tonpuu match', () => {
    const match = createMatch(false, { round: 4, dealer: 0 })
    const payments: Payments = { main: 1000, total: 1000 }
    const { over } = settleRound(
      match,
      { ended: 'win', win: { seat: 0, from: 1, payments } },
      TONPUU,
    )
    expect(over).toBe(false)
  })

  it('a non-dealer win in South 4 ends a hanchan', () => {
    const match = createMatch(false, { round: 4, dealer: 0, prevalentWind: HONOR + 1 })
    const payments: Payments = { main: 1000, total: 1000 }
    const { over } = settleRound(
      match,
      { ended: 'win', win: { seat: 1, from: 0, payments } },
      HANCHAN,
    )
    expect(over).toBe(true)
  })

  it('a seat that busts below zero ends the match immediately, whatever the round', () => {
    const match = createMatch(false, { points: [500, 25000, 25000, 25000] })
    const payments: Payments = { main: 8000, total: 8000 }
    const { over } = settleRound(
      match,
      { ended: 'win', win: { seat: 1, from: 0, payments } },
      HANCHAN,
    )
    expect(over).toBe(true)
  })

  it('a win that ends the match collects any outstanding sticks for the winner as usual', () => {
    const match = createMatch(false, {
      round: 4,
      dealer: 0,
      prevalentWind: HONOR + 1,
      riichiSticks: 1,
    })
    const payments: Payments = { main: 1000, total: 1000 }
    const { match: next, over } = settleRound(
      match,
      { ended: 'win', win: { seat: 1, from: 0, payments } },
      HANCHAN,
    )
    expect(over).toBe(true)
    expect(next.riichiSticks).toBe(0)
  })

  it('sticks still on the table at an exhaustive-draw match end go to the leader, not to nobody', () => {
    // South 4, dealer noten so the dealer rotates and the wind runs past hanchan's own end —
    // the one shape that leaves `riichiSticks` untouched by a win (only a win collects them
    // itself; a draw carries them forward, which is what this rule has to catch)
    const match = createMatch(false, {
      round: 4,
      dealer: 0,
      prevalentWind: HONOR + 1,
      riichiSticks: 1,
      points: [10000, 25000, 20000, 39000],
    })
    const { match: next, over } = settleRound(match, { ended: 'exhaustive', tenpai: [1] }, HANCHAN)
    expect(over).toBe(true)
    // seat 3 (39000) stays the clear leader after the tenpai/noten payout (38000) and takes the
    // stray stick on top
    expect(next.points).toEqual([9000, 28000, 19000, 39000])
    expect(next.riichiSticks).toBe(0)
  })

  it('ties for the leftover sticks break to the lowest seat index', () => {
    const match = createMatch(false, {
      round: 4,
      dealer: 0,
      prevalentWind: HONOR + 1,
      riichiSticks: 1,
      points: [25000, 25000, 25000, 25000],
    })
    const { match: next } = settleRound(match, { ended: 'exhaustive', tenpai: [] }, HANCHAN)
    // no tenpai/noten split at 0/4, so the four starting points are still tied — seat 0 wins it
    expect(next.points[0]).toBe(26000)
    expect(next.points.slice(1)).toEqual([25000, 25000, 25000])
  })
})
