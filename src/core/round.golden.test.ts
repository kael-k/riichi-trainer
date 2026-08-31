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
        // an own-turn action was invisible to this hash until an algorithm could take one
        //: an `'ev'` seat's kans would otherwise move `EV_GOLDEN` not at all
        case 'kita':
          return `kita:${e.seat}`
        case 'ankan':
          return `ankan:${e.seat}:${e.tile}`
        case 'kakan':
          return `kakan:${e.seat}:${e.tile}`
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
 *  here — a change that has to move these says so in its own commit. Four have: T3 of the
 *  seat-algorithm refactor (it changed what `defense`/`efficiency` decide), the move to real
 *  4/4/4+1 dealing (every seat is dealt different tiles off the same wall), cutting the dead wall
 *  into real stacks (which moves which tiles are dora and which ura pays out), and the
 *  turn seam.
 *
 *  **The fourth move is the sanma column alone, and it is not a decision change.** Every one of
 *  the forty seeded rounds plays exactly the tiles it played before; what moved is that an AI
 *  seat's own kita now goes through `callKita` and so raises the `'kita'` event a manual seat's
 *  pull always did — invisible to this hash until `serialize` above learned to spell it. The
 *  correctness fix the seam carried (a tsumo is now priced on the drawn tile, before any kita
 *  spends it) fired on **none** of the twenty walls, which is worth knowing: no seeded sanma hand
 *  ever had a kita competing with a tsumo. */
const GOLDEN: Record<string, [yonma: string, sanma: string]> = {
  'golden-0': ['1771f2e19c0e5bf8', '8a49ea858dd3ee22'],
  'golden-1': ['4047a43d61d584f0', 'cb12eb6c48b69292'],
  'golden-2': ['41b64dafd8de6987', '0848579437debaa9'],
  'golden-3': ['bb468b2afb281212', '81038a99e244d0fa'],
  'golden-4': ['afc54c91dc9d069a', '78a1694797b8d6ca'],
  'golden-5': ['2a79119f8bea1b22', '427c24dfbe769e35'],
  'golden-6': ['3173e588cf15f213', '482da96e1005e2f2'],
  'golden-7': ['eca7cd5f289ec8ab', 'a152ce5cc699f818'],
  'golden-8': ['37046f5637bdbdff', '469f4b4b944ac8fe'],
  'golden-9': ['d4813c6b02bcfeff', '31bd8844e96fcaf6'],
  'golden-10': ['939714d757dc4101', 'f0faef8cf752794a'],
  'golden-11': ['1d199abe707275f6', '75c57dcccef83fe7'],
  'golden-12': ['664af11d0925dde4', '3c4ade876fa0a6f4'],
  'golden-13': ['d16d65d947b9955d', '4e3b023ee012b237'],
  'golden-14': ['95b5ade0a11929f6', '2523d073837811e1'],
  'golden-15': ['5cac3039e5faffab', '5ee2df9821e265c2'],
  'golden-16': ['d9ad2a6b42c5f843', '02a95faa3b120816'],
  'golden-17': ['e387e2fcea924abf', 'd2f9740eca98f15a'],
  'golden-18': ['098ff6ac78118d20', '0ddc8b802d748cb6'],
  'golden-19': ['62be2ff8e1e0537f', '3214d0ee34a3f8e9'],
}

/**
 * One frozen event stream per EV model, on the same wall the divergence tests use.
 *
 * `EV_FAST_CANDIDATES` and `EV_SAFE_CANDIDATES` — how many tiles reach
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

// Neither moved for the turn seam, and that is a fact about this one wall rather than about the
// kan rule: `golden-3` deals no seat a concealed quad, and `YONMA` leaves `calledKan` off, so
// there was never a legal kan for either model to price. What the rule does when there *is* one
// is `round.test.ts`'s two `'ev'` kan tests.
//
// Neither moved for pricing the claim gate either, and that is the same kind of fact. `calledKan`
// is off here so no minkan is ever a candidate, and on this one wall the priced answer to every
// call the seat was offered is the answer `chooseCall` already gave — a measured ~2.4 call
// opportunities a hand leaves plenty of walls where the two never part. The tests that pin the
// difference name their own boards; this table pins determinism, and it still does.

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
   * The seeds are a **re-scan, not a constant**: which walls happen to divide the two currencies
   * is a property of the arithmetic, so a deliberate change to the identity moves them.
   * `golden-12`/`golden-19` were the pair before the win term stopped counting `P(win)` twice;
   * `golden-2`/`golden-6` after that; `golden-2`/`golden-8` after every decision point was priced;
   * `golden-2`/`golden-6`/`golden-16` since the candidate union stopped padding a quiet board with
   * its two lowest tile ids and a tie stopped resolving toward 1m. Each is the whole twenty-seed
   * sweep re-run. What the test pins is the claim — the objective is a switch, not a label — never
   * these particular walls.
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
    const diverged = ['golden-2', 'golden-6', 'golden-16'].filter(
      (seed) =>
        hash(serialize(playRound(seed, 4, evSeat('placement')).events)) !==
        hash(serialize(playRound(seed, 4, evSeat('points')).events)),
    )
    expect(diverged).toEqual(['golden-2', 'golden-6', 'golden-16'])
  })
})
