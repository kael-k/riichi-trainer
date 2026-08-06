import { describe, expect, it } from 'vitest'
import { decompose } from './agari'
import { handFromTenhou } from './hand'
import { HONOR, MAN, parseTenhou } from './tiles'
import { detectYaku, type WinContext } from './yaku'

function ctx(overrides: Partial<WinContext> = {}): WinContext {
  return {
    round: HONOR,
    seat: HONOR + 1,
    tsumo: false,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    winTile: 0,
    ...overrides,
  }
}

/** Runs decompose() + detectYaku() over every (arrangement, winning-block) reading and
 *  returns the union of every yaku/yakuman name that appears anywhere — enough to assert
 *  "this yaku is reachable for this hand" without hand-picking a specific reading. */
function allYakuNames(hand: string, melds: Parameters<typeof decompose>[1], winTile: number, extra: Partial<WinContext> = {}) {
  const h = handFromTenhou(hand, melds.length)
  const arrangements = decompose(h.counts, melds)
  const names = new Set<string>()
  for (const a of arrangements) {
    const indices =
      a.kind === 'standard'
        ? a.blocks
            .map((_, i) => i)
            .filter((i) => {
              const b = (a as Extract<typeof a, { kind: 'standard' }>).blocks[i]
              if (b.meld) return false
              const ids = b.kind === 'run' ? [b.tile, b.tile + 1, b.tile + 2] : [b.tile]
              return ids.includes(winTile)
            })
        : [undefined]
    for (const idx of indices) {
      const { yaku, yakuman } = detectYaku(a, melds, ctx({ winTile, ...extra }), idx)
      for (const y of yaku) names.add(y.name)
      for (const y of yakuman) names.add(y)
    }
  }
  return names
}

describe('detectYaku (standard hands)', () => {
  it('toitoi: four triplets and a pair, no runs', () => {
    // win via ron into the South triplet (shanpon) rather than the pair, so it isn't also
    // a 4-closed-triplet suuankou — that would supersede toitoi entirely (yakuman only)
    const names = allYakuNames('111m999p111s22233z', [], HONOR + 1)
    expect(names.has('toitoi')).toBe(true)
  })

  it('honitsu: one suit plus honors', () => {
    const names = allYakuNames('123456789m11122z', [], HONOR + 1)
    expect(names.has('honitsu')).toBe(true)
    expect(names.has('chinitsu')).toBe(false)
  })

  it('chinitsu: one suit only, no honors', () => {
    const names = allYakuNames('11223344556677m', [], MAN)
    expect(names.has('chinitsu')).toBe(true)
  })

  it('sanshoku doujun: the same run in all three suits', () => {
    // 123m / 123p+456p / 123s + a 77m pair (tanki win)
    const names = allYakuNames('12377m123456p123s', [], MAN + 6)
    expect(names.has('sanshokuDoujun')).toBe(true)
  })

  it('ittsuu: 123-456-789 of one suit', () => {
    const names = allYakuNames('123456789m123p55s', [], MAN)
    expect(names.has('ittsuu')).toBe(true)
  })

  it('chanta: every block touches a terminal or honor, at least one run present', () => {
    const names = allYakuNames('123m789p123789s11z', [], MAN)
    expect(names.has('chanta')).toBe(true)
    expect(names.has('junchan')).toBe(false) // the 11z pair breaks junchan (honor, not terminal)
  })

  it('junchan: chanta shape with no honors at all', () => {
    const names = allYakuNames('12399m789p123789s', [], MAN)
    expect(names.has('junchan')).toBe(true)
  })

  it('shousangen: two dragon triplets plus the third as the pair', () => {
    const names = allYakuNames('123456m55566677z', [], HONOR + 6)
    expect(names.has('shousangen')).toBe(true)
  })
})

describe('detectYaku (yakuman)', () => {
  it('daisangen: three dragon triplets', () => {
    const names = allYakuNames('555666777z12355m', [], MAN)
    expect(names.has('daisangen')).toBe(true)
    // yakuman hands don't also report the regular yaku that would otherwise apply
    expect(names.has('yakuhaiHaku')).toBe(false)
  })

  it('tsuuiisou: honors only', () => {
    const names = allYakuNames('111z222z333z44z555z', [], HONOR + 3)
    expect(names.has('tsuuiisou')).toBe(true)
  })

  it('suuankou: four concealed triplets, won by tsumo', () => {
    const names = allYakuNames('111m999p111s11122z', [], HONOR + 1, { tsumo: true })
    expect(names.has('suuankou')).toBe(true)
  })

  it('suukantsu: four called kans', () => {
    const kans = [
      { kind: 'ankan' as const, tiles: parseTenhou('1111m') },
      { kind: 'ankan' as const, tiles: parseTenhou('9999p') },
      { kind: 'ankan' as const, tiles: parseTenhou('1111s') },
      { kind: 'ankan' as const, tiles: parseTenhou('9999s') },
    ]
    const names = allYakuNames('22z', kans, HONOR + 1)
    expect(names.has('suukantsu')).toBe(true)
  })
})
