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

describe('winValue — what a seat\u2019s own hand pays when it wins', () => {
  const CLOSED = { dora: 0, closed: true, riichi: false, route: null } as const

  it('is what fills the hole the collapsed chain leaves, so both models can speak above 2 shanten', () => {
    // the whole point: a deep hand used to be worth exactly zero to the win term, whichever model
    // was asked. Neither may answer zero now
    expect(statistical.winValue(CLOSED, board())).toBeGreaterThan(0)
    expect(houou.winValue(CLOSED, board())).toBeGreaterThan(0)
  })

  it('pays a dealer more than a non-dealer, under both', () => {
    for (const model of [statistical, houou]) {
      expect(model.winValue(CLOSED, board({ dealer: true }))).toBeGreaterThan(
        model.winValue(CLOSED, board({ dealer: false })),
      )
    }
  })

  it('collects the honba on the table, the way the exact leaf already does', () => {
    for (const model of [statistical, houou]) {
      const rules = { kiriageMangan: false, honba: 2, sanma: false }
      expect(model.winValue(CLOSED, board({ rules }))).toBe(model.winValue(CLOSED, board()) + 600)
    }
  })

  it('prices a closed hand above an open one at the same turn, under both', () => {
    const open = { dora: 0, closed: false, riichi: false, route: 'yakuhai' } as const
    for (const model of [statistical, houou]) {
      expect(model.winValue(CLOSED, board())).toBeGreaterThan(model.winValue(open, board()))
    }
  })

  it('reads the two models from their own sources, so they disagree about the same hand', () => {
    expect(statistical.winValue(CLOSED, board())).not.toBeCloseTo(
      houou.winValue(CLOSED, board()),
      0,
    )
  })

  describe('the derived one', () => {
    it('is worth more for every dora the hand actually holds', () => {
      const none = statistical.winValue(CLOSED, board())
      const three = statistical.winValue({ ...CLOSED, dora: 3 }, board())
      expect(three).toBeGreaterThan(none)
    })

    it('prices an open hand with no yaku route at nothing at all, because it cannot win', () => {
      const hopeless = { dora: 4, closed: false, riichi: false, route: null } as const
      expect(statistical.winValue(hopeless, board())).toBe(0)
    })

    it('prices a chinitsu route far above a yakuhai one', () => {
      const at = (route: 'chinitsu' | 'yakuhai') =>
        statistical.winValue({ dora: 0, closed: false, riichi: false, route }, board())
      expect(at('chinitsu')).toBeGreaterThan(3 * at('yakuhai'))
    })
  })

  describe('the measured one', () => {
    it('reads the declared column once the hand has declared, and the dama one before', () => {
      const turn = 9
      const dama = houou.winValue(CLOSED, board({ turn }))
      const declared = houou.winValue({ ...CLOSED, riichi: true }, board({ turn }))
      expect(dama).toBe(HOUOU_HAND_SCORE.nonDealer.damaRon[turn])
      expect(declared).toBe(HOUOU_HAND_SCORE.nonDealer.ron[turn])
    })

    it('reads the open column that matches the route it was given', () => {
      const turn = 9
      const at = (route: 'tanyao' | 'honitsu') =>
        houou.winValue({ dora: 0, closed: false, riichi: false, route }, board({ turn }))
      expect(at('tanyao')).toBe(HOUOU_HAND_SCORE.nonDealer.open.tanyao[turn])
      expect(at('honitsu')).toBe(HOUOU_HAND_SCORE.nonDealer.open.honitsu[turn])
    })

    it('sends a hand with no route to the remainder bucket rather than to zero', () => {
      const turn = 9
      const none = houou.winValue(
        { dora: 0, closed: false, riichi: false, route: null },
        board({ turn }),
      )
      expect(none).toBe(HOUOU_HAND_SCORE.nonDealer.open['other open yaku'][turn])
    })

    it('carries a sample count behind every open cell it will answer from', () => {
      // the same `MIN_SAMPLES` guard the fold table needs: a thin cell must step to a neighbour
      // rather than be believed
      for (const seat of [HOUOU_HAND_SCORE.dealer, HOUOU_HAND_SCORE.nonDealer]) {
        for (const key of Object.keys(seat.open) as (keyof typeof seat.open)[]) {
          expect(seat.open[key].length).toBe(seat.openSamples[key].length)
        }
      }
    })
  })
})
