import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseTenhou } from '../../core/tiles'
import { emptySituation } from '../situation/urlCodec'
import { useShantenRound } from './useShantenRound'

describe('useShantenRound', () => {
  it('deals a concealed 13-tile hand', () => {
    const situation = emptySituation()
    situation.seed = 'shanten-seed'
    const { result } = renderHook(() => useShantenRound(situation, true))
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.concealed).toBe(true)
    expect(result.current.running).toBe(false)
  })

  it('reveal starts the timer; pause re-conceals', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useShantenRound(situation, true))
    act(() => result.current.reveal())
    expect(result.current.running).toBe(true)
    expect(result.current.concealed).toBe(false)
    act(() => result.current.pause())
    expect(result.current.running).toBe(false)
    expect(result.current.concealed).toBe(true)
  })

  it('grades a submitted guess and names non-standard paths', () => {
    const situation = emptySituation()
    // seven distinct pairs: tenpai (0-shanten) via chiitoitsu, worse via standard
    situation.hand = parseTenhou('1122334455667m')
    const { result } = renderHook(() => useShantenRound(situation, true))

    act(() => result.current.reveal())
    act(() => result.current.submit(0))

    expect(result.current.lastResult?.correct).toBe(true)
    expect(result.current.lastResult?.actual.value).toBe(0)
    expect(result.current.lastResult?.actual.paths).toContain('chiitoitsu')
    expect(result.current.lastResult?.hand).toEqual(situation.hand)
    expect(result.current.correctCount).toBe(1)
    expect(result.current.totalCount).toBe(1)
  })

  it('preserves a red five pinned in the situation hand', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m0p112z') // 13 tiles incl. red 5p
    const { result } = renderHook(() => useShantenRound(situation, true))
    expect(result.current.hand).toContainEqual({ id: 13, red: true })
  })

  it('rolls straight into the next hand, still revealed and timing', () => {
    const situation = emptySituation()
    situation.seed = 'stream-seed'
    const { result } = renderHook(() => useShantenRound(situation, true))
    act(() => result.current.reveal())
    const first = result.current.hand

    act(() => result.current.submit(0))
    expect(result.current.hand).not.toEqual(first)
    expect(result.current.lastResult?.hand).toEqual(first) // feedback keeps the graded hand
    expect(result.current.running).toBe(true)
    expect(result.current.concealed).toBe(false)
    expect(result.current.elapsed).toBe(0) // per-hand timer restarts

    act(() => result.current.submit(1))
    expect(result.current.totalCount).toBe(2) // no button press in between
  })
})
