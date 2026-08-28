import { describe, expect, it } from 'vitest'
import { ALGORITHMS, type SeatView } from './algorithm'
import { createMatch } from './match'
import { foldRanking } from './ev'
import { EV_MODELS } from './evModel'
import { playRound, type RoundOptions } from './round'

/**
 * Not a test — a measurement, gated on `EV_BENCH` exactly the way `ev.bench.test.ts` gates on it,
 * so it never runs in CI:
 *
 *   EV_BENCH=1 npx vitest run src/core/evGrade.bench.test.ts --disable-console-intercept
 *
 * `plans/EV-5` §2.5 asks for the folding trainer's EV grading bands (ε₁ correct, ε₂ still partial
 * credit) to be **per-EV-model defaults**, "provisional constants... re-fixed after calibration".
 * This prints the spread `foldRanking` actually produces — `best.ev - worst.ev` over every held
 * tile — across real seeded hands with a real riichi threat on the board, so `EV_GRADE_BANDS`
 * (`evGrade.ts`) is set from a real distribution rather than guessed at the keyboard.
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

function spreadsUnder(model: 'statistical' | 'houou'): number[] {
  const real = ALGORITHMS.efficiency
  const spreads: number[] = []
  ALGORITHMS.efficiency = {
    ...real,
    turn: (view: SeatView) => {
      if (view.threats.length > 0) {
        const ranked = foldRanking(view, { model: EV_MODELS[model] })
        if (ranked.length > 1) {
          const evs = ranked.map((entry) => entry.ev)
          spreads.push(Math.max(...evs) - Math.min(...evs))
        }
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

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

describe.runIf(process.env.EV_BENCH)('folding EV grade bands', () => {
  it('prints the spread each model produces on real fold turns', () => {
    for (const model of ['statistical', 'houou'] as const) {
      const spreads = spreadsUnder(model).sort((a, b) => a - b)
      console.log(
        [
          '',
          `${model}: ${spreads.length} fold turns over ${SEEDS.length} seeds`,
          `  p25 ${percentile(spreads, 0.25).toFixed(0)}` +
            `  median ${percentile(spreads, 0.5).toFixed(0)}` +
            `  p75 ${percentile(spreads, 0.75).toFixed(0)}` +
            `  p90 ${percentile(spreads, 0.9).toFixed(0)}`,
        ].join('\n'),
      )
    }
    expect(true).toBe(true)
  }, 600_000)
})
