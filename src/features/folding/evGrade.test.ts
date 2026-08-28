import { describe, expect, it } from 'vitest'
import type { DiscardEv } from '../../core/ev'
import { EV_GRADE_BANDS, gradeEv } from './evGrade'

function ranking(evs: number[]): DiscardEv[] {
  return evs
    .map((ev, tile) => ({ tile, ev, dealIn: 0, terms: [] }))
    .sort((a, b) => b.ev - a.ev)
}

describe('gradeEv', () => {
  const bands = EV_GRADE_BANDS.statistical

  it('grades the best tile itself as correct with full quality', () => {
    const ranked = ranking([100, 0, -400])
    const grade = gradeEv(ranked, 0, bands)
    expect(grade.correct).toBe(true)
    expect(grade.delta).toBe(0)
    expect(grade.quality).toBe(1)
  })

  it('is still correct inside ε₁', () => {
    const ranked = ranking([100, 100 - bands.near])
    const grade = gradeEv(ranked, 1, bands)
    expect(grade.correct).toBe(true)
    expect(grade.quality).toBe(1)
  })

  it('grades partial credit between ε₁ and ε₂, degrading toward zero', () => {
    const ranked = ranking([100, 100 - bands.near - 1, 100 - bands.wrong])
    const near = gradeEv(ranked, 1, bands)
    const far = gradeEv(ranked, 2, bands)
    expect(near.correct).toBe(false)
    expect(near.quality).toBeGreaterThan(0)
    expect(near.quality).toBeLessThan(1)
    expect(far.quality).toBe(0)
    expect(far.quality).toBeLessThan(near.quality)
  })

  it('never scores below zero past ε₂', () => {
    const ranked = ranking([100, -10000])
    const grade = gradeEv(ranked, 1, bands)
    expect(grade.correct).toBe(false)
    expect(grade.quality).toBe(0)
  })

  it("falls back to the best entry if the tile isn't in the ranking", () => {
    const ranked = ranking([100, 0])
    const grade = gradeEv(ranked, 99 as never, bands)
    expect(grade.yours).toBe(grade.best)
    expect(grade.correct).toBe(true)
  })
})
