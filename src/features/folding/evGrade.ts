import type { DiscardEv } from '../../core/ev'
import type { EvModelName } from '../../core/evModel'
import type { TileId } from '../../core/tiles'

/** ε₁ (still correct) and ε₂ (still partial credit), in points — `plans/EV-5` §2.5. Beyond ε₂
 *  grades wrong. */
export interface EvBands {
  near: number
  wrong: number
}

/**
 * Provisional per-model defaults, `plans/EV-5` §2.5's "one visible table, the `TIER_SCORE`
 * precedent — tune here, never scatter". Sized off `evGrade.bench.test.ts`'s measured spread of
 * `foldRanking`'s own `best.ev - worst.ev` over real seeded fold turns (30 seeds, ~300 turns each):
 * `statistical` at p25/median/p75/p90 = 323/410/586/1036, `houou` at 646/855/1275/2168 — roughly
 * double, which the derived deal-in cost landing at about half the measured one already predicts
 * (`evModel.ts#TYPICAL_CLOSED_YAKU_HAN`'s own note). `near` sits under the first quartile so most
 * turns have room to be wrong in; `wrong` sits near the median so a genuinely bad throw — not just
 * a second-best one — is what crosses it. **An imperfect start is accepted; adjustability is the
 * requirement** (`plans/EV-5` §2.5) — re-fix these after the backtest that section's §2.13 owes.
 */
export const EV_GRADE_BANDS: Record<EvModelName, EvBands> = {
  statistical: { near: 100, wrong: 400 },
  houou: { near: 200, wrong: 800 },
}

export interface EvGrade {
  delta: number
  correct: boolean
  /** 0-1, the same partial-credit scale `useSessionStats.record`'s third argument takes. */
  quality: number
  best: DiscardEv
  yours: DiscardEv
}

/**
 * Grades one discard against a `foldRanking`, per `plans/EV-5` §2.5's two-threshold band.
 *
 * `ranking` is sorted best-first (`foldRanking`'s own total order), so `ranking[0]` is `best` by
 * construction and `delta` is never negative. `quality` degrades linearly from 1 at `bands.near`
 * to 0 at `bands.wrong`, the same shape folding's tier grading already uses
 * (`(worst - yours) / worst`, `useFoldingRound.ts`) — full marks inside the correct band, none once
 * a throw is as bad as `wrong` calls for.
 */
export function gradeEv(ranking: readonly DiscardEv[], tile: TileId, bands: EvBands): EvGrade {
  const best = ranking[0]!
  const yours = ranking.find((entry) => entry.tile === tile) ?? best
  const delta = best.ev - yours.ev
  const correct = delta <= bands.near
  const span = bands.wrong - bands.near
  const quality = correct ? 1 : Math.max(0, Math.min(1, span > 0 ? (bands.wrong - delta) / span : 0))
  return { delta, correct, quality, best, yours }
}
