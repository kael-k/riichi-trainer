import type { MatchState } from './match'
import { HONOR } from './tiles'

/**
 * Where a match is likely to finish, and what finishing there is worth.
 *
 * This is the maths behind the placement objective
 * (`docs/model/push-fold.md#the-currency-switch`) and nothing else: it holds no
 * weights of its own. Each EV model supplies the **moments** — how much a seat's score still has
 * left to move — and this module integrates the seats against each other for rank probabilities
 * and prices the result under the ruleset. That split is what keeps the no-borrowing rule
 * (ADR-0037) intact while both models share one integral: an integral is not a number either
 * model measured.
 *
 * **The value function is fixed by the ruleset, not a parameter.** Tenhou dan-level scoring: start
 * at 25000, return at 30000, uma ±10/±20 (sanma: 35000/40000, +15/0/−15). A seat's result is
 * `(final − return)/1000 + uma[rank]`, which is the currency real riichi argument happens in and
 * has no free knobs in it.
 */

/** How much a seat's score has left to move before the match ends: the mean and standard deviation
 *  of `final − now`, in points. Measured by `houou`, derived by `statistical`, never mixed. */
export interface Swing {
  mean: number
  stddev: number
}

/** Rounds a hanchan runs: East and South, four each at a four-player table and three at a
 *  three-player one. Stated rather than read off `MatchState`, which carries no match length of
 *  its own (`core/match.ts#MatchFormat` lives beside `settleRound`, not here) — this is always
 *  the hanchan length regardless of the running match's real format. The one real ceiling that
 *  leaves: an `'ev'` seat on the placement objective in a **tonpuu** `/match` game prices its
 *  swing over the eight rounds of a hanchan it isn't playing, rather than the four it is —
 *  plumbing the format through `swing`/`evOptions` is a separate wave (ADR-0040). */
export function totalRounds(sanma: boolean): number {
  return sanma ? 6 : 8
}

/** Which round of the hanchan this is, counting from zero: East 1 is 0, South 4 is 7. */
export function roundIndex(match: MatchState, sanma: boolean): number {
  const players = sanma ? 3 : 4
  const wind = Math.max(0, match.prevalentWind - HONOR)
  const index = wind * players + Math.max(0, match.round - 1)
  return Math.min(index, totalRounds(sanma) - 1)
}

/** Tenhou dan-level uma, best rank first. Sums to zero; the oka is what the return score above the
 *  starting score already carries. */
const UMA: Record<'yonma' | 'sanma', readonly number[]> = {
  yonma: [20, 10, -10, -20],
  sanma: [15, 0, -15],
}

const RETURN_SCORE: Record<'yonma' | 'sanma', number> = { yonma: 30000, sanma: 40000 }

/** Result points for finishing `rank`-th (1-based) on `score` — what a seat under the placement
 *  objective is actually maximising. */
export function resultPoints(score: number, rank: number, sanma: boolean): number {
  const rules = sanma ? 'sanma' : 'yonma'
  const uma = UMA[rules]
  return (score - RETURN_SCORE[rules]) / 1000 + uma[Math.min(rank, uma.length) - 1]
}

/** Grid points the rank integral runs over. 257 is a Simpson-friendly odd count, and the answer
 *  moves in the fifth decimal past it — the moments feeding this are measured to two figures. */
const GRID = 257
/** How far past the widest seat's own spread the grid runs. Beyond five standard deviations a
 *  normal contributes less than a millionth. */
const TAILS = 5
/** A seat with nothing left to move would be a delta function the grid cannot see. One point is a
 *  thousandth of the smallest real spread in either model's tables. */
const MIN_SPREAD = 1

/**
 * P(this seat finishes in each rank), best rank first.
 *
 * Each seat's final score is its score now plus an independent normal with the moments handed in,
 * and the rank is one plus however many others land above it. Integrating `f_seat(x)` against the
 * chance that exactly `k` of the others exceed `x` gives the whole distribution in one pass — the
 * inner count is a three-term Poisson binomial, which is a four-entry running convolution rather
 * than anything that needs enumerating.
 *
 * **Independence is the stated approximation.** Points move between seats, so the four are exactly
 * negatively correlated in their sum; treating them as independent lets the total drift and
 * slightly widens every rank. It is the same shape of approximation `combineThreats` makes for the
 * same reason (`core/dealIn.ts`), and correcting it needs a joint model of the rest of the match
 * that neither EV model has.
 */
export function rankOdds(
  scores: readonly number[],
  swings: readonly Swing[],
  seat: number,
): number[] {
  const n = scores.length
  const odds = new Array<number>(n).fill(0)
  if (n === 0) return odds
  if (n === 1) return [1]

  const mean = scores.map((score, i) => score + swings[i].mean)
  const spread = swings.map((swing) => Math.max(swing.stddev, MIN_SPREAD))
  const widest = Math.max(...spread)
  const low = Math.min(...mean) - TAILS * widest
  const high = Math.max(...mean) + TAILS * widest
  const step = (high - low) / (GRID - 1)

  // Simpson's rule: the ends count once, then alternating 4 and 2
  const above = new Array<number>(n).fill(0)
  const counts = new Array<number>(n).fill(0)
  for (let g = 0; g < GRID; g++) {
    const weight = g === 0 || g === GRID - 1 ? 1 : g % 2 === 1 ? 4 : 2
    const x = low + g * step
    const density = normalPdf(x, mean[seat], spread[seat])
    if (density === 0) continue

    for (let j = 0; j < n; j++) above[j] = 1 - normalCdf(x, mean[j], spread[j])
    counts.fill(0)
    counts[0] = 1
    let held = 0
    for (let j = 0; j < n; j++) {
      if (j === seat) continue
      const p = above[j]
      for (let k = held + 1; k > 0; k--) counts[k] = counts[k] * (1 - p) + counts[k - 1] * p
      counts[0] *= 1 - p
      held++
    }
    for (let k = 0; k <= held; k++) odds[k] += weight * density * counts[k]
  }

  const scale = step / 3
  let total = 0
  for (let k = 0; k < n; k++) {
    odds[k] *= scale
    total += odds[k]
  }
  // the grid truncates the tails, so normalise rather than leaving a distribution that does not
  // sum to one — every consumer here takes an expectation over it
  if (total > 0) for (let k = 0; k < n; k++) odds[k] /= total
  return odds
}

/** Expected result points for `seat` — the rank odds above, priced by the ruleset, plus the score
 *  half, which needs no integral at all. */
export function expectedResult(
  scores: readonly number[],
  swings: readonly Swing[],
  seat: number,
  sanma: boolean,
): number {
  const odds = rankOdds(scores, swings, seat)
  const final = scores[seat] + swings[seat].mean
  let result = 0
  for (let rank = 0; rank < odds.length; rank++) {
    result += odds[rank] * resultPoints(final, rank + 1, sanma)
  }
  return result
}

/** Each seat's current rank, 1-based, ties broken by seat order — a total order, since a rank that
 *  depended on sort stability would make a model's own table read differently on two boards that
 *  are the same. */
export function ranks(scores: readonly number[]): number[] {
  const order = scores.map((score, seat) => ({ score, seat }))
  order.sort((a, b) => b.score - a.score || a.seat - b.seat)
  const rank = new Array<number>(scores.length).fill(1)
  order.forEach((entry, i) => (rank[entry.seat] = i + 1))
  return rank
}

function normalPdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI))
}

/** Abramowitz & Stegun 26.2.17 — the five-term rational approximation, accurate to 7.5e-8, which
 *  is orders past what moments measured to two figures can justify. */
function normalCdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd
  const sign = z < 0 ? -1 : 1
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const tail = normalPdf(Math.abs(z), 0, 1) * poly
  return sign > 0 ? 1 - tail : tail
}
