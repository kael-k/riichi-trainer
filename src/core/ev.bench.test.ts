import { describe, expect, it } from 'vitest'
import { ALGORITHMS, type Algorithm, type SeatView } from './algorithm'
import { createMatch } from './match'
import { availableCalls, kanOptions } from './policy'
import { playRound, type RoundOptions } from './round'
import { shanten } from './shanten'

/**
 * Not a test — a measurement, and a throwaway one. Gated on `EV_BENCH` exactly the way
 * `round.golden.test.ts` gates on `GENERATE_GOLDEN`, so it never runs in CI and never becomes an
 * artefact anyone has to maintain:
 *
 *   EV_BENCH=1 npx vitest run src/core/ev.bench.test.ts --disable-console-intercept
 *
 * It answers three questions the plan for pricing the call gate rests on:
 *
 *  1. Is the documented `~460ms` a hand or a turn? Seven doc sites say "a turn", four say "a
 *     hand", and the whole cost objection to pricing `call` was built on the per-turn reading.
 *  2. How often is each decision point actually asked, per hand?
 *  3. How many of those `call` asks would survive a cheap screen — the number that decides
 *     whether a priced call gate is affordable at all. Measured with no production change:
 *     `availableCalls` and `shanten` only.
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

const SEEDS = Array.from({ length: 20 }, (_, i) => `golden-${i}`)

function evOptions(model: 'statistical' | 'houou'): RoundOptions {
  return { ...YONMA, algorithms: ['ev'], ev: [{ model, objective: 'points' }] }
}

/** Wraps `ALGORITHMS.ev` in place, counting every ask and screening the call gate. Restores the
 *  original on `stop()`, so nothing leaks into another test file. */
function instrument() {
  const real = ALGORITHMS.ev
  const tally = { turn: 0, call: 0, win: 0, riichi: 0, abort: 0, offered: 0, screened: 0 }
  const proxy: Algorithm = {
    ...real,
    turn: (view) => {
      tally.turn++
      return real.turn(view)
    },
    call: (view: SeatView, tile, fromKamicha) => {
      tally.call++
      // the screen, run against unmodified production helpers: is there anything to price at all
      const calls = availableCalls(view.hand, tile, fromKamicha, view.calledKan)
      if (calls.length > 0) {
        tally.offered++
        if (shanten(view.hand) <= 2) tally.screened++
      }
      return real.call(view, tile, fromKamicha)
    },
    win: (view, candidate) => {
      tally.win++
      return real.win(view, candidate)
    },
    riichi: (view) => {
      tally.riichi++
      return real.riichi(view)
    },
    abort: (view) => {
      tally.abort++
      return real.abort(view)
    },
  }
  ALGORITHMS.ev = proxy
  return { tally, stop: () => void (ALGORITHMS.ev = real) }
}

function timed(run: () => void, repeats: number): number {
  run() // warm the JIT: the first hand of a process measures the compiler, not the model
  const started = performance.now()
  for (let i = 0; i < repeats; i++) run()
  return (performance.now() - started) / repeats
}

describe.runIf(process.env.EV_BENCH)('EV cost', () => {
  it('prints the numbers', () => {
    const ev = evOptions('statistical')

    // 1. ms per hand, and per own turn
    const efficiencyMs = timed(() => void playRound('golden-0', 4, YONMA), 20)
    const evMs = timed(() => void playRound('golden-0', 4, ev), 20)
    const outcome = playRound('golden-0', 4, ev)
    const ownTurns = outcome.events.filter((e) => e.kind === 'discard' && e.seat === 0).length

    // 2 & 3. how often each decision point is asked, and the call screen's yield
    const { tally, stop } = instrument()
    for (const seed of SEEDS) playRound(seed, 4, ev)
    stop()
    const hands = SEEDS.length

    console.log(
      [
        '',
        `efficiency        ${efficiencyMs.toFixed(1)} ms/hand`,
        `ev (statistical)  ${evMs.toFixed(1)} ms/hand over ${ownTurns} own turns` +
          ` = ${(evMs / Math.max(1, ownTurns)).toFixed(1)} ms/turn`,
        '',
        `per hand, averaged over ${hands} seeds, one 'ev' seat:`,
        `  turn   ${(tally.turn / hands).toFixed(1)}`,
        `  call   ${(tally.call / hands).toFixed(1)} asked` +
          `, ${(tally.offered / hands).toFixed(1)} with a legal call` +
          `, ${(tally.screened / hands).toFixed(1)} of those at <= 2 shanten`,
        `  win    ${(tally.win / hands).toFixed(1)}`,
        `  riichi ${(tally.riichi / hands).toFixed(1)}`,
        `  abort  ${(tally.abort / hands).toFixed(1)}`,
        '',
      ].join('\n'),
    )
    expect(tally.turn).toBeGreaterThan(0)
    // referenced so the import earns its place: the same legality the priced gate will read
    expect(kanOptions).toBeTypeOf('function')
  }, 600_000)
})
