import { describe, expect, it } from 'vitest'
import { EV_MODELS } from './evModel'
import { createMatch } from './match'
import {
  expectedResult,
  rankOdds,
  ranks,
  resultPoints,
  roundIndex,
  totalRounds,
  type Swing,
} from './placement'
import { HONOR } from './tiles'

const { statistical, houou } = EV_MODELS
const YONMA = { kiriageMangan: false, honba: 0, sanma: false }
const SANMA = { kiriageMangan: false, honba: 0, sanma: true }

/** Every seat's swing under one model, at the round given — the shape `ev.ts` builds per call. */
function swingsOf(model: typeof statistical, scores: number[], round: number): Swing[] {
  const rank = ranks(scores)
  return scores.map((_, seat) => model.swing(rank[seat], round, YONMA))
}

describe('resultPoints', () => {
  it('is Tenhou arithmetic: the return score, then uma', () => {
    // 40000 at a 30000 return is +10, and first place adds the +20 uma
    expect(resultPoints(40000, 1, false)).toBe(30)
    expect(resultPoints(10000, 4, false)).toBe(-40)
    // the four ranks' uma cancels, so four seats sharing the pot come out at the oka alone
    const table = [1, 2, 3, 4].map((rank) => resultPoints(25000, rank, false))
    expect(table.reduce((sum, points) => sum + points, 0)).toBe(-20)
  })

  it('follows the ruleset into sanma, where the return score and the uma both change', () => {
    expect(resultPoints(40000, 1, true)).toBe(15)
    expect(resultPoints(40000, 2, true)).toBe(0)
  })
})

describe('roundIndex', () => {
  it('counts East 1 as zero and runs to the end of the hanchan', () => {
    expect(roundIndex(createMatch(false), false)).toBe(0)
    expect(roundIndex(createMatch(false, { prevalentWind: HONOR + 1, round: 4 }), false)).toBe(7)
    expect(totalRounds(false)).toBe(8)
    expect(totalRounds(true)).toBe(6)
  })

  it('clamps rather than running off the end of a model table', () => {
    const past = createMatch(false, { prevalentWind: HONOR + 2, round: 4 })
    expect(roundIndex(past, false)).toBe(totalRounds(false) - 1)
  })
})

describe('rankOdds', () => {
  it('is a distribution', () => {
    const scores = [25000, 31000, 22000, 22000]
    for (const seat of [0, 1, 2, 3]) {
      const odds = rankOdds(scores, swingsOf(houou, scores, 3), seat)
      expect(odds).toHaveLength(4)
      expect(odds.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 9)
      for (const p of odds) expect(p).toBeGreaterThanOrEqual(0)
    }
  })

  it('splits East 1 four ways when nobody is ahead', () => {
    const even = [25000, 25000, 25000, 25000]
    const odds = rankOdds(even, swingsOf(houou, even, 0), 0)
    for (const p of odds) expect(p).toBeCloseTo(0.25, 1)
  })

  it('all but settles the match in South 4', () => {
    const scores = [40000, 20000, 20000, 20000]
    const leader = rankOdds(scores, swingsOf(houou, scores, 7), 0)
    expect(leader[0]).toBeGreaterThan(0.95)
    const last = rankOdds(
      [10000, 30000, 30000, 30000],
      swingsOf(houou, [10000, 30000, 30000, 30000], 7),
      0,
    )
    expect(last[3]).toBeGreaterThan(0.95)
  })

  it('leaves East 1 wide open on the same scores that settle South 4', () => {
    const scores = [40000, 20000, 20000, 20000]
    const early = rankOdds(scores, swingsOf(houou, scores, 0), 0)
    const late = rankOdds(scores, swingsOf(houou, scores, 7), 0)
    expect(early[0]).toBeLessThan(late[0])
    expect(early[0]).toBeGreaterThan(0.4)
  })
})

describe('the placement objective', () => {
  // the whole reason the switch exists: points are linear and placement is not
  it('is worth more to a seat that has something to gain by it', () => {
    const gain = 8000
    const desperate = [10000, 30000, 30000, 30000]
    const comfortable = [40000, 20000, 20000, 20000]
    const value = (scores: number[]): number =>
      expectedResult(
        scores.map((score, seat) => (seat === 0 ? score + gain : score)),
        swingsOf(houou, scores, 7),
        0,
        false,
      ) - expectedResult(scores, swingsOf(houou, scores, 7), 0, false)

    // 8000 points is 8 result points before any rank moves; last place in South 4 gets more than
    // that because the same 8000 also buys a real chance of third
    expect(value(desperate)).toBeGreaterThan(gain / 1000)
    expect(value(comfortable)).toBeLessThan(value(desperate))
  })

  it('prices a seat that cannot lose its place at the score alone', () => {
    const settled = [60000, 15000, 15000, 10000]
    const swings = swingsOf(houou, settled, 7)
    const before = expectedResult(settled, swings, 0, false)
    const after = expectedResult([64000, 15000, 15000, 6000], swings, 0, false)
    expect(after - before).toBeCloseTo(4, 1)
  })
})

describe('the two models derive the same shape from different sources', () => {
  // `plans/EV-5` §2.10's owed derivation, against the measurement it may not read
  it('agrees within a factor on how much a match has left to move, and on how it decays', () => {
    for (const round of [0, 3, 7]) {
      const derived = statistical.swing(1, round, YONMA).stddev
      const measured = houou.swing(1, round, YONMA).stddev
      // the derived side omits yakuman, honba, sticks and dealer repeats, so it is the narrower
      // of the two — a known direction, not a tolerance
      expect(derived).toBeLessThan(measured)
      expect(derived / measured).toBeGreaterThan(0.6)
    }
  })

  it('both narrow as the match runs out, and the measured one narrows faster', () => {
    for (const model of [statistical, houou]) {
      const byRound = [0, 1, 2, 3, 4, 5, 6, 7].map((round) => model.swing(1, round, YONMA).stddev)
      for (let i = 1; i < byRound.length; i++) expect(byRound[i]).toBeLessThan(byRound[i - 1])
    }

    const shape = (model: typeof statistical): number =>
      model.swing(1, 0, YONMA).stddev / model.swing(1, 7, YONMA).stddev
    // the derived side is a sum of independent rounds by construction, so a whole hanchan is
    // exactly sqrt(8) times one round of it
    expect(shape(statistical)).toBeCloseTo(Math.sqrt(8), 2)
    // the measured side narrows further than that — real late rounds carry less variance than a
    // plain random walk says, which is a finding rather than a tolerance: an All Last hand is
    // played by seats who mostly know what they need, and the round ends the moment somebody has
    // it. Nothing in the derived model can see that, and it is why the two disagree most early
    expect(shape(houou)).toBeGreaterThan(shape(statistical))
  })

  it('only the measured side sees a leader regress toward the field', () => {
    expect(houou.swing(1, 3, YONMA).mean).toBeLessThan(0)
    expect(houou.swing(4, 3, YONMA).mean).toBeGreaterThan(0)
    expect(statistical.swing(1, 3, YONMA).mean).toBe(0)
    expect(statistical.swing(4, 3, YONMA).mean).toBe(0)
  })

  it('the derived side follows a three-player table where the measured one may not', () => {
    expect(statistical.swing(1, 0, SANMA).stddev).toBeGreaterThan(0)
    expect(houou.unsupported(true)).not.toBeNull()
  })
})
