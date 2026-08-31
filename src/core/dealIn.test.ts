import { describe, expect, it } from 'vitest'
import { assessDiscards, type ThreatView } from './danger'
import {
  combinedDealInRisk,
  combineThreats,
  dealInRisk,
  impliedWaitWidth,
  KOKUSHI_SHARE,
  UNIFORM_PRIOR,
  type DealInRisk,
} from './dealIn'
import { handFromTenhou } from './hand'
import { HOUOU_PRIOR_META } from './hououPrior'
import { NUM_TILE_TYPES, parseTenhou, PIN, type TileId } from './tiles'

function ids(tenhou: string): TileId[] {
  return parseTenhou(tenhou).map((t) => t.id)
}
function visibleOf(...tenhou: string[]): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (const part of tenhou) for (const tile of parseTenhou(part)) seen[tile.id]++
  return seen
}
function threatOf(discards: string, passed = '', seat = 1): ThreatView {
  return { seat, discards: ids(discards), passed: ids(passed) }
}
const NOTHING_SEEN = new Uint8Array(NUM_TILE_TYPES)
const FRESH_RIICHI = threatOf('')

function probabilityOf(risks: DealInRisk[], tenhou: string): number {
  return risks[ids(tenhou)[0]].probability
}

describe('dealInRisk', () => {
  describe('calibration against the source data', () => {
    // The first check to write, and the one that catches an availability term counted twice: a
    // prototype that multiplied the empirical prior by an absolute count of ways-to-hold implied a
    // width of 2.25 kinds instead.
    it('reproduces the measured wait width with nothing visible', () => {
      const risks = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, false)
      // kokushi is not in the source tables, so it widens the model's own answer: it adds
      // `KOKUSHI_SHARE` of the mass, waiting on all thirteen terminals and honours
      const expected = (HOUOU_PRIOR_META.width + 13 * KOKUSHI_SHARE) / (1 + KOKUSHI_SHARE)
      expect(impliedWaitWidth(risks)).toBeCloseTo(expected, 9)
    })

    // An INDEPENDENT check: the prior is built from wait *shape* counts, and `waitByRank` is a
    // different analyzer counting per-tile wait frequency directly over the same database. Their
    // agreeing is evidence the enumeration and the per-bucket division are right; nothing about
    // the model forces it.
    it('matches an independently measured per-rank wait frequency', () => {
      const risks = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, false)
      for (let rank = 1; rank <= 9; rank++) {
        // the source collapses the three suits by "any", and two suits waited at one rank is rare
        const measured = HOUOU_PRIOR_META.waitByRank[rank] / 3
        const model = risks[PIN + rank - 1].probability
        expect(Math.abs(model / measured - 1)).toBeLessThan(0.25)
      }
    })

    it('is a probability for every tile, and honours rank below every number', () => {
      const risks = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, false)
      for (const risk of risks) {
        expect(risk.probability).toBeGreaterThanOrEqual(0)
        expect(risk.probability).toBeLessThanOrEqual(1)
      }
      expect(probabilityOf(risks, '1z')).toBeLessThan(probabilityOf(risks, '1p'))
      expect(probabilityOf(risks, '1p')).toBeLessThan(probabilityOf(risks, '5p'))
    })
  })

  describe('the worked example — 2p and 8p discarded, all four 3p visible, one 1p in hand', () => {
    const threat = threatOf('2p8p')
    const seen = visibleOf('2p', '8p', '3p3p3p3p', '1p')
    const risks = dealInRisk(threat, seen, false)

    it('gives genbutsu exactly zero, with every term crossed out', () => {
      expect(probabilityOf(risks, '2p')).toBe(0)
      expect(probabilityOf(risks, '8p')).toBe(0)
      for (const term of risks[ids('2p')[0]].terms) expect(term.dead).toBeDefined()
    })

    it('leaves 1p a tanki, a shanpon or a kokushi and nothing else — the 3p wall kills the runs', () => {
      const terms = risks[ids('1p')[0]].terms
      const live = terms.filter((term) => term.dead === undefined)
      expect(new Set(live.map((term) => term.shape))).toEqual(
        new Set(['tanki', 'shanpon', 'kokushi']),
      )
      const runs = terms.filter((term) => term.shape === 'ryanmen' || term.shape === 'sanmenchan')
      expect(runs.length).toBeGreaterThan(0)
      for (const term of runs) expect(term.dead).toBe('kabe')
      // a walled-off tile is not a safe tile, which is the whole reason the tier model refuses to
      // call anything below genbutsu safe
      expect(probabilityOf(risks, '1p')).toBeGreaterThan(0)
    })

    it('kills both ryanmen on double-suji 5p and leaves the kanchan, tanki and shanpon alive', () => {
      const terms = risks[ids('5p')[0]].terms
      const ryanmen = terms.filter((term) => term.shape === 'ryanmen')
      expect(ryanmen).toHaveLength(2)
      for (const term of ryanmen) expect(term.dead).toBe('furiten')
      const kanchan = terms.find((term) => term.shape === 'kanchan')
      expect(kanchan?.dead).toBeUndefined()
      expect(kanchan?.holds).toEqual(ids('4p6p'))
      // suji only ever spoke about ryanmen, so the tile drops but stays well clear of zero
      expect(probabilityOf(risks, '5p')).toBeGreaterThan(probabilityOf(risks, '1p'))
    })

    it('ranks a live non-suji tile worst of all, with every run shape still standing', () => {
      const terms = risks[ids('6p')[0]].terms
      // its shanpon partners with 2p and 8p are furiten-dead like every other hypothesis those
      // two discards touch; what makes 6p non-suji is that no shape *waiting on it* is
      for (const term of terms.filter((t) => t.shape !== 'shanpon')) {
        expect(term.dead).toBeUndefined()
      }
      expect(probabilityOf(risks, '6p')).toBeGreaterThan(probabilityOf(risks, '5p'))
      expect(probabilityOf(risks, '6p')).toBeGreaterThan(probabilityOf(risks, '4p'))
    })

    it('names the tiles the threat would be holding, which is what an explanation draws', () => {
      const ryanmen = risks[ids('6p')[0]].terms.filter((term) => term.shape === 'ryanmen')
      expect(ryanmen.map((term) => term.holds)).toEqual([ids('4p5p'), ids('7p8p')])
      for (const term of ryanmen) expect(term.waits).toContain(ids('6p')[0])
    })
  })

  describe('agreement with the tier model', () => {
    // `danger.ts` describes the same game one level coarser, so the two must not contradict each
    // other on cases where the tier is unambiguous.
    it('orders genbutsu < kabe < double suji < non-suji, the same way the tiers do', () => {
      const threat = threatOf('2p8p')
      const seen = visibleOf('2p', '8p', '3p3p3p3p', '1p4p5p6p')
      const hand = handFromTenhou('2p1p5p6p')
      const tiers = assessDiscards(hand, [threat], seen, false)
      const risks = dealInRisk(threat, seen, false)

      const byTier = Object.fromEntries(tiers.map((entry) => [entry.tier, entry.tile]))
      expect(Object.keys(byTier).sort()).toEqual(['doubleSuji', 'genbutsu', 'noChance', 'nonSuji'])
      const ordered = ['genbutsu', 'noChance', 'doubleSuji', 'nonSuji'] as const
      const probabilities = ordered.map((tier) => risks[byTier[tier]].probability)
      for (let i = 1; i < probabilities.length; i++) {
        expect(probabilities[i]).toBeGreaterThan(probabilities[i - 1])
      }
    })
  })

  describe('the wall, and rulesets', () => {
    it('treats a passed tile exactly like one of their own discards', () => {
      const own = dealInRisk(threatOf('5p'), visibleOf('5p'), false)
      const passed = dealInRisk(threatOf('', '5p'), visibleOf('5p'), false)
      expect(passed.map((risk) => risk.probability)).toEqual(own.map((risk) => risk.probability))
    })

    it('kills a shape whose tiles are all face up, and rates one scarce copy as merely rare', () => {
      const walled = dealInRisk(FRESH_RIICHI, visibleOf('4p4p4p4p'), false)
      const scarce = dealInRisk(FRESH_RIICHI, visibleOf('4p4p4p'), false)
      const ryanmen = (risks: DealInRisk[]) =>
        risks[ids('3p')[0]].terms.find(
          (term) => term.shape === 'ryanmen' && term.holds[0] === ids('4p')[0],
        )
      expect(ryanmen(walled)?.dead).toBe('kabe')
      expect(ryanmen(scarce)?.dead).toBeUndefined()
      expect(ryanmen(scarce)!.ways).toBe(4) // one 4p left, four 5p
      expect(probabilityOf(scarce, '3p')).toBeGreaterThan(probabilityOf(walled, '3p'))
    })

    it('under sanma treats 2m-8m as fully visible, so every shape needing one is dead', () => {
      const risks = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, true)
      expect(probabilityOf(risks, '5m')).toBe(0)
      expect(probabilityOf(risks, '1m')).toBeGreaterThan(0)
      // 1m survives only as a tanki, shanpon or kokushi: every run shape needs a 2m or a 3m
      const live = risks[ids('1m')[0]].terms.filter((term) => term.dead === undefined)
      expect(new Set(live.map((term) => term.shape))).toEqual(
        new Set(['tanki', 'shanpon', 'kokushi']),
      )
    })
  })

  describe('the uniform prior', () => {
    /**
     * The check this prior did not have, and the whole of what went wrong without it.
     *
     * It used to weight each hypothesis by the raw number of ways to hold it, which scales as
     * `copies ** (tiles in the shape)`. Shanpon holds four tiles across 561 hypotheses, so it took
     * ~86% of the distribution and every tile on the board came out within a few tenths of a
     * percent of every other: 1m 6.36%, 5m 6.40%, an honour 5.20%. Every assertion this block used
     * to make survived that — `5p > 1p` held by 0.04pp — and so did the whole suite, while the
     * folding trainer's EV grading was quietly telling a reader that a live honour and a genbutsu
     * were two points apart.
     *
     * So the shape of the curve is pinned by *ratios*, not by orderings: an ordering is exactly
     * what a flat distribution can satisfy.
     */
    it('prices the middle of a suit well above the ends, and an honour well below both', () => {
      const risks = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, false, UNIFORM_PRIOR)
      const middle = probabilityOf(risks, '5p')
      const terminal = probabilityOf(risks, '1p')
      const honour = probabilityOf(risks, '1z')

      // a terminal is waited on by strictly fewer shapes than a 5 — no ryanmen reaches it from
      // below, and the penchan that does is the rarest shape there is
      expect(terminal / middle).toBeLessThan(0.8)
      // and an honour is only ever a tanki, a shanpon or the kokushi, which is a different order
      // of magnitude rather than a discount. The old prior put this at 0.81
      expect(honour / middle).toBeLessThan(0.4)
      // rising monotonically from the end of the suit toward its middle
      expect(probabilityOf(risks, '2p')).toBeGreaterThan(terminal)
      expect(probabilityOf(risks, '3p')).toBeGreaterThan(probabilityOf(risks, '2p'))
      expect(probabilityOf(risks, '4p')).toBeGreaterThan(probabilityOf(risks, '3p'))
      // and symmetric about it, since nothing here distinguishes the two ends of a suit
      expect(probabilityOf(risks, '9p')).toBeCloseTo(terminal, 12)
      expect(probabilityOf(risks, '6p')).toBeCloseTo(middle, 12)
    })

    it('implies a plausible number of waits, the same check the measured prior gets', () => {
      const risks = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, false, UNIFORM_PRIOR)
      // a tenpai hand waits on one or two kinds; the old raw-availability weighting implied 2.09,
      // which is more distinct waits than a real riichi hand has
      expect(impliedWaitWidth(risks)).toBeGreaterThan(1.4)
      expect(impliedWaitWidth(risks)).toBeLessThan(2)
    })

    it('disagrees with the measured prior, which is the point of shipping both', () => {
      const measured = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, false)
      const uniform = dealInRisk(FRESH_RIICHI, NOTHING_SEEN, false, UNIFORM_PRIOR)
      // `CLASS_MASS` is stated from riichi reasoning rather than measured, and it states more
      // shanpon and tanki than real hands hold — so an honour still reads as more dangerous than
      // it measures, just no longer as more dangerous than a 5
      expect(probabilityOf(uniform, '1z')).toBeGreaterThan(probabilityOf(measured, '1z'))
      expect(probabilityOf(uniform, '1z')).toBeLessThan(probabilityOf(measured, '5p'))
    })

    it('still gives genbutsu exactly zero', () => {
      const risks = dealInRisk(threatOf('5p'), visibleOf('5p'), false, UNIFORM_PRIOR)
      expect(probabilityOf(risks, '5p')).toBe(0)
    })
  })

  describe('combineThreats', () => {
    const first = dealInRisk(threatOf('2p8p'), visibleOf('2p8p'), false)
    const second = dealInRisk(threatOf('1s9s', '', 2), visibleOf('1s9s'), false)

    it('takes the union, so the combined risk exceeds either threat alone', () => {
      const both = combineThreats([first, second])
      const tile = ids('5s')[0]
      expect(both[tile].probability).toBeGreaterThan(first[tile].probability)
      expect(both[tile].probability).toBeGreaterThan(second[tile].probability)
      expect(both[tile].probability).toBeLessThan(
        first[tile].probability + second[tile].probability,
      )
    })

    it('keeps a tile safe only when it is safe against every threat', () => {
      const both = combineThreats([first, second])
      expect(both[ids('2p')[0]].probability).toBeCloseTo(second[ids('2p')[0]].probability, 12)
      expect(both[ids('2p')[0]].probability).toBeGreaterThan(0)
    })

    it('passes one threat through untouched, and answers 34 zeroes for none at all', () => {
      expect(combineThreats([first])).toBe(first)
      const none = combineThreats([])
      expect(none).toHaveLength(NUM_TILE_TYPES)
      expect(none.every((risk) => risk.probability === 0 && risk.terms.length === 0)).toBe(true)
    })

    it('carries the terms of every threat, each stamped with the seat it belongs to', () => {
      const both = combineThreats([first, second])
      const seats = new Set(both[ids('5s')[0]].terms.map((term) => term.seat))
      expect(seats).toEqual(new Set([1, 2]))
    })
  })

  describe('combinedDealInRisk', () => {
    const alone = threatOf('2p8p')
    const other = threatOf('1s9s', '', 2)
    const seen = visibleOf('2p8p1s9s')

    it('defers to the single-threat answer when there is only one', () => {
      const one = combinedDealInRisk([alone], seen, false)
      const direct = dealInRisk(alone, seen, false)
      expect(one.map((risk) => risk.probability)).toEqual(direct.map((risk) => risk.probability))
      expect(combinedDealInRisk([], seen, false).every((risk) => risk.probability === 0)).toBe(true)
    })

    it('is the product unless the joint path is asked for', () => {
      const product = combineThreats([
        dealInRisk(alone, seen, false),
        dealInRisk(other, seen, false),
      ])
      const combined = combinedDealInRisk([alone, other], seen, false)
      expect(combined.map((risk) => risk.probability)).toEqual(
        product.map((risk) => risk.probability),
      )
    })

    // The measurement that made the joint path opt-in: it costs ~20x the product and moves the
    // answer by a tenth of a point; the design expected sub-millisecond and the opposite sign
    // (`docs/model/limits.md#the-joint-enumeration`).
    it('lands within a tenth of a point of the product, mostly above it', () => {
      const product = combineThreats([
        dealInRisk(alone, seen, false),
        dealInRisk(other, seen, false),
      ])
      const joint = combinedDealInRisk([alone, other], seen, false, undefined, true)
      let above = 0
      for (let id = 0; id < NUM_TILE_TYPES; id++) {
        expect(Math.abs(joint[id].probability - product[id].probability)).toBeLessThan(0.002)
        if (joint[id].probability > product[id].probability) above++
      }
      expect(above).toBeGreaterThan(NUM_TILE_TYPES / 2)
    })

    it('normalises over compatible pairs, so each threat still holds exactly one wait', () => {
      const joint = combinedDealInRisk([alone, other], seen, false, undefined, true)
      const mass = new Map<number, number>()
      const counted = new Set<object>()
      for (const risk of joint) {
        for (const term of risk.terms) {
          if (counted.has(term)) continue
          counted.add(term)
          mass.set(term.seat, (mass.get(term.seat) ?? 0) + term.probability)
        }
      }
      expect(mass.get(1)).toBeCloseTo(1, 9)
      expect(mass.get(2)).toBeCloseTo(1, 9)
    })

    it('keeps a tile genbutsu against both threats at exactly zero', () => {
      const joint = combinedDealInRisk(
        [alone, threatOf('2p8p', '', 2)],
        seen,
        false,
        undefined,
        true,
      )
      expect(probabilityOf(joint, '2p')).toBe(0)
      expect(probabilityOf(joint, '8p')).toBe(0)
    })

    it('takes the product for three threats, where the pair loop would be a cube', () => {
      const three = [alone, other, threatOf('3m7m', '', 3)]
      const product = combineThreats(three.map((threat) => dealInRisk(threat, seen, false)))
      const joint = combinedDealInRisk(three, seen, false, undefined, true)
      expect(joint.map((risk) => risk.probability)).toEqual(product.map((risk) => risk.probability))
    })
  })

  it('is pure: the same board gives the same answer', () => {
    const seen = visibleOf('2p8p3p3p')
    const once = dealInRisk(threatOf('2p8p'), seen, false)
    const twice = dealInRisk(threatOf('2p8p'), seen, false)
    expect(twice.map((risk) => risk.probability)).toEqual(once.map((risk) => risk.probability))
  })
})
