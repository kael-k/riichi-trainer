import { describe, expect, it, vi } from 'vitest'
import { assessDiscards } from './danger'
import { evaluateDiscards } from './efficiency'
import { beginTurn, createMatch, finishTurn, type MatchOptions } from './match'
import type { SeatAlgorithm } from './policy'
import { HONOR, NUM_TILE_TYPES, parseTenhou, SOU } from './tiles'
import {
  actingSeat,
  analysisOf,
  goRound,
  seatRead,
  seenBy,
  snapshotTable,
  splitDrawn,
  type TableCore,
} from './table'

// wraps the real implementations in vi.fn so laziness can be proved by call count, not inspection
// (D-05) — every other test in this file still gets the real analysis, since these pass through
vi.mock('./efficiency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./efficiency')>()
  return { ...actual, evaluateDiscards: vi.fn(actual.evaluateDiscards) }
})
vi.mock('./danger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./danger')>()
  return { ...actual, assessDiscards: vi.fn(actual.assessDiscards) }
})

const YONMA: MatchOptions = {
  sanma: false,
  aka: true,
  round: HONOR,
  deadWall: true,
  calls: true,
  riichi: true,
  wins: true,
}

/** `MatchOptions.algorithms` naming just the manual seats — every other seat defaults to
 *  `'efficiency'`, same as an absent entry does. */
function manual(...seats: number[]): SeatAlgorithm[] {
  const algorithms: SeatAlgorithm[] = Array(Math.max(...seats) + 1).fill('efficiency')
  for (const seat of seats) algorithms[seat] = 'manual'
  return algorithms
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
          expect(
            unclamped,
            `tile ${id} in seed table-seenby-${i} never exceeds 4`,
          ).toBeLessThanOrEqual(4)
        }
        expect(Math.max(...seen)).toBeLessThanOrEqual(4)
      }
    }
  })
})

// what stops the go-round loop is a *manual* seat, not `seatIndex` — the two coincide in every
// single-manual-seat setup, which is what these fixtures spell out
const YOU_AT_0: MatchOptions = { ...YONMA, algorithms: manual(0) }

describe('goRound', () => {
  it('leaves match.seat at the manual seat when the hand is still running', () => {
    const match = createMatch([], 4, YOU_AT_0, 'table-goround-1')
    const core: TableCore = { match, options: YOU_AT_0, seatIndex: 0 }
    beginTurn(match, YOU_AT_0)
    finishTurn(match, YOU_AT_0)
    goRound(core)
    expect(match.ended !== undefined || match.seat === core.seatIndex).toBe(true)
  })

  it('stops at whichever manual seat comes first, not only at seatIndex', () => {
    // seat 2 is manual and seat 0 is the one the board is drawn from: the loop must hand the
    // turn over at seat 2 rather than playing straight past it back round to seat 0
    const options: MatchOptions = { ...YONMA, algorithms: manual(0, 2) }
    const match = createMatch([], 4, options, 'table-goround-multi')
    const core: TableCore = { match, options, seatIndex: 0 }
    beginTurn(match, options)
    finishTurn(match, options)
    goRound(core)
    expect(match.ended !== undefined || match.seat === 2).toBe(true)
  })

  it('is a no-op on a one-seat match', () => {
    const options: MatchOptions = { ...YOU_AT_0, calls: false, riichi: false }
    const match = createMatch([], 1, options, 'table-goround-solo')
    const core: TableCore = { match, options, seatIndex: 0 }
    const before = match.turn
    goRound(core)
    expect(match.seat).toBe(0)
    expect(match.turn).toBe(before)
  })

  it('makes at most one full circuit even on a table that never returns the turn', () => {
    // a rule bug that never hands the turn back would spin without the guard; simulate it by
    // leaving every seat on an algorithm (no seat manual at all), so the loop condition never
    // trips false on its own and only the guard stops it
    const options: MatchOptions = { ...YONMA }
    const match = createMatch([], 4, options, 'table-goround-guard')
    const core: TableCore = { match, options, seatIndex: 99 }
    const before = match.discards.length
    goRound(core)
    // 8 begin/finish pairs is the bound (4 seats x 2) — at most 8 more discards can land
    expect(match.discards.length - before).toBeLessThanOrEqual(8)
  })
})

describe('actingSeat', () => {
  it('returns seatIndex when only that seat is manual', () => {
    const match = createMatch([], 4, YOU_AT_0, 'table-acting-1')
    const core: TableCore = { match, options: YOU_AT_0, seatIndex: 0 }
    expect(actingSeat(core)).toBe(0)
  })

  it('returns the other manual seat once the turn reaches it, not seatIndex', () => {
    // same setup as goRound's "stops at whichever manual seat comes first" case: the board is
    // drawn from seat 0, but once the turn hands to seat 2 (also manual) the acting seat has to
    // follow the turn, not the board
    const options: MatchOptions = { ...YONMA, algorithms: manual(0, 2) }
    const match = createMatch([], 4, options, 'table-acting-2')
    const core: TableCore = { match, options, seatIndex: 0 }
    beginTurn(match, options)
    finishTurn(match, options)
    goRound(core)
    expect(match.seat).toBe(2)
    expect(actingSeat(core)).toBe(2)
  })
})

describe('snapshotTable', () => {
  it('separates the drawn tile out of hand into .drawn', () => {
    const match = createMatch([], 4, YONMA, 'table-snap-1')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    beginTurn(match, YONMA)
    const snap = snapshotTable(core)
    const drawn = match.players[match.seat].hand.drawn
    expect(snap.drawn).toEqual(drawn)
    expect(snap.hand.some((t) => t.id === drawn!.id && t.red === drawn!.red)).toBe(false)
    // whoever's turn it is right now — the seat a page must split *its own* hand for when
    // watching it from another perspective
    expect(snap.drawnSeat).toBe(match.seat)
  })

  it('leaves drawnSeat undefined between turns', () => {
    const match = createMatch([], 4, YONMA, 'table-snap-nodraw')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    const snap = snapshotTable(core)
    expect(match.players[match.seat].hand.drawn).toBeUndefined()
    expect(snap.drawnSeat).toBeUndefined()
  })

  it('mirrors every seat with one entry per player, for both 4-seat and 3-seat tables', () => {
    const match4 = createMatch([], 4, YONMA, 'table-snap-4')
    const snap4 = snapshotTable({ match: match4, options: YONMA, seatIndex: 0 })
    expect(snap4.rivers.length).toBe(match4.players.length)
    expect(snap4.hands.length).toBe(match4.players.length)
    expect(snap4.melds.length).toBe(match4.players.length)
    expect(snap4.nuki.length).toBe(match4.players.length)
    expect(snap4.riichi.length).toBe(match4.players.length)

    const sanma = { ...YONMA, sanma: true }
    const match3 = createMatch([], 3, sanma, 'table-snap-3')
    const snap3 = snapshotTable({ match: match3, options: sanma, seatIndex: 0 })
    expect(snap3.rivers.length).toBe(match3.players.length)
  })

  it('copies every array defensively: mutating the match after a snapshot leaves it unchanged', () => {
    const match = createMatch([], 4, { ...YONMA, wins: false }, 'table-snap-copy')
    const core: TableCore = { match, options: { ...YONMA, wins: false }, seatIndex: 0 }
    beginTurn(match, core.options)
    finishTurn(match, core.options)
    const before = snapshotTable(core)
    const riversBefore = before.rivers.map((r) => [...r])
    const handsBefore = before.hands.map((h) => [...h])

    goRound(core)
    if (!match.ended) beginTurn(match, core.options)
    if (!match.ended) finishTurn(match, core.options)

    expect(before.rivers).toEqual(riversBefore)
    expect(before.hands).toEqual(handsBefore)
  })
})

describe('splitDrawn', () => {
  const tiles = parseTenhou('123456789m11p').map((t) => ({ id: t.id, red: t.red }))

  it('passes tiles through unchanged when nothing is drawn', () => {
    expect(splitDrawn(tiles, undefined)).toEqual({ tiles, drawn: undefined })
  })

  it('splices the matching tile out of tiles, wherever it sits in sort order', () => {
    const drawn = tiles[3] // a tile mid-array, not the last — the sort order a real hand ships in
    const { tiles: rest, drawn: split } = splitDrawn(tiles, drawn)
    expect(split).toEqual(drawn)
    expect(rest.length).toBe(tiles.length - 1)
    expect(rest).not.toContainEqual(drawn)
  })

  it('returns drawn as given, and tiles unchanged, when the tile is not found', () => {
    const stray = { id: 33, red: false } // outside `tiles`'s own kinds
    expect(splitDrawn(tiles, stray)).toEqual({ tiles, drawn: stray })
  })
})

describe('analysisOf', () => {
  it('caches .ranked: reading it twice returns the identical array reference', () => {
    const match = createMatch([], 4, YONMA, 'table-analysis-1')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    beginTurn(match, YONMA)
    const analysis = analysisOf(core)
    expect(analysis.ranked).toBe(analysis.ranked)
  })

  it('never calls evaluateDiscards when only .danger is read', () => {
    vi.clearAllMocks()
    const match = createMatch([], 4, YONMA, 'table-analysis-2')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    beginTurn(match, YONMA)
    void analysisOf(core).danger
    expect(vi.mocked(evaluateDiscards)).not.toHaveBeenCalled()
  })

  it('never calls assessDiscards when only .ranked is read', () => {
    vi.clearAllMocks()
    const match = createMatch([], 4, YONMA, 'table-analysis-3')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    beginTurn(match, YONMA)
    void analysisOf(core).ranked
    expect(vi.mocked(assessDiscards)).not.toHaveBeenCalled()
  })

  it('returns a distinct object each call, so an earlier capture keeps its pre-throw numbers', () => {
    const match = createMatch([], 4, YONMA, 'table-analysis-4')
    const core: TableCore = { match, options: YONMA, seatIndex: 0 }
    beginTurn(match, YONMA)
    expect(analysisOf(core)).not.toBe(analysisOf(core))
  })

  it('with nobody in riichi, .danger still returns one entry per held kind', () => {
    const match = createMatch([], 4, { ...YONMA, riichi: false }, 'table-analysis-5')
    const core: TableCore = { match, options: { ...YONMA, riichi: false }, seatIndex: 0 }
    beginTurn(match, core.options)
    const player = match.players[0]
    const distinctKinds = player.hand.counts.filter((c) => c > 0).length
    expect(analysisOf(core).danger.length).toBe(distinctKinds)
  })
})

describe('seatRead', () => {
  // seat 1 is tanki tenpai on 2s (two complete runs each in man/pin, plus the single wait) —
  // the same hand `match.test.ts`'s furiten regression tests use
  const wall = [
    ...parseTenhou('189m189p2s123456z'),
    ...parseTenhou('234567m234567p2s'),
    ...parseTenhou('111222333m111p7z'),
    ...parseTenhou('444555666m222p7z'),
  ]

  it('reads no tenpai, no waits and no furiten for a seat far from tenpai', () => {
    const match = createMatch(wall, 4, YONMA, 'seat-read-1')
    expect(seatRead(match, 0, false)).toEqual({ tenpai: false, waits: [], furiten: false })
  })

  it('reads tenpai, the wait and its remaining copies for a seat one tile from a hand', () => {
    const match = createMatch(wall, 4, YONMA, 'seat-read-2')
    const read = seatRead(match, 1, false)
    expect(read.tenpai).toBe(true)
    // 4 copies of 2s total, minus the one already in seat 1's own hand
    expect(read.waits).toEqual([{ tile: SOU + 1, remaining: 3 }])
    expect(read.furiten).toBe(false)
  })

  it('reads furiten for a seat tenpai on a tile sitting in its own river', () => {
    const match = createMatch(wall, 4, YONMA, 'seat-read-3')
    match.players[1].river.push({ id: SOU + 1, red: false })
    expect(seatRead(match, 1, false).furiten).toBe(true)
  })

  it('reads furiten for a seat that missed a win on this tenpai', () => {
    const match = createMatch(wall, 4, YONMA, 'seat-read-4')
    match.players[1].missedWin = true
    expect(seatRead(match, 1, false).furiten).toBe(true)
  })
})
