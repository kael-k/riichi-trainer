import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, PIN } from '../../core/tiles'
import { useLog } from '../../store/log'
import type { ScoringUrl } from './scoringUrl'
import { useScoringRound, type RoundOptions } from './useScoringRound'

const FULL: RoundOptions = {
  sanma: false,
  aka: true,
  openHands: true,
  honba: true,
  kiriageMangan: false,
  exactFu: false,
  ignoreFuOnLimit: false,
  testHan: true,
  testFu: true,
  testPoints: true,
}

function generated(seed: string): ScoringUrl {
  return { seed, situation: null }
}

describe('useScoringRound', () => {
  it('deals a hand with a precomputed score, visible immediately', () => {
    const urlData = generated('round-seed')
    const { result } = renderHook(() => useScoringRound(urlData, FULL, true))
    expect(result.current.situation.concealed.length).toBeGreaterThan(0)
    expect(result.current.actual.payments.total).toBeGreaterThan(0)
    expect(result.current.checked).toBe(false)
  })

  it('grades a fully correct answer', () => {
    const urlData = generated('grade-seed')
    const { result } = renderHook(() => useScoringRound(urlData, FULL, true))
    const { actual } = result.current
    const split = actual.payments.fromDealer !== undefined
    act(() =>
      result.current.check(
        split
          ? {
              han: actual.han,
              fu: actual.fu,
              pointsMain: actual.payments.main,
              pointsFromDealer: actual.payments.fromDealer,
            }
          : { han: actual.han, fu: actual.fu, points: actual.payments.main },
      ),
    )
    expect(result.current.checked).toBe(true)
    expect(result.current.lastResult?.correct).toBe(true)
    expect(result.current.correctCount).toBe(1)
    expect(result.current.totalCount).toBe(1)
  })

  it('grades a wrong han as incorrect overall, even with fu/points right', () => {
    const urlData = generated('wrong-seed')
    const { result } = renderHook(() => useScoringRound(urlData, FULL, true))
    const { actual } = result.current
    act(() =>
      result.current.check({ han: actual.han + 1, fu: actual.fu, points: actual.payments.main }),
    )
    expect(result.current.lastResult?.correctHan).toBe(false)
    expect(result.current.lastResult?.correct).toBe(false)
  })

  it('skips a disabled test entirely: wrong fu still grades correct when testFu is off', () => {
    const urlData = generated('skip-seed')
    const options: RoundOptions = { ...FULL, testFu: false }
    const { result } = renderHook(() => useScoringRound(urlData, options, true))
    const { actual } = result.current
    act(() => result.current.check({ han: actual.han, fu: -1, points: actual.payments.main }))
    expect(result.current.lastResult?.correctFu).toBe(true)
    expect(result.current.lastResult?.correct).toBe(true)
  })

  it('grades the exact (pre-rounding) fu when exactFu is on', () => {
    const urlData = generated('exact-seed')
    const options: RoundOptions = { ...FULL, exactFu: true }
    const { result } = renderHook(() => useScoringRound(urlData, options, true))
    const { actual } = result.current
    act(() =>
      result.current.check({ han: actual.han, fu: actual.fu, points: actual.payments.main }),
    )
    // if the rounded and exact fu differ, only the exact one should have graded as correct
    if (actual.fu !== actual.fuExact) expect(result.current.lastResult?.correctFu).toBe(false)
  })

  it('next() deals a fresh hand and resets checked/elapsed', () => {
    const urlData = generated('next-seed')
    const { result } = renderHook(() => useScoringRound(urlData, FULL, true))
    const first = result.current.situation
    act(() => result.current.check({ han: 0, fu: 0, points: 0 }))
    expect(result.current.checked).toBe(true)

    act(() => result.current.next())
    expect(result.current.checked).toBe(false)
    expect(result.current.elapsed).toBe(0)
    expect(result.current.situation).not.toEqual(first)
  })

  it('clearing the log resets the score and the average', () => {
    const urlData = generated('log-seed')
    const { result } = renderHook(() => useScoringRound(urlData, FULL, true))
    const { actual } = result.current
    act(() =>
      result.current.check({ han: actual.han, fu: actual.fu, points: actual.payments.main }),
    )
    expect(result.current.totalCount).toBe(1)

    act(() => useLog.getState().clear())
    expect(result.current.correctCount).toBe(0)
    expect(result.current.totalCount).toBe(0)
    expect(result.current.averageTime).toBe(0)
  })

  it('deals sanma hands without 2m-8m', () => {
    const urlData = generated('sanma-seed')
    const options: RoundOptions = { ...FULL, sanma: true }
    const { result } = renderHook(() => useScoringRound(urlData, options, true))
    const hasBanned = result.current.situation.concealed.some((t) => t.id >= 1 && t.id <= 7)
    expect(hasBanned).toBe(false)
  })

  it('reuses a pinned URL situation instead of generating one', () => {
    const pinned: ScoringUrl = {
      seed: '',
      situation: {
        concealed: parseTenhou('234567m456678p33s'),
        melds: [],
        ctx: {
          round: HONOR,
          seat: HONOR,
          tsumo: false,
          riichi: true,
          doubleRiichi: false,
          ippatsu: false,
          haitei: false,
          houtei: false,
          rinshan: false,
          chankan: false,
          winTile: PIN + 7,
        },
        doraIndicators: [],
        uraIndicators: [],
        kita: 0,
        honba: 0,
      },
    }
    const { result } = renderHook(() => useScoringRound(pinned, FULL, true))
    expect(result.current.situation.concealed).toEqual(pinned.situation!.concealed)
    expect(result.current.actual.payments.total).toBe(5800) // dealer riichi-pinfu-tanyao ron
    expect(result.current.invalidLink).toBe(false)
  })

  it('falls back to a generated hand when the pinned situation has no legal win', () => {
    const yakuless: ScoringUrl = {
      seed: 'fallback-seed',
      situation: {
        // 111m 456s 678p 888p 33p ron: complete, but two triplets kill pinfu and nothing else
        // applies, so it isn't a win at all
        concealed: parseTenhou('111m456s67888833p'),
        melds: [],
        ctx: {
          round: HONOR + 2,
          seat: HONOR + 2,
          tsumo: false,
          riichi: false,
          doubleRiichi: false,
          ippatsu: false,
          haitei: false,
          houtei: false,
          rinshan: false,
          chankan: false,
          winTile: PIN + 7,
        },
        doraIndicators: [],
        uraIndicators: [],
        kita: 0,
        honba: 0,
      },
    }
    const { result } = renderHook(() => useScoringRound(yakuless, FULL, true))
    expect(result.current.invalidLink).toBe(true)
    expect(result.current.situation.concealed).not.toEqual(yakuless.situation!.concealed)
    expect(result.current.actual.payments.total).toBeGreaterThan(0)
  })
})
