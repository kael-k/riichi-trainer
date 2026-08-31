import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { assessDiscards } from '../../core/danger'
import { evaluateDiscards } from '../../core/efficiency'
import { createMatch } from '../../core/match'
import { shanten } from '../../core/shanten'
import { type LogEntry, type RoundEvent, type RoundOptions } from '../../core/round'
import { splitDrawn, type TableSnapshot } from '../../core/table'
import { parseTenhou, SOU, type ParsedTile } from '../../core/tiles'
import { completeWall, wallWithHand, wallWithHands } from '../../core/wall'
import { useRound, type RoundCommand, type RoundEventContext } from './useRound'

// wraps the real implementations in vi.fn so laziness can be proved by call count, not
// inspection — every other test in this file still gets the real analysis, since these pass through
vi.mock('../../core/efficiency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/efficiency')>()
  return { ...actual, evaluateDiscards: vi.fn(actual.evaluateDiscards) }
})
vi.mock('../../core/danger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/danger')>()
  return { ...actual, assessDiscards: vi.fn(actual.assessDiscards) }
})

/** Bare yonma options: no opponents/riichi/calls, wins off — fully deterministic given a seeded
 *  wall. */
const BARE: RoundOptions = {
  sanma: false,
  aka: false,
  match: createMatch(false),
  calls: false,
  riichi: false,
  wins: false,
  algorithms: ['manual'],
}

/** Wall for seat 0: a pinned, already-tenpai 13-tile hand (shanpon on 1z/2z, via three man runs)
 *  plus a random draw and random opponents. Discarding whatever gets drawn (tsumogiri) always
 *  returns to this same pinned tenpai shape, regardless of what the random draw actually was. */
function tenpaiWall(seed: string) {
  return wallWithHand(0, parseTenhou('123456789m1122z'), false, false, seed)
}

/** The acting seat's hand as a page would draw it: every tile, with the 14th split out. */
function shown(result: { current: ReturnType<typeof useRound> }) {
  const snap = result.current.snapshot!
  return splitDrawn(
    snap.hands[snap.seat],
    snap.drawn?.seat === snap.seat ? snap.drawn.tile : undefined,
  )
}

/** Discards the acting seat's drawn tile — the tsumogiri every test below plays. */
function tsumogiri(result: { current: ReturnType<typeof useRound> }) {
  const { drawn } = shown(result)
  act(() => result.current.discard(drawn!, true))
}

describe('useRound', () => {
  it('reports the deal as engine events, with a draw for the acting seat', () => {
    const wall = tenpaiWall('match-initial-seed')
    const events: RoundEvent[] = []
    const { result } = renderHook(() =>
      useRound({
        wall,
        players: 4,
        options: BARE,
        onEvent: ({ event }) => void events.push(event),
      }),
    )
    expect(result.current.snapshot?.turn).toBe(1)
    expect(events.filter((e) => e.kind === 'draw')).toHaveLength(1)
    expect(shown(result).drawn).toBeDefined()
  })

  it('carries the pre-throw analysis on the discard event, after the tile has already left', () => {
    const wall = tenpaiWall('match-prethrow-seed')
    let seenCount: number | undefined
    let rankedFor: number | undefined
    const { result } = renderHook(() =>
      useRound({
        wall,
        players: 4,
        options: BARE,
        onEvent: ({ event, analysis, core }) => {
          if (event.kind !== 'discard') return
          // the live hand is already 13 tiles here — the analysis must not be
          expect(shanten(core.round.players[0].hand)).toBeDefined()
          seenCount = analysis!.hand.counts.reduce((a, b) => a + b, 0)
          rankedFor = analysis!.ranked.length
        },
      }),
    )
    tsumogiri(result)
    // 14 tiles ranked, one option per distinct kind held — never the 13-tile hand left behind
    expect(seenCount).toBe(14)
    expect(rankedFor).toBeGreaterThan(0)
  })

  it('never computes ranked or danger for a handler that ignores them', () => {
    vi.mocked(evaluateDiscards).mockClear()
    vi.mocked(assessDiscards).mockClear()
    const wall = tenpaiWall('match-lazy-seed')
    renderHook(() => useRound({ wall, players: 4, options: BARE, onEvent: () => undefined }))
    expect(evaluateDiscards).not.toHaveBeenCalled()
    expect(assessDiscards).not.toHaveBeenCalled()
  })

  it('halts on a stop command, leaving the hand at 13 tiles so it reads as finished', () => {
    const wall = tenpaiWall('match-stop-seed')
    const { result } = renderHook(() =>
      useRound({
        wall,
        players: 4,
        options: BARE,
        onEvent: ({ event, core }): RoundCommand => {
          if (event.kind !== 'discard' || event.seat !== 0) return
          if (shanten(core.round.players[0].hand) <= 0) return { stop: true }
        },
      }),
    )
    tsumogiri(result)
    const snap = result.current.snapshot!
    expect(snap.drawn).toBeUndefined()
    expect(snap.hands[0]).toHaveLength(13)
  })

  it('takes a fresh wall from a restart command instead of keeping the rejected deal', async () => {
    // reject the first two deals outright, keep the third: the driver must rebuild each time
    let rejections = 0
    const wall = completeWall([], false, false, 'match-restart-seed')
    const onEvent = ({ event }: RoundEventContext): RoundCommand => {
      if (event.kind !== 'draw' || rejections >= 2) return
      rejections++
      return { restart: [] }
    }
    const { result } = renderHook(() => useRound({ wall, players: 4, options: BARE, onEvent }))
    await waitFor(() => expect(rejections).toBe(2))
    await waitFor(() => expect(result.current.snapshot).toBeDefined())
    expect(result.current.snapshot!.hands[0].length).toBeGreaterThan(0)
  })

  it('marks replayed events so a consumer can rebuild state without grading them', () => {
    const wall = tenpaiWall('match-replay-seed')
    const first = renderHook(() => useRound({ wall, players: 4, options: BARE }))
    tsumogiri(first.result)
    const log: LogEntry[] = [...first.result.current.core!.round.log]
    expect(log.length).toBeGreaterThan(0)

    const live: RoundEvent[] = []
    const replayed: RoundEvent[] = []
    renderHook(() =>
      useRound({
        wall,
        players: 4,
        options: BARE,
        replay: log,
        onEvent: ({ event, replaying }) => void (replaying ? replayed : live).push(event),
      }),
    )
    // the restored decisions arrive as real engine events, not a second code path
    expect(replayed.some((e) => e.kind === 'discard')).toBe(true)
    expect(live.some((e) => e.kind === 'discard')).toBe(false)
  })

  it('does not double-report a replayed log under StrictMode', () => {
    const wall = tenpaiWall('match-strict-seed')
    const first = renderHook(() => useRound({ wall, players: 4, options: BARE }))
    tsumogiri(first.result)
    const log: LogEntry[] = [...first.result.current.core!.round.log]

    let discards = 0
    renderHook(
      () =>
        useRound({
          wall,
          players: 4,
          options: BARE,
          replay: log,
          onEvent: ({ event, replaying }) => {
            if (replaying && event.kind === 'discard') discards++
          },
        }),
      { wrapper: ({ children }) => createElement(StrictMode, null, children) },
    )
    expect(discards).toBe(log.filter((e) => e.kind === 'discard').length)
  })

  it('reports every manual seat, leaving the trainer to decide which one it grades', () => {
    const options: RoundOptions = {
      ...BARE,
      algorithms: ['manual', 'manual', 'efficiency', 'efficiency'],
    }
    const wall = tenpaiWall('match-multi-seed')
    const seats: number[] = []
    const { result } = renderHook(() =>
      useRound({
        wall,
        players: 4,
        options,
        onEvent: ({ event }) => {
          if (event.kind === 'discard') seats.push(event.seat)
        },
      }),
    )
    tsumogiri(result)
    // the turn stops at seat 1, which is also manual, rather than running past it
    expect(result.current.snapshot!.seat).toBe(1)
    tsumogiri(result)
    // seats 2 and 3 are on an algorithm, so they play themselves once seat 1 is done — every
    // seat's discard is reported, and it is the trainer that decides which of them it grades
    expect(seats.slice(0, 2)).toEqual([0, 1])
    expect(seats).toContain(2)
  })
})

describe('live option changes', () => {
  it('flipping an opponent between two AI algorithms never touches the running match', () => {
    const wall = tenpaiWall('match-live-general')
    const options: RoundOptions = {
      ...BARE,
      algorithms: ['manual', 'efficiency', 'efficiency', 'efficiency'],
    }
    const { result, rerender } = renderHook(
      (props: { options: RoundOptions }) => useRound({ wall, players: 4, options: props.options }),
      { initialProps: { options } },
    )
    tsumogiri(result)
    const { turn, rivers, liveWall } = result.current.snapshot!

    rerender({
      options: { ...options, algorithms: ['manual', 'defense', 'efficiency', 'efficiency'] },
    })

    const after = result.current.snapshot!
    expect(after.turn).toBe(turn)
    expect(after.rivers).toEqual(rivers)
    expect(after.liveWall).toEqual(liveWall)
  })

  it('toggling claims mid-hand leaves the hand exactly as it stands', () => {
    // `claims` is a reader preference, so the live-algorithm rule binds it: it must never redeal
    // through `wallWithHands`, not by concatenation: a seat's thirteen are dealt four at a time
    const wall = wallWithHands(
      [parseTenhou('2468m2468p9s2345z'), parseTenhou('1133557799m11p9s')],
      false,
      false,
      'match-claims-seed',
    )
    const options: RoundOptions = {
      ...BARE,
      wins: true,
      claims: true,
      algorithms: ['manual', 'manual', 'efficiency', 'efficiency'],
    }
    const { result, rerender } = renderHook(
      (props: { options: RoundOptions }) => useRound({ wall, players: 4, options: props.options }),
      { initialProps: { options } },
    )

    const { tiles } = shown(result)
    const nineSou = tiles.findIndex((t: ParsedTile) => t.id === SOU + 8)
    act(() => result.current.discard(tiles[nineSou], false))
    expect(result.current.snapshot!.claim?.seat).toBe(1)
    const { turn, rivers, liveWall } = result.current.snapshot!

    rerender({ options: { ...options, claims: false } })

    const after = result.current.snapshot!
    expect(after.turn).toBe(turn)
    expect(after.rivers).toEqual(rivers)
    expect(after.liveWall).toEqual(liveWall)
    // a prompt already on screen stays answerable: re-resolving it under `claims: false` would
    // drop its ron entry and cost seat 1 a win it was mid-way through taking
    expect(after.claim?.seat).toBe(1)
  })
})

describe('pacing', () => {
  /** Mounts a board at `pace` and records every distinct snapshot it commits — one entry per frame
   *  the reader would actually see. Recorded in the render body rather than an effect, since that
   *  is where a commit becomes visible and an effect would coalesce two of them. */
  function paced(pace: number, seed: string) {
    // one identity for the life of the hook: a wall rebuilt in the render body is a new link every
    // render, which `useLinkedHand` reads as a fresh hand to deal
    const wall = tenpaiWall(seed)
    const commits: (TableSnapshot | null)[] = []
    const { result } = renderHook(() => {
      const round = useRound({ wall, players: 4, options: BARE, pace })
      if (commits.at(-1) !== round.snapshot) commits.push(round.snapshot)
      return round
    })
    return { result, commits }
  }

  it('lands an unpaced go-around in the one commit it always did', () => {
    const { result, commits } = paced(0, 'match-pace-off')
    const before = commits.length
    // three AI seats play in full between the reader's discard and their next draw. Unpaced that
    // is one frame, and it has to stay one: the whole burst settles inside this synchronous `act`
    tsumogiri(result)
    expect(commits.length - before).toBe(1)
    expect(result.current.snapshot!.rivers.flat().length).toBe(4)
  })

  it('holds a tedashi\u2019s slot open and never a tsumogiri\u2019s', () => {
    // two mounts rather than two discards: one hold is still up 260ms after the first throw, and
    // the seat has moved on by then anyway
    const tedashi = paced(20, 'match-pace-throw')
    const { tiles } = shown(tedashi.result)
    // out of the thirteen: the hand it left keeps the hole until the tile lands
    act(() => tedashi.result.current.discard(tiles[0], false))
    expect(tedashi.result.current.tedashi).toEqual({ seat: 0, tile: tiles[0] })

    const tsumogiri = paced(20, 'match-pace-throw')
    const { drawn } = shown(tsumogiri.result)
    // straight off the draw: nothing left the row, so there is nothing to hold open — the river's
    // own flash is what says tsumogiri
    act(() => tsumogiri.result.current.discard(drawn!, true))
    expect(tsumogiri.result.current.tedashi).toBeUndefined()
  })

  it('commits a paced go-around turn by turn, and lands on the same board', () => {
    const { result: plain } = paced(0, 'match-pace-same')
    tsumogiri(plain)
    const settled = plain.current.snapshot!.rivers

    const { result, commits } = paced(20, 'match-pace-same')
    const before = commits.length
    tsumogiri(result)
    // the reader's own tile is committed the instant they throw it — they clicked it, there is
    // nothing to wait for — and the seats that follow are not yet on the board
    expect(commits.length - before).toBe(1)
    expect(result.current.snapshot!.rivers.flat().length).toBe(1)

    return waitFor(() => {
      expect(result.current.snapshot!.rivers).toEqual(settled)
      // one frame per opponent rather than one for the lot: that is the whole feature
      expect(commits.length - before).toBeGreaterThan(3)
    })
  })
})
