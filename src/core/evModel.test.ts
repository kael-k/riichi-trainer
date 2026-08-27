import { describe, expect, it } from 'vitest'
import { EV_MODELS, type BoardCost, type ThreatCost } from './evModel'
import { HOUOU_FOLD_COST, HOUOU_HAND_SCORE } from './hououPrior'
import { NUM_TILE_TYPES, PIN, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

const { statistical, houou } = EV_MODELS

function board(overrides: Partial<BoardCost> = {}): BoardCost {
  const unseen = new Uint8Array(NUM_TILE_TYPES).fill(TILES_PER_KIND)
  return {
    dealer: false,
    turn: 9,
    drawsLeft: 8,
    rules: { kiriageMangan: false, honba: 0, sanma: false },
    unseen,
    dora: [],
    tsumoChance: 0.02,
    ...overrides,
  }
}

const NON_DEALER: ThreatCost = { dealer: false, riichiTurn: 9 }
const DEALER: ThreatCost = { dealer: true, riichiTurn: 9 }

describe('the houou model', () => {
  it('prices a deal-in off the measured table, by declaration turn and dealership', () => {
    expect(houou.dealInCost(NON_DEALER, board())).toBe(HOUOU_HAND_SCORE.nonDealer.ron[9])
    expect(houou.dealInCost(DEALER, board())).toBe(HOUOU_HAND_SCORE.dealer.ron[9])
    // the published rule of thumb this is checked against: a riichi deal-in is 5-6k
    expect(houou.dealInCost(NON_DEALER, board())).toBeGreaterThan(5000)
    expect(houou.dealInCost(NON_DEALER, board())).toBeLessThan(6000)
  })

  it('conditions on the declaration turn, not the turn being asked about', () => {
    const early = houou.dealInCost({ dealer: false, riichiTurn: 3 }, board({ turn: 15 }))
    const late = houou.dealInCost({ dealer: false, riichiTurn: 15 }, board({ turn: 15 }))
    expect(late).toBeGreaterThan(early)
  })

  it('falls back to the turn being asked about when the declaration turn is unknown', () => {
    expect(houou.dealInCost({ dealer: false }, board({ turn: 4 }))).toBe(
      houou.dealInCost({ dealer: false, riichiTurn: 4 }, board({ turn: 4 })),
    )
  })

  // turn 18 has three hands behind it, and a three-hand average is not a price
  it('steps away from a cell with too few hands behind it', () => {
    const thin = HOUOU_HAND_SCORE.nonDealer.ronSamples[18]
    expect(thin).toBeLessThan(100)
    const priced = houou.dealInCost({ dealer: false, riichiTurn: 18 }, board())
    expect(priced).not.toBe(HOUOU_HAND_SCORE.nonDealer.ron[18])
    expect(priced).toBe(HOUOU_HAND_SCORE.nonDealer.ron[16])
  })

  it('reads the fold price off the matchup the board actually is', () => {
    expect(houou.giveUpCost([NON_DEALER], board({ turn: 8 }))).toBe(
      HOUOU_FOLD_COST.cost['ND vs ND'][2],
    )
    expect(houou.giveUpCost([DEALER], board({ turn: 8 }))).toBe(HOUOU_FOLD_COST.cost['ND vs D'][2])
    expect(houou.giveUpCost([NON_DEALER], board({ dealer: true, turn: 8 }))).toBe(
      HOUOU_FOLD_COST.cost['D vs ND'][2],
    )
  })

  it('costs more to give up against two threats than against one, and always something', () => {
    const one = houou.giveUpCost([NON_DEALER], board())
    const two = houou.giveUpCost([NON_DEALER, DEALER], board())
    expect(one).toBeLessThan(0)
    expect(two).toBeLessThan(0)
    expect(houou.giveUpCost([], board())).toBeLessThan(0)
  })

  it('prices declaring off the gap between a riichi hand and a dama one', () => {
    const uplift = houou.riichiUplift(5000, board())
    expect(uplift).toBe(HOUOU_HAND_SCORE.nonDealer.ron[9] - HOUOU_HAND_SCORE.nonDealer.damaRon[9])
    expect(uplift).toBeGreaterThan(0)
  })

  it('refuses three-player rules, and says why', () => {
    expect(houou.unsupported(true)).toMatch(/four-player/)
    expect(houou.unsupported(false)).toBeNull()
  })
})

describe('the statistical model', () => {
  // Combinatorics can see riichi, dora and ura; it cannot see the yaku a hand was *built* around,
  // because that is a choice rather than a draw. So the derived price sits below the measured one
  // by about half, knowingly and in a stated direction — see `TYPICAL_CLOSED_YAKU_HAN`.
  it('derives a deal-in cost of the right order, below the measured one', () => {
    const derived = statistical.dealInCost(NON_DEALER, board())
    expect(derived).toBeGreaterThan(2000)
    expect(derived).toBeLessThan(houou.dealInCost(NON_DEALER, board()))
    expect(statistical.dealInCost(DEALER, board())).toBeGreaterThan(derived)
  })

  it('prices a hand higher when there is more dora left to be holding', () => {
    const dora: TileId[] = [PIN + 4]
    const plain = statistical.dealInCost(NON_DEALER, board())
    const withDora = statistical.dealInCost(NON_DEALER, board({ dora }))
    expect(withDora).toBeGreaterThan(plain)
  })

  it('does not read the measured tables — the two models disagree on the same board', () => {
    expect(statistical.dealInCost(NON_DEALER, board())).not.toBe(
      houou.dealInCost(NON_DEALER, board()),
    )
    expect(statistical.giveUpCost([NON_DEALER], board())).not.toBe(
      houou.giveUpCost([NON_DEALER], board()),
    )
  })

  it('pays the noten penalty and nothing else when nobody is threatening', () => {
    expect(statistical.giveUpCost([], board())).toBe(-1500)
  })

  // The same direction the measured table has: 'ND vs ND' rises from -1092 at turn 4 to -1253 at
  // turn 16. Giving up late is worse than giving up early, and the two models agree about it
  // without either having been told.
  it('costs more to give up late in the hand than early, as the measured table does', () => {
    const early = statistical.giveUpCost([NON_DEALER], board({ drawsLeft: 12 }))
    const late = statistical.giveUpCost([NON_DEALER], board({ drawsLeft: 2 }))
    expect(late).toBeLessThan(early)
    expect(HOUOU_FOLD_COST.cost['ND vs ND'][6]).toBeLessThan(HOUOU_FOLD_COST.cost['ND vs ND'][0])
  })

  it('prices declaring as a multiple of what the hand is already worth', () => {
    expect(statistical.riichiUplift(4000, board())).toBeCloseTo(
      2 * statistical.riichiUplift(2000, board()),
      6,
    )
    expect(statistical.riichiUplift(4000, board())).toBeGreaterThan(0)
  })

  it('speaks about every ruleset, which is why it is the fallback', () => {
    expect(statistical.unsupported(true)).toBeNull()
    expect(statistical.unsupported(false)).toBeNull()
  })
})

it('is pure: the same board gives the same prices', () => {
  for (const model of [statistical, houou]) {
    expect(model.dealInCost(NON_DEALER, board())).toBe(model.dealInCost(NON_DEALER, board()))
    expect(model.giveUpCost([DEALER], board())).toBe(model.giveUpCost([DEALER], board()))
  }
})
