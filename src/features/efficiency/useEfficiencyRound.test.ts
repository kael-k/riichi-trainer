import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, SOU } from '../../core/tiles'
import { completeWall, INITIAL_HAND_SIZE, wallWithHand } from '../../core/wall'
import { useLog } from '../../store/log'
import { decodeSituation, emptySituation, type Situation } from '../situation/urlCodec'
import { NORTH, useEfficiencyRound, type RoundOptions } from './useEfficiencyRound'

/** Bare-table options: no dead wall, no aka, no sanma — real opponents are always dealt in and
 *  always play now (calls/riichi are hardcoded in the hook), so there is no off switch left to
 *  test here. */
const BARE: RoundOptions = {
  deadWall: false,
  aka: false,
  sanma: false,
  seats: null,
  showSeatWaits: false,
}

describe('useEfficiencyRound', () => {
  it('deals 13 tiles plus a separated drawn tile and evaluates discards', () => {
    const situation = emptySituation()
    // fillSeed-backed rather than a bare prefix: nine gates is tenpai on every tile, so an
    // unpinned draw+discard(0) risks re-landing on tenpai and ending the round on turn 1
    situation.wall = completeWall(parseTenhou('1112345678999m'), false, false, 'test-seed')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeDefined()
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)

    act(() => result.current.discard(0))
    expect(result.current.lastResult?.turn).toBe(1)
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeDefined()
    expect(result.current.turn).toBe(2)
  })

  // the old codec's "pin all 14, skip the draw" shape has no wall-based equivalent: `createMatch`
  // always deals exactly 13 to a seat and always draws its 14th — a wall names the deal, never
  // the post-deal state, so the closest a link gets to pinning a 14th tile is naming exactly what
  // gets drawn (the tile right after the deal, `wall[players * 13]`)
  it('draws a tile after the wall-pinned starting hand — a wall can only name the draw, not skip it', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789m1122p') // 13 tiles
    const wall = wallWithHand(0, hand, false, false, 'fourteen')
    const drawn = parseTenhou('3p')[0]
    wall[4 * INITIAL_HAND_SIZE] = drawn
    situation.wall = wall
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toEqual(drawn)
  })

  it('runs until tenpai, not for a fixed turn count', () => {
    const situation = emptySituation()
    // fillSeed-backed for a deterministic board: "always discard the smallest id" isn't
    // guaranteed to reach tenpai before the wall runs dry on an arbitrary random deal — real
    // opponents now always play too, draining roughly 4 tiles per turn instead of 1, so only
    // ~30 of the user's own turns are available rather than the ~120 this used to allow
    situation.wall = completeWall([], false, false, 'seed-6')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    for (let i = 0; i < 40 && !result.current.finished; i++) {
      act(() => result.current.discard(0))
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.tenpai).toBe(true)
    expect(result.current.turn).toBeGreaterThan(1)
  })

  it('ends the round as soon as a discard reaches tenpai', () => {
    const situation = emptySituation()
    situation.wall = parseTenhou('123456789m11227z') // discard 7z -> shanpon tenpai
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.finished).toBe(false)
    act(() => result.current.discard(13)) // the 7z
    expect(result.current.finished).toBe(true)
    expect(result.current.tenpai).toBe(true)
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeUndefined()
    expect(result.current.liveWall.length).toBeGreaterThan(0) // stopped early, wall untouched
  })

  it('restart deals a fresh hand', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    const firstHand = result.current.hand
    act(() => result.current.discard(0))
    act(() => result.current.restart())
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)
    expect(result.current.hand).not.toEqual(firstHand)
  })

  it('preserves a red five pinned in the situation wall', () => {
    const situation = emptySituation()
    situation.wall = parseTenhou('123456789m0p112z') // 13 tiles incl. red 5p
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    expect(result.current.hand).toContainEqual({ id: 13, red: true })
  })

  it('draws a red five from a pinned wall and drops it again on discard', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789m1234z') // 13 tiles, still far from tenpai
    const wall = wallWithHand(0, hand, false, false, 'red-draw-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('0s')[0] // the user's own first draw: red 5s
    situation.wall = wall
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.drawn).toEqual({ id: 22, red: true })
    expect(result.current.hand).not.toContainEqual({ id: 22, red: true })

    // real opponents play between the user's own turns now, so the wall slot immediately after
    // this one belongs to the next seat, not the user's next draw — only the redness contract
    // (discarding the red five drops it for good) is what this test is proving
    act(() => result.current.discard(13)) // index past the 13 hand tiles = the drawn tile
    expect(result.current.hand).not.toContainEqual({ id: 22, red: true })
    expect(result.current.drawn).toBeDefined() // still far from tenpai — another draw follows
    expect(result.current.drawn?.red).toBe(false)
  })

  // the red-five count is asserted over a whole table in core/match.test.ts — from here the
  // opponents' hands are hidden, so only "none at all when aka is off" is checkable
  it('seeds no red fives at all when aka is disabled', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    const visible = [
      ...result.current.hand,
      ...(result.current.drawn ? [result.current.drawn] : []),
      ...result.current.liveWall,
    ]
    expect(visible.filter((t) => t.red)).toHaveLength(0)
  })

  it('reserves a dead wall and exposes its dora indicator', () => {
    const situation = emptySituation()
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, deadWall: true }, true),
    )
    expect(result.current.doraIndicators).toHaveLength(1)
    // every seat is dealt a real hand now, opponents or not: 4 x 13, a 14-tile dead wall, and
    // the one tile drawn to start your turn
    expect(result.current.liveWall.length).toBe(136 - 14 - 52 - 1)
  })

  it('lets opponents tsumogiri around the table, draining the wall 4 tiles per turn', () => {
    const situation = emptySituation()
    // fillSeed-backed so no opponent's random deal happens to hold a callable pair on the
    // discard below — an unset seed made this flaky the same way as the sanma opponents test
    situation.wall = completeWall(parseTenhou('123456789m1122z'), false, false, 'opp-seed')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    // 123 unpinned - 39 hidden opponent hands - 1 user draw
    expect(result.current.liveWall.length).toBe(83)
    expect(result.current.rivers.every((r) => r.length === 0)).toBe(true)

    act(() => result.current.discard(0))
    expect(result.current.liveWall.length).toBe(79)
    expect(result.current.rivers.map((r) => r.length)).toEqual([1, 1, 1, 1])
  })

  it('opponents before the user act first, and their discards count as visible', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789m1122z') // discard 7z draw -> shanpon on 1z/2z
    // pinned so opponent hands (and whether one happens to pon/kan the 7z below) are stable —
    // an unset seed made this flaky whenever the random deal gave a seat a callable pair on it
    const wall = wallWithHand(1, hand, false, false, 'east-first-seed')
    const draws = parseTenhou('1z7z')
    wall[4 * INITIAL_HAND_SIZE] = draws[0]
    wall[4 * INITIAL_HAND_SIZE + 1] = draws[1]
    situation.wall = wall
    situation.seat = 'S' // East tsumogiris before the user's first draw
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    // East drew the wall prefix's first tile and has already discarded by the time it is your
    // turn; what it chose is its own business, but it acted, and you drew the tile after it
    expect(result.current.rivers[0]).toHaveLength(1)
    expect(result.current.drawn).toEqual(parseTenhou('7z')[0])

    act(() => result.current.discard(13)) // tsumogiri the 7z
    expect(result.current.rivers[1]).toEqual([{ id: 33, red: false, tsumogiri: true }])
    // East's discard is face up, so it is accounted for in your ukeire counts
    const eastDiscard = result.current.rivers[0][0].id
    const seen = result.current.lastResult!.yours.ukeireTiles.find((t) => t.tile === eastDiscard)
    if (seen) expect(seen.remaining).toBeLessThan(4)
  })

  it('marks a discard from the hand as tedashi, not tsumogiri', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789m1122z')
    const wall = wallWithHand(0, hand, false, false, 'tedashi-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('7z')[0]
    situation.wall = wall
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    act(() => result.current.discard(0)) // 1m, out of the hand rather than off the draw
    expect(result.current.rivers[0]).toEqual([{ id: 0, red: false }])
  })

  it('replays the situation river to reach the saved decision point', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789m1237z') // 13 tiles, includes the 7z that gets discarded
    const wall = wallWithHand(0, hand, false, false, 'replay-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('9s')[0] // turn 1's own draw — unrelated to the replay
    situation.wall = wall
    situation.river = parseTenhou('7z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.turn).toBe(2)
    expect(result.current.rivers[0]).toEqual(parseTenhou('7z'))
    expect(result.current.drawn).toBeDefined()
    expect(result.current.cumulativeLost).toBe(0) // replayed turns are not graded
  })

  it('situationQuery round-trips the exact round state', () => {
    const situation = emptySituation()
    const opts: RoundOptions = {
      deadWall: true,
      aka: true,
      sanma: false,
      seats: null,
      showSeatWaits: false,
    }
    const a = renderHook(() => useEfficiencyRound(situation, opts, true))
    act(() => a.result.current.discard(0))
    act(() => a.result.current.discard(3))

    const decoded = decodeSituation(new URLSearchParams(a.result.current.situationQuery()))
    const b = renderHook(() =>
      useEfficiencyRound(
        decoded,
        {
          deadWall: decoded.deadWall ?? false,
          aka: decoded.aka ?? false,
          sanma: decoded.sanma ?? false,
          seats: null,
          showSeatWaits: false,
        },
        true,
      ),
    )

    expect(b.result.current.hand).toEqual(a.result.current.hand)
    expect(b.result.current.drawn).toEqual(a.result.current.drawn)
    expect(b.result.current.turn).toBe(a.result.current.turn)
    expect(b.result.current.rivers).toEqual(a.result.current.rivers)
    expect(b.result.current.liveWall.length).toBe(a.result.current.liveWall.length)
    expect(b.result.current.doraIndicators).toEqual(a.result.current.doraIndicators)
  })

  it('logs the pre-discard situation, and a rewind after a restart reproduces the restarted round', () => {
    const situation = emptySituation()
    situation.wall = parseTenhou('123456789m1122z') // 13 tiles, deterministic starting hand
    const { result, rerender } = renderHook(
      (props: { situation: Situation }) => useEfficiencyRound(props.situation, BARE, true),
      { initialProps: { situation } },
    )

    act(() => result.current.discard(0))
    // the entry describes the round as it stood *before* this discard — turn 1, no river yet —
    // not the post-discard state the round has already moved on to
    const firstEntry = useLog.getState().entries.at(-1)!
    const decodedFirst = decodeSituation(new URLSearchParams(firstEntry.situation!))
    expect(decodedFirst.wall.slice(0, 13)).toEqual(situation.wall)
    expect(decodedFirst.river).toHaveLength(0)

    // restart, so a later rewind has to reproduce a wall this hook chose at random rather than
    // the one the situation prop originally named
    act(() => result.current.restart())
    act(() => result.current.discard(0))
    const secondEntry = useLog.getState().entries.at(-1)!
    const decoded = decodeSituation(new URLSearchParams(secondEntry.situation!))

    // simulate the rewind button: the page hands the same mounted hook a brand-new `situation`
    // object decoded straight from the URL, same as an EfficiencyPage remount would.
    act(() => rerender({ situation: decoded }))
    const fresh = renderHook(() => useEfficiencyRound(decoded, BARE, true))
    expect(result.current.hand).toEqual(fresh.result.current.hand)
    expect(result.current.drawn).toEqual(fresh.result.current.drawn)
    expect(result.current.turn).toBe(fresh.result.current.turn)
  })

  it('logs one rewindable entry per discard a shared river was replayed through', () => {
    const situation = emptySituation()
    const played = renderHook(() => useEfficiencyRound(situation, BARE, true))
    act(() => played.result.current.discard(0))
    act(() => played.result.current.discard(0))
    const shared = decodeSituation(new URLSearchParams(played.result.current.situationQuery()))
    expect(shared.river).toHaveLength(2)

    // opening that link replays the two discards and puts them on the log, each rewinding to the
    // round as it stood before it — so the first carries no river and the second carries one tile
    useLog.getState().clear()
    const link = renderHook(() => useEfficiencyRound(shared, BARE, true))
    const entries = useLog.getState().entries
    expect(entries.map((e) => e.key)).toEqual(['log.replay', 'log.replay'])
    expect(
      entries.map((e) => decodeSituation(new URLSearchParams(e.situation!)).river.length),
    ).toEqual([0, 1])
    expect(link.result.current.hand).toEqual(played.result.current.hand)
    expect(link.result.current.turn).toBe(played.result.current.turn)
  })

  it('sanma: never deals 2m-8m, and aka seeds only two red fives (no 5m)', () => {
    const situation = emptySituation()
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true, aka: true }, true),
    )
    const everywhere = [
      ...result.current.hand,
      ...(result.current.drawn ? [result.current.drawn] : []),
      ...result.current.liveWall,
    ]
    expect(everywhere.some((t) => t.id >= 1 && t.id <= 7)).toBe(false) // 2m-8m
    // the other two reds may be sitting in a hidden hand; a red 5m cannot exist at all
    expect(everywhere.some((t) => t.red && t.id === 4)).toBe(false)
  })

  it('sanma: 3 rivers, wall drains 3 tiles per turn, only 2 hidden opponent hands reserved', () => {
    const situation = emptySituation()
    // fillSeed-backed so an opponent's random deal never happens to hold a callable pair on the
    // discard below — an unset seed made this flaky the same way as the yonma opponents test
    situation.wall = completeWall(parseTenhou('123456789p1122z'), true, false, 'sanma-opp-seed')
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true }, true),
    )
    expect(result.current.rivers).toHaveLength(3)
    // 108 - 13 pinned - 26 dealt to the other two seats - 1 user draw
    expect(result.current.liveWall.length).toBe(108 - 13 - 26 - 1)

    const before = result.current.liveWall.length
    act(() => result.current.discard(0))
    expect(result.current.rivers.map((r) => r.length)).toEqual([1, 1, 1])
    // at least one tile per seat, and more when an opponent pulls a kita and takes a replacement
    expect(result.current.liveWall.length).toBeLessThanOrEqual(before - 3)
  })

  it('sanma clamps an out-of-range seat (e.g. yonma North) instead of indexing past rivers', () => {
    const situation = emptySituation()
    situation.seat = 'N'
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true }, true),
    )
    expect(result.current.seatIndex).toBe(2)
    expect(result.current.rivers).toHaveLength(3)
  })

  it('kita pulls the held north to the nuki pile and draws a replacement, keeping 14 tiles', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789p1224z') // includes one North (4z), 13 tiles
    const wall = wallWithHand(0, hand, true, false, 'kita-seed')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('5z')[0] // turn 1's own draw — not North
    wall[3 * INITIAL_HAND_SIZE + 1] = parseTenhou('5p')[0] // what kita's replacement draw grabs
    situation.wall = wall
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true }, true),
    )

    expect(result.current.hand.some((t) => t.id === NORTH)).toBe(true)
    expect(result.current.nuki[result.current.seatIndex]).toHaveLength(0)

    act(() => result.current.kita())

    expect(result.current.nuki[result.current.seatIndex]).toEqual([{ id: NORTH, red: false }])
    expect(result.current.hand.some((t) => t.id === NORTH)).toBe(false)
    expect(result.current.drawn).toEqual(parseTenhou('5p')[0])
    expect(result.current.hand).toHaveLength(13) // drawn shown separately, 13+1 = 14
    expect(result.current.turn).toBe(1) // kita doesn't advance the turn
    expect(result.current.lastResult?.kind).toBe('kita')

    act(() => result.current.kita()) // no north left — no-op
    expect(result.current.nuki[result.current.seatIndex]).toHaveLength(1)
  })

  it('kita is a no-op outside sanma', () => {
    const situation = emptySituation()
    situation.wall = parseTenhou('123456789p1224z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    act(() => result.current.kita())
    expect(result.current.nuki[result.current.seatIndex]).toHaveLength(0)
    expect(result.current.hand.some((t) => t.id === NORTH)).toBe(true)
  })

  it('kita on a genuinely useless drawn north ties the best discard', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789p123s1z') // tenpai, tanki wait on 1z
    const wall = wallWithHand(0, hand, true, false, 'useless-kita-seed')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('4z')[0] // draws a useless North
    situation.wall = wall
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true }, true),
    )

    expect(result.current.drawn).toEqual(parseTenhou('4z')[0])
    act(() => result.current.kita())
    expect(result.current.lastResult?.kind).toBe('kita')
    expect(result.current.lastResult!.yours.shanten).toBe(result.current.lastResult!.best.shanten)
    expect(result.current.lastResult!.yours.ukeireCount).toBe(
      result.current.lastResult!.best.ukeireCount,
    )
  })

  it("kita pulling one of a load-bearing north pair (the hand's head) is graded a mistake", () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789p23s44z') // tenpai on 1s/4s; the North pair is the head
    const wall = wallWithHand(0, hand, true, false, 'north-pair-seed')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('9s')[0] // draws an unrelated, genuinely discardable tile
    situation.wall = wall
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true }, true),
    )

    expect(result.current.drawn).toEqual(parseTenhou('9s')[0])
    act(() => result.current.kita())
    expect(result.current.lastResult?.kind).toBe('kita')
    expect(result.current.lastResult!.yours.shanten).toBeGreaterThan(
      result.current.lastResult!.best.shanten,
    )
  })

  it('kan locks a held quad as a meld, keeps the hand at 14 tiles, and flips a second dora indicator', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456m78s22p333z') // 13 tiles, three of the quad 3z
    const wall = wallWithHand(0, hand, false, false, 'kan-mech-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('3z')[0] // the fourth 3z, drawn to complete the quad
    situation.wall = wall
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, deadWall: true }, true),
    )
    expect(result.current.doraIndicators).toHaveLength(1)
    // a wall can only name the draw, not skip it (see the "draws a tile after..." test above) —
    // the deal is 13 tiles and this fourth 3z is what completes the quad on the draw
    expect(result.current.drawn).toEqual(parseTenhou('3z')[0])
    expect(result.current.hand).toHaveLength(13)

    act(() => result.current.kan(HONOR + 2)) // 3z

    expect(result.current.kans).toHaveLength(1)
    expect(result.current.kans[0]).toHaveLength(4)
    expect(result.current.kans[0].every((t) => t.id === HONOR + 2)).toBe(true)
    expect(result.current.hand.some((t) => t.id === HONOR + 2)).toBe(false)
    expect(result.current.doraIndicators).toHaveLength(2)
    expect(result.current.drawn).toBeDefined() // replacement draw
    expect(result.current.hand).toHaveLength(10) // 11 concealed - 1 separated drawn tile
    expect(result.current.finished).toBe(false) // still 14 tiles logically (10 + drawn + meld)
    expect(result.current.turn).toBe(1) // kan doesn't advance the turn
    expect(result.current.lastResult?.kind).toBe('kan')
    expect(result.current.lastResult?.grade).toBe('ok')
  })

  it('kan is a no-op when the tile is not held four times', () => {
    const situation = emptySituation()
    situation.wall = parseTenhou('123456789p1224z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    act(() => result.current.kan(HONOR + 3)) // only one North held
    expect(result.current.kans).toHaveLength(0)
  })

  it('kan on a quad that was pulling double duty in a run and a triplet is graded an error', () => {
    // 788889s decomposes losslessly as 789s + 888s; kanning the four 8s strands the 7s/9s
    // as a dead kanchan since all four 8s just left the game in their own meld.
    const situation = emptySituation()
    const hand = parseTenhou('123456m78889s19p') // 13 tiles, three of the quad 8s
    const wall = wallWithHand(0, hand, false, false, 'quad-error-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('8s')[0] // the fourth 8s
    situation.wall = wall
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    act(() => result.current.kan(SOU + 7)) // 8s
    expect(result.current.lastResult?.kind).toBe('kan')
    expect(result.current.lastResult?.grade).toBe('error')
    expect(result.current.lastResult!.yours.shanten).toBeGreaterThan(
      result.current.lastResult!.best.shanten,
    )
  })

  it('discarding a tile that ties best while a same-value kan was available is a warning, not an error', () => {
    // the spare 3z ties for best whether it's discarded outright or kanned — passing up
    // the kan costs no ukeire, so this should read softer than a genuine mistake.
    const situation = emptySituation()
    const hand = parseTenhou('123456m78s22p333z') // 13 tiles, three of the quad 3z
    const wall = wallWithHand(0, hand, false, false, 'warning-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('3z')[0]
    situation.wall = wall
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    const index = result.current.hand.findIndex((t) => t.id === HONOR + 2)

    act(() => result.current.discard(index))
    expect(result.current.lastResult?.grade).toBe('warning')
    expect(result.current.lastResult?.missed).toEqual({ kind: 'kan', tile: HONOR + 2 })
  })
})
