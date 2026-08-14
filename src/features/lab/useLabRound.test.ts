import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, type ParsedTile } from '../../core/tiles'
import { completeWall, INITIAL_HAND_SIZE, wallWithHand } from '../../core/wall'
import { emptySituation, type Situation } from '../situation/urlCodec'
import { useLabRound, type RoundOptions } from './useLabRound'

/** Bare-table options: no dead wall, no aka, no sanma, opponents never win — a rehearsal board so
 *  a hand doesn't end on someone else's tsumo out from under a test. */
const BARE: RoundOptions = {
  deadWall: false,
  aka: false,
  sanma: false,
  opponentWins: false,
  showOpponentHands: false,
}

/** Seat 0's pinned 13-tile hand: nine man kinds plus two honor kinds — 11 distinct kinds. */
const HAND = parseTenhou('123456789m1122z')

function distinctKinds(hand: ParsedTile[], drawn: ParsedTile | undefined): number {
  return new Set([...hand, ...(drawn ? [drawn] : [])].map((t) => t.id)).size
}

describe('useLabRound', () => {
  it('ranked holds one entry per distinct tile in the 14-tile hand', () => {
    const situation: Situation = { ...emptySituation(), wall: wallWithHand(0, HAND, false, false, 'lab-ranked-seed') }
    const { result } = renderHook(() => useLabRound(situation, BARE))
    expect(result.current.ranked.length).toBe(
      distinctKinds(result.current.hand, result.current.drawn),
    )
  })

  it('danger holds one entry per distinct tile with nobody in riichi', () => {
    const situation: Situation = { ...emptySituation(), wall: wallWithHand(0, HAND, false, false, 'lab-danger-seed') }
    const { result } = renderHook(() => useLabRound(situation, BARE))
    expect(result.current.danger.length).toBe(
      distinctKinds(result.current.hand, result.current.drawn),
    )
  })

  it("every danger entry's against array is present", () => {
    const situation: Situation = { ...emptySituation(), wall: wallWithHand(0, HAND, false, false, 'lab-against-seed') }
    const { result } = renderHook(() => useLabRound(situation, BARE))
    expect(result.current.danger.length).toBeGreaterThan(0)
    for (const entry of result.current.danger) {
      expect(entry.against).toBeDefined()
      expect(Array.isArray(entry.against)).toBe(true)
    }
  })

  it('discarding advances the board and produces fresh ranked/danger for the new hand', () => {
    const situation: Situation = { ...emptySituation(), wall: wallWithHand(0, HAND, false, false, 'lab-advance-seed') }
    const { result } = renderHook(() => useLabRound(situation, BARE))
    const firstRanked = result.current.ranked
    const firstTurn = result.current.turn

    act(() => result.current.discard(result.current.hand.length)) // tsumogiri

    expect(result.current.turn).toBeGreaterThan(firstTurn)
    expect(result.current.ranked).not.toBe(firstRanked)
    expect(result.current.ranked.length).toBe(
      distinctKinds(result.current.hand, result.current.drawn),
    )
  })

  it('nothing is filtered out: a board no drill would consider worth posing is still accepted', () => {
    // a wall with nobody tenpai and nothing dangerous — folding's own worthwhile() would reject
    // this outright; the lab must not apply any equivalent filter
    const situation: Situation = { ...emptySituation(), wall: completeWall([], false, false, 'lab-worthwhile-seed') }
    const { result } = renderHook(() => useLabRound(situation, BARE))
    expect(result.current.hand.length + (result.current.drawn ? 1 : 0)).toBe(14)
    expect(result.current.ranked.length).toBeGreaterThan(0)
  })

  it("mid-hand, every other seat's boardHands is BACK_TILE filler", () => {
    const situation: Situation = { ...emptySituation(), wall: wallWithHand(0, HAND, false, false, 'lab-filler-seed') }
    const { result } = renderHook(() => useLabRound(situation, BARE))
    act(() => result.current.discard(result.current.hand.length))

    expect(result.current.finished).toBe(false)
    for (let seat = 0; seat < result.current.boardHands.length; seat++) {
      if (seat === result.current.seatIndex) continue
      expect(new Set(result.current.boardHands[seat].map((t) => t.id)).size).toBe(1)
      expect(result.current.boardHands[seat][0]?.id).toBe(0)
    }
  })

  it("your own seat's boardHands are always the real hand, never filler", () => {
    const situation: Situation = { ...emptySituation(), wall: wallWithHand(0, HAND, false, false, 'lab-own-seed') }
    const { result } = renderHook(() => useLabRound(situation, BARE))
    const own = result.current.boardHands[result.current.seatIndex]
    expect(new Set(own.map((t) => t.id)).size).toBeGreaterThan(1)
  })

  it('boardHands reveals every seat once the hand is finished', () => {
    const wall = wallWithHand(0, parseTenhou('123456789m1122z'), false, false, 'lab-finish-seed')
    wall[4 * INITIAL_HAND_SIZE] = { id: HONOR, red: false } // 1z tsumo completes the shanpon
    const situation: Situation = { ...emptySituation(), wall }
    const { result } = renderHook(() => useLabRound(situation, { ...BARE, opponentWins: true }))

    expect(result.current.finished).toBe(true)
    for (let seat = 0; seat < result.current.boardHands.length; seat++) {
      if (seat === result.current.seatIndex) continue
      expect(new Set(result.current.boardHands[seat].map((t) => t.id)).size).toBeGreaterThan(1)
    }
  })
})
