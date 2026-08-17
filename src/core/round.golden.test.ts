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
 *  here — a change that has to move these says so in its own commit. Two have: T3 of the
 *  seat-algorithm refactor (it changed what `defense`/`efficiency` decide) and the move to real
 *  4/4/4+1 dealing (every seat is dealt different tiles off the same wall). */
const GOLDEN: Record<string, [yonma: string, sanma: string]> = {
  'golden-0': ['ad25f22625249718', 'fb5c433711f251e4'],
  'golden-1': ['b2ba6983ea6c034a', '66d6d8dde8f00eaa'],
  'golden-2': ['2a86d74f06add38b', 'dd45f5aae9669696'],
  'golden-3': ['bb468b2afb281212', '093d886952bc7b19'],
  'golden-4': ['733fd0f6d09170b6', 'e3e73a8bb3ac9981'],
  'golden-5': ['bcd5dc36d0a1baec', 'f67df1eb460e339a'],
  'golden-6': ['01eed891412b24b5', '529013ca19470bea'],
  'golden-7': ['4fcff736b166b02f', 'e5d77d1e9745c506'],
  'golden-8': ['d1f70a12bda48ee3', '26e8510f336618f0'],
  'golden-9': ['f0910076e355f897', '1090adc959b82c18'],
  'golden-10': ['939714d757dc4101', '478423099ffc65e3'],
  'golden-11': ['1d199abe707275f6', '861708430e6fc8bc'],
  'golden-12': ['e88fd3ecdce1d896', '5d42a1da5467eb4e'],
  'golden-13': ['a6457705cb9ab576', 'e3e6ef10c6a82b36'],
  'golden-14': ['0d2dccfccdaf5fe1', '4d894a20482a4b67'],
  'golden-15': ['b7f1cb42785151bb', '5526741589a1c139'],
  'golden-16': ['bab9a5b44c0db268', '130be4521474b584'],
  'golden-17': ['6eacbf74a6cecf39', 'cd9b62651ad55b5f'],
  'golden-18': ['098ff6ac78118d20', '4ead3e2b1ab69ba6'],
  'golden-19': ['62be2ff8e1e0537f', '2d2db7ef40d7ab95'],
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
