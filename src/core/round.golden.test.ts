import { describe, expect, it } from 'vitest'
import { createMatch } from './match'
import { HONOR } from './tiles'
import { playRound, type RoundEvent, type RoundOptions } from './round'

/**
 * Regression net for the seat-algorithm refactor (PLAN-seat-algorithms.md). Every seeded match's
 * whole event stream is hashed; an unrelated mechanical rename must reproduce every hash bit for
 * bit. T3 is the one commit allowed to move these — it changes what `defense`/`efficiency`
 * actually decide, and regenerates the table below in the same commit.
 */

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  calls: true,
  riichi: true,
  wins: true,
}

const SANMA: RoundOptions = { ...YONMA, sanma: true, match: createMatch(true) }

function serialize(events: RoundEvent[]): string {
  return events
    .map((e) => {
      switch (e.kind) {
        case 'draw':
          return `draw:${e.seat}:${e.tile.id}${e.tile.red ? 'r' : ''}`
        case 'discard':
          return `discard:${e.seat}:${e.tile.id}${e.tile.red ? 'r' : ''}${e.tile.tsumogiri ? 't' : ''}${e.tile.riichi ? 'R' : ''}`
        case 'riichi':
          return `riichi:${e.seat}`
        case 'call':
          return `call:${e.seat}:${e.from}:${e.meld.kind}:${e.meld.tiles.map((t) => t.id).join(',')}`
        case 'win':
          return `win:${e.win.seat}:${e.win.from ?? 'tsumo'}:${e.win.score.payments.total}:${e.win.score.yaku.map((y) => y.name).join(',')}`
        case 'exhaustive':
          return 'exhaustive'
        case 'abort':
          return `abort:${e.seat}:${e.reason}`
      }
    })
    .join('|')
}

/** cyrb53 — small, dependency-free, good enough distribution for a frozen-value regression test. */
function hash(str: string): string {
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

const SEEDS = Array.from({ length: 20 }, (_, i) => `golden-${i}`)

// tsconfig.app.json carries no Node types (it's the browser app config); vitest runs this file
// under Node regardless, so `process` exists at runtime even though the app config doesn't know it.
declare const process: { env: Record<string, string | undefined> }

/** Frozen event streams. Regenerate with `GENERATE_GOLDEN=1 npx vitest run
 *  src/core/round.golden.test.ts --disable-console-intercept` and paste the printed table back in
 *  here — a change that has to move these says so in its own commit. Three have: T3 of the
 *  seat-algorithm refactor (it changed what `defense`/`efficiency` decide), the move to real
 *  4/4/4+1 dealing (every seat is dealt different tiles off the same wall), and cutting the dead wall
 *  into real stacks (ADR-0028, which moves which tiles are dora and which ura pays out). */
const GOLDEN: Record<string, [yonma: string, sanma: string]> = {
  'golden-0': ['1771f2e19c0e5bf8', 'f8f21d751959f3d1'],
  'golden-1': ['4047a43d61d584f0', '66d6d8dde8f00eaa'],
  'golden-2': ['41b64dafd8de6987', 'b2b1a21d8d9e1e52'],
  'golden-3': ['bb468b2afb281212', '093d886952bc7b19'],
  'golden-4': ['afc54c91dc9d069a', '2a852d9026a370d5'],
  'golden-5': ['2a79119f8bea1b22', '427c24dfbe769e35'],
  'golden-6': ['3173e588cf15f213', '229f61d5553ffa7b'],
  'golden-7': ['eca7cd5f289ec8ab', '0c18e1cc5162567e'],
  'golden-8': ['37046f5637bdbdff', 'f0caa9459c793f57'],
  'golden-9': ['d4813c6b02bcfeff', '05b752de4cbfb3c2'],
  'golden-10': ['939714d757dc4101', '0fb2bd027169bd11'],
  'golden-11': ['1d199abe707275f6', '867993f028ccac47'],
  'golden-12': ['664af11d0925dde4', '3ec4629f54071bd0'],
  'golden-13': ['d16d65d947b9955d', 'e3e6ef10c6a82b36'],
  'golden-14': ['95b5ade0a11929f6', '01ed69f34db9fbde'],
  'golden-15': ['5cac3039e5faffab', '9f33c6ed50ab298c'],
  'golden-16': ['d9ad2a6b42c5f843', '4a34f4e9728fe8e3'],
  'golden-17': ['e387e2fcea924abf', 'cd9b62651ad55b5f'],
  'golden-18': ['098ff6ac78118d20', 'a48703b94847bfad'],
  'golden-19': ['62be2ff8e1e0537f', 'f98026bd1740656d'],
}

/**
 * One frozen event stream per EV model, on the same wall the divergence tests use.
 *
 * `plans/EV-5` §1.9 asks that `EV_FAST_CANDIDATES` and `EV_SAFE_CANDIDATES` — how many tiles reach
 * the DP, and from which end of the hand — be versioned rather than tuned casually, because
 * changing either changes which discards an `'ev'` seat makes. Until this table existed nothing
 * pinned them: the tests below check that an EV seat *differs* from `efficiency` and from the
 * other model, and every value of K and J satisfies that.
 *
 * Unlike `GOLDEN`, these are expected to move whenever the identity in `core/ev.ts` changes on
 * purpose — they are a "say so in the commit" net, not an invariant. Regenerate with the same
 * `GENERATE_GOLDEN=1` run.
 */
const EV_GOLDEN: Record<'statistical' | 'houou', string> = {
  statistical: 'bb468b2afb281212',
  houou: '824333eb044ca5f5',
}

describe('match golden determinism', () => {
  if (process.env.GENERATE_GOLDEN) {
    it('prints the golden table', () => {
      const lines = SEEDS.map((seed) => {
        const yonma = hash(serialize(playRound(seed, 4, YONMA).events))
        const sanma = hash(serialize(playRound(seed, 3, SANMA).events))
        return `  '${seed}': ['${yonma}', '${sanma}'],`
      })
      const ev = (['statistical', 'houou'] as const).map((model) => {
        const options: RoundOptions = {
          ...YONMA,
          algorithms: ['ev'],
          ev: [{ model, objective: 'points' }],
        }
        return `  ${model}: '${hash(serialize(playRound('golden-3', 4, options).events))}',`
      })
      console.log([...lines, '', 'EV_GOLDEN:', ...ev].join('\n'))
      expect(true).toBe(true)
    })
    return
  }

  it.each(SEEDS)('%s reproduces its frozen event-stream hash', (seed) => {
    const [wantYonma, wantSanma] = GOLDEN[seed]
    expect(hash(serialize(playRound(seed, 4, YONMA).events))).toBe(wantYonma)
    expect(hash(serialize(playRound(seed, 3, SANMA).events))).toBe(wantSanma)
  })

  /**
   * The other half of the guarantee. The frozen hashes above say a new algorithm changed nothing
   * for the seats that were not asked to run it; this says the new algorithm is genuinely deciding
   * rather than quietly falling through to `efficiency` — a seeded wall played with one `'ev-*'`
   * seat must diverge from the same wall played without one.
   *
   * Both models are checked, because two models that always chose the same tile would not be worth
   * shipping two of.
   */
  it.each(['statistical', 'houou'] as const)('an ev seat on %s plays a different hand', (model) => {
    const seed = 'golden-0'
    const evSeat: RoundOptions = {
      ...YONMA,
      algorithms: ['ev'],
      ev: [{ model, objective: 'points' }],
    }
    const played = hash(serialize(playRound(seed, 4, evSeat).events))
    expect(played).not.toBe(GOLDEN[seed][0])
    // and it is still deterministic: same seed, same seat, same hand
    expect(hash(serialize(playRound(seed, 4, evSeat).events))).toBe(played)
  })

  it('the two EV models do not play the same hand as each other', () => {
    const seed = 'golden-3'
    const evSeat = (model: 'statistical' | 'houou'): RoundOptions => ({
      ...YONMA,
      algorithms: ['ev'],
      ev: [{ model, objective: 'points' }],
    })
    const pure = hash(serialize(playRound(seed, 4, evSeat('statistical')).events))
    const measured = hash(serialize(playRound(seed, 4, evSeat('houou')).events))
    expect(measured).not.toBe(pure)
    // and each is the hand its own constants say it is — this is where `EV_GOLDEN` does its work.
    // `statistical` happens to land on `efficiency`'s line for this wall; that is a coincidence of
    // one seed, not a fallthrough, which the row above proves on `golden-0`.
    expect(pure).toBe(EV_GOLDEN.statistical)
    expect(measured).toBe(EV_GOLDEN.houou)
  })

  /**
   * The other half of the cross product, and the reason the model moved off `SeatAlgorithm`: a
   * seat playing for placement is the same decider on the same prices, and it must still reach a
   * different hand — otherwise the objective is a label rather than a switch.
   *
   * The board is South 4 with this seat **leading**, which is where the two currencies were
   * measured to disagree. Behind, they do not: a hopeless seat pushes under both, because points
   * already say a hand worth nothing costs nothing to chase. A lead is what placement can protect
   * and points cannot see — 44000 with three seats behind is a first place worth more than any
   * hand on the table, and the seat starts declining risk it would otherwise take.
   *
   * The two seeds are a **re-scan, not a constant**: which walls happen to divide the two
   * currencies is a property of the arithmetic, so a deliberate change to the identity moves them.
   * `golden-12`/`golden-19` were the pair before the win term stopped counting `P(win)` twice;
   * `golden-2`/`golden-6` are the pair after, from the same twenty-seed sweep. What the test pins
   * is the claim — the objective is a switch, not a label — never these particular walls.
   */
  it('an ev seat playing for placement does not play the same hand as one playing for points', () => {
    const allLast = createMatch(false, {
      prevalentWind: HONOR + 1,
      round: 4,
      points: [44000, 12000, 12000, 32000],
    })
    const evSeat = (objective: 'points' | 'placement'): RoundOptions => ({
      ...YONMA,
      match: allLast,
      algorithms: ['ev'],
      ev: [{ model: 'houou', objective }],
    })
    const diverged = ['golden-2', 'golden-6'].filter(
      (seed) =>
        hash(serialize(playRound(seed, 4, evSeat('placement')).events)) !==
        hash(serialize(playRound(seed, 4, evSeat('points')).events)),
    )
    expect(diverged).toEqual(['golden-2', 'golden-6'])
  })
})
