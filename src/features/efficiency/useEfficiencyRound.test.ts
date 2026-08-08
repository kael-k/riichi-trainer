import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, SOU } from '../../core/tiles'
import { useLog } from '../../store/log'
import { decodeSituation, emptySituation, type Situation } from '../situation/urlCodec'
import { NORTH, useEfficiencyRound, type RoundOptions } from './useEfficiencyRound'

/** Bare-table options: no opponents, no dead wall, no aka, no sanma — fully deterministic. */
const BARE: RoundOptions = { opponents: false, deadWall: false, aka: false, sanma: false }

describe('useEfficiencyRound', () => {
  it('deals 13 tiles plus a separated drawn tile and evaluates discards', () => {
    const situation = emptySituation()
    situation.seed = 'test-seed'
    situation.hand = parseTenhou('1112345678999m') // 13 tiles, nine-gates tenpai
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

  it('has no drawn tile for turn 1 when the situation already supplies all 14', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m11223p')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    expect(result.current.hand).toHaveLength(14)
    expect(result.current.drawn).toBeUndefined()
  })

  it('runs until tenpai, not for a fixed turn count', () => {
    const situation = emptySituation()
    situation.seed = 'drain-seed'
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    for (let i = 0; i < 200 && !result.current.finished; i++) {
      act(() => result.current.discard(0))
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.tenpai).toBe(true)
    expect(result.current.turn).toBeGreaterThan(1)
  })

  it('ends the round as soon as a discard reaches tenpai', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m11227z') // discard 7z -> shanpon tenpai
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

  it('preserves a red five pinned in the situation hand', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m0p1122z') // 14 tiles incl. red 5p, no draw
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    expect(result.current.hand).toContainEqual({ id: 13, red: true })
  })

  it('draws a red five from a pinned wall and drops it again on discard', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789m1234z') // 13 tiles, still far from tenpai
    situation.wall = parseTenhou('0s5s')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.drawn).toEqual({ id: 22, red: true })
    expect(result.current.hand).not.toContainEqual({ id: 22, red: true })

    act(() => result.current.discard(13)) // index past the 13 hand tiles = the drawn tile
    expect(result.current.drawn).toEqual({ id: 22, red: false }) // the normal 5s follows
    expect(result.current.hand).not.toContainEqual({ id: 22, red: true })
  })

  // the red-five count is asserted over a whole table in core/match.test.ts — from here the
  // opponents' hands are hidden, so only "none at all when aka is off" is checkable
  it('seeds no red fives at all when aka is disabled', () => {
    const situation = emptySituation()
    situation.seed = 'aka-seed'
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
    situation.seed = 'dora-seed'
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
    situation.seed = 'opp-seed'
    situation.hand = parseTenhou('123456789m1122z')
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, opponents: true }, true),
    )
    // 123 unpinned - 39 hidden opponent hands - 1 user draw
    expect(result.current.liveWall.length).toBe(83)
    expect(result.current.rivers.every((r) => r.length === 0)).toBe(true)

    act(() => result.current.discard(0))
    expect(result.current.liveWall.length).toBe(79)
    expect(result.current.rivers.map((r) => r.length)).toEqual([1, 1, 1, 1])
  })

  it('opponents before the user act first, and their discards count as visible', () => {
    const situation = emptySituation()
    // pinned so opponent hands (and whether one happens to pon/kan the 7z below) are stable —
    // an unset seed made this flaky whenever the random deal gave a seat a callable pair on it
    situation.seed = 'east-first-seed'
    situation.hand = parseTenhou('123456789m1122z') // discard 7z draw -> shanpon on 1z/2z
    situation.wall = parseTenhou('1z7z')
    situation.seat = 'S' // East tsumogiris before the user's first draw
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, opponents: true }, true),
    )

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
    situation.hand = parseTenhou('123456789m1122z')
    situation.wall = parseTenhou('7z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    act(() => result.current.discard(0)) // 1m, out of the hand rather than off the draw
    expect(result.current.rivers[0]).toEqual([{ id: 0, red: false }])
  })

  it('replays the situation river to reach the saved decision point', () => {
    const situation = emptySituation()
    situation.seed = 'replay-seed'
    situation.hand = parseTenhou('123456789m12347z')
    situation.river = parseTenhou('7z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))

    expect(result.current.turn).toBe(2)
    expect(result.current.rivers[0]).toEqual(parseTenhou('7z'))
    expect(result.current.drawn).toBeDefined()
    expect(result.current.cumulativeLost).toBe(0) // replayed turns are not graded
  })

  it('situationQuery round-trips the exact round state', () => {
    const situation = emptySituation()
    situation.seed = 'dump-seed'
    const opts: RoundOptions = { opponents: true, deadWall: true, aka: true, sanma: false }
    const a = renderHook(() => useEfficiencyRound(situation, opts, true))
    act(() => a.result.current.discard(0))
    act(() => a.result.current.discard(3))

    const decoded = decodeSituation(new URLSearchParams(a.result.current.situationQuery()))
    const b = renderHook(() =>
      useEfficiencyRound(
        decoded,
        {
          opponents: decoded.opponents ?? false,
          deadWall: decoded.deadWall ?? false,
          aka: decoded.aka ?? false,
          sanma: decoded.sanma ?? false,
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

  it('logs the pre-discard situation, and a rewind after a restart does not double-suffix the seed', () => {
    const situation = emptySituation()
    situation.seed = 'rewind-seed'
    const { result, rerender } = renderHook(
      (props: { situation: Situation }) => useEfficiencyRound(props.situation, BARE, true),
      { initialProps: { situation } },
    )

    act(() => result.current.discard(0))
    // the entry describes the round as it stood *before* this discard — turn 1, no river yet —
    // not the post-discard state the round has already moved on to
    const firstEntry = useLog.getState().entries.at(-1)!
    const decodedFirst = decodeSituation(new URLSearchParams(firstEntry.situation!))
    expect(decodedFirst.seed).toBe('rewind-seed')
    expect(decodedFirst.river).toHaveLength(0)

    // restart, so a later rewind has a restart-suffixed seed to contend with
    act(() => result.current.restart())
    act(() => result.current.discard(0))
    const secondEntry = useLog.getState().entries.at(-1)!
    const decoded = decodeSituation(new URLSearchParams(secondEntry.situation!))
    expect(decoded.seed).toBe('rewind-seed:1') // sanity: the entry itself names the right round

    // simulate the rewind button: the page hands the same mounted hook a brand-new `situation`
    // object decoded straight from the URL, same as an EfficiencyPage remount would. Without the
    // restartCount reset, startRound() would suffix this already-suffixed seed a second time.
    act(() => rerender({ situation: decoded }))
    const fresh = renderHook(() => useEfficiencyRound(decoded, BARE, true))
    expect(result.current.hand).toEqual(fresh.result.current.hand)
    expect(result.current.drawn).toEqual(fresh.result.current.drawn)
    expect(result.current.turn).toBe(fresh.result.current.turn)
  })

  it('sanma: never deals 2m-8m, and aka seeds only two red fives (no 5m)', () => {
    const situation = emptySituation()
    situation.seed = 'sanma-tileset-seed'
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
    situation.seed = 'sanma-opp-seed'
    situation.hand = parseTenhou('123456789p1122z')
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true, opponents: true }, true),
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
    situation.seed = 'sanma-seat-seed'
    situation.seat = 'N'
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true }, true),
    )
    expect(result.current.seatIndex).toBe(2)
    expect(result.current.rivers).toHaveLength(3)
  })

  it('kita pulls the held north to the nuki pile and draws a replacement, keeping 14 tiles', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789p11224z') // includes one North (4z)
    situation.wall = parseTenhou('5p')
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, sanma: true }, true),
    )

    expect(result.current.hand.some((t) => t.id === NORTH)).toBe(true)
    expect(result.current.nuki).toHaveLength(0)

    act(() => result.current.kita())

    expect(result.current.nuki).toEqual([{ id: NORTH, red: false }])
    expect(result.current.hand.some((t) => t.id === NORTH)).toBe(false)
    expect(result.current.drawn).toEqual(parseTenhou('5p')[0])
    expect(result.current.hand).toHaveLength(13) // drawn shown separately, 13+1 = 14
    expect(result.current.turn).toBe(1) // kita doesn't advance the turn
    expect(result.current.lastResult?.kind).toBe('kita')

    act(() => result.current.kita()) // no north left — no-op
    expect(result.current.nuki).toHaveLength(1)
  })

  it('kita is a no-op outside sanma', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789p11224z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    act(() => result.current.kita())
    expect(result.current.nuki).toHaveLength(0)
    expect(result.current.hand.some((t) => t.id === NORTH)).toBe(true)
  })

  it('kita on a genuinely useless drawn north ties the best discard', () => {
    const situation = emptySituation()
    situation.hand = parseTenhou('123456789p123s1z') // tenpai, tanki wait on 1z
    situation.wall = parseTenhou('4z') // draws a useless North
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
    situation.hand = parseTenhou('123456789p23s44z') // tenpai on 1s/4s; the North pair is the head
    situation.wall = parseTenhou('9s') // draws an unrelated, genuinely discardable tile
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
    situation.seed = 'kan-mech-seed'
    situation.hand = parseTenhou('123456m78s22p3333z') // all 14 tiles pinned, includes quad 3z
    const { result } = renderHook(() =>
      useEfficiencyRound(situation, { ...BARE, deadWall: true }, true),
    )
    expect(result.current.doraIndicators).toHaveLength(1)
    expect(result.current.drawn).toBeUndefined() // situation already supplies all 14
    expect(result.current.hand).toHaveLength(14)

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
    situation.hand = parseTenhou('123456789p11224z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    act(() => result.current.kan(HONOR + 3)) // only one North held
    expect(result.current.kans).toHaveLength(0)
  })

  it('kan on a quad that was pulling double duty in a run and a triplet is graded an error', () => {
    // 788889s decomposes losslessly as 789s + 888s; kanning the four 8s strands the 7s/9s
    // as a dead kanchan since all four 8s just left the game in their own meld.
    const situation = emptySituation()
    situation.hand = parseTenhou('123456m788889s19p')
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
    situation.hand = parseTenhou('123456m78s22p3333z')
    const { result } = renderHook(() => useEfficiencyRound(situation, BARE, true))
    const index = result.current.hand.findIndex((t) => t.id === HONOR + 2)

    act(() => result.current.discard(index))
    expect(result.current.lastResult?.grade).toBe('warning')
    expect(result.current.lastResult?.missed).toEqual({ kind: 'kan', tile: HONOR + 2 })
  })
})
