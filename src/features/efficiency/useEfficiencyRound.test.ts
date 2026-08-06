import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseTenhou } from '../../core/tiles'
import { decodeSituation, emptySituation } from '../situation/urlCodec'
import { useEfficiencyRound, type RoundOptions } from './useEfficiencyRound'

/** Bare-table options: no opponents, no dead wall, no aka — fully deterministic. */
const BARE: RoundOptions = { opponents: false, deadWall: false, aka: false }

describe('useEfficiencyRound', () => {
  it('deals 13 tiles plus a separated drawn tile and evaluates discards', () => {
    const situation = emptySituation()
    situation.seed = 'test-seed'
    situation.hand = parseTenhou('1112345678999m') // 13 tiles, nine-gates tenpai
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeDefined()
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)

    act(() => result.current.discard(0))
    expect(result.current.lastResult?.turn).toBe(1)
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeDefined()
    expect(result.current.turn).toBe(2)
  })

  it('has no drawn tile for turn 1 when the situation already supplies all 14', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m11223p')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    expect(result.current.hand).toHaveLength(14)
    expect(result.current.drawn).toBeUndefined()
  })

  it('runs until tenpai, not for a fixed turn count', () => {
    const situation = emptySituation()
    situation.seed = 'drain-seed'
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    for (let i = 0; i < 200 && !result.current.finished; i++) {
      act(() => result.current.discard(0))
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.tenpai).toBe(true)
    expect(result.current.turn).toBeGreaterThan(1)
  })

  it('ends the round as soon as a discard reaches tenpai', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m11227z') // discard 7z -> shanpon tenpai
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.finished).toBe(false)
    act(() => result.current.discard(13)) // the 7z
    expect(result.current.finished).toBe(true)
    expect(result.current.tenpai).toBe(true)
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeUndefined()
    expect(result.current.wallRemaining).toBeGreaterThan(0) // stopped early, wall untouched
  })

  it('restart deals a fresh hand', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    const firstHand = result.current.hand
    act(() => result.current.discard(0))
    act(() => result.current.restart())
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)
    expect(result.current.hand).not.toEqual(firstHand)
  })

  it('preserves a red five pinned in the situation hand', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m0p1122z') // 14 tiles incl. red 5p, no draw
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    expect(result.current.hand).toContainEqual({ id: 13, red: true })
  })

  it('draws a red five from a pinned wall and drops it again on discard', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m1234z') // 13 tiles, still far from tenpai
    situation.wall = parseTenhou('0s5s')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.drawn).toEqual({ id: 22, red: true })
    expect(result.current.hand).not.toContainEqual({ id: 22, red: true })

    act(() => result.current.discard(13)) // index past the 13 hand tiles = the drawn tile
    expect(result.current.drawn).toEqual({ id: 22, red: false }) // the normal 5s follows
    expect(result.current.hand).not.toContainEqual({ id: 22, red: true })
  })

  it('seeds one red five per suit into random walls when aka is enabled', () => {
    const situation = emptySituation()
    situation.seed = 'aka-seed'
    const count = (opts: RoundOptions) => {
      const { result } = renderHook(() => useEfficiencyRound(situation, opts, true))
      const everywhere = [
        ...result.current.hand,
        ...(result.current.drawn ? [result.current.drawn] : []),
        ...result.current.liveWall,
      ]
      return everywhere.filter((t) => t.red).length
    }
    expect(count({ ...BARE, aka: true })).toBe(3)
    expect(count(BARE)).toBe(0)
  })

  it('reserves a dead wall and exposes its dora indicator', () => {
    const situation = emptySituation()
    situation.seed = 'dora-seed'
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, deadWall: true }, true),
    )
    expect(result.current.doraIndicator).not.toBeNull()
    expect(result.current.wallRemaining).toBe(136 - 14 - 14) // deal 14, dead wall 14
  })

  it('lets opponents tsumogiri around the table, draining the wall 4 tiles per turn', () => {
    const situation = emptySituation()
    situation.seed = 'opp-seed'
    situation.hand = parseTenhou('123456789m1122z')
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, opponents: true }, true),
    )
    // 123 unpinned - 39 hidden opponent hands - 1 user draw
    expect(result.current.wallRemaining).toBe(83)
    expect(result.current.rivers.every((r) => r.length === 0)).toBe(true)

    act(() => result.current.discard(0))
    expect(result.current.wallRemaining).toBe(79)
    expect(result.current.rivers.map((r) => r.length)).toEqual([1, 1, 1, 1])
  })

  it('opponents before the user act first, and their discards count as visible', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m1122z') // discard 7z draw -> shanpon on 1z/2z
    situation.wall = parseTenhou('1z7z')
    situation.seat = 'S' // East tsumogiris before the user's first draw
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, opponents: true }, true),
    )

    expect(result.current.rivers[0]).toEqual(parseTenhou('1z')) // East ate the wall prefix
    expect(result.current.drawn).toEqual(parseTenhou('7z')[0])

    act(() => result.current.discard(13)) // tsumogiri the 7z
    const east = result.current.lastResult!.yours.ukeireTiles.find((t) => t.tile === 27)
    expect(east?.remaining).toBe(1) // 2 in hand + 1 in East's river = 3 of 4 accounted for
  })

  it('replays the situation river to reach the saved decision point', () => {
    const situation = emptySituation()
    situation.seed = 'replay-seed'
    situation.hand = parseTenhou('123456789m12347z')
    situation.river = parseTenhou('7z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.turn).toBe(2)
    expect(result.current.rivers[0]).toEqual(parseTenhou('7z'))
    expect(result.current.drawn).toBeDefined()
    expect(result.current.cumulativeLost).toBe(0) // replayed turns are not graded
  })

  it('situationQuery round-trips the exact round state', () => {
    const situation = emptySituation()
    situation.seed = 'dump-seed'
    const opts: RoundOptions = { opponents: true, deadWall: true, aka: true }
    const a = renderHook(() => useEfficiencyRound(situation, opts, true))
    act(() => a.result.current.discard(0))
    act(() => a.result.current.discard(3))

    const decoded = decodeSituation(new URLSearchParams(a.result.current.situationQuery()))
    const b = renderHook(() =>
      useEfficiencyRound(
        decoded,
        {
          opponents: decoded.opponents ?? false,
          deadWall: decoded.deadWall ?? false,
          aka: decoded.aka ?? false,
        },
        true,
      ),
    )

    expect(b.result.current.hand).toEqual(a.result.current.hand)
    expect(b.result.current.drawn).toEqual(a.result.current.drawn)
    expect(b.result.current.turn).toBe(a.result.current.turn)
    expect(b.result.current.rivers).toEqual(a.result.current.rivers)
    expect(b.result.current.wallRemaining).toBe(a.result.current.wallRemaining)
    expect(b.result.current.doraIndicator).toEqual(a.result.current.doraIndicator)
  })
})
