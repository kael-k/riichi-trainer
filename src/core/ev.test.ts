import { describe, expect, it } from 'vitest'
import type { SeatView } from './algorithm'
import type { ThreatView } from './danger'
import { foldEv, rankDiscards, riichiWorthIt, tsumoChance, type DiscardEv } from './ev'
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
    match: createMatch(false),
    seen,
    threats,
    furiten: false,
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

function evOf(ranked: DiscardEv[], tenhou: string): DiscardEv | undefined {
  return ranked.find((entry) => entry.tile === ids(tenhou)[0])
}

describe('rankDiscards', () => {
  it('adds up: every entry is the sum of its own terms, which is what makes it explainable', () => {
    for (const entry of rankDiscards(viewOf(FOURTEEN), { model: statistical })) {
      const sum = entry.terms.reduce((total, term) => total + term.points, 0)
      expect(entry.ev).toBeCloseTo(sum, 9)
      for (const term of entry.terms) expect(term.points).toBeCloseTo(term.probability * term.value, 9)
    }
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
