import { describe, expect, it } from 'vitest'
import { handFromTenhou } from './hand'
import { discardOutlooks, handOutlook, type ScoringContext } from './probability'
import { shanten } from './shanten'
import { HONOR, NUM_TILE_TYPES, parseTenhou, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

/** Everything the hand itself accounts for, plus `extra` copies of tiles nobody can draw. */
function seenFor(tenhou: string, extra = ''): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (const tile of parseTenhou(tenhou)) seen[tile.id]++
  for (const tile of parseTenhou(extra)) seen[tile.id]++
  return seen
}
function ids(tenhou: string): TileId[] {
  return parseTenhou(tenhou).map((t) => t.id)
}
function poolOf(seen: Uint8Array): number {
  let pool = 0
  for (let id = 0; id < NUM_TILE_TYPES; id++) pool += TILES_PER_KIND - seen[id]
  return pool
}

/** Four sets and a lone 5s: a tanki, the one case the recursion collapses to a closed form. */
const TANKI = '123m456m789m123p5s'
/** Three sets and two pairs: tenpai, shanpon on 1z/2z. */
const SHANPON = '123m456p789s1122z'
const SHANPON_14 = '123m456p789s1122z3z'
/** Two sets, a pair, a partial run and three floaters: 2-shanten, the exact model's ceiling. */
const WIDE = '123m456p78s11z2z5s9m'
const WIDE_14 = '123m456p78s11z2z5s9m9p'
/** Past the ceiling, where the collapsed chain runs instead. */
const FAR = '147m258p369s1234z'
/** About as disconnected as a real deal gets. */
const DEAL = '159m159p159s1234z'

const SCORING: ScoringContext = {
  round: HONOR,
  seat: HONOR,
  doraIndicators: ids('1z'),
  rules: { kiriageMangan: false, honba: 0, sanma: false },
}

describe('handOutlook', () => {
  describe('the closed form it must reproduce', () => {
    // Tenpai on a single kind is sampling without replacement, and it is the one case the whole
    // recursion collapses to something checkable by hand. This pins the recurrence rather than a
    // snapshot of it.
    it.each([1, 3, 6, 9, 15])('matches 1 - product((U-k-j)/(U-j)) over %i draws', (draws) => {
      // four complete sets and a lone 5s: a tanki, and the only tile that finishes it
      const hand = handFromTenhou(TANKI)
      expect(shanten(hand)).toBe(0)
      const seen = seenFor(TANKI)
      const winning = TILES_PER_KIND - seen[ids('5s')[0]]
      const pool = poolOf(seen)

      let missing = 1
      for (let j = 0; j < draws; j++) missing *= (pool - winning - j) / (pool - j)

      const outlook = handOutlook(hand, seen, false, draws)
      expect(outlook.soloWin).toBeCloseTo(1 - missing, 12)
      expect(outlook.exact).toBe(true)
    })

    it('is already tenpai, so tenpai probability is 1 even with no draws left', () => {
      const hand = handFromTenhou(TANKI)
      const outlook = handOutlook(hand, seenFor(TANKI), false, 0)
      expect(outlook.soloTenpai).toBe(1)
      expect(outlook.soloWin).toBe(0)
    })

    it('cannot win on a kind that is entirely face up', () => {
      const hand = handFromTenhou(TANKI)
      const outlook = handOutlook(hand, seenFor(TANKI, '5s5s5s'), false, 18)
      expect(outlook.soloWin).toBe(0)
    })
  })

  describe('monotonicity', () => {
    const hand = handFromTenhou(SHANPON)
    const seen = seenFor(SHANPON)

    it('rises with draws left', () => {
      let previous = -1
      for (const draws of [0, 1, 4, 8, 12, 18]) {
        const outlook = handOutlook(hand, seen, false, draws)
        expect(outlook.soloWin).toBeGreaterThan(previous)
        previous = outlook.soloWin
      }
    })

    it('falls as the winning tiles become visible', () => {
      const open = handOutlook(hand, seen, false, 10).soloWin
      const scarce = handOutlook(hand, seenFor(SHANPON, '2z2z1z'), false, 10).soloWin
      expect(scarce).toBeGreaterThan(0)
      expect(scarce).toBeLessThan(open)
    })

    it('falls as shanten rises', () => {
      const draws = 12
      const shapes = [TANKI, SHANPON, WIDE]
      const outlooks = shapes.map((tenhou) =>
        handOutlook(handFromTenhou(tenhou), seenFor(tenhou), false, draws),
      )
      expect(shapes.map((t) => shanten(handFromTenhou(t)))).toEqual([0, 0, 2])
      expect(outlooks[2].soloWin).toBeLessThan(outlooks[0].soloWin)
      expect(outlooks[2].soloWin).toBeLessThan(outlooks[1].soloWin)
      for (const outlook of outlooks) expect(outlook.soloTenpai).toBeGreaterThanOrEqual(0)
    })

    it('never reports a win it could not have reached tenpai for', () => {
      const outlook = handOutlook(handFromTenhou(WIDE), seenFor(WIDE), false, 10)
      expect(outlook.soloWin).toBeLessThanOrEqual(outlook.soloTenpai)
    })
  })

  describe('pricing the win', () => {
    const tenhou = TANKI

    it('leaves score undefined without a scoring context, and fills it with one', () => {
      const bare = handOutlook(handFromTenhou(tenhou), seenFor(tenhou), false, 10)
      expect(bare.score).toBeUndefined()
      expect(bare.winAtLeast).toBeUndefined()

      const priced = handOutlook(handFromTenhou(tenhou), seenFor(tenhou), false, 10, {
        scoring: SCORING,
      })
      expect(priced.score).toBeGreaterThan(0)
      // menzen tsumo at the very least, so a completed hand always pays something real
      expect(priced.score! / priced.soloWin).toBeGreaterThan(700)
    })

    it('reports the high-value tail as a distribution rather than a mean', () => {
      const priced = handOutlook(handFromTenhou(tenhou), seenFor(tenhou), false, 10, {
        scoring: SCORING,
        thresholds: [0, 2000, 8000, 100000],
      })
      const tail = priced.winAtLeast!
      expect(tail[0]).toBeCloseTo(priced.soloWin, 12)
      for (let i = 1; i < tail.length; i++) expect(tail[i]).toBeLessThanOrEqual(tail[i - 1])
      expect(tail[tail.length - 1]).toBe(0)
    })

    it('prices dora, so the same shape is worth more with an indicator pointing at it', () => {
      const seen = seenFor(tenhou)
      const plain = handOutlook(handFromTenhou(tenhou), seen, false, 10, { scoring: SCORING })
      const dora = handOutlook(handFromTenhou(tenhou), seen, false, 10, {
        scoring: { ...SCORING, doraIndicators: ids('4s') },
      })
      expect(dora.soloWin).toBeCloseTo(plain.soloWin, 12)
      expect(dora.score!).toBeGreaterThan(plain.score!)
    })
  })

  describe('the objective is not a presentation detail', () => {
    it('reports every figure under the policy it was asked to optimise', () => {
      const hand = handFromTenhou(WIDE)
      const seen = seenFor(WIDE)
      const speed = handOutlook(hand, seen, false, 12, { objective: 'win' })
      const width = handOutlook(hand, seen, false, 12, { objective: 'tenpai' })
      // maximising each objective cannot do worse at it than maximising the other one does
      expect(speed.soloWin).toBeGreaterThanOrEqual(width.soloWin)
      expect(width.soloTenpai).toBeGreaterThanOrEqual(speed.soloTenpai)
    })
  })

  describe('the collapsed chain', () => {
    const tenhou = FAR

    it('runs instead of the DP above maxShanten, and says so', () => {
      const hand = handFromTenhou(tenhou)
      expect(shanten(hand)).toBeGreaterThan(2)
      const outlook = handOutlook(hand, seenFor(tenhou), false, 15)
      expect(outlook.exact).toBe(false)
      expect(outlook.score).toBeUndefined()
      expect(outlook.soloWin).toBeGreaterThan(0)
      expect(outlook.soloWin).toBeLessThan(outlook.soloTenpai)
    })

    it('agrees with the exact DP where both can run', () => {
      const hand = handFromTenhou(WIDE)
      expect(shanten(hand)).toBe(2)
      const exact = handOutlook(hand, seenFor(WIDE), false, 12)
      const chain = handOutlook(hand, seenFor(WIDE), false, 12, { maxShanten: 0 })
      expect(chain.exact).toBe(false)
      // it walks one representative path rather than a distribution over them, so it runs high —
      // measured 9-31% over the exact DP across 2-shanten shapes and 8, 12 and 18 draws. A band,
      // never an equality
      expect(chain.soloWin).toBeGreaterThan(exact.soloWin * 0.95)
      expect(chain.soloWin).toBeLessThan(exact.soloWin * 1.5)
    })

    it('is not an approximation at all once the hand is tenpai', () => {
      // with no advances left to guess at, the chain is the same hypergeometric the DP computes
      for (const tenhou of [TANKI, SHANPON]) {
        const hand = handFromTenhou(tenhou)
        const seen = seenFor(tenhou)
        const exact = handOutlook(hand, seen, false, 12)
        const chain = handOutlook(hand, seen, false, 12, { maxShanten: -1 })
        expect(chain.soloWin).toBeCloseTo(exact.soloWin, 12)
      }
    })

    it('is total on a fresh deal, which is where every hand starts', () => {
      const outlook = handOutlook(handFromTenhou(DEAL), seenFor(DEAL), false, 18)
      expect(outlook.soloWin).toBeGreaterThanOrEqual(0)
      expect(outlook.soloWin).toBeLessThanOrEqual(1)
    })
  })

  it('is pure: the same hand gives the same answer', () => {
    const once = handOutlook(handFromTenhou(SHANPON), seenFor(SHANPON), false, 8)
    const twice = handOutlook(handFromTenhou(SHANPON), seenFor(SHANPON), false, 8)
    expect(twice).toEqual(once)
  })

  it('leaves the hand it was given untouched', () => {
    const hand = handFromTenhou(WIDE)
    const before = hand.counts.slice()
    handOutlook(hand, seenFor(WIDE), false, 10)
    expect(hand.counts).toEqual(before)
  })
})

describe('discardOutlooks', () => {
  const tenhou = SHANPON_14
  const hand = handFromTenhou(tenhou)
  const seen = seenFor(tenhou)

  it('answers for every distinct tile in hand, and no others', () => {
    const outlooks = discardOutlooks(hand, seen, false, 10)
    const distinct = new Set(ids(tenhou))
    expect(new Set(outlooks.keys())).toEqual(distinct)
  })

  it('ranks the discard that keeps the hand fastest above one that breaks it', () => {
    const outlooks = discardOutlooks(hand, seen, false, 10)
    const keepPair = outlooks.get(ids('3z')[0])!
    const breakPair = outlooks.get(ids('1z')[0])!
    expect(keepPair.soloWin).toBeGreaterThan(breakPair.soloWin)
  })

  it('leaves the hand it was given untouched', () => {
    const before = hand.counts.slice()
    discardOutlooks(hand, seen, false, 8)
    expect(hand.counts).toEqual(before)
  })

  it('stays inside the measured cost boundary for a 2-shanten ranking', () => {
    const wide = WIDE_14
    const started = performance.now()
    discardOutlooks(handFromTenhou(wide), seenFor(wide), false, 12)
    // measures ~105ms on the machine this was written on. The budget is a guard against an
    // accidental order of magnitude, not a benchmark
    expect(performance.now() - started).toBeLessThan(1500)
  })
})
