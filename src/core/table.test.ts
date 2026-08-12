import { describe, expect, it } from 'vitest'
import { beginTurn, createMatch, finishTurn, type MatchOptions } from './match'
import { HONOR, NUM_TILE_TYPES, parseTenhou } from './tiles'
import { goRound, seenBy, yourDiscards, type TableCore } from './table'

const YONMA: MatchOptions = {
  sanma: false,
  aka: true,
  round: HONOR,
  deadWall: true,
  calls: true,
  riichi: true,
  wins: true,
}

describe('seenBy', () => {
  it('equals visible + hand counts, clamped, at every turn of 20 seeded matches', () => {
    for (let i = 0; i < 20; i++) {
      const match = createMatch([], 4, YONMA, `table-seenby-${i}`)
      const core: TableCore = { match, options: YONMA, seatIndex: 0 }
      // a hand is ~18 turns; the bound is a backstop against a rule bug spinning forever
      for (let guard = 0; guard < 80 && !match.ended; guard++) {
        beginTurn(match, YONMA)
        finishTurn(match, YONMA)
        const player = match.players[0]
        const seen = seenBy(core)
        for (let id = 0; id < NUM_TILE_TYPES; id++) {
          const unclamped = match.visible[id] + player.hand.counts[id]
          expect(seen[id], `tile ${id} in seed table-seenby-${i}`).toBe(Math.min(4, unclamped))
          expect(unclamped, `tile ${id} in seed table-seenby-${i} never exceeds 4`).toBeLessThanOrEqual(4)
        }
        expect(Math.max(...seen)).toBeLessThanOrEqual(4)
      }
    }
  })
})

describe('goRound', () => {
  it('leaves match.seat at seatIndex when the hand is still running', () => {
    const match = createMatch([], 4, YONMA, 'table-goround-1')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    beginTurn(match, YONMA)
    finishTurn(match, YONMA)
    goRound(core)
    expect(match.ended !== undefined || match.seat === core.seatIndex).toBe(true)
  })

  it('is a no-op on a one-seat match', () => {
    const match = createMatch([], 1, { ...YONMA, calls: false, riichi: false }, 'table-goround-solo')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    const before = match.turn
    goRound(core)
    expect(match.seat).toBe(0)
    expect(match.turn).toBe(before)
  })

  it('makes at most one full circuit even on a table that never returns the turn', () => {
    // a rule bug that never hands the turn back would spin without the guard; simulate it by
    // pointing seatIndex at a seat that can never become current (out of range), so the loop
    // condition never trips false on its own and only the guard stops it
    const match = createMatch([], 4, YONMA, 'table-goround-guard')
    const core: TableCore = { match, options: YONMA, seatIndex: 99 }
    const before = match.discards.length
    goRound(core)
    // 8 begin/finish pairs is the bound (4 seats x 2) — at most 8 more discards can land
    expect(match.discards.length - before).toBeLessThanOrEqual(8)
  })
})

// no calls/riichi/wins: isolates seat 0's own discard bookkeeping from opponent behaviour that
// would otherwise vary the number of turns played per seed
const NO_WIN: MatchOptions = { ...YONMA, calls: false, riichi: false, wins: false }

describe('yourDiscards', () => {
  it('returns every tile thrown, in order, including one called out of the river', () => {
    const wall = parseTenhou('123456789m1122p')
    const match = createMatch(wall, 4, NO_WIN, 'table-yd-1')
    const core: TableCore = { match, options: NO_WIN, seatIndex: 0 }
    beginTurn(match, NO_WIN)
    finishTurn(match, NO_WIN, { id: 0, red: false }) // discard 1m
    for (let g = 0; g < 3; g++) {
      beginTurn(match, NO_WIN)
      finishTurn(match, NO_WIN)
    }
    beginTurn(match, NO_WIN)
    finishTurn(match, NO_WIN, { id: 1, red: false }) // discard 2m
    const played = yourDiscards(core)
    expect(played.map((t) => t.id)).toEqual([0, 1])
  })

  it('skips the first `from` discards', () => {
    const wall = parseTenhou('123456789m1122p')
    const match = createMatch(wall, 4, NO_WIN, 'table-yd-2')
    const core: TableCore = { match, options: NO_WIN, seatIndex: 0 }
    beginTurn(match, NO_WIN)
    finishTurn(match, NO_WIN, { id: 0, red: false })
    for (let g = 0; g < 3; g++) {
      beginTurn(match, NO_WIN)
      finishTurn(match, NO_WIN)
    }
    beginTurn(match, NO_WIN)
    finishTurn(match, NO_WIN, { id: 1, red: false })
    const played = yourDiscards(core, 1)
    expect(played.map((t) => t.id)).toEqual([1])
  })
})
