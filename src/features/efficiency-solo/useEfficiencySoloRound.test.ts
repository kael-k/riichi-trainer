import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseTenhou } from '../../core/tiles'
import { INITIAL_HAND_SIZE, wallWithHand } from '../../core/wall'
import {
  useEfficiencyRound,
  type RoundOptions as TableRoundOptions,
} from '../efficiency/useEfficiencyRound'
import { emptySituation } from '../situation/urlCodec'
import { useEfficiencySoloRound, type RoundOptions } from './useEfficiencySoloRound'

const BARE: RoundOptions = { deadWall: false, aka: false, sanma: false }
const TABLE_BARE: TableRoundOptions = {
  deadWall: false,
  aka: false,
  sanma: false,
  seats: null,
  showSeatWaits: false,
}

describe('useEfficiencySoloRound', () => {
  it('deals exactly one seat', () => {
    const situation = emptySituation()
    const { result } = renderHook(() => useEfficiencySoloRound(situation, BARE, true))
    expect(result.current.seatIndex).toBe(0)
    expect(result.current.rivers).toHaveLength(1)
    expect(result.current.hand).toHaveLength(13)
  })

  it('reserves a dead wall and flips a dora indicator when deadWall is on', () => {
    const situation = emptySituation()
    const { result } = renderHook(() =>
      useEfficiencySoloRound(situation, { ...BARE, deadWall: true }, true),
    )
    expect(result.current.doraIndicators).toHaveLength(1)
  })

  it('deals a longer live wall than the table app off the same seat-0 hand', () => {
    const hand = parseTenhou('123456789m1122z')
    const wall = wallWithHand(0, hand, false, false, 'longer-wall-seed')
    const situation = { ...emptySituation(), wall }
    const solo = renderHook(() => useEfficiencySoloRound(situation, BARE, true))
    const table = renderHook(() => useEfficiencyRound(situation, TABLE_BARE, true))
    // one hand dealt off this wall (solo) leaves far more of it live than four hands (table)
    expect(solo.result.current.liveWall.length).toBeGreaterThan(
      table.result.current.liveWall.length,
    )
  })

  it('grades the same 14-tile hand identically through both hooks', () => {
    const hand = parseTenhou('123456789m1122z') // 13 tiles, still one away from tenpai
    const wall = wallWithHand(0, hand, false, false, 'grade-parity-seed')
    const draw = parseTenhou('3z')[0]
    wall[1 * INITIAL_HAND_SIZE] = draw // solo's own first draw (1 seat dealt)
    wall[4 * INITIAL_HAND_SIZE] = draw // table's own first draw (4 seats dealt)
    const situation = { ...emptySituation(), wall }

    const solo = renderHook(() => useEfficiencySoloRound(situation, BARE, true))
    const table = renderHook(() => useEfficiencyRound(situation, TABLE_BARE, true))
    expect(solo.result.current.drawn).toEqual(draw)
    expect(table.result.current.drawn).toEqual(draw)

    act(() => solo.result.current.discard(13)) // tsumogiri the drawn 3z, both hooks
    act(() => table.result.current.discard(13))

    expect(solo.result.current.lastResult?.grade).toBe(table.result.current.lastResult?.grade)
    expect(solo.result.current.lastResult?.yours.ukeireCount).toBe(
      table.result.current.lastResult?.yours.ukeireCount,
    )
  })

  it('ends the round as soon as a discard reaches tenpai, leaving 13 tiles', () => {
    const situation = { ...emptySituation(), wall: parseTenhou('123456789m11227z') }
    const { result } = renderHook(() => useEfficiencySoloRound(situation, BARE, true))
    expect(result.current.finished).toBe(false)

    act(() => result.current.discard(13)) // the 7z -> shanpon tenpai on 1z/2z
    expect(result.current.finished).toBe(true)
    expect(result.current.tenpai).toBe(true)
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.drawn).toBeUndefined()
  })

  it('kita and kan grade through the shared module, same as the table app', () => {
    const hand = parseTenhou('123456m78s22p333z') // three of the quad 3z, sanma-only kita path
    const wall = wallWithHand(0, hand, true, false, 'solo-kan-seed')
    wall[1 * INITIAL_HAND_SIZE] = parseTenhou('3z')[0] // the fourth 3z, completing the quad
    const situation = { ...emptySituation(), wall }
    const { result } = renderHook(() =>
      useEfficiencySoloRound(situation, { ...BARE, sanma: true }, true),
    )

    act(() => result.current.kan(29)) // 3z
    expect(result.current.kans).toHaveLength(1)
    expect(result.current.lastResult?.kind).toBe('kan')
    expect(result.current.lastResult?.grade).toBe('ok')
  })
})
