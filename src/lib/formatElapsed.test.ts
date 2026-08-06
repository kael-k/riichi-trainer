import { describe, expect, it } from 'vitest'
import { formatElapsed, formatElapsedMs } from './formatElapsed'

describe('formatElapsed', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(75)).toBe('1:15')
  })

  it('formats milliseconds as m:ss.mmm, zero-padded', () => {
    expect(formatElapsedMs(5)).toBe('0:00.005')
    expect(formatElapsedMs(60_000)).toBe('1:00.000')
    expect(formatElapsedMs(75_432)).toBe('1:15.432')
    expect(formatElapsedMs(1234.6)).toBe('0:01.235') // rounded, not truncated
  })
})
