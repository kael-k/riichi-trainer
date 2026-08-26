import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, SOU } from '../../core/tiles'
import { completeWall, INITIAL_HAND_SIZE, wallWithHand, wallWithHands } from '../../core/wall'
import { useLog } from '../../store/log'
import { decodeSituation, emptySituation, type Situation } from '../situation/urlCodec'
import { NORTH, useEfficiencyRound, type EfficiencyOptions } from './useEfficiencyRound'

/** Bare-table options: no aka, no sanma — real opponents are always dealt in and always play now
 *  (calls/riichi are hardcoded in the hook), so there is no off switch left to test here. */
const BARE: EfficiencyOptions = {
  aka: false,
  sanma: false,
  seats: null,
  showSeatWaits: false,
  showOpponentHands: false,
}

describe('useEfficiencyRound', () => {
  it('deals 13 tiles plus a separated drawn tile and evaluates discards', () => {
    const situation = emptySituation()
    // fillSeed-backed rather than a bare prefix: nine gates is tenpai on every tile, so an
    // unpinned draw+discard(0) risks re-landing on tenpai and ending the round on turn 1
    situation.wall = completeWall(parseTenhou('1112345678999m'), false, false, 'test-seed')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

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

  // the old codec's "pin all 14, skip the draw" shape has no wall-based equivalent: `createRound`
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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toEqual(drawn)
  })

  it('runs until tenpai, not for a fixed turn count', () => {
    const situation = emptySituation()
    // fillSeed-backed for a deterministic board: "always discard the smallest id" isn't
    // guaranteed to reach tenpai before the wall runs dry on an arbitrary random deal — real
    // opponents now always play too, and the dead wall is always reserved, so only ~18 of the
    // user's own turns are available rather than the ~120 a wide-open wall used to allow
    situation.wall = completeWall([], false, false, 'probe-231')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

    // claims are always on now (ADR-0034): a stray opponent discard may offer the graded seat a
    // ron/pon/chi along the way, which is not this test's concern, so decline it and move on.
    // Looping on `drillOver` rather than `finished`: a pending claim also holds the seat at 13
    // tiles, which `finished` cannot tell apart from the real tenpai-stop this test is after.
    for (let i = 0; i < 40 && !result.current.drillOver; i++) {
      if (result.current.claim) act(() => result.current.answer({ kind: 'pass' }))
      else act(() => result.current.discard(0))
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.tenpai).toBe(true)
    expect(result.current.turn).toBeGreaterThan(1)
  })

  it('ends the round as soon as a discard reaches tenpai', () => {
    const situation = emptySituation()
    // dealt tenpai (three runs + a shanpon), so tsumogiri of whatever is drawn keeps it there
    situation.wall = wallWithHand(0, parseTenhou('123456789m1122z'), false, false, 'tenpai-stop')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
    const firstHand = result.current.hand
    act(() => result.current.discard(0))
    act(() => result.current.restart())
    expect(result.current.turn).toBe(1)
    expect(result.current.finished).toBe(false)
    expect(result.current.hand).not.toEqual(firstHand)
  })

  it('preserves a red five pinned in the situation wall', () => {
    const situation = emptySituation()
    // 13 tiles incl. red 5p — pinned through the dealing order, not as a bare prefix
    situation.wall = wallWithHand(0, parseTenhou('123456789m0p112z'), false, false, 'red-pin')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
    expect(result.current.hand).toContainEqual({ id: 13, red: true })
  })

  it('draws a red five from a pinned wall and drops it again on discard', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789m1234z') // 13 tiles, still far from tenpai
    const wall = wallWithHand(0, hand, false, false, 'red-draw-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('0s')[0] // the user's own first draw: red 5s
    situation.wall = wall
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

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

  // the red-five count is asserted over a whole table in core/round.test.ts — from here the
  // opponents' hands are hidden, so only "none at all when aka is off" is checkable
  it('seeds no red fives at all when aka is disabled', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
    const visible = [
      ...result.current.hand,
      ...(result.current.drawn ? [result.current.drawn] : []),
      ...result.current.liveWall,
    ]
    expect(visible.filter((t) => t.red)).toHaveLength(0)
  })

  it('reserves a dead wall and exposes its dora indicator', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
    // 123 unpinned - 14-tile dead wall - 39 hidden opponent hands - 1 user draw
    expect(result.current.liveWall.length).toBe(69)
    expect(result.current.rivers.every((r) => r.length === 0)).toBe(true)

    act(() => result.current.discard(0))
    expect(result.current.liveWall.length).toBe(65)
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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

    act(() => result.current.discard(0)) // 1m, out of the hand rather than off the draw
    expect(result.current.rivers[0]).toEqual([{ id: 0, red: false }])
  })

  it('replays the situation river to reach the saved decision point', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789m1237z') // 13 tiles, includes the 7z that gets discarded
    const wall = wallWithHand(0, hand, false, false, 'replay-seed')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('9s')[0] // turn 1's own draw — unrelated to the replay
    situation.wall = wall
    const discarded7z = parseTenhou('7z')[0]
    situation.log = [
      { kind: 'discard', seat: 0, tile: discarded7z, fromDrawn: false, riichi: false },
    ]
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

    expect(result.current.turn).toBe(2)
    expect(result.current.rivers[0]).toEqual(parseTenhou('7z'))
    expect(result.current.drawn).toBeDefined()
    expect(result.current.cumulativeLost).toBe(0) // replayed turns are not graded
  })

  it('situationQuery round-trips the exact round state', () => {
    const situation = emptySituation()
    // seeded rather than left to `completeWall`'s own unseeded fallback: claims are always on now
    // (ADR-0034), and a passed claim leaves no record in `log` (only calls/wins do) — the graded
    // seat's own "no thanks" on a stray ron/pon/chi does not survive a round-trip through
    // `situationQuery`, so a wall this test happens to draw such an offer on would compare two
    // rounds that never reached the same point. A fixed seed keeps this test about the round-trip
    // itself, not about that separate (and pre-existing, since the lab already ran claims on)
    // engine gap — recorded in `docs/STATUS.md`.
    situation.wall = completeWall([], false, true, 'round-trip-seed-a')
    const opts: EfficiencyOptions = {
      aka: true,
      sanma: false,
      seats: null,
      showSeatWaits: false,
      showOpponentHands: false,
    }
    const a = renderHook(() => useEfficiencyRound(situation, opts))
    act(() => a.result.current.discard(0))
    act(() => a.result.current.discard(3))
    expect(a.result.current.claim).toBeUndefined() // this test is not about the claims flow

    const decoded = decodeSituation(new URLSearchParams(a.result.current.situationQuery()))
    const b = renderHook(() =>
      useEfficiencyRound(decoded, {
        aka: decoded.aka ?? false,
        sanma: decoded.sanma ?? false,
        seats: null,
        showSeatWaits: false,
        showOpponentHands: false,
      }),
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
      (props: { situation: Situation }) => useEfficiencyRound(props.situation, BARE),
      { initialProps: { situation } },
    )

    act(() => result.current.discard(0))
    // the entry describes the round as it stood *before* this discard — turn 1, no river yet —
    // not the post-discard state the round has already moved on to
    const firstEntry = useLog.getState().entries.at(-1)!
    const decodedFirst = decodeSituation(new URLSearchParams(firstEntry.situation!))
    expect(decodedFirst.wall.slice(0, 13)).toEqual(situation.wall)
    expect(decodedFirst.log).toHaveLength(0)

    // restart, so a later rewind has to reproduce a wall this hook chose at random rather than
    // the one the situation prop originally named
    act(() => result.current.restart())
    act(() => result.current.discard(0))
    const secondEntry = useLog.getState().entries.at(-1)!
    const decoded = decodeSituation(new URLSearchParams(secondEntry.situation!))

    // simulate the rewind button: the page hands the same mounted hook a brand-new `situation`
    // object decoded straight from the URL, same as an EfficiencyPage remount would.
    act(() => rerender({ situation: decoded }))
    const fresh = renderHook(() => useEfficiencyRound(decoded, BARE))
    expect(result.current.hand).toEqual(fresh.result.current.hand)
    expect(result.current.drawn).toEqual(fresh.result.current.drawn)
    expect(result.current.turn).toBe(fresh.result.current.turn)
  })

  it('logs one rewindable entry per discard a shared river was replayed through', () => {
    const situation = emptySituation()
    // seeded, not left unseeded: claims are always on now (ADR-0034), and an opponent's stray
    // claim opportunity between the two discards below would silently no-op the second one
    // (`discard` is a no-op while a claim is pending) — this test is about the log/replay shape,
    // not the claims flow, so a wall known not to raise one keeps it deterministic
    situation.wall = completeWall([], false, false, 'log-replay-seed')
    const played = renderHook(() => useEfficiencyRound(situation, BARE))
    act(() => played.result.current.discard(0))
    act(() => played.result.current.discard(0))
    const shared = decodeSituation(new URLSearchParams(played.result.current.situationQuery()))
    // the full log carries every seat's turns between your own two discards, not just yours —
    // it's your own discard count that stays exactly two regardless of what opponents did
    expect(shared.log.filter((e) => e.kind === 'discard' && e.seat === 0)).toHaveLength(2)

    // opening that link replays every seat's recorded turn and puts your own two discards on the
    // log, each rewinding to the round as it stood before it — so the first carries none of your
    // own discards yet and the second carries one
    useLog.getState().clear()
    const link = renderHook(() => useEfficiencyRound(shared, BARE))
    const entries = useLog.getState().entries
    // the board as dealt gets its own leading row, ahead of the replayed discards (T2)
    expect(entries.map((e) => e.key)).toEqual(['log.dealt', 'log.replay', 'log.replay'])
    expect(
      entries.map((e) => {
        const log = decodeSituation(new URLSearchParams(e.situation!)).log
        return log.filter((entry) => entry.kind === 'discard' && entry.seat === 0).length
      }),
    ).toEqual([0, 0, 1])
    expect(link.result.current.hand).toEqual(played.result.current.hand)
    expect(link.result.current.turn).toBe(played.result.current.turn)
  })

  it('a restart writes its own dealt row', () => {
    // the guard used to key on the link, which a local restart never moves — so every board after
    // the first had no row of its own, and nothing left to rewind or share it from
    const situation = emptySituation()
    useLog.getState().clear()
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
    act(() => result.current.restart())
    expect(useLog.getState().entries.filter((e) => e.key === 'log.dealt')).toHaveLength(2)
  })

  it('sanma: never deals 2m-8m, and aka seeds only two red fives (no 5m)', () => {
    const situation = emptySituation()
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true, aka: true }),
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
    const { result } = renderHook(() => useEfficiencyRound(situation, { ...BARE, sanma: true }))
    expect(result.current.rivers).toHaveLength(3)
    // 108 - 13 pinned - 14-tile dead wall - 26 dealt to the other two seats - 1 user draw
    expect(result.current.liveWall.length).toBe(108 - 13 - 14 - 26 - 1)

    const before = result.current.liveWall.length
    act(() => result.current.discard(0))
    expect(result.current.rivers.map((r) => r.length)).toEqual([1, 1, 1])
    // at least one tile per seat, and more when an opponent pulls a kita and takes a replacement
    expect(result.current.liveWall.length).toBeLessThanOrEqual(before - 3)
  })

  it('sanma clamps an out-of-range seat (e.g. yonma North) instead of indexing past rivers', () => {
    const situation = emptySituation()
    situation.seat = 'N'
    const { result } = renderHook(() => useEfficiencyRound(situation, { ...BARE, sanma: true }))
    expect(result.current.seatIndex).toBe(2)
    expect(result.current.rivers).toHaveLength(3)
  })

  it('kita pulls the held north to the nuki pile and draws a replacement, keeping 14 tiles', () => {
    const situation = emptySituation()
    const hand = parseTenhou('123456789p1224z') // includes one North (4z), 13 tiles
    const wall = wallWithHand(0, hand, true, false, 'kita-seed')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('5z')[0] // turn 1's own draw — not North
    wall[wall.length - 1] = parseTenhou('5p')[0] // the first rinshan tile kita's replacement grabs
    situation.wall = wall
    const { result } = renderHook(() => useEfficiencyRound(situation, { ...BARE, sanma: true }))

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
    situation.wall = wallWithHand(0, parseTenhou('123456789p1224z'), false, false, 'kita-yonma')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
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
    const { result } = renderHook(() => useEfficiencyRound(situation, { ...BARE, sanma: true }))

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
    const { result } = renderHook(() => useEfficiencyRound(situation, { ...BARE, sanma: true }))

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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
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
    situation.wall = wallWithHand(0, parseTenhou('123456789p1224z'), false, false, 'kita-yonma')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

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
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))
    const index = result.current.hand.findIndex((t) => t.id === HONOR + 2)

    act(() => result.current.discard(index))
    expect(result.current.lastResult?.grade).toBe('warning')
    expect(result.current.lastResult?.missed).toEqual({ kind: 'kan', tile: HONOR + 2 })
  })
})

describe('efficiency never offers a call, and the second manual seat', () => {
  /** A wall where an opponent's discard is chi/pon-eligible for the graded seat: seat 0 holds
   *  the 5m pair, seat 1 (also manual) holds the 5m it is made to discard, and seats 2/3 are
   *  pinned so their only efficiency-best discard is a tile seat 0 cannot take (triplets plus a
   *  pair, drawing the second of the other stray). Before ADR-0035 this put the graded seat's
   *  claim prompt up (ADR-0034's "always ask"); `useEfficiencyRound` now leaves `claims` off, so
   *  the discard is never offered at all. */
  function claimableWall() {
    const wall = wallWithHands(
      [
        parseTenhou('55m12345678p11z9s'), // seat 0: the 5m pair, one away once the 9s goes
        parseTenhou('123456789p113z5m'), // seat 1: the 5m it will discard
        parseTenhou('9m339s222444666z'), // seats 2/3: throws 9m / 9s, nothing seat 0 holds
        parseTenhou('9m339s333555777z'),
      ],
      false,
      false,
      'claim-race-seed',
    )
    // pinned by swap, never by overwrite: an overwrite would duplicate the copies the random
    // fill already placed, and the link path's `validateWall` rejects a wall with a fifth copy
    const wants = parseTenhou('9m7m9s9m8m') // seats 0, 1, then 2/3 and seat 0 again
    for (let i = 0; i < wants.length; i++) {
      const at = 4 * INITIAL_HAND_SIZE + i
      const from = wall.findIndex(
        (t, j) => j > at && t.id === wants[i].id && t.red === wants[i].red,
      )
      ;[wall[at], wall[from]] = [wall[from], wall[at]]
    }
    return wall
  }

  const TWO_MANUAL: EfficiencyOptions = {
    ...BARE,
    seats: { modes: ['manual', 'manual', 'efficiency', 'efficiency'] },
  }

  it('never puts up a claim for a chi/pon-eligible discard', () => {
    const situation = emptySituation()
    situation.wall = claimableWall()
    const { result } = renderHook(() => useEfficiencyRound(situation, TWO_MANUAL))

    act(() => result.current.discard(10)) // seat 0's 9s — one away, not tenpai
    expect(result.current.acting).toBe(1)
    act(() => result.current.discard(0)) // seat 1's 5m — pon/chi-eligible for seat 0
    expect(result.current.claim).toBeUndefined()
  })

  it('leaves the second manual seat playable while the graded seat is frozen between turns', () => {
    // the freeze `NOTE-efficiency-multi-manual-freeze.md` found: `finished` is anchored to the
    // graded seat (0) and stays true for the whole window seat 1 (also manual) is acting in —
    // `actingPlayable` is what the page's `canAct` reads instead (ADR-0034). Unrelated to claims,
    // which share this fixture only because it already seeds a second manual seat.
    const situation = emptySituation()
    situation.wall = claimableWall()
    const { result } = renderHook(() => useEfficiencyRound(situation, TWO_MANUAL))

    act(() => result.current.discard(10)) // seat 0's 9s — seat 1 draws and is due to act next
    expect(result.current.acting).toBe(1)
    expect(result.current.finished).toBe(true)
    expect(result.current.actingPlayable).toBe(true)

    act(() => result.current.discard(0)) // seat 1's own 5m — no claim to answer, play continues
    expect(result.current.claim).toBeUndefined()
  })

  it('still reaches the card from a shared link replayed into the drill’s last turn', () => {
    const situation = emptySituation()
    // dealt tenpai (three runs + a shanpon): the recorded turn is the tsumogiri that keeps it
    situation.wall = wallWithHand(0, parseTenhou('123456789m1122z'), false, false, 'replay-stop')
    situation.wall[4 * INITIAL_HAND_SIZE] = parseTenhou('9m')[0]
    situation.log = [
      { kind: 'discard', seat: 0, tile: parseTenhou('9m')[0], fromDrawn: true, riichi: false },
    ]
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE))

    // claims are always on now (ADR-0034): before the graded seat's own next draw, an opponent
    // may discard into its shanpon wait and offer a ron — decline it, since this test is about
    // the replay/drillOver timing, not the claims flow
    while (result.current.claim) {
      act(() => result.current.answer({ kind: 'pass' }))
    }

    // the replay hands the decision back rather than grading it: one more tenpai-preserving
    // discard is the link's last turn, and the card follows it exactly as in live play
    expect(result.current.drillOver).toBe(false)
    act(() => result.current.discard(13))
    expect(result.current.drillOver).toBe(true)
    expect(result.current.tenpai).toBe(true)
  })
})
