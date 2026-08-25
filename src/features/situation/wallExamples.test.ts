import { describe, expect, it } from 'vitest'
import { createMatch } from '../../core/match'
import { createRound } from '../../core/round'
import { parseTenhou, serializeTenhou } from '../../core/tiles'
import { dealtSeat } from '../../core/wall'

/**
 * The two `wall=` examples worth quoting anywhere, checked against the engine that reads them.
 *
 * Not pedantry: the "deals a kokushi start to seat 0" line was true right up until tiles started
 * going out four at a time (ADR-0024), and nothing failed when it stopped being true. A wall is
 * positionally meaningful, so an example of one is a claim about the deal — this is the test that
 * makes it one the suite can check. Quote a wall in prose anywhere and it belongs here first.
 */

/** A 13-tile prefix: the start of a *deal*, not one seat's hand. */
const SHORT = parseTenhou('19m19p19s1234567z')

/** The same kokushi actually dealt to East — 49 tiles, because everything in between is other
 *  seats' tiles. */
const LONG = parseTenhou('19m19p2345678m23456p19s12z78p2345678s234m3456z5678m2345678p2s7z')

const OPTIONS = {
  sanma: false,
  aka: false,
  calls: false,
  riichi: false,
  wins: false,
  match: createMatch(false),
}

describe('the situation-URL wall examples', () => {
  it('hands the short one out four tiles at a time, round the seats', () => {
    const seats: string[][] = [[], [], [], []]
    SHORT.forEach((tile, index) => seats[dealtSeat(index, 4)].push(serializeTenhou([tile])))
    expect(seats.map((seat) => seat.join(''))).toEqual(['1m9m1p9p', '1s9s1z2z', '3z4z5z6z', '7z'])
  })

  it('really does deal kokushi to East in the long one', () => {
    const round = createRound(LONG, 4, OPTIONS, 'readme')
    expect(serializeTenhou(round.players[0].concealed)).toBe('19m19p19s1234567z')
  })
})
