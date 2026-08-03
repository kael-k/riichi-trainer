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

    expect(result.current.result?.correct).toBe(true)
    expect(result.current.result?.actual.value).toBe(0)
    expect(result.current.result?.actual.paths).toContain('chiitoitsu')
    expect(result.current.correctCount).toBe(1)
    expect(result.current.totalCount).toBe(1)
  })

  it('newHand deals a fresh concealed hand and clears the result', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useShantenRound(situation, true))
    act(() => result.current.reveal())
    act(() => result.current.submit(0))
    act(() => result.current.newHand())
    expect(result.current.result).toBeNull()
    expect(result.current.concealed).toBe(true)
  })
})
