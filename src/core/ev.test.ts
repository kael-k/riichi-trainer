import { describe, expect, it } from 'vitest'
import type { SeatView } from './algorithm'
import type { ThreatView } from './danger'
import {
  DEFAULT_EV_SEAT,
  foldEv,
  rankDiscards,
  riichiWorthIt,
  tsumoChance,
  type DiscardEv,
} from './ev'
import { EV_MODELS } from './evModel'
import { handFromTenhou, handToTiles } from './hand'
import { createMatch } from './match'
import { dealInRisk } from './dealIn'
import { HONOR, NUM_TILE_TYPES, PIN, parseTenhou, SOU, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

const { statistical, houou } = EV_MODELS

/** Every hand here is the fourteen-tile mid-turn one, which is what `rankDiscards` is asked. */
const FOURTEEN = '123456789m12344p'
/** Junk in every suit with a few honours to hide behind — the hand that should give up. Not
 *  terminals-and-honours: thirteen orphan kinds is a kokushi tenpai, and the DP prices it as the
 *  yakuman it is. */
const TERMINALS = '147m258p369s11223z'
/** Three runs, a pair and a ryanmen: tenpai on 5s/8s, the hand that should push. */
const TENPAI = '234m234p234s55677s'
/** The same shape on an honour shanpon — four winning tiles instead of six. */
const THIN_TENPAI = '234m234p234s55667z'

function ids(tenhou: string): TileId[] {
  return parseTenhou(tenhou).map((tile) => tile.id)
}

/** A seat mid-turn, holding fourteen tiles, with whatever threats the test names. Everything a
 *  real `seatView` would carry, filled in plainly — `ev.ts` reads the hand, the board and the
 *  threats and nothing else. */
function viewOf(
  tenhou: string,
  threats: ThreatView[] = [],
  overrides: Partial<SeatView> = {},
): SeatView {
  const hand = handFromTenhou(tenhou)
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (const tile of handToTiles(hand)) seen[tile.id]++
  for (const threat of threats) for (const tile of threat.discards) seen[tile]++
  const concealed = handToTiles(hand)
  return {
    seat: 0,
    hand,
    concealed,
    drawn: concealed[concealed.length - 1],
    melds: [],
    river: [],
    riichi: false,
    nuki: 0,
    players: [0, 1, 2, 3].map(() => ({ river: [], melds: [], riichi: false, nuki: 0 })),
    prevalentWind: HONOR,
    seatWind: HONOR + 1,
    dealer: false,
    turn: 8,
    wallLeft: 40,
    doraIndicators: [{ id: SOU + 0, red: false }],
    sanma: false,
    kiriageMangan: false,
    match: createMatch(false),
    seen,
    threats,
    furiten: false,
    ev: DEFAULT_EV_SEAT,
    ...overrides,
  }
}

/** A riichi seat whose river is these tiles. */
function threatOf(discards: string, seat = 1, riichiTurn = 6): ThreatView {
  return { seat, discards: ids(discards), passed: [], riichiTurn }
}

/** The seat as `Algorithm.riichi` sees it: the discard is already made, so the hand is thirteen
 *  tiles — the last one of the string is dropped. */
function declared(tenhou: string, wallLeft: number): SeatView {
  const tiles = parseTenhou(tenhou)
  const view = viewOf(tenhou, [], { wallLeft })
  view.hand.counts[tiles[tiles.length - 1].id]--
  return view
}

/** The unseen pool as `ev.ts` derives it, for a test that has to undo the walk's own discounting. */
function unseenOf(view: SeatView): Uint8Array {
  const unseen = new Uint8Array(NUM_TILE_TYPES)
  for (let id = 0; id < NUM_TILE_TYPES; id++) unseen[id] = TILES_PER_KIND - view.seen[id]
  return unseen
}

function poolOf(view: SeatView): number {
  return unseenOf(view).reduce((total, copies) => total + copies, 0)
}

function evOf(ranked: DiscardEv[], tenhou: string): DiscardEv | undefined {
  return ranked.find((entry) => entry.tile === ids(tenhou)[0])
}

describe('rankDiscards', () => {
  it('adds up: every entry is the sum of its own terms, which is what makes it explainable', () => {
    for (const entry of rankDiscards(viewOf(FOURTEEN), { model: statistical })) {
      const sum = entry.terms.reduce((total, term) => total + term.points, 0)
      expect(entry.ev).toBeCloseTo(sum, 9)
      for (const term of entry.terms)
        expect(term.points).toBeCloseTo(term.probability * term.value, 9)
    }
  })

  // The regression this pins: `Outlook.score` is the *unconditional* expectation, P(win) times
  // what the hand pays when it wins (`plans/EV-1` §4). A term is a probability times what the
  // outcome is *worth*, so pairing `soloWin` with `score` counts P(win) twice and shrinks every
  // push quadratically. Every other test here checks that a row adds up, which the double-count
  // preserved — only the magnitude of `value` catches it.
  it('prices a win at what it pays, not at the expected points — P(win) enters exactly once', () => {
    let checked = 0
    for (const entry of rankDiscards(viewOf(TENPAI), { model: statistical })) {
      const win = entry.terms.find((term) => term.kind === 'win')
      if (!win || entry.outlook?.score === undefined || entry.outlook.soloWin === 0) continue
      // no honba and no sticks on a fresh match, so the value is the conditional win alone
      expect(win.value).toBeCloseTo(entry.outlook.score / entry.outlook.soloWin, 6)
      expect(win.value).toBeGreaterThan(entry.outlook.score)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('prices no deal-in at all when nobody has declared', () => {
    const ranked = rankDiscards(viewOf(FOURTEEN), { model: statistical })
    expect(ranked.length).toBeGreaterThan(0)
    for (const entry of ranked) {
      expect(entry.dealIn).toBe(0)
      expect(entry.terms.some((term) => term.kind === 'dealIn')).toBe(false)
    }
  })

  it('names the seat every deal-in term belongs to', () => {
    const view = viewOf(FOURTEEN, [threatOf('1z2z3z', 1), threatOf('5z6z7z', 2)])
    const ranked = rankDiscards(view, { model: statistical })
    const seats = new Set(
      ranked.flatMap((entry) =>
        entry.terms.filter((term) => term.kind === 'dealIn').map((term) => term.seat),
      ),
    )
    expect(seats.has(1) || seats.has(2)).toBe(true)
  })

  // The reason the candidate set is a union rather than the efficiency prefilter alone: a
  // push/fold decision that never prices the fold option is not a decision.
  it('prices safe tiles as well as fast ones, and both come out of the same ranking', () => {
    const threat = threatOf('1z', 1)
    const view = viewOf(TERMINALS, [threat])
    const ranked = rankDiscards(view, { model: statistical })
    // 1z is in their river, so it cannot deal in
    expect(evOf(ranked, '1z')?.dealIn).toBe(0)
    expect(ranked.some((entry) => entry.dealIn > 0)).toBe(true)
  })

  it('is a total order, so two tiles worth the same never depend on sort stability', () => {
    const view = viewOf(FOURTEEN, [threatOf('1z')])
    const once = rankDiscards(view, { model: statistical }).map((entry) => entry.tile)
    const twice = rankDiscards(view, { model: statistical }).map((entry) => entry.tile)
    expect(twice).toEqual(once)
  })

  it('is pure: the same view gives the same numbers', () => {
    const view = viewOf(FOURTEEN, [threatOf('1z')])
    const once = rankDiscards(view, { model: houou }).map((entry) => entry.ev)
    const twice = rankDiscards(view, { model: houou }).map((entry) => entry.ev)
    expect(twice).toEqual(once)
  })

  // The disagreement is the product: two models that always agreed would not be worth shipping two
  // of. They price the same probabilities differently because they price the same costs
  // differently, and the pure one prices opponents cheap.
  it('answers differently under the two models', () => {
    const view = viewOf(FOURTEEN, [threatOf('1z2z')])
    const pure = rankDiscards(view, { model: statistical })
    const measured = rankDiscards(view, { model: houou })
    expect(measured.map((entry) => entry.ev)).not.toEqual(pure.map((entry) => entry.ev))
  })

  it('prices every held tile when asked to be exhaustive', () => {
    const view = viewOf(FOURTEEN)
    const all = rankDiscards(view, { model: statistical, exhaustive: true })
    const union = rankDiscards(view, { model: statistical })
    expect(all.length).toBeGreaterThan(union.length)
    expect(all.length).toBe(new Set(handToTiles(view.hand).map((tile) => tile.id)).size)
  })
})

describe('the push and fold branches', () => {
  it('folds a hopeless hand against a riichi, and pushes a tenpai one', () => {
    const threat = threatOf('1z2z3z4z')
    const hopeless = viewOf(TERMINALS, [threat])
    const tenpai = viewOf(TENPAI, [threat])
    expect(foldEv(hopeless, { model: houou }).ev).toBeGreaterThan(
      rankDiscards(hopeless, { model: houou })[0].ev,
    )
    expect(rankDiscards(tenpai, { model: houou })[0].ev).toBeGreaterThan(
      foldEv(tenpai, { model: houou }).ev,
    )
  })

  it('throws the safest tile it holds when it folds, and says what that costs', () => {
    const threat = threatOf('1z2z3z')
    const view = viewOf(TERMINALS, [threat])
    const fold = foldEv(view, { model: statistical })
    const risks = dealInRisk(threat, view.seen, false, statistical.prior)
    for (const tile of handToTiles(view.hand)) {
      expect(risks[fold.tile].probability).toBeLessThanOrEqual(risks[tile.id].probability + 1e-12)
    }
    expect(fold.ev).toBeLessThan(0)
    expect(fold.terms.some((term) => term.kind === 'notWinning')).toBe(true)
  })

  it('costs nothing to fold with no threats but the noten penalty', () => {
    const fold = foldEv(viewOf(TERMINALS), { model: statistical })
    expect(fold.ev).toBe(-1500)
  })

  // `plans/EV-3` §5: the price of folding is the whole sequence, not this turn's tile. The turns
  // the hand's own genbutsu cover cost nothing and come first; after that the rate is set by what
  // the unseen pool keeps supplying, and the published betaori band is 3-5% a turn.
  it('prices the fold turn by turn: free while the genbutsu last, then a steady rate', () => {
    const threat = threatOf('1z2z3z')
    const view = viewOf(TERMINALS, [threat], { wallLeft: 48 })
    const fold = foldEv(view, { model: statistical })
    const priced = fold.terms.filter((term) => term.kind === 'dealIn')
    expect(priced.length).toBeGreaterThan(3)

    // the hand holds 1z 2z 3z, all three in their river, so its first turns are genbutsu and are
    // charged nothing at all — a fold with three safe tiles in hand is three turns of breathing
    // room, not a per-turn constant
    const drawsLeft = Math.floor(48 / 4)
    expect(priced.length).toBeLessThan(drawsLeft)

    // every term prices the same deal-in, so the whole sequence lives in the probabilities
    const cost = priced.map((term) => term.points / term.probability)
    expect(cost.every((each) => Math.abs(each - cost[0]) < 1e-9)).toBe(true)

    // and the steady rate, undoing the survival discount the walk applies as it goes
    let alive = 1
    for (const term of priced) {
      const risk = term.probability / alive
      expect(risk).toBeGreaterThan(0.02)
      expect(risk).toBeLessThan(0.06)
      alive *= 1 - term.probability / alive
      alive *=
        1 -
        tsumoChance(
          [dealInRisk(threat, view.seen, false, statistical.prior)],
          unseenOf(view),
          poolOf(view),
        )
    }
  })

  // the half that was missing before: a folding hand draws more safe tiles, so a fatter unseen
  // pool is a cheaper fold even though the hand and the threat are identical
  it('replenishes safe tiles out of the unseen pool', () => {
    const threat = threatOf('1z2z3z')
    const short = viewOf(TERMINALS, [threat], { wallLeft: 12 })
    const long = viewOf(TERMINALS, [threat], { wallLeft: 12 })
    // same number of turns to survive; the only difference is how much of the wall is unaccounted
    // for, which is what the draw can bring
    for (let id = 0; id < NUM_TILE_TYPES; id++) short.seen[id] = TILES_PER_KIND
    for (const tile of handToTiles(short.hand)) short.seen[tile.id] = TILES_PER_KIND
    expect(foldEv(long, { model: statistical }).ev).toBeGreaterThan(
      foldEv(short, { model: statistical }).ev,
    )
  })

  // `plans/EV-3` §2's `P_exhaustive × tenpai_payment`, which `giveUpCost` cannot carry: it is the
  // *give-up* price, and a hand that has given up is noten by construction. A pushing hand that
  // does not win may still be tenpai when the wall runs out, and then the penalty is collected
  // rather than paid — a swing of twice the penalty against what `notWinning` already charged.
  it('collects the tenpai payment on the push branch, and never on the fold', () => {
    const view = viewOf(TENPAI)
    const entry = rankDiscards(view, { model: statistical })[0]
    const tenpai = entry.terms.find((term) => term.kind === 'tenpai')
    expect(tenpai).toBeDefined()
    expect(tenpai!.value).toBe(3000)
    expect(tenpai!.probability).toBeGreaterThan(0)
    expect(tenpai!.probability).toBeLessThan(1)
    expect(foldEv(view, { model: statistical }).terms.some((t) => t.kind === 'tenpai')).toBe(false)
  })
})

describe('the objective', () => {
  /** South 4, and this seat is last by a mile — where placement and points stop agreeing. */
  function allLast(tenhou: string, threats: ThreatView[] = []): SeatView {
    return viewOf(tenhou, threats, {
      match: createMatch(false, {
        prevalentWind: HONOR + 1,
        round: 4,
        points: [8000, 32000, 30000, 30000],
      }),
    })
  }

  it('still adds up: every entry is the sum of its own terms in either currency', () => {
    const view = allLast(FOURTEEN, [threatOf('1z2z3z')])
    for (const objective of ['points', 'placement'] as const) {
      for (const entry of rankDiscards(view, { model: statistical, objective })) {
        const sum = entry.terms.reduce((total, term) => total + term.points, 0)
        expect(entry.ev).toBeCloseTo(sum, 9)
        for (const term of entry.terms)
          expect(term.points).toBeCloseTo(term.probability * term.value, 9)
      }
    }
  })

  it('reports in the currency it was asked for, and they are not the same number', () => {
    const view = allLast(TENPAI)
    const points = rankDiscards(view, { model: statistical, objective: 'points' })[0]
    const placement = rankDiscards(view, { model: statistical, objective: 'placement' })[0]
    // result points run to a few tens over a whole hanchan where hand points run to thousands
    expect(Math.abs(placement.ev)).toBeLessThan(Math.abs(points.ev) / 10)
  })

  // the reason a deal-in term carries its seat: under placement the same points lost to the seat
  // above you and to the seat below you are two different decisions
  it('cares which seat it deals into, but only under placement', () => {
    const above = allLast(FOURTEEN, [threatOf('1z2z3z', 1)])
    const below = allLast(FOURTEEN, [threatOf('1z2z3z', 3)])
    const dealInOf = (view: SeatView, objective: 'points' | 'placement'): number => {
      const ranked = rankDiscards(view, { model: statistical, objective })
      const term = ranked.flatMap((entry) => entry.terms).find((each) => each.kind === 'dealIn')
      return term!.value
    }
    expect(dealInOf(above, 'points')).toBeCloseTo(dealInOf(below, 'points'), 9)
    expect(dealInOf(above, 'placement')).not.toBeCloseTo(dealInOf(below, 'placement'), 6)
  })

  it('leaves the points objective exactly where it was', () => {
    const view = viewOf(FOURTEEN, [threatOf('1z2z3z')])
    const implicit = rankDiscards(view, { model: statistical })
    const explicit = rankDiscards(view, { model: statistical, objective: 'points' })
    expect(explicit.map((entry) => [entry.tile, entry.ev])).toEqual(
      implicit.map((entry) => [entry.tile, entry.ev]),
    )
  })
})

describe('the riichi declaration', () => {
  it('declares on a good wait with the hand still to run', () => {
    expect(riichiWorthIt(declared(TENPAI, 60), { model: houou })).toBe(true)
  })

  it('will not pay a stick the hand has no time left to win back', () => {
    expect(riichiWorthIt(declared(TENPAI, 4), { model: houou })).toBe(false)
  })

  // A KNOWN GAP, pinned here so it is a recorded limit rather than a surprise: this hand has no
  // yaku at all without riichi, so declining leaves it unable to win by ron. The model compares
  // the declaration against a dama branch it prices as if dama could win, because nothing in
  // `Outlook` says whether the hand has a yaku of its own. Real play declares here.
  it('declines a thin wait even when the hand has no yaku without the declaration', () => {
    expect(riichiWorthIt(declared(THIN_TENPAI, 60), { model: houou })).toBe(false)
  })

  // The model whose uplift actually reads the hand value — `houou`'s is a measured points
  // difference that ignores its argument, so the three tests above cannot see whether the value
  // handed to `riichiUplift` is the conditional one or P(win) times it.
  //
  // This hand pays 10 633 when it lands (sanshoku + pinfu + tsumo + dora), so even the last draw
  // of the wall is worth a 1000 stick: 7.4% of it clears the stick with room to spare. That is the
  // discriminating case — pairing `soloWin` with the unconditional `score` priced the hand at 784
  // instead of 10 633 and declined here.
  it('declares under the statistical model even on the last draw, for a hand worth 10k', () => {
    expect(riichiWorthIt(declared(TENPAI, 60), { model: statistical })).toBe(true)
    expect(riichiWorthIt(declared(TENPAI, 4), { model: statistical })).toBe(true)
  })
})

describe('tsumoChance', () => {
  it('is the chance a threat draws one of its own waits, and rises with a second threat', () => {
    const unseen = new Uint8Array(NUM_TILE_TYPES).fill(TILES_PER_KIND)
    let pool = 0
    for (const count of unseen) pool += count
    const seen = new Uint8Array(NUM_TILE_TYPES)
    const one = dealInRisk(threatOf('1z'), seen, false, statistical.prior)
    const two = dealInRisk(threatOf('9p', 2), seen, false, statistical.prior)
    const single = tsumoChance([one], unseen, pool)
    const double = tsumoChance([one, two], unseen, pool)
    expect(single).toBeGreaterThan(0)
    expect(single).toBeLessThan(0.1)
    expect(double).toBeGreaterThan(single)
    expect(tsumoChance([], unseen, pool)).toBe(0)
  })
})

it('leaves the hand exactly as it found it', () => {
  const view = viewOf(FOURTEEN, [threatOf('1z')])
  const before = Array.from(view.hand.counts)
  rankDiscards(view, { model: statistical })
  foldEv(view, { model: statistical })
  expect(Array.from(view.hand.counts)).toEqual(before)
  void PIN
})
