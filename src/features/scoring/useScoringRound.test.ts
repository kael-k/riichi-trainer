import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, PIN } from '../../core/tiles'
import { useLog } from '../../store/log'
import type { ScoringUrl } from './scoringUrl'
import { useScoringRound, type RoundOptions } from './useScoringRound'

const FULL: RoundOptions = {
  sanma: false,
  timerEnabled: true,
  table: true,
  showYaku: false,
  showFu: false,
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

/** Hands come from a simulated match now, so they arrive a tick later than they used to. */
async function deal(urlData: ScoringUrl, options: RoundOptions = FULL) {
  const { result } = renderHook(() => useScoringRound(urlData, options))
  await waitFor(() => expect(result.current.loading).toBe(false))
  return result
}

describe('useScoringRound', () => {
  it('deals a hand with a precomputed score', async () => {
    const result = await deal(generated('round-seed'))
    expect(result.current.situation!.concealed.length).toBeGreaterThan(0)
    expect(result.current.actual!.payments.total).toBeGreaterThan(0)
    expect(result.current.checked).toBe(false)
  })

  it('deals it from a real match, with rivers behind it', async () => {
    const result = await deal(generated('match-seed'))
    expect(result.current.match).not.toBeNull()
    // the winner is a seat at that table, and somebody has discarded by the time a hand is won
    expect(result.current.match!.players.length).toBe(4)
    expect(result.current.match!.players.some((p) => p.river.length > 0)).toBe(true)
    expect(result.current.seat).toBeGreaterThanOrEqual(0)
    expect(result.current.seat).toBeLessThan(4)
  })

  it('is reproducible from the same seed', async () => {
    const a = await deal(generated('repeat-seed'))
    const b = await deal(generated('repeat-seed'))
    expect(a.current.situation!.concealed).toEqual(b.current.situation!.concealed)
    expect(a.current.actual!.han).toBe(b.current.actual!.han)
  })

  it('grades a fully correct answer', async () => {
    const result = await deal(generated('grade-seed'))
    const actual = result.current.actual!
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

  it('grades a wrong han as incorrect overall, even with fu/points right', async () => {
    const result = await deal(generated('wrong-seed'))
    const actual = result.current.actual!
    act(() =>
      result.current.check({ han: actual.han + 1, fu: actual.fu, points: actual.payments.main }),
    )
    expect(result.current.lastResult?.correctHan).toBe(false)
    expect(result.current.lastResult?.correct).toBe(false)
  })

  it('skips a disabled test entirely: wrong fu still grades correct when testFu is off', async () => {
    const result = await deal(generated('skip-seed'), { ...FULL, testFu: false })
    const actual = result.current.actual!
    act(() => result.current.check({ han: actual.han, fu: -1, points: actual.payments.main }))
    expect(result.current.lastResult?.correctFu).toBe(true)
    expect(result.current.lastResult?.correct).toBe(true)
  })

  it('grades the exact (pre-rounding) fu when exactFu is on', async () => {
    const result = await deal(generated('exact-seed'), { ...FULL, exactFu: true })
    const actual = result.current.actual!
    act(() =>
      result.current.check({ han: actual.han, fu: actual.fu, points: actual.payments.main }),
    )
    // if the rounded and exact fu differ, only the exact one should have graded as correct
    if (actual.fu !== actual.fuExact) expect(result.current.lastResult?.correctFu).toBe(false)
  })

  it('next() deals a fresh hand and resets checked/elapsed', async () => {
    const result = await deal(generated('next-seed'))
    const first = result.current.situation
    // let the clock run, so "reset" is something the next hand actually has to undo
    await waitFor(() => expect(result.current.elapsed).toBeGreaterThan(80))
    act(() => result.current.check({ han: 0, fu: 0, points: 0 }))
    expect(result.current.checked).toBe(true)
    const before = result.current.elapsed

    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.checked).toBe(false)
    expect(result.current.elapsed).toBeLessThan(before)
    expect(result.current.situation).not.toEqual(first)
  })

  it('clearing the log resets the score and the average', async () => {
    const result = await deal(generated('log-seed'))
    const actual = result.current.actual!
    act(() =>
      result.current.check({ han: actual.han, fu: actual.fu, points: actual.payments.main }),
    )
    expect(result.current.totalCount).toBe(1)

    act(() => useLog.getState().clear())
    expect(result.current.correctCount).toBe(0)
    expect(result.current.totalCount).toBe(0)
    expect(result.current.averageTime).toBe(0)
  })

  it('deals sanma hands without 2m-8m', async () => {
    const result = await deal(generated('sanma-seed'), { ...FULL, sanma: true })
    expect(result.current.situation!.concealed.some((t) => t.id >= 1 && t.id <= 7)).toBe(false)
    expect(result.current.match?.players.length).toBe(3)
  })

  it('reuses a pinned URL situation instead of generating one', async () => {
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
    const result = await deal(pinned)
    expect(result.current.situation!.concealed).toEqual(pinned.situation!.concealed)
    expect(result.current.actual!.payments.total).toBe(5800) // dealer riichi-pinfu-tanyao ron
    expect(result.current.invalidLink).toBe(false)
    // a pinned hand has no match behind it, so the board falls back to winds and melds only
    expect(result.current.match).toBeNull()
  })

  it('falls back to a generated hand when the pinned situation has no legal win', async () => {
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
    const result = await deal(yakuless)
    expect(result.current.invalidLink).toBe(true)
    expect(result.current.situation!.concealed).not.toEqual(yakuless.situation!.concealed)
    expect(result.current.actual!.payments.total).toBeGreaterThan(0)
  })
})
