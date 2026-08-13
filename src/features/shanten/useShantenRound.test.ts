import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseTenhou } from '../../core/tiles'
import { useLog } from '../../store/log'
import { decodeSituation, emptySituation } from '../situation/urlCodec'
import { useShantenRound } from './useShantenRound'

describe('useShantenRound', () => {
  it('deals a concealed 13-tile hand', () => {
    const situation = emptySituation()
    situation.seed = 'shanten-seed'
    const { result } = renderHook(() => useShantenRound(situation, true, false))
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.concealed).toBe(true)
    expect(result.current.running).toBe(false)
  })

  it('reveal shows the hand; stop re-conceals, resets the timer and deals a new hand', () => {
    const situation = emptySituation()
    situation.seed = 'stop-seed'
    const { result } = renderHook(() => useShantenRound(situation, true, false))
    act(() => result.current.reveal())
    expect(result.current.running).toBe(true)
    expect(result.current.concealed).toBe(false)
    const revealed = result.current.hand

    act(() => result.current.stop())
    expect(result.current.running).toBe(false)
    expect(result.current.concealed).toBe(true)
    expect(result.current.elapsed).toBe(0)
    expect(result.current.hand).not.toEqual(revealed) // a peeked hand is never re-served
    expect(result.current.totalCount).toBe(0) // abandoned, not graded
  })

  it('pausing freezes the clock without re-concealing an already-revealed hand', () => {
    const situation = emptySituation()
    situation.seed = 'pause-seed'
    const { result } = renderHook(() => useShantenRound(situation, true, false))
    act(() => result.current.reveal())
    const revealed = result.current.hand
    expect(result.current.paused).toBe(false)

    act(() => result.current.togglePause())
    expect(result.current.paused).toBe(true)
    expect(result.current.running).toBe(false)
    expect(result.current.concealed).toBe(false) // still shown — a pause is not a stop
    expect(result.current.hand).toEqual(revealed)

    act(() => result.current.togglePause())
    expect(result.current.paused).toBe(false)
    expect(result.current.running).toBe(true)
    expect(result.current.concealed).toBe(false)
    expect(result.current.hand).toEqual(revealed) // resuming never re-deals
  })

  it('grades a submitted guess and names non-standard paths', () => {
    const situation = emptySituation()
    // seven distinct pairs: tenpai (0-shanten) via chiitoitsu, worse via standard
    situation.hand = parseTenhou('1122334455667m')
    const { result } = renderHook(() => useShantenRound(situation, true, false))

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
    const { result } = renderHook(() => useShantenRound(situation, true, false))
    expect(result.current.hand).toContainEqual({ id: 13, red: true })
  })

  it('rolls straight into the next hand, still revealed and timing', () => {
    const situation = emptySituation()
    situation.seed = 'stream-seed'
    const { result } = renderHook(() => useShantenRound(situation, true, false))
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

  it('clearing the log resets the score and the average', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('1122334455667m')
    const { result } = renderHook(() => useShantenRound(situation, true, false))
    act(() => result.current.reveal())
    act(() => result.current.submit(0))
    expect(result.current.correctCount).toBe(1)
    expect(result.current.averageTime).toBeGreaterThanOrEqual(0)

    act(() => useLog.getState().clear())
    expect(result.current.correctCount).toBe(0)
    expect(result.current.totalCount).toBe(0)
    expect(result.current.averageTime).toBe(0)
  })

  it('logs the graded hand as a situation the row can rewind to, then moves on', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('1122334455667m')
    const { result } = renderHook(() => useShantenRound(situation, true, false))
    act(() => result.current.reveal())
    act(() => result.current.submit(0))

    const entry = useLog.getState().entries.at(-1)!
    expect(decodeSituation(new URLSearchParams(entry.situation!)).hand).toEqual(situation.hand)
    // a pinned hand is served once: the stream carries on rather than re-serving it forever
    expect(result.current.hand).not.toEqual(situation.hand)
  })

  it('deals sanma hands without 2m-8m', () => {
    const situation = emptySituation()
    situation.seed = 'shanten-sanma-seed'
    const { result } = renderHook(() => useShantenRound(situation, true, true))
    expect(result.current.hand.some((t) => t.id >= 1 && t.id <= 7)).toBe(false)
  })
})
