import { describe, expect, it } from 'vitest'
import { generateHand, type GenOptions } from './generateHand'
import { scoreHand } from './score'
import { HONOR, MAN } from './tiles'

const FULL: GenOptions = { sanma: false, aka: true, openHands: true, honba: true }
const SANMA: GenOptions = { sanma: true, aka: true, openHands: true, honba: true }

function tileCounts(situation: ReturnType<typeof generateHand>): Map<number, number> {
  const counts = new Map<number, number>()
  const bump = (id: number) => counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const t of situation.concealed) bump(t.id)
  for (const m of situation.melds) for (const t of m.tiles) bump(t.id)
  return counts
}

describe('generateHand', () => {
  it('is deterministic: the same seed always produces the same hand', () => {
    const a = generateHand('scoring-seed-1', FULL)
    const b = generateHand('scoring-seed-1', FULL)
    expect(a).toEqual(b)
  })

  it('different seeds (usually) produce different hands', () => {
    const a = generateHand('scoring-seed-a', FULL)
    const b = generateHand('scoring-seed-b', FULL)
    expect(a).not.toEqual(b)
  })

  it('always produces a hand that scores (has a legal yaku)', () => {
    for (let i = 0; i < 60; i++) {
      const situation = generateHand(`round-${i}`, FULL)
      const result = scoreHand({
        concealed: situation.concealed,
        melds: situation.melds,
        ctx: situation.ctx,
        doraIndicators: situation.doraIndicators,
        uraIndicators: situation.uraIndicators,
        kita: situation.kita,
        rules: { kiriageMangan: false, honba: situation.honba, sanma: false },
      })
      expect(result, `seed round-${i} produced an unscoreable hand`).not.toBeNull()
    }
  })

  it('never uses more than 4 copies of any tile kind', () => {
    for (let i = 0; i < 60; i++) {
      const situation = generateHand(`budget-${i}`, FULL)
      for (const count of tileCounts(situation).values()) expect(count).toBeLessThanOrEqual(4)
    }
  })

  it('sanma output never contains 2m-8m', () => {
    for (let i = 0; i < 60; i++) {
      const situation = generateHand(`sanma-${i}`, SANMA)
      const counts = tileCounts(situation)
      for (let id = MAN + 1; id <= MAN + 7; id++) expect(counts.get(id) ?? 0).toBe(0)
      for (const id of situation.doraIndicators) expect(id < MAN + 1 || id > MAN + 7).toBe(true)
    }
  })

  it('pulled norths fit in the 4-copy budget alongside the hand', () => {
    for (let i = 0; i < 200; i++) {
      const situation = generateHand(`kita-${i}`, SANMA)
      const inHand = tileCounts(situation).get(HONOR + 3) ?? 0
      const indicators = situation.doraIndicators.filter((id) => id === HONOR + 3).length
      expect(inHand + indicators + situation.kita).toBeLessThanOrEqual(4)
    }
  })

  it('never generates open calls when openHands is off', () => {
    const closedOnly: GenOptions = { ...FULL, openHands: false }
    for (let i = 0; i < 60; i++) {
      const situation = generateHand(`closed-${i}`, closedOnly)
      expect(situation.melds.every((m) => m.kind === 'ankan')).toBe(true)
    }
  })

  it('the winning tile is always among the concealed tiles', () => {
    for (let i = 0; i < 60; i++) {
      const situation = generateHand(`wintile-${i}`, FULL)
      expect(situation.concealed.some((t) => t.id === situation.ctx.winTile)).toBe(true)
    }
  })
})
