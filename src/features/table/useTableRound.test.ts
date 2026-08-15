import { act, renderHook } from '@testing-library/react'
import { createElement, StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { assessDiscards } from '../../core/danger'
import { evaluateDiscards } from '../../core/efficiency'
import { beginTurn, createMatch, finishTurn, type LogEntry, type MatchOptions } from '../../core/match'
import { HONOR, parseTenhou, SOU, type ParsedTile } from '../../core/tiles'
import { completeWall, INITIAL_HAND_SIZE, wallWithHand } from '../../core/wall'
import { useTableRound, type DiscardStats } from './useTableRound'

// wraps the real implementations in vi.fn so laziness (D-05) can be proved by call count, not
// inspection — every other test in this file still gets the real analysis, since these pass through
vi.mock('../../core/efficiency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/efficiency')>()
  return { ...actual, evaluateDiscards: vi.fn(actual.evaluateDiscards) }
})
vi.mock('../../core/danger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/danger')>()
  return { ...actual, assessDiscards: vi.fn(actual.assessDiscards) }
})

/** Bare yonma options: no opponents/riichi/calls/dead wall, wins on — fully deterministic given a
 *  seeded wall. */
const BARE: MatchOptions = {
  sanma: false,
  aka: false,
  round: HONOR,
  deadWall: false,
  calls: false,
  riichi: false,
  wins: false,
  algorithms: ['manual'],
}

/** Wall for seat 0: a pinned, already-tenpai 13-tile hand (shanpon on 1z/2z, via three man runs)
 *  plus a random draw and random opponents. Discarding whatever gets drawn (tsumogiri) always
 *  returns to this same pinned tenpai shape, regardless of what the random draw actually was —
 *  which is what makes "reaches tenpai" deterministic without pinning the draw itself. */
function tenpaiWall(seed: string) {
  return wallWithHand(0, parseTenhou('123456789m1122z'), false, false, seed)
}

describe('useTableRound', () => {
  it('fires onUserDraw exactly once on the initial build, turn 1, analysing the 14-tile hand', () => {
    const wall = tenpaiWall('table-initial-seed')
    const onUserDraw = vi.fn()
    renderHook(() => useTableRound({ wall, players: 4, seatIndex: 0, options: BARE, onUserDraw }))

    expect(onUserDraw).toHaveBeenCalledTimes(1)
    const ctx = onUserDraw.mock.calls[0][0]
    expect(ctx.turn).toBe(1)
    expect(ctx.analysis.ranked.length).toBeGreaterThan(0)
  })

  it("onUserDiscard's stats.analysis is the same object onUserDraw handed over", () => {
    const wall = tenpaiWall('table-identity-seed')
    const onUserDraw = vi.fn()
    const onUserDiscard = vi.fn()
    const { result } = renderHook(() =>
      useTableRound({ wall, players: 4, seatIndex: 0, options: BARE, onUserDraw, onUserDiscard }),
    )

    act(() => result.current.discard(0))
    expect(onUserDiscard).toHaveBeenCalledTimes(1)
    expect(onUserDiscard.mock.calls[0][1].analysis).toBe(onUserDraw.mock.calls[0][0].analysis)
  })

  it('fires onUserDraw again with a fresh analysis object and an advanced turn after a live discard', () => {
    const wall = tenpaiWall('table-fresh-seed')
    const onUserDraw = vi.fn()
    const { result } = renderHook(() =>
      useTableRound({ wall, players: 4, seatIndex: 0, options: BARE, onUserDraw }),
    )

    act(() => result.current.discard(0))
    expect(onUserDraw).toHaveBeenCalledTimes(2)
    expect(onUserDraw.mock.calls[1][0].analysis).not.toBe(onUserDraw.mock.calls[0][0].analysis)
    expect(onUserDraw.mock.calls[1][0].turn).toBeGreaterThanOrEqual(
      onUserDraw.mock.calls[0][0].turn,
    )
  })

  it('reading .danger never triggers evaluateDiscards, and reading .yours never triggers assessDiscards', () => {
    const wall = tenpaiWall('table-lazy-seed')
    let captured: DiscardStats | undefined
    const { result } = renderHook(() =>
      useTableRound({
        wall,
        players: 4,
        seatIndex: 0,
        options: BARE,
        onUserDiscard: (_tile, stats) => {
          captured = stats
        },
      }),
    )

    vi.mocked(evaluateDiscards).mockClear()
    act(() => result.current.discard(0))
    void captured!.danger
    expect(vi.mocked(evaluateDiscards)).not.toHaveBeenCalled()

    vi.mocked(assessDiscards).mockClear()
    act(() => result.current.discard(0))
    void captured!.yours
    expect(vi.mocked(assessDiscards)).not.toHaveBeenCalled()
  })

  it('replaying discards fires zero onUserDraw/onUserDiscard, then exactly one onUserDraw for the live turn', () => {
    const wall = tenpaiWall('table-replay-seed')
    // a real, playable-out log — every seat's turn, not just seat 0's — captured by driving the
    // engine bare (BARE's calls/riichi/wins are all off, so nothing can interrupt the cycle):
    // seat 0 discards, then 1/2/3 each take their own turn, then seat 0 discards again
    const capture = createMatch(wall, 4, BARE)
    for (let t = 0; t < 5; t++) {
      beginTurn(capture, BARE)
      finishTurn(capture, BARE)
    }
    // identity-stable, like `wall` above — an inline array literal in the render callback would
    // fail the effect's own dependency check on every render and never settle
    const replay: LogEntry[] = [...capture.log]
    const onUserDraw = vi.fn()
    const onUserDiscard = vi.fn()
    renderHook(() =>
      useTableRound({
        wall,
        players: 4,
        seatIndex: 0,
        options: BARE,
        replay,
        onUserDraw,
        onUserDiscard,
      }),
    )

    expect(onUserDiscard).not.toHaveBeenCalled()
    expect(onUserDraw).toHaveBeenCalledTimes(1)
  })

  it('fires onAgariCall once with the winning seat, matching the snapshot win field', () => {
    const wall = tenpaiWall('table-win-seed')
    wall[4 * INITIAL_HAND_SIZE] = { id: HONOR, red: false } // 1z tsumo completes the shanpon
    const options: MatchOptions = { ...BARE, wins: true }
    const onAgariCall = vi.fn()
    const { result } = renderHook(() =>
      useTableRound({ wall, players: 4, seatIndex: 0, options, onAgariCall }),
    )

    expect(onAgariCall).toHaveBeenCalledTimes(1)
    expect(onAgariCall.mock.calls[0][0].seat).toBe(0)
    expect(onAgariCall.mock.calls[0][0]).toBe(result.current.win)
  })

  it('stopAtTenpai leaves the hand at 13 tiles and fires no further onUserDraw', () => {
    const wall = tenpaiWall('table-stop-seed')
    const onUserDraw = vi.fn()
    const { result } = renderHook(() =>
      useTableRound({
        wall,
        players: 4,
        seatIndex: 0,
        options: BARE,
        stopAtTenpai: true,
        onUserDraw,
      }),
    )

    expect(onUserDraw).toHaveBeenCalledTimes(1)
    act(() => result.current.discard(result.current.hand.length)) // tsumogiri, back to the pinned shape
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeUndefined()
    expect(onUserDraw).toHaveBeenCalledTimes(1)
  })

  it('without stopAtTenpai, the round plays on past tenpai and draws again', () => {
    const wall = tenpaiWall('table-playon-seed')
    const onUserDraw = vi.fn()
    const { result } = renderHook(() =>
      useTableRound({ wall, players: 4, seatIndex: 0, options: BARE, onUserDraw }),
    )

    act(() => result.current.discard(result.current.hand.length))
    expect(result.current.drawn).toBeDefined()
    expect(onUserDraw).toHaveBeenCalledTimes(2)
  })

  it("kita() fires onUserDiscard with stats.kind 'kita', then onUserDraw for the replacement", () => {
    const hand = parseTenhou('19m19p19s1234567z') // includes 4z = North
    const wall = wallWithHand(0, hand, true, false, 'table-kita-seed')
    const options: MatchOptions = { ...BARE, sanma: true }
    const onUserDraw = vi.fn()
    const onUserDiscard = vi.fn()
    const { result } = renderHook(() =>
      useTableRound({ wall, players: 3, seatIndex: 0, options, onUserDraw, onUserDiscard }),
    )

    onUserDraw.mockClear()
    act(() => result.current.kita())
    expect(onUserDiscard).toHaveBeenCalledTimes(1)
    expect(onUserDiscard.mock.calls[0][1].kind).toBe('kita')
    expect(onUserDraw).toHaveBeenCalledTimes(1)
  })

  it("kan() fires onUserDiscard with stats.kind 'kan', then onUserDraw for the replacement", () => {
    const hand = parseTenhou('1111m123456789p') // four 1m (13 tiles total)
    const wall = wallWithHand(0, hand, false, false, 'table-kan-seed')
    const onUserDraw = vi.fn()
    const onUserDiscard = vi.fn()
    const { result } = renderHook(() =>
      useTableRound({ wall, players: 4, seatIndex: 0, options: BARE, onUserDraw, onUserDiscard }),
    )

    onUserDraw.mockClear()
    act(() => result.current.kan(0)) // 1m
    expect(onUserDiscard).toHaveBeenCalledTimes(1)
    expect(onUserDiscard.mock.calls[0][1].kind).toBe('kan')
    expect(onUserDraw).toHaveBeenCalledTimes(1)
  })

  it('restart() rebuilds from an empty wall, dealing a different board', () => {
    // an identity-stable `wall` (a module-scope-style const, not an inline `[]` literal) — a
    // fresh array every render would fail the hook's own "reset while rendering" identity check
    // on every render and spin forever, which is exactly the contract the hook's doc comment warns
    // callers to uphold
    const emptyWall: ParsedTile[] = []
    const { result } = renderHook(() =>
      useTableRound({ wall: emptyWall, players: 4, seatIndex: 0, options: BARE }),
    )
    const firstHand = result.current.hand
    act(() => result.current.restart())
    expect(result.current.hand).not.toEqual(firstHand)
  })

  it('fires each callback once per real event even under React StrictMode double-invoked effects', () => {
    const wall = tenpaiWall('table-strict-seed')
    const onUserDraw = vi.fn()
    const { result } = renderHook(
      () => useTableRound({ wall, players: 4, seatIndex: 0, options: BARE, onUserDraw }),
      { wrapper: ({ children }) => createElement(StrictMode, null, children) },
    )

    expect(onUserDraw).toHaveBeenCalledTimes(1)
    act(() => result.current.discard(0))
    expect(onUserDraw).toHaveBeenCalledTimes(2)
  })
})

// D6: flipping a seat's algorithm mid-hand must never redeal — these prove the live-sync effect
// (`useTableRound.ts`'s second `useEffect`) patches the running match in place instead.
describe('live algorithm changes (D6)', () => {
  it('flipping an opponent between two AI algorithms never touches the running match', () => {
    const wall = tenpaiWall('live-general-seed')
    const options: MatchOptions = {
      ...BARE,
      algorithms: ['manual', 'efficiency', 'efficiency', 'efficiency'],
    }
    const { result, rerender } = renderHook(
      (props: { options: MatchOptions }) =>
        useTableRound({ wall, players: 4, seatIndex: 0, options: props.options }),
      { initialProps: { options } },
    )
    act(() => result.current.discard(0))
    const { turn, rivers, liveWall, drawn } = result.current

    rerender({
      options: { ...options, algorithms: ['manual', 'defense', 'efficiency', 'efficiency'] },
    })

    expect(result.current.turn).toBe(turn)
    expect(result.current.rivers).toEqual(rivers)
    expect(result.current.liveWall).toEqual(liveWall)
    expect(result.current.drawn).toEqual(drawn)
  })

  it('flipping an opponent to tsumogiri never touches the running match either (T4)', () => {
    // tsumogiri's own discard reads `view.hand.drawn` directly rather than running
    // chooseDiscard/chooseFold, so it gets its own regression rather than trusting the general
    // efficiency<->defense case above to cover it
    const wall = tenpaiWall('live-tsumogiri-seed')
    const options: MatchOptions = {
      ...BARE,
      algorithms: ['manual', 'efficiency', 'efficiency', 'efficiency'],
    }
    const { result, rerender } = renderHook(
      (props: { options: MatchOptions }) =>
        useTableRound({ wall, players: 4, seatIndex: 0, options: props.options }),
      { initialProps: { options } },
    )
    act(() => result.current.discard(0))
    const { turn, rivers, liveWall, drawn } = result.current

    rerender({
      options: { ...options, algorithms: ['manual', 'tsumogiri', 'efficiency', 'efficiency'] },
    })

    expect(result.current.turn).toBe(turn)
    expect(result.current.rivers).toEqual(rivers)
    expect(result.current.liveWall).toEqual(liveWall)
    expect(result.current.drawn).toEqual(drawn)
  })

  it('AI to manual: untouched immediately, then pauses for its own turn once it arrives', () => {
    const wall = tenpaiWall('live-ai-to-manual-seed')
    const options: MatchOptions = {
      ...BARE,
      algorithms: ['manual', 'efficiency', 'efficiency', 'efficiency'],
    }
    const { result, rerender } = renderHook(
      (props: { options: MatchOptions }) =>
        useTableRound({ wall, players: 4, seatIndex: 0, options: props.options }),
      { initialProps: { options } },
    )
    const { turn, drawn, rivers } = result.current

    // seat 1 hasn't acted yet this go-round — flipping it now must not disturb seat 0's own
    // already-drawn tile (free, via `goRound`'s own guard: nothing to do until seat 1's turn)
    rerender({
      options: { ...options, algorithms: ['manual', 'manual', 'efficiency', 'efficiency'] },
    })
    expect(result.current.turn).toBe(turn)
    expect(result.current.drawn).toEqual(drawn)
    expect(result.current.rivers).toEqual(rivers)

    // now that seat 1's turn actually arrives, it correctly pauses instead of autoplaying
    act(() => result.current.discard(0))
    expect(result.current.acting).toBe(1)
    expect(result.current.drawn).toBeDefined()
    expect(result.current.claim).toBeUndefined()
  })

  it('manual to AI: the already-drawn tile is played, not redrawn, and play moves on', () => {
    const wall = tenpaiWall('live-manual-to-ai-seed')
    const options: MatchOptions = {
      ...BARE,
      algorithms: ['manual', 'manual', 'efficiency', 'efficiency'],
    }
    const { result, rerender } = renderHook(
      (props: { options: MatchOptions }) =>
        useTableRound({ wall, players: 4, seatIndex: 0, options: props.options }),
      { initialProps: { options } },
    )
    // hands the turn to seat 1, which pauses (still manual) with its own tile drawn
    act(() => result.current.discard(0))
    expect(result.current.acting).toBe(1)
    expect(result.current.rivers[1]).toHaveLength(0)

    rerender({
      options: { ...options, algorithms: ['manual', 'efficiency', 'efficiency', 'efficiency'] },
    })

    // discarded straight out of the hand it already held — not a fresh draw — and the round
    // carries on round the table back to seat 0
    expect(result.current.rivers[1]).toHaveLength(1)
    expect(result.current.acting).toBe(0)
  })

  it('a claim pending on a seat that stops being manual resolves through its new algorithm', () => {
    const seat0Hand = parseTenhou('2468m2468p9s2345z') // scattered; only needs a spare 9s to discard
    // chiitoitsu tenpai: six pairs plus the lone 9s, waiting to pair it
    const seat1Hand = parseTenhou('1133557799m11p9s')
    const wall = completeWall([...seat0Hand, ...seat1Hand], false, false, 'live-claim-seed')
    const options: MatchOptions = {
      sanma: false,
      aka: false,
      round: HONOR,
      deadWall: false,
      calls: false,
      riichi: false,
      wins: true,
      claims: true,
      algorithms: ['manual', 'manual', 'efficiency', 'efficiency'],
    }
    const { result, rerender } = renderHook(
      (props: { options: MatchOptions }) =>
        useTableRound({ wall, players: 4, seatIndex: 0, options: props.options }),
      { initialProps: { options } },
    )

    const nineSou = result.current.hand.findIndex((t) => t.id === SOU + 8)
    act(() => result.current.discard(nineSou))
    expect(result.current.claim?.seat).toBe(1)

    // nobody will ever answer seat 1's pending ron now — `reconsiderClaim` re-resolves it through
    // the algorithm instead of leaving it stuck, or worse, inventing a pass that would poison the
    // hand with furiten over a decision the reader never made
    rerender({
      options: { ...options, algorithms: ['manual', 'efficiency', 'efficiency', 'efficiency'] },
    })

    expect(result.current.claim).toBeUndefined()
    expect(result.current.win?.seat).toBe(1)
    expect(result.current.ended).toBe('win')
  })
})
