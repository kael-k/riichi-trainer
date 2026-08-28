import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptySituation } from '../situation/urlCodec'
import { linkedSeats, useMatchRound, type MatchOptions } from './useMatchRound'

// no `?wall=` link behind these tests — every round comes from ordinary local play, never a
// resync (`useMatchRound`'s own `situation.wall.length > 0` guard)
const NO_LINK = emptySituation()

const BARE: MatchOptions = {
  format: 'hanchan',
  sanma: false,
  aka: false,
  kiriageMangan: false,
  seats: null,
  showOpponentHands: false,
  // unpaced, so the whole board settles inside a synchronous `act()`
  pace: 0,
  showSeatWaits: false,
}

/** Plays the manual seat (seat 0, `resolveSeatConfig`'s default) tsumogiri, declining every claim
 *  offered along the way — real mahjong runs `wins`/`riichi`/`claims` all on, so a round can end
 *  on a bot's ron/tsumo, an exhaustive draw, or (rarely) the seat's own tsumo just as well as a
 *  full go-round. The cap is generous: a hand is ~18 turns, this is every seat's. */
function playToSettlement(result: { current: ReturnType<typeof useMatchRound> }) {
  for (let i = 0; i < 120 && !result.current.settlement; i++) {
    if (result.current.claim) act(() => result.current.answer({ kind: 'pass' }))
    else if (result.current.acting === result.current.seatIndex && !result.current.finished) {
      act(() => result.current.discard(result.current.hand.length))
    } else break // an AI seat is mid-turn; `useRound` plays it out inside the pending act()
  }
}

describe('linkedSeats', () => {
  // a shared `/match` link opens straight onto the board (`MatchPage`), so the cast has to come
  // from the link rather than from the setup screen's own shuffle — which would otherwise move the
  // reader to a different seat than the one the link was shared from
  it("plays the link's own seat and leaves the rest to the bots", () => {
    expect(linkedSeats({ ...emptySituation(), seat: 'W' })).toEqual({
      modes: ['ev', 'ev', 'manual', 'ev'],
    })
    expect(linkedSeats({ ...emptySituation(), seat: 'S', sanma: true })).toEqual({
      modes: ['ev', 'manual', 'ev'],
    })
    // an absent or unparseable `?seat=` decodes to 'E', which is seat 0 either way
    expect(linkedSeats(emptySituation()).modes[0]).toBe('manual')
  })
})

describe('useMatchRound', () => {
  // the three bot seats default to 'ev' now (`matchDefaultModes`), not 'efficiency' — an EV
  // decision runs a real push/fold search, so a full round comfortably clears the default 5s.
  // These two are the only tests in the suite that play a whole hand through React and they lose
  // most of their wall clock to the other 45 files running beside them: ~1.7s in isolation against
  // tens of seconds under a loaded run. The budget below guards against a hang, not against a
  // regression — the measurement that watches cost is `core/ev.bench.test.ts`.
  it('plays a round to its end and produces a settlement', () => {
    const { result } = renderHook(() => useMatchRound(BARE, NO_LINK))
    playToSettlement(result)

    expect(result.current.settlement).not.toBeNull()
    const { deltas, result: rr } = result.current.settlement!
    expect(deltas.length).toBe(4)
    expect(['win', 'exhaustive', 'abort']).toContain(rr.kind)
  }, 120_000)

  it('nextRound deals a fresh board and carries the settled points over', () => {
    const { result } = renderHook(() => useMatchRound(BARE, NO_LINK))
    playToSettlement(result)
    const settled = result.current.settlement!
    const nextPoints = settled.settlement.match.points

    act(() => result.current.nextRound())

    expect(result.current.settlement).toBeNull()
    expect(result.current.finished).toBe(false)
    expect(result.current.match.points).toEqual(nextPoints)
  }, 120_000)
})
