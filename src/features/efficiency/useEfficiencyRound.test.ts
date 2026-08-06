import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseTenhou } from '../../core/tiles'
import { emptySituation } from '../situation/urlCodec'
import { useEfficiencyRound } from './useEfficiencyRound'

describe('useEfficiencyRound', () => {
  it('deals to 14 tiles and evaluates every discard against the seeded wall', () => {
    const situation = emptySituation()
    situation.seed = 'test-seed'
    situation.hand = parseTenhou('1112345678999m') // 13 tiles, nine-gates tenpai
    const { result } = renderHook(() => useEfficiencyRound(situation, true))

    expect(result.current.hand).toHaveLength(14)
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)
    expect(result.current.drawn).toBeDefined()

    act(() => result.current.discard(0))
    expect(result.current.lastResult?.turn).toBe(1)
    expect(result.current.hand).toHaveLength(14)
    expect(result.current.turn).toBe(2)
    expect(result.current.drawn).toBeDefined()
  })

  it('has no drawn tile for turn 1 when the situation already supplies all 14', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m11223p')
    const { result } = renderHook(() => useEfficiencyRound(situation, true))
    expect(result.current.hand).toHaveLength(14)
    expect(result.current.drawn).toBeUndefined()
  })

  it('finishes only once the wall is exhausted, not after a fixed turn count', () => {
    const situation = emptySituation()
    situation.seed = 'drain-seed'
    const { result } = renderHook(() => useEfficiencyRound(situation, true))

    for (let i = 0; i < 200 && !result.current.finished; i++) {
      act(() => result.current.discard(0))
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.wallRemaining).toBe(0)
  })

  it('counts situation river tiles as visible for ukeire remaining counts', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m11227z') // discard 7z -> shanpon tenpai on 1z/2z
    situation.rivers[1] = parseTenhou('11z') // the last two 1z are in a river, face up
    const { result } = renderHook(() => useEfficiencyRound(situation, true))

    act(() => result.current.discard(13)) // sorted hand: 7z is last
    const east = result.current.lastResult!.yours.ukeireTiles.find((t) => t.tile === 27)
    expect(east?.remaining).toBe(0) // 2 in hand + 2 in river = all 4 accounted for
  })

  it('preserves a red five pinned in the situation hand', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m0p1122z') // 14 tiles incl. red 5p, no draw
    const { result } = renderHook(() => useEfficiencyRound(situation, true))
    expect(result.current.hand).toContainEqual({ id: 13, red: true })
  })

  it('draws a red five from a pinned wall and drops it again on discard', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m1122z') // 13 tiles
    situation.wall = parseTenhou('0s5s')
    const { result } = renderHook(() => useEfficiencyRound(situation, true))

    expect(result.current.drawn).toEqual({ id: 22, red: true })
    expect(result.current.hand).toContainEqual({ id: 22, red: true })

    // sorted hand: 1m-9m (0-8), 5s red (9), 1z 1z (10, 11), 2z 2z (12, 13)
    act(() => result.current.discard(9))
    expect(result.current.drawn).toEqual({ id: 22, red: false }) // the normal 5s follows
    expect(result.current.hand).not.toContainEqual({ id: 22, red: true })
  })

  it('restart deals a fresh hand', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencyRound(situation, true))
    const firstHand = result.current.hand
    act(() => result.current.discard(0))
    act(() => result.current.restart())
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)
    expect(result.current.hand).not.toEqual(firstHand)
  })
})
