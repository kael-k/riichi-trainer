import { describe, expect, it } from 'vitest'
import { createMatch } from './match'
import { playRound, type RoundEvent, type RoundOptions } from './round'

/**
 * Regression net for the seat-algorithm refactor (PLAN-seat-algorithms.md). Every seeded match's
 * whole event stream is hashed; an unrelated mechanical rename must reproduce every hash bit for
 * bit. T3 is the one commit allowed to move these — it changes what `defense`/`efficiency`
 * actually decide, and regenerates the table below in the same commit.
 */

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  deadWall: true,
  calls: true,
  riichi: true,
  wins: true,
}

const SANMA: RoundOptions = { ...YONMA, sanma: true, match: createMatch(true) }

function serialize(events: RoundEvent[]): string {
  return events
    .map((e) => {
      switch (e.kind) {
        case 'draw':
          return `draw:${e.seat}:${e.tile.id}${e.tile.red ? 'r' : ''}`
        case 'discard':
          return `discard:${e.seat}:${e.tile.id}${e.tile.red ? 'r' : ''}${e.tile.tsumogiri ? 't' : ''}${e.tile.riichi ? 'R' : ''}`
        case 'riichi':
          return `riichi:${e.seat}`
        case 'call':
          return `call:${e.seat}:${e.from}:${e.meld.kind}:${e.meld.tiles.map((t) => t.id).join(',')}`
        case 'win':
          return `win:${e.win.seat}:${e.win.from ?? 'tsumo'}:${e.win.score.payments.total}:${e.win.score.yaku.map((y) => y.name).join(',')}`
        case 'exhaustive':
          return 'exhaustive'
      }
    })
    .join('|')
}

/** cyrb53 — small, dependency-free, good enough distribution for a frozen-value regression test. */
function hash(str: string): string {
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

const SEEDS = Array.from({ length: 20 }, (_, i) => `golden-${i}`)

// tsconfig.app.json carries no Node types (it's the browser app config); vitest runs this file
// under Node regardless, so `process` exists at runtime even though the app config doesn't know it.
declare const process: { env: Record<string, string | undefined> }

/** Frozen event streams. Regenerate with `GENERATE_GOLDEN=1 npx vitest run
 *  src/core/round.golden.test.ts --disable-console-intercept` and paste the printed table back in
 *  here — a change that has to move these says so in its own commit. Three have: T3 of the
 *  seat-algorithm refactor (it changed what `defense`/`efficiency` decide), the move to real
 *  4/4/4+1 dealing (every seat is dealt different tiles off the same wall), and cutting the dead wall
 *  into real stacks (ADR-0028, which moves which tiles are dora and which ura pays out). */
const GOLDEN: Record<string, [yonma: string, sanma: string]> = {
  'golden-0': ['1771f2e19c0e5bf8', 'f8f21d751959f3d1'],
  'golden-1': ['4047a43d61d584f0', '66d6d8dde8f00eaa'],
  'golden-2': ['41b64dafd8de6987', 'b2b1a21d8d9e1e52'],
  'golden-3': ['bb468b2afb281212', '093d886952bc7b19'],
  'golden-4': ['afc54c91dc9d069a', '2a852d9026a370d5'],
  'golden-5': ['2a79119f8bea1b22', '427c24dfbe769e35'],
  'golden-6': ['3173e588cf15f213', '229f61d5553ffa7b'],
  'golden-7': ['eca7cd5f289ec8ab', '0c18e1cc5162567e'],
  'golden-8': ['37046f5637bdbdff', 'f0caa9459c793f57'],
  'golden-9': ['d4813c6b02bcfeff', '05b752de4cbfb3c2'],
  'golden-10': ['939714d757dc4101', '0fb2bd027169bd11'],
  'golden-11': ['1d199abe707275f6', '867993f028ccac47'],
  'golden-12': ['664af11d0925dde4', '3ec4629f54071bd0'],
  'golden-13': ['d16d65d947b9955d', 'e3e6ef10c6a82b36'],
  'golden-14': ['95b5ade0a11929f6', '01ed69f34db9fbde'],
  'golden-15': ['5cac3039e5faffab', '9f33c6ed50ab298c'],
  'golden-16': ['d9ad2a6b42c5f843', '4a34f4e9728fe8e3'],
  'golden-17': ['e387e2fcea924abf', 'cd9b62651ad55b5f'],
  'golden-18': ['098ff6ac78118d20', 'a48703b94847bfad'],
  'golden-19': ['62be2ff8e1e0537f', 'f98026bd1740656d'],
}

describe('match golden determinism', () => {
  if (process.env.GENERATE_GOLDEN) {
    it('prints the golden table', () => {
      const lines = SEEDS.map((seed) => {
        const yonma = hash(serialize(playRound(seed, 4, YONMA).events))
        const sanma = hash(serialize(playRound(seed, 3, SANMA).events))
        return `  '${seed}': ['${yonma}', '${sanma}'],`
      })
      console.log(lines.join('\n'))
      expect(true).toBe(true)
    })
    return
  }

  it.each(SEEDS)('%s reproduces its frozen event-stream hash', (seed) => {
    const [wantYonma, wantSanma] = GOLDEN[seed]
    expect(hash(serialize(playRound(seed, 4, YONMA).events))).toBe(wantYonma)
    expect(hash(serialize(playRound(seed, 3, SANMA).events))).toBe(wantSanma)
  })
})
