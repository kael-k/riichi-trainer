import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { assessDiscards } from '../../core/danger'
import { handFromTenhou } from '../../core/hand'
import { parseTenhou } from '../../core/tiles'
import { useLog } from '../../store/log'
import {
  decodeFoldingUrl,
  encodeFoldingUrl,
  useFoldingRound,
  type FoldingUrl,
  type RoundOptions,
} from './useFoldingRound'

const OPTIONS: RoundOptions = {
  sanma: false,
  timerEnabled: true,
  threats: 1,
  opponentWins: true,
  showEquallySafe: false,
}

/** Generation is a seed search, so hands arrive a tick (or several) later. */
async function deal(urlData: FoldingUrl, options: RoundOptions = OPTIONS) {
  const { result } = renderHook(() => useFoldingRound(urlData, options))
  await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 })
  return result
}

/** Index of a tile in the on-screen hand (the drawn tile sits at `hand.length`). */
function indexOf(hand: { id: number }[], drawn: { id: number } | undefined, tile: number): number {
  const i = hand.findIndex((t) => t.id === tile)
  return i >= 0 ? i : drawn?.id === tile ? hand.length : -1
}

describe('useFoldingRound', () => {
  it('deals a hand with a threat already in riichi and the decision on you', async () => {
    const result = await deal({ seed: 'fold-seed' })
    expect(result.current.failed).toBe(false)
    expect(result.current.threatSeats.length).toBeGreaterThanOrEqual(1)
    expect(result.current.threatSeats).not.toContain(result.current.seatIndex)
    // 13 + the tile you just drew, and the threat's declaration tile is lying sideways
    expect(result.current.hand.length + (result.current.drawn ? 1 : 0)).toBe(14)
    const threat = result.current.threatSeats[0]
    expect(result.current.rivers[threat].some((t) => t.riichi)).toBe(true)
  })

  it('only offers hands where the choice matters', async () => {
    const result = await deal({ seed: 'worth-seed' })
    const ranked = result.current.ranked()
    expect(ranked[0].tier).toBe('genbutsu')
    expect(ranked.some((e) => e.tier === 'nonSuji' || e.tier === 'halfSuji')).toBe(true)
    expect(result.current.finished).toBe(false)
  })

  it('is reproducible: the same seed rebuilds the same board', async () => {
    const a = await deal({ seed: 'repeat-seed' })
    const b = await deal({ seed: 'repeat-seed' })
    expect(a.current.hand).toEqual(b.current.hand)
    expect(a.current.rivers).toEqual(b.current.rivers)
    expect(a.current.seatIndex).toBe(b.current.seatIndex)
  })

  it('the share link replays into the identical board', async () => {
    const first = await deal({ seed: 'share-seed' })
    const query = first.current.situationQuery()
    const shared = await deal(decodeFoldingUrl(new URLSearchParams(query)))
    expect(shared.current.hand).toEqual(first.current.hand)
    expect(shared.current.rivers).toEqual(first.current.rivers)
    expect(shared.current.threatSeats).toEqual(first.current.threatSeats)
  })

  it('seats you somewhere other than always the declarer’s shimocha', async () => {
    const seats = new Set<number>()
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      const result = await deal({ seed })
      const threat = result.current.threatSeats[0]
      seats.add((result.current.seatIndex - threat + 4) % 4)
    }
    expect(seats.size).toBeGreaterThan(1)
  })

  it('a mid-hand link replays the discards behind it, and logs them', async () => {
    const first = await deal({ seed: 'midhand-seed' })
    for (let i = 0; i < 2 && !first.current.finished; i++) {
      const safe = first.current.ranked()[0]
      act(() => first.current.discard(indexOf(first.current.hand, first.current.drawn, safe.tile)))
    }
    const query = first.current.situationQuery()
    expect(new URLSearchParams(query).get('discards')).toBeTruthy()

    act(() => useLog.getState().clear())
    const shared = await deal(decodeFoldingUrl(new URLSearchParams(query)))
    expect(shared.current.hand).toEqual(first.current.hand)
    expect(shared.current.rivers).toEqual(first.current.rivers)
    expect(shared.current.turn).toBe(first.current.turn)
    // the replayed turns land on the log, each rewindable to the turn before it
    const replayed = useLog.getState().entries.filter((e) => e.key === 'log.replay')
    expect(replayed).toHaveLength(2)
    expect(new URLSearchParams(replayed[0].situation!).get('discards')).toBeNull()
  })

  it('grades a safest-tier discard correct and anything else wrong', async () => {
    const result = await deal({ seed: 'grade-seed' })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))
    expect(result.current.lastResult?.correct).toBe(true)
    expect(result.current.correctCount).toBe(1)

    const ranked = result.current.ranked()
    const risky = ranked[ranked.length - 1]
    if (risky.rank > 0) {
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, risky.tile)),
      )
      expect(result.current.lastResult?.correct).toBe(false)
      expect(result.current.lastResult?.safest[0].rank).toBe(0)
      expect(result.current.correctCount).toBe(1)
      expect(result.current.totalCount).toBe(2)
    }
  })

  it('plays the fold out: every turn to the end of the hand is graded', async () => {
    const result = await deal({ seed: 'multi-seed' })
    let turns = 0
    for (let i = 0; i < 4 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
      turns++
    }
    // the drill is the whole fold, not one question: the board keeps handing the turn back
    expect(turns).toBeGreaterThan(1)
    expect(result.current.totalCount).toBe(turns)
    expect(result.current.correctCount).toBe(turns)
  })

  it('with opponent wins off, the hand plays to the wall instead of ending on a win', async () => {
    const result = await deal({ seed: 'nowin-seed' }, { ...OPTIONS, opponentWins: false })
    // deliberately the most dangerous tile every turn: with wins off nobody can collect
    for (let i = 0; i < 40 && !result.current.finished; i++) {
      const ranked = result.current.ranked()
      const risky = ranked[ranked.length - 1]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, risky.tile)),
      )
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.end!.kind).not.toBe('dealIn')
    expect(result.current.end!.seat).toBeUndefined()
    // still a real fold: the ranking graded every one of those throws
    expect(result.current.totalCount).toBeGreaterThan(1)
  })

  it('never lets a folding opponent declare a second riichi', async () => {
    const result = await deal({ seed: 'multi-seed' })
    const initialThreats = result.current.threatSeats.length
    for (let i = 0; i < 30 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
      expect(result.current.threatSeats.length).toBe(initialThreats)
    }
  })

  it('holds the reveal back until the hand is over', async () => {
    const result = await deal({ seed: 'reveal-seed' })
    expect(result.current.end).toBeNull()
    for (let i = 0; i < 30 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
    }
    expect(result.current.finished).toBe(true)
    const end = result.current.end!
    expect(end.threats.length).toBeGreaterThanOrEqual(1)
    // a threat in riichi is tenpai by construction, so it has a real wait to show
    expect(end.threats[0].hand.length).toBe(13)
    expect(end.threats[0].waits.length).toBeGreaterThan(0)
  })

  it('never lets the engine call for the player', async () => {
    const result = await deal({ seed: 'nocall-seed' })
    // a seat can arrive holding a meld it called before the drill started; what must never grow
    // is the pile after the board is handed over
    const atHandover = result.current.melds[result.current.seatIndex]
    for (let i = 0; i < 10 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
    }
    expect(result.current.melds[result.current.seatIndex]).toEqual(atHandover)
  })

  it('deals sanma boards without 2m-8m', async () => {
    const result = await deal({ seed: 'sanma-seed' }, { ...OPTIONS, sanma: true })
    expect(result.current.rivers).toHaveLength(3)
    expect(result.current.hand.some((t) => t.id >= 1 && t.id <= 7)).toBe(false)
  })

  it('next() deals a different hand', async () => {
    const result = await deal({ seed: 'next-seed' })
    const first = result.current.hand
    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 })
    expect(result.current.hand).not.toEqual(first)
    expect(result.current.lastResult).toBeNull()
  })

  it('clearing the log resets the session score', async () => {
    const result = await deal({ seed: 'log-seed' })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))
    expect(result.current.totalCount).toBe(1)
    act(() => useLog.getState().clear())
    expect(result.current.totalCount).toBe(0)
    expect(result.current.averageTime).toBe(0)
  })
})

describe('the folding link', () => {
  it('round-trips the seed and the rules the board was built under', () => {
    const query = encodeFoldingUrl('abc#3', { sanma: true, threats: 2, wins: true })
    expect(decodeFoldingUrl(new URLSearchParams(query))).toEqual({
      seed: 'abc#3',
      sanma: true,
      wins: true,
      threats: 2,
      discards: undefined,
    })
  })

  it('round-trips the discards played since the handover', () => {
    const discards = parseTenhou('1m9p7z')
    const query = encodeFoldingUrl('abc', { sanma: false, threats: 1, wins: true }, discards)
    expect(decodeFoldingUrl(new URLSearchParams(query)).discards).toEqual(discards)
  })

  it('leaves unset rules undefined, so the reader keeps their own settings', () => {
    expect(decodeFoldingUrl(new URLSearchParams(''))).toEqual({
      seed: '',
      sanma: undefined,
      wins: undefined,
      threats: undefined,
      discards: undefined,
    })
  })
})

describe('assessDiscards through the hook', () => {
  it('is the same ranking the trainer grades on', () => {
    // guards the contract the hook relies on: rank 0 is the safest tier, ties included
    const ranked = assessDiscards(
      handFromTenhou('123m456p789s11z'),
      [{ seat: 1, discards: [0], passed: [] }],
      new Uint8Array(34),
      false,
    )
    expect(ranked[0].rank).toBe(0)
    expect(ranked.filter((e) => e.rank === 0).every((e) => e.tier === ranked[0].tier)).toBe(true)
  })
})
