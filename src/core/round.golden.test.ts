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

/** Frozen against `main` as it stood before the seat-algorithm refactor. Regenerate with
 *  `GENERATE_GOLDEN=1 npx vitest run src/core/round.golden.test.ts` and paste the printed table
 *  back in here — only T3 is allowed to do that. */
const GOLDEN: Record<string, [yonma: string, sanma: string]> = {
  'golden-0': ['408c20fb1ad2a8bc', '74e9e3a6e8c51dc4'],
  'golden-1': ['b48398ce8cc9e9de', '98a8295f0836e0c8'],
  'golden-2': ['76c3b0e4c2346950', 'bc4013d4730d5297'],
  'golden-3': ['41894b650eac6e33', 'def9ffb30c9bf331'],
  'golden-4': ['035e539278653b9b', '5564f3d1252a1b63'],
  'golden-5': ['090d89797803dcb2', '848e30900035ce39'],
  'golden-6': ['4b7de86ac75714af', '30993eb5f791008d'],
  'golden-7': ['d62ae0ecf415b2e5', 'ec5ea5a96cccf218'],
  'golden-8': ['04221b3b05419d62', '312a94d150179809'],
  'golden-9': ['a9bc11dc50688977', 'd740db08690b5a0a'],
  'golden-10': ['a5f89ea553ad93a6', '7e09b97032ee674e'],
  'golden-11': ['ef03cd5cf8ba7532', 'ae8d64439c7031e9'],
  'golden-12': ['630199b42a3ee88f', 'd9471e642f98d3a9'],
  'golden-13': ['b8f12fe7854e167c', '94e1745aa17ad34e'],
  'golden-14': ['c978d4488ccd00d6', 'f7b88927312c0f23'],
  'golden-15': ['07f8a6735f3174c0', '6a7d90c23d7b1a1d'],
  'golden-16': ['bd933d8e1d7268c3', '7207471756dc7a57'],
  'golden-17': ['0b9032a5ac86698d', 'b34ee66a828434d7'],
  'golden-18': ['15e5c344d1d14642', '37b40241676d7135'],
  'golden-19': ['47bd876deed31c20', '1f860e148929a3d6'],
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
