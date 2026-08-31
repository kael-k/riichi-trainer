import { describe, expect, it } from 'vitest'
import { ALGORITHMS, type SeatView } from '../../core/algorithm'
import { foldRanking, rankDiscards } from '../../core/ev'
import { EV_MODELS } from '../../core/evModel'
import { createMatch } from '../../core/match'
import { playRound, type RoundOptions } from '../../core/round'

/**
 * Not a test — a measurement, gated on `EV_BENCH` exactly the way `core/ev.bench.test.ts` gates on
 * it, so it never runs in CI:
 *
 *   EV_BENCH=1 npx vitest run src/features/table/evGrade.bench.test.ts --disable-console-intercept
 *
 * A probability-graded trainer needs grading bands (ε₁ correct, ε₂ still
 * partial credit) to be **per-EV-model defaults**, "provisional constants... re-fixed after
 * calibration". This prints the spread each trainer's own ranking actually produces —
 * `best.ev - worst.ev` over every held tile — across real seeded hands, so `evGrade.ts`'s two
 * band tables are set from real distributions rather than guessed at the keyboard.
 *
 * Folding reads `foldRanking` (the fold branch, priced only when a threat is on the board);
 * efficiency reads `rankDiscards` with `exhaustive: true` (the push branch, priced every turn,
 * since efficiency never folds) — different branches, different magnitudes, so they get their own
 * measurement and their own table.
 */

declare const process: { env: Record<string, string | undefined> }

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  calls: true,
  riichi: true,
  wins: true,
}

const SEEDS = Array.from({ length: 30 }, (_, i) => `band-${i}`)

function spreadOf(evs: number[]): number {
  return Math.max(...evs) - Math.min(...evs)
}

function foldSpreadsUnder(model: 'statistical' | 'houou'): number[] {
  const real = ALGORITHMS.efficiency
  const spreads: number[] = []
  ALGORITHMS.efficiency = {
    ...real,
    turn: (view: SeatView) => {
      if (view.threats.length > 0) {
        const ranked = foldRanking(view, { model: EV_MODELS[model] })
        if (ranked.length > 1) spreads.push(spreadOf(ranked.map((entry) => entry.ev)))
      }
      return real.turn(view)
    },
  }
  try {
    for (const seed of SEEDS) playRound(seed, 4, YONMA)
  } finally {
    ALGORITHMS.efficiency = real
  }
  return spreads
}

function pushSpreadsUnder(model: 'statistical' | 'houou'): number[] {
  const real = ALGORITHMS.efficiency
  const spreads: number[] = []
  ALGORITHMS.efficiency = {
    ...real,
    turn: (view: SeatView) => {
      const ranked = rankDiscards(view, { model: EV_MODELS[model], exhaustive: true })
      if (ranked.length > 1) spreads.push(spreadOf(ranked.map((entry) => entry.ev)))
      return real.turn(view)
    },
  }
  try {
    // efficiency's own ruleset: no riichi to read danger from, so no fold branch is ever worth it
    for (const seed of SEEDS) playRound(seed, 4, { ...YONMA, riichi: false })
  } finally {
    ALGORITHMS.efficiency = real
  }
  return spreads
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

function report(label: string, spreads: number[]): void {
  const sorted = [...spreads].sort((a, b) => a - b)
  console.log(
    [
      '',
      `${label}: ${sorted.length} turns over ${SEEDS.length} seeds`,
      `  p25 ${percentile(sorted, 0.25).toFixed(0)}` +
        `  median ${percentile(sorted, 0.5).toFixed(0)}` +
        `  p75 ${percentile(sorted, 0.75).toFixed(0)}` +
        `  p90 ${percentile(sorted, 0.9).toFixed(0)}`,
    ].join('\n'),
  )
}

describe.runIf(process.env.EV_BENCH)('EV grade bands', () => {
  it('prints the fold-branch spread each model produces on real fold turns', () => {
    for (const model of ['statistical', 'houou'] as const) {
      report(`fold/${model}`, foldSpreadsUnder(model))
    }
    expect(true).toBe(true)
  }, 600_000)

  it('prints the push-branch spread each model produces on real efficiency turns', () => {
    for (const model of ['statistical', 'houou'] as const) {
      report(`push/${model}`, pushSpreadsUnder(model))
    }
    expect(true).toBe(true)
  }, 600_000)
})
