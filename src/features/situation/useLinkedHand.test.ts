import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLinkedHand } from './useLinkedHand'

describe('useLinkedHand', () => {
  it('starts at hand 0, fromLink true', () => {
    const link = {}
    const { result } = renderHook(() => useLinkedHand(link))
    expect(result.current.handIndex).toBe(0)
    expect(result.current.fromLink).toBe(true)
  })

  it('next() advances the index and drops fromLink', () => {
    const link = {}
    const { result } = renderHook(() => useLinkedHand(link))
    act(() => result.current.next())
    expect(result.current.handIndex).toBe(1)
    expect(result.current.fromLink).toBe(false)
    act(() => result.current.next())
    expect(result.current.handIndex).toBe(2)
  })

  it('a new link object resets the index back to 0, even mid-stream', () => {
    let link = {}
    const { result, rerender } = renderHook(() => useLinkedHand(link))
    act(() => result.current.next())
    expect(result.current.handIndex).toBe(1)

    link = {} // a fresh identity, as a navigation (rewind, a new link) produces
    rerender()
    expect(result.current.handIndex).toBe(0)
    expect(result.current.fromLink).toBe(true)
  })

  it('re-rendering with the same link identity leaves the index alone', () => {
    const link = {}
    const { result, rerender } = renderHook(() => useLinkedHand(link))
    act(() => result.current.next())
    rerender()
    expect(result.current.handIndex).toBe(1)
  })
})
