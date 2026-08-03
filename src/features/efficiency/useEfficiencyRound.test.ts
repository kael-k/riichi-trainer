import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseTenhou } from '../../core/tiles'
import { emptySituation } from '../situation/urlCodec'
import { useEfficiencyRound } from './useEfficiencyRound'

describe('useEfficiencyRound', () => {
  it('deals to 14 tiles and evaluates every discard against the seeded wall', () => {
    const situation = emptySituation()
    situation.seed = 'test-seed'
    situation.hand = parseTenhou('1112345678999m') // 13 tiles, tenpai on kokushi-ish shape
    const { result } = renderHook(() => useEfficiencyRound(situation, 3))

    expect(result.current.hand).toHaveLength(14)
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)

    act(() => result.current.discard(0))
    expect(result.current.lastResult?.turn).toBe(1)
    expect(result.current.hand).toHaveLength(14)
    expect(result.current.turn).toBe(2)
  })

  it('finishes after totalTurns and stops drawing', () => {
    const situation = emptySituation()
    situation.seed = 'test-seed-2'
    situation.hand = parseTenhou('123456789m123p')
    const { result } = renderHook(() => useEfficiencyRound(situation, 1))

    act(() => result.current.discard(0))
    expect(result.current.finished).toBe(true)
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.cumulativeLost).toBeGreaterThanOrEqual(0)
  })

  it('restart deals a fresh hand', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencyRound(situation, 5))
    const firstHand = result.current.hand
    act(() => result.current.discard(0))
    act(() => result.current.restart())
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)
    expect(result.current.hand).not.toEqual(firstHand)
  })
})
