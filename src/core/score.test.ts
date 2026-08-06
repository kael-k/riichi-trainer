import { describe, expect, it } from 'vitest'
import type { Meld } from './agari'
import { scoreHand, type ScoreInput, type ScoringRules } from './score'
import { HONOR, MAN, parseTenhou, PIN } from './tiles'
import type { WinContext } from './yaku'

const NO_RULES: ScoringRules = { kiriageMangan: false, honba: 0, sanma: false }

function ctx(overrides: Partial<WinContext> = {}): WinContext {
  return {
    round: HONOR,
    seat: HONOR, // dealer by default
    tsumo: false,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    winTile: PIN + 7,
    ...overrides,
  }
}

describe('scoreHand', () => {
  it('scores a dealer riichi-pinfu-tanyao ron as 3han/30fu/5800', () => {
    const input: ScoreInput = {
      concealed: parseTenhou('234567m456678p33s'),
      melds: [],
      ctx: ctx({ riichi: true }),
      doraIndicators: [],
      uraIndicators: [],
      kita: 0,
      rules: NO_RULES,
    }
    const result = scoreHand(input)!
    expect(result.han).toBe(3)
    expect(result.fu).toBe(30)
    expect(result.yaku.map((y) => y.name).sort()).toEqual(['pinfu', 'riichi', 'tanyao'])
    expect(result.payments).toEqual({ main: 5800, total: 5800 })
  })

  it('pinfu tsumo is always exactly 20 fu, never rounded', () => {
    const input: ScoreInput = {
      concealed: parseTenhou('234567m456678p33s'),
      melds: [],
      ctx: ctx({ tsumo: true, seat: HONOR + 1 }), // non-dealer
      doraIndicators: [],
      uraIndicators: [],
      kita: 0,
      rules: NO_RULES,
    }
    const result = scoreHand(input)!
    expect(result.fu).toBe(20)
    expect(result.fuExact).toBe(20)
  })

  it('chiitoitsu is always flat 25 fu', () => {
    // odd, non-adjacent ranks (1/3/5/7/9m) plus two honor pairs: no 3 consecutive ranks
    // share a suit and no count ever reaches 3, so no standard reading exists at all —
    // decompose() can only offer the chiitoi arrangement.
    const input: ScoreInput = {
      concealed: parseTenhou('1133557799m5566z'),
      melds: [],
      ctx: ctx({ winTile: HONOR + 5, seat: HONOR + 1 }), // ron completes the hatsu pair
      doraIndicators: [],
      uraIndicators: [],
      kita: 0,
      rules: NO_RULES,
    }
    const result = scoreHand(input)!
    expect(result.fu).toBe(25)
    expect(result.yaku.some((y) => y.name === 'chiitoitsu')).toBe(true)
  })

  it('kiriage mangan rounds exactly 4han/30fu up to a flat mangan, nothing else', () => {
    // open hand: pon 222s (0 han, 2 fu) + closed chun triplet (1 han yakuhai, 8 fu, honor) +
    // a complete man run + a ryanmen-won pin run (0 fu each, non-overlapping so the winning
    // tile can't ambiguously read as a different, higher-fu block) + a plain pair —
    // fu = 20 + 8 + 2 = 30 exactly. Dora on the indicator before chun (hatsu) turns the chun
    // triplet into 3 extra han, reaching 4 han without touching the fu shape at all.
    const shape: ScoreInput = {
      concealed: parseTenhou('234m678p55s777z'),
      melds: [{ kind: 'pon', tiles: parseTenhou('222s') }],
      ctx: ctx({ winTile: PIN + 7, seat: HONOR + 1 }), // ron on 8p, ryanmen 67p->678p
      doraIndicators: [HONOR + 5], // hatsu indicator -> chun is dora
      uraIndicators: [],
      kita: 0,
      rules: NO_RULES,
    }
    const plain = scoreHand(shape)!
    expect(plain.han).toBe(4)
    expect(plain.fu).toBe(30)
    expect(plain.limit).toBeUndefined()

    const kiriage = scoreHand({ ...shape, rules: { ...NO_RULES, kiriageMangan: true } })!
    expect(kiriage.fu).toBe(30)
    expect(kiriage.limit).toBe('mangan')
    expect(kiriage.payments.total).toBeGreaterThan(plain.payments.total)
  })

  it('non-dealer tsumo splits dealer 2x / other non-dealers 1x each (yonma)', () => {
    const input: ScoreInput = {
      concealed: parseTenhou('234567m456678p33s'),
      melds: [],
      ctx: ctx({ tsumo: true, seat: HONOR + 1 }),
      doraIndicators: [],
      uraIndicators: [],
      kita: 0,
      rules: NO_RULES,
    }
    const result = scoreHand(input)!
    // 3han (riichi/pinfu/tanyao don't all apply without riichi -> just pinfu+tanyao = 2han here,
    // but the split arithmetic under test doesn't depend on which combo produced it)
    const basic = result.fu * 2 ** (2 + result.han)
    expect(result.payments.fromDealer).toBe(Math.ceil((2 * basic) / 100) * 100)
    expect(result.payments.main).toBe(Math.ceil(basic / 100) * 100)
    expect(result.payments.total).toBe(
      result.payments.fromDealer! + result.payments.main * 2,
    )
  })

  it('non-dealer tsumo in sanma only has one other non-dealer payer', () => {
    const input: ScoreInput = {
      concealed: parseTenhou('234567m456678p33s'),
      melds: [],
      ctx: ctx({ tsumo: true, seat: HONOR + 1 }),
      doraIndicators: [],
      uraIndicators: [],
      kita: 0,
      rules: { ...NO_RULES, sanma: true },
    }
    const result = scoreHand(input)!
    expect(result.payments.total).toBe(result.payments.fromDealer! + result.payments.main)
  })

  it('scores kokushi as a flat yakuman payout', () => {
    const input: ScoreInput = {
      concealed: parseTenhou('119m19p19s1234567z'),
      melds: [],
      ctx: ctx({ winTile: MAN, seat: HONOR + 1 }), // ron on the second 1m
      doraIndicators: [],
      uraIndicators: [],
      kita: 0,
      rules: NO_RULES,
    }
    const result = scoreHand(input)!
    expect(result.yakuman).toEqual(['kokushi'])
    expect(result.limit).toBe('yakuman')
    expect(result.payments).toEqual({ main: 32000, total: 32000 })
  })

  it('returns null for a complete hand with no legal yaku', () => {
    const meld: Meld = { kind: 'pon', tiles: parseTenhou('999s') }
    const input: ScoreInput = {
      concealed: parseTenhou('123m456p789p11z'),
      melds: [meld],
      ctx: ctx({ winTile: PIN + 6, seat: HONOR + 1, round: HONOR + 2 }),
      doraIndicators: [],
      uraIndicators: [],
      kita: 0,
      rules: NO_RULES,
    }
    expect(scoreHand(input)).toBeNull()
  })

  it('counts dora, aka and kita on top of yaku han', () => {
    const input: ScoreInput = {
      concealed: parseTenhou('234567m456678p33s'),
      melds: [],
      ctx: ctx({ riichi: true }),
      doraIndicators: [parseTenhou('1m')[0].id], // dora is 2m — two of them in this hand
      uraIndicators: [],
      kita: 1,
      rules: NO_RULES,
    }
    const result = scoreHand(input)!
    expect(result.dora.dora).toBe(1) // one 2m in the hand
    expect(result.dora.kita).toBe(1)
    expect(result.han).toBe(3 + 1 + 1) // riichi+pinfu+tanyao, +1 dora, +1 kita
  })
})
