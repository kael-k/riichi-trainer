import { describe, expect, it, vi } from 'vitest'
import { assessDiscards } from './danger'
import { evaluateDiscards } from './efficiency'
import { createMatch } from './match'
import { beginTurn, createRound, finishTurn, type RoundOptions } from './round'
import type { SeatAlgorithm } from './policy'
import { NUM_TILE_TYPES, parseTenhou, SOU } from './tiles'
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
// (ADR-0012) — every other test in this file still gets the real analysis, since these pass through
vi.mock('./efficiency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./efficiency')>()
  return { ...actual, evaluateDiscards: vi.fn(actual.evaluateDiscards) }
})
vi.mock('./danger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./danger')>()
  return { ...actual, assessDiscards: vi.fn(actual.assessDiscards) }
})

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  deadWall: true,
  calls: true,
  riichi: true,
  wins: true,
}

/** `RoundOptions.algorithms` naming just the manual seats — every other seat defaults to
 *  `'efficiency'`, same as an absent entry does. */
function manual(...seats: number[]): SeatAlgorithm[] {
  const algorithms: SeatAlgorithm[] = Array(Math.max(...seats) + 1).fill('efficiency')
  for (const seat of seats) algorithms[seat] = 'manual'
  return algorithms
}

describe('seenBy', () => {
  it('equals visible + hand counts, clamped, at every turn of 20 seeded matches', () => {
    for (let i = 0; i < 20; i++) {
      const round = createRound([], 4, YONMA, `table-seenby-${i}`)
      const core: TableCore = { round, options: YONMA }
      // a hand is ~18 turns; the bound is a backstop against a rule bug spinning forever
      for (let guard = 0; guard < 80 && !round.ended; guard++) {
        beginTurn(round, YONMA)
        finishTurn(round, YONMA)
        const player = round.players[0]
        const seen = seenBy(core, 0)
        for (let id = 0; id < NUM_TILE_TYPES; id++) {
          const unclamped = round.visible[id] + player.hand.counts[id]
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
const YOU_AT_0: RoundOptions = { ...YONMA, algorithms: manual(0) }

describe('goRound', () => {
  it('leaves round.seat at the manual seat when the hand is still running', () => {
    const round = createRound([], 4, YOU_AT_0, 'table-goround-1')
    const core: TableCore = { round, options: YOU_AT_0 }
    beginTurn(round, YOU_AT_0)
    finishTurn(round, YOU_AT_0)
    goRound(core)
    expect(round.ended !== undefined || round.seat === 0).toBe(true)
  })

  it('stops at whichever manual seat comes first, not only at seatIndex', () => {
    // seat 2 is manual and seat 0 is the one the board is drawn from: the loop must hand the
    // turn over at seat 2 rather than playing straight past it back round to seat 0
    const options: RoundOptions = { ...YONMA, algorithms: manual(0, 2) }
    const round = createRound([], 4, options, 'table-goround-multi')
    const core: TableCore = { round, options }
    beginTurn(round, options)
    finishTurn(round, options)
    goRound(core)
    expect(round.ended !== undefined || round.seat === 2).toBe(true)
  })

  it('is a no-op on a one-seat round', () => {
    const options: RoundOptions = { ...YOU_AT_0, calls: false, riichi: false }
    const round = createRound([], 1, options, 'table-goround-solo')
    const core: TableCore = { round, options }
    const before = round.turn
    goRound(core)
    expect(round.seat).toBe(0)
    expect(round.turn).toBe(before)
  })

  it('plays the hand out when no seat is manual, and still terminates', () => {
    // nothing here can stop the loop by being manual, so this is both the autoplay case
    // (ADR-0011: every seat on an algorithm, watch it play) and the check that `stepRound`'s own
    // 400-turn backstop catches a rule bug that never hands the turn back
    const options: RoundOptions = { ...YONMA }
    const round = createRound([], 4, options, 'table-goround-guard')
    const core: TableCore = { round, options }
    goRound(core)
    expect(round.ended).toBeDefined()
  })
})

describe('actingSeat', () => {
  it('returns seatIndex when only that seat is manual', () => {
    const round = createRound([], 4, YOU_AT_0, 'table-acting-1')
    const core: TableCore = { round, options: YOU_AT_0 }
    expect(actingSeat(core)).toBe(0)
  })

  it('returns the other manual seat once the turn reaches it, not seatIndex', () => {
    // same setup as goRound's "stops at whichever manual seat comes first" case: the board is
    // drawn from seat 0, but once the turn hands to seat 2 (also manual) the acting seat has to
    // follow the turn, not the board
    const options: RoundOptions = { ...YONMA, algorithms: manual(0, 2) }
    const round = createRound([], 4, options, 'table-acting-2')
    const core: TableCore = { round, options }
    beginTurn(round, options)
    finishTurn(round, options)
    goRound(core)
    expect(round.seat).toBe(2)
    expect(actingSeat(core)).toBe(2)
  })
})

describe('snapshotTable', () => {
  it("names the drawn tile and whose it is, leaving it mixed into that seat's hand", () => {
    const round = createRound([], 4, YONMA, 'table-snap-1')
    const core: TableCore = { round, options: YONMA }
    beginTurn(round, YONMA)
    const snap = snapshotTable(core)
    const drawn = round.players[round.seat].drawn
    expect(snap.drawn).toEqual({ seat: round.seat, tile: drawn })
    // the snapshot no longer splits one privileged seat's hand — `hands[seat]` keeps every tile
    // and a page separates the 14th itself with `splitDrawn`, which is what lets perspective move
    expect(snap.hands[round.seat].some((t) => t.id === drawn!.id)).toBe(true)
    const split = splitDrawn(snap.hands[round.seat], drawn)
    expect(split.tiles.some((t) => t.id === drawn!.id && t.red === drawn!.red)).toBe(false)
  })

  it('leaves drawn undefined between turns', () => {
    const round = createRound([], 4, YONMA, 'table-snap-nodraw')
    const core: TableCore = { round, options: YONMA }
    const snap = snapshotTable(core)
    expect(round.players[round.seat].drawn).toBeUndefined()
    expect(snap.drawn).toBeUndefined()
  })

  it("reports whose turn it is, and every seat's algorithm", () => {
    const options: RoundOptions = { ...YONMA, algorithms: manual(0, 2) }
    const round = createRound([], 4, options, 'table-snap-seat')
    const snap = snapshotTable({ round, options })
    expect(snap.seat).toBe(round.seat)
    expect(snap.algorithms).toEqual(['manual', 'efficiency', 'manual', 'efficiency'])
  })

  it('mirrors every seat with one entry per player, for both 4-seat and 3-seat tables', () => {
    const match4 = createRound([], 4, YONMA, 'table-snap-4')
    const snap4 = snapshotTable({ round: match4, options: YONMA })
    expect(snap4.rivers.length).toBe(match4.players.length)
    expect(snap4.hands.length).toBe(match4.players.length)
    expect(snap4.melds.length).toBe(match4.players.length)
    expect(snap4.nuki.length).toBe(match4.players.length)
    expect(snap4.riichi.length).toBe(match4.players.length)

    const sanma = { ...YONMA, sanma: true }
    const match3 = createRound([], 3, sanma, 'table-snap-3')
    const snap3 = snapshotTable({ round: match3, options: sanma })
    expect(snap3.rivers.length).toBe(match3.players.length)
  })

  it('copies every array defensively: mutating the round after a snapshot leaves it unchanged', () => {
    const round = createRound([], 4, { ...YONMA, wins: false }, 'table-snap-copy')
    const core: TableCore = { round, options: { ...YONMA, wins: false } }
    beginTurn(round, core.options)
    finishTurn(round, core.options)
    const before = snapshotTable(core)
    const riversBefore = before.rivers.map((r) => [...r])
    const handsBefore = before.hands.map((h) => [...h])

    goRound(core)
    if (!round.ended) beginTurn(round, core.options)
    if (!round.ended) finishTurn(round, core.options)

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
    const round = createRound([], 4, YONMA, 'table-analysis-1')
    const core: TableCore = { round, options: YONMA }
    beginTurn(round, YONMA)
    const analysis = analysisOf(core, 0)
    expect(analysis.ranked).toBe(analysis.ranked)
  })

  it('never calls evaluateDiscards when only .danger is read', () => {
    vi.clearAllMocks()
    const round = createRound([], 4, YONMA, 'table-analysis-2')
    const core: TableCore = { round, options: YONMA }
    beginTurn(round, YONMA)
    void analysisOf(core, 0).danger
    expect(vi.mocked(evaluateDiscards)).not.toHaveBeenCalled()
  })

  it('never calls assessDiscards when only .ranked is read', () => {
    vi.clearAllMocks()
    const round = createRound([], 4, YONMA, 'table-analysis-3')
    const core: TableCore = { round, options: YONMA }
    beginTurn(round, YONMA)
    void analysisOf(core, 0).ranked
    expect(vi.mocked(assessDiscards)).not.toHaveBeenCalled()
  })

  it('returns a distinct object each call, so an earlier capture keeps its pre-throw numbers', () => {
    const round = createRound([], 4, YONMA, 'table-analysis-4')
    const core: TableCore = { round, options: YONMA }
    beginTurn(round, YONMA)
    expect(analysisOf(core, 0)).not.toBe(analysisOf(core, 0))
  })

  it('with nobody in riichi, .danger still returns one entry per held kind', () => {
    const round = createRound([], 4, { ...YONMA, riichi: false }, 'table-analysis-5')
    const core: TableCore = { round, options: { ...YONMA, riichi: false } }
    beginTurn(round, core.options)
    const player = round.players[0]
    const distinctKinds = player.hand.counts.filter((c) => c > 0).length
    expect(analysisOf(core, 0).danger.length).toBe(distinctKinds)
  })
})

describe('seatRead', () => {
  // seat 1 is tanki tenpai on 2s (two complete runs each in man/pin, plus the single wait) —
  // the same hand `round.test.ts`'s furiten regression tests use
  const wall = [
    ...parseTenhou('189m189p2s123456z'),
    ...parseTenhou('234567m234567p2s'),
    ...parseTenhou('111222333m111p7z'),
    ...parseTenhou('444555666m222p7z'),
  ]

  it('reads no tenpai, no waits and no furiten for a seat far from tenpai', () => {
    const round = createRound(wall, 4, YONMA, 'seat-read-1')
    expect(seatRead(round, 0, false)).toEqual({ tenpai: false, waits: [], furiten: false })
  })

  it('reads tenpai, the wait and its remaining copies for a seat one tile from a hand', () => {
    const round = createRound(wall, 4, YONMA, 'seat-read-2')
    const read = seatRead(round, 1, false)
    expect(read.tenpai).toBe(true)
    // 4 copies of 2s total, minus the one already in seat 1's own hand
    expect(read.waits).toEqual([{ tile: SOU + 1, remaining: 3 }])
    expect(read.furiten).toBe(false)
  })

  it('reads furiten for a seat tenpai on a tile sitting in its own river', () => {
    const round = createRound(wall, 4, YONMA, 'seat-read-3')
    round.players[1].river.push({ id: SOU + 1, red: false })
    expect(seatRead(round, 1, false).furiten).toBe(true)
  })

  it('reads furiten for a seat that missed a win on this tenpai', () => {
    const round = createRound(wall, 4, YONMA, 'seat-read-4')
    round.players[1].missedWin = true
    expect(seatRead(round, 1, false).furiten).toBe(true)
  })
})
