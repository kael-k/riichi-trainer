import type { DiscardEv } from '../../core/ev'
import type { EvModelName } from '../../core/evModel'
import type { TileId } from '../../core/tiles'
import type { LogBar, LogDetail } from '../../store/log'

/**
 * Grading a decision on the EV model instead of a trainer's own ordinal/count model —
 * `plans/EV-5` §2.5's two-threshold band, shared by every trainer that reads it (folding's fold
 * branch, ADR-0046; efficiency's push branch). No React, no zustand: a pure module beside
 * `features/folding/grade.ts`'s and `features/efficiency/grade.ts`'s own pure grading, which each
 * trainer still owns for its own model (tiers, ukeire) — this is only the EV half.
 */

/** ε₁ (still correct) and ε₂ (still partial credit), in points — `plans/EV-5` §2.5. Beyond ε₂
 *  grades wrong. */
export interface EvBands {
  near: number
  wrong: number
}

/**
 * Provisional per-model defaults for **folding's fold branch**, `plans/EV-5` §2.5's "one visible
 * table, the `TIER_SCORE` precedent — tune here, never scatter". Sized off
 * `evGrade.bench.test.ts`'s measured spread of `foldRanking`'s own `best.ev - worst.ev` over real
 * seeded fold turns (30 seeds, ~300 turns each): `statistical` at p25/median/p75/p90 =
 * 412/538/749/1179, `houou` at 646/855/1262/1993. `near` sits under the first quartile so most
 * turns have room to be wrong in; `wrong` sits near the median so a genuinely bad throw — not just
 * a second-best one — is what crosses it. **An imperfect start is accepted; adjustability is the
 * requirement** (`plans/EV-5` §2.5) — re-fix these after the backtest that section's §2.13 owes.
 *
 * **`statistical`'s pair moved when its prior did.** It used to read 323/410/586/1036, banded
 * 100/400, and that spread was the flat distribution `dealIn.ts#UNIFORM_PRIOR` used to produce —
 * a hand whose safest and most dangerous tile were a few hundred points apart because every tile
 * on the board priced about the same. With a real shape prior the fold branch separates properly
 * and the whole spread widened by about a third. `houou` did not move: its own prior never
 * changed. The two are no longer a clean factor of two apart, but the derived deal-in cost still
 * lands at about half the measured one (`evModel.ts#TYPICAL_CLOSED_YAKU_HAN`'s own note), which is
 * what keeps `houou`'s pair the wider of the two.
 *
 * A reader who already has these persisted keeps their stored pair — that is what the per-model
 * record is for, and the settings row is where they change it.
 */
export const FOLD_EV_BANDS: Record<EvModelName, EvBands> = {
  statistical: { near: 150, wrong: 550 },
  houou: { near: 200, wrong: 800 },
}

/**
 * Provisional per-model defaults for **efficiency's push branch** — the same measurement,
 * `evGrade.bench.test.ts`'s `rankDiscards(…, { exhaustive: true })` spread over real efficiency
 * turns: `statistical` at p25/median/p75/p90 = 763/1102/1408/1840, `houou` at
 * 792/1134/1441/1886 — visibly wider than `FOLD_EV_BANDS` (a push ranking carries the win term the
 * fold branch never does, so a shanten-losing discard costs whole hands of value rather than a
 * turn's worth of danger), and, unlike the fold branch, the two models land close to each other:
 * the spread here is dominated by whether a shape reaches tenpai at all, which both models price
 * in the same order even though they source it differently (the DP directly vs
 * `EvModel.winValue`'s per-model table). Same rule as `FOLD_EV_BANDS`: provisional, re-fixed after
 * `plans/EV-5` §2.13's backtest, kept as two entries rather than one shared pair so either can move
 * independently once real calibration data says they should.
 */
export const PUSH_EV_BANDS: Record<EvModelName, EvBands> = {
  statistical: { near: 250, wrong: 1000 },
  houou: { near: 250, wrong: 1000 },
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
 * Grades one discard against a ranking sorted best-first (`foldRanking`'s or `rankDiscards`' own
 * total order — either serves, since both return the same `DiscardEv[]` shape), per `plans/EV-5`
 * §2.5's two-threshold band.
 *
 * `ranking[0]` is `best` by construction, so `delta` is never negative. `quality` degrades linearly
 * from 1 at `bands.near` to 0 at `bands.wrong`, the same shape folding's own tier grading already
 * uses (`(worst - yours) / worst`) — full marks inside the correct band, none once a throw is as
 * bad as `wrong` calls for.
 */
export function gradeEv(ranking: readonly DiscardEv[], tile: TileId, bands: EvBands): EvGrade {
  const best = ranking[0]!
  const yours = ranking.find((entry) => entry.tile === tile)
  // A tile the ranking never priced has no grade, and falling back to `best` would hand it
  // `delta: 0` — full marks for every discard the ranking happened not to cover. Both callers pass
  // an exhaustive ranking (`table.ts#pushRankingOf` forces `exhaustive: true`, `core/ev.ts#
  // foldRanking` walks `heldTiles`), so this cannot fire today; it throws rather than returning a
  // silent pass because the failure mode of the cheap candidate union is "everything is correct",
  // which no reader would ever notice.
  if (!yours) {
    throw new Error(`gradeEv: tile ${tile} is not in the ranking — it must price every held tile`)
  }
  const delta = best.ev - yours.ev
  const correct = delta <= bands.near
  const span = bands.wrong - bands.near
  const quality = correct
    ? 1
    : Math.max(0, Math.min(1, span > 0 ? (bands.wrong - delta) / span : 0))
  return { delta, correct, quality, best, yours }
}

/**
 * The band a turn was graded against, drawn as one `LogDetail`: a line naming the model and ε pair
 * plus one bar per candidate, normalized on the ranking's own best entry — `plans/EV-5` §2.5's "the
 * grading UI must show the band it graded against". `fraction` is computed here rather than in the
 * renderer, so the best candidate is always a full bar and the worst always empty regardless of how
 * negative a fold's own numbers run. One shared key (`log.evBand`) and shape for every trainer that
 * writes this line, so the wording and the bar chart read as one convention rather than two.
 */
export function evBandDetail(
  ranking: readonly DiscardEv[],
  model: EvModelName,
  bands: EvBands,
  tile: TileId,
): LogDetail {
  const grade = gradeEv(ranking, tile, bands)
  const best = ranking[0]!.ev
  const worst = ranking[ranking.length - 1]!.ev
  const span = best - worst
  const bars: LogBar[] = ranking.map((entry) => ({
    tile: entry.tile,
    value: Math.round(entry.ev),
    fraction: span > 0 ? (entry.ev - worst) / span : 1,
    chosen: entry.tile === tile,
    best: entry === ranking[0],
  }))
  return {
    key: 'log.evBand',
    params: {
      model,
      near: Math.round(bands.near),
      wrong: Math.round(bands.wrong),
      delta: Math.round(grade.delta),
    },
    bars,
  }
}
