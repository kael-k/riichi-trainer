import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createMatch } from '../../core/match'
import { playWall } from '../../core/round'
import { mulberry32 } from '../../core/rng'
import { HONOR, parseTenhou, PIN, serializeTenhouOrdered, type ParsedTile } from '../../core/tiles'
import { completeWall } from '../../core/wall'
import { useLog } from '../../store/log'
import { decodeScoringUrl, type ScoringUrl } from './scoringUrl'
import { useScoringRound, type ScoringOptions } from './useScoringRound'

const FULL: ScoringOptions = {
  sanma: false,
  table: true,
  aka: true,
  kiriageMangan: false,
  exactFu: false,
  ignoreFuOnLimit: false,
  testHan: true,
  testFu: true,
  testPoints: true,
}

/** A genuinely random hand — no wall pinned, matching ADR-0005: with no wall in the link, the
 *  trainer loops fresh random-wall matches rather than reproducing from a seed. */
const EMPTY_WALL: ParsedTile[] = []
function generated(): ScoringUrl {
  return { wall: EMPTY_WALL, situation: null }
}

/** A deterministic wall a test can pin, replacing the old seed-only setup — `completeWall`
 *  keeps backing reproducible test fixtures even though seeds are dropped as the shared/URL
 *  record (ADR-0005, ADR-0013). */
function fixtureWall(seed: string, sanma = false, aka = true): ScoringUrl {
  return { wall: completeWall([], sanma, aka, seed), situation: null }
}

/** Hands come from a simulated match now, so they arrive a tick later than they used to. */
async function deal(urlData: ScoringUrl, options: ScoringOptions = FULL) {
  const { result } = renderHook(() => useScoringRound(urlData, options))
  await waitFor(() => expect(result.current.loading).toBe(false))
  return result
}

describe('useScoringRound', () => {
  it('deals a hand with a precomputed score', async () => {
    const result = await deal(fixtureWall('round-seed'))
    expect(result.current.situation!.concealed.length).toBeGreaterThan(0)
    expect(result.current.actual!.payments.total).toBeGreaterThan(0)
    expect(result.current.checked).toBe(false)
  })

  it('deals it from a real match, with rivers behind it', async () => {
    const result = await deal(fixtureWall('match-seed'))
    expect(result.current.round).not.toBeNull()
    // the winner is a seat at that table, and somebody has discarded by the time a hand is won
    expect(result.current.round!.players.length).toBe(4)
    expect(result.current.round!.players.some((p) => p.river.length > 0)).toBe(true)
    expect(result.current.seat).toBeGreaterThanOrEqual(0)
    expect(result.current.seat).toBeLessThan(4)
  })

  // what a share link and the log's rewind button both ride on: the query a round dumps has to
  // deal that very hand back, not merely a hand from a related wall
  it('replays the hand its own situationQuery names, han and fu included', async () => {
    const a = await deal(fixtureWall('share-seed'))
    const query = new URLSearchParams(a.current.situationQuery())
    const b = await deal(decodeScoringUrl(query))
    expect(b.current.situation!.concealed).toEqual(a.current.situation!.concealed)
    expect(b.current.actual!.han).toBe(a.current.actual!.han)
    expect(b.current.actual!.fu).toBe(a.current.actual!.fu)
  })

  it('is reproducible from the same wall', async () => {
    // a wall that itself contains a legal win, so both hooks resolve it directly rather than
    // falling through to two independently-random searches
    const wall = winningWall('repeat-seed')
    const a = await deal({ wall, situation: null })
    const b = await deal({ wall, situation: null })
    expect(a.current.situation!.concealed).toEqual(b.current.situation!.concealed)
    expect(a.current.actual!.han).toBe(b.current.actual!.han)
  })

  it('grades a fully correct answer', async () => {
    const result = await deal(fixtureWall('grade-seed'))
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
    const result = await deal(fixtureWall('wrong-seed'))
    const actual = result.current.actual!
    act(() =>
      result.current.check({ han: actual.han + 1, fu: actual.fu, points: actual.payments.main }),
    )
    expect(result.current.lastResult?.correctHan).toBe(false)
    expect(result.current.lastResult?.correct).toBe(false)
  })

  it('skips a disabled test entirely: wrong fu still grades correct when testFu is off', async () => {
    const result = await deal(fixtureWall('skip-seed'), { ...FULL, testFu: false })
    const actual = result.current.actual!
    act(() => result.current.check({ han: actual.han, fu: -1, points: actual.payments.main }))
    expect(result.current.lastResult?.correctFu).toBe(true)
    expect(result.current.lastResult?.correct).toBe(true)
  })

  it('grades the exact (pre-rounding) fu when exactFu is on', async () => {
    const result = await deal(fixtureWall('exact-seed'), { ...FULL, exactFu: true })
    const actual = result.current.actual!
    act(() =>
      result.current.check({ han: actual.han, fu: actual.fu, points: actual.payments.main }),
    )
    // if the rounded and exact fu differ, only the exact one should have graded as correct
    if (actual.fu !== actual.fuExact) expect(result.current.lastResult?.correctFu).toBe(false)
  })

  it('next() deals a fresh hand and resets checked/elapsed', async () => {
    const result = await deal(generated())
    const first = result.current.situation
    // let the clock run, so "reset" is something the next hand actually has to undo
    await waitFor(() => expect(result.current.elapsedNow()).toBeGreaterThan(80))
    act(() => result.current.check({ han: 0, fu: 0, points: 0 }))
    expect(result.current.checked).toBe(true)
    const before = result.current.elapsedNow()

    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.checked).toBe(false)
    expect(result.current.elapsedNow()).toBeLessThan(before)
    expect(result.current.situation).not.toEqual(first)
  })

  it('clearing the log resets the score and the average', async () => {
    const result = await deal(fixtureWall('log-seed'))
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
    const result = await deal(fixtureWall('sanma-seed', true), { ...FULL, sanma: true })
    expect(result.current.situation!.concealed.some((t) => t.id >= 1 && t.id <= 7)).toBe(false)
    expect(result.current.round?.players.length).toBe(3)
  })

  it('reuses a pinned URL situation instead of generating one', async () => {
    const pinned: ScoringUrl = {
      wall: [],
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
    expect(result.current.round).toBeNull()
  })

  // regression: a link (or a rewind, which pushes the same params) named exactly one hand, and
  // `next()` used to keep re-posing it forever because the pinned branch had no handIndex guard
  it('next() moves off a pinned situation onto a freshly generated hand', async () => {
    const pinned: ScoringUrl = {
      wall: [],
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

    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.situation!.concealed).not.toEqual(pinned.situation!.concealed)
    expect(result.current.invalidLink).toBe(false)
  })

  // same regression, for a pinned wall rather than a pinned situation — the other branch that
  // used to have no handIndex guard
  it('next() moves off a pinned wall onto a freshly generated hand', async () => {
    const wall = winningWall('pinned-wall-next-seed')
    const result = await deal({ wall, situation: null })
    const first = result.current.situation

    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.situation).not.toEqual(first)
    expect(result.current.invalidLink).toBe(false)
  })

  it('falls back to a generated hand when the pinned situation has no legal win', async () => {
    const yakuless: ScoringUrl = {
      wall: [],
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

  it('falls back to a generated hand when a pinned wall has no legal win', async () => {
    const wall = nonWinningWall('no-win-wall-seed')
    const result = await deal({ wall, situation: null })
    expect(result.current.invalidLink).toBe(true)
    expect(result.current.actual!.payments.total).toBeGreaterThan(0)
  })
})

// searches wall-fill seed suffixes (mirroring `core/round.test.ts`'s `findRound` pattern) for one
// whose *own* deal ends in a win, so "reproducible from the same wall" doesn't depend on the
// non-deterministic random-search fallback landing on the same result twice
function winningWall(seed: string): ParsedTile[] {
  for (let i = 0; i < 40; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const wall = completeWall([], FULL.sanma, FULL.aka, attemptSeed)
    if (hasWin(wall)) return wall
  }
  throw new Error(`no winning wall found for seed ${seed}`)
}

// the inverse of `winningWall`: a deal that itself reaches exhaustive draw (or no scoreable win),
// so the "pinned wall has no legal win" test deterministically exercises the fallback path rather
// than hoping a hand-picked wall happens not to win
function nonWinningWall(seed: string): ParsedTile[] {
  for (let i = 0; i < 200; i++) {
    const attemptSeed = i === 0 ? seed : `${seed}#${i}`
    const wall = completeWall([], FULL.sanma, FULL.aka, attemptSeed)
    if (!hasWin(wall)) return wall
  }
  throw new Error(`no non-winning wall found for seed ${seed}`)
}

// re-derives the same round `useScoringRound`'s own `roundOptions` would, so this check tells the
// truth about what the hook itself will see when handed the wall
function hasWin(wall: ParsedTile[]): boolean {
  const rng = mulberry32(`${serializeTenhouOrdered(wall)}:round`)
  const prevalentWind = HONOR + Math.floor(rng() * 4)
  const outcome = playWall(wall, 4, {
    sanma: FULL.sanma,
    aka: FULL.aka,
    match: createMatch(FULL.sanma, { prevalentWind }),
    calls: true,
    riichi: true,
    wins: true,
  })
  return outcome.state.win !== undefined
}
