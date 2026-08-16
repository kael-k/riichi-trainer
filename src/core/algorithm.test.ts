import { describe, expect, it } from 'vitest'
import { ALGORITHMS, type Algorithm, type SeatView } from './algorithm'
import { createHand, handFromTenhou } from './hand'
import { HONOR, NUM_TILE_TYPES, parseTenhou } from './tiles'

// `defense` declining a legal win is already covered end-to-end by
// round.test.ts's "never tsumos for a defense-algorithm seat" — this file covers what has no
// coverage yet: `kita` now differs per algorithm (T3), and a third algorithm needs nothing from
// `round.ts` to plug in.

function baseView(overrides: Partial<SeatView> = {}): SeatView {
  return {
    seat: 0,
    hand: createHand(),
    concealed: [],
    melds: [],
    river: [],
    riichi: false,
    nuki: 0,
    players: [],
    round: HONOR,
    seatWind: HONOR,
    dealer: true,
    turn: 1,
    wallLeft: 70,
    doraIndicators: [],
    sanma: true,
    seen: new Uint8Array(NUM_TILE_TYPES),
    threats: [],
    furiten: false,
    ...overrides,
  }
}

describe('ALGORITHMS.kita', () => {
  it('efficiency pulls a held north when it ties the best discard; defense never does', () => {
    // all terminals/honours, one of each kind, no pair anywhere — reliably ties or beats every
    // other discard for shanten, the same hand useTableRound.test.ts's own kita() test uses
    const hand = handFromTenhou('19m19p19s1234567z')
    const view = baseView({ hand })

    expect(ALGORITHMS.efficiency.kita(view)).toBe(true)
    expect(ALGORITHMS.defense.kita(view)).toBe(false)
  })
})

describe('ALGORITHMS.tsumogiri', () => {
  it('discards exactly the drawn tile, marked fromDrawn, never calls/declares/wins/pulls', () => {
    const hand = handFromTenhou('19m19p19s1234567z')
    const drawn = parseTenhou('9s')[0]
    const view = baseView({ hand, drawn })

    expect(ALGORITHMS.tsumogiri.discard(view)).toEqual({
      tile: parseTenhou('9s')[0].id,
      fromDrawn: true,
    })
    expect(ALGORITHMS.tsumogiri.call(view, parseTenhou('1m')[0].id, true)).toBeNull()
    expect(ALGORITHMS.tsumogiri.riichi(view)).toBe(false)
    expect(ALGORITHMS.tsumogiri.win(view, { tile: parseTenhou('9s')[0], score: {} as never })).toBe(
      false,
    )
    expect(ALGORITHMS.tsumogiri.kita(view)).toBe(false)
  })

  it('falls back to the lowest held tile, not marked fromDrawn, when there is nothing to tsumogiri', () => {
    // reachable by flipping a seat to tsumogiri mid-hand right after it called (ADR-0008) — no `drawn`
    // sits on the hand between a call and this seat's own next draw
    const hand = handFromTenhou('19m19p19s1234567z')
    const view = baseView({ hand })

    expect(ALGORITHMS.tsumogiri.discard(view)).toEqual({
      tile: parseTenhou('1m')[0].id,
      fromDrawn: false,
    })
  })
})

describe('a new algorithm needs nothing from round.ts', () => {
  it('compiles and decides against the same SeatView/Algorithm contract the real two use', () => {
    // deliberately trivial — the point is only that authoring this needed nothing beyond what
    // `core/algorithm.ts` itself exports (T3's whole reason to exist)
    const passive: Algorithm = {
      discard: (view) => {
        for (let id = 0; id < NUM_TILE_TYPES; id++) {
          if (view.hand.counts[id] > 0) return { tile: id, fromDrawn: id === view.drawn?.id }
        }
        throw new Error('empty hand')
      },
      call: () => null,
      riichi: () => false,
      win: () => true,
      kita: () => false,
    }
    const hand = handFromTenhou('19m19p19s1234567z')
    expect(passive.discard(baseView({ hand })).tile).toBe(parseTenhou('1m')[0].id)
  })
})
