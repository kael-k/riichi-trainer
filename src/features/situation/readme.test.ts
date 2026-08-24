import { describe, expect, it } from 'vitest'
import README from '../../../README.md?raw'
import { createMatch } from '../../core/match'
import { createRound } from '../../core/round'
import { parseTenhou, serializeTenhou } from '../../core/tiles'
import { dealtSeat, INITIAL_HAND_SIZE } from '../../core/wall'

/**
 * README's `wall=` examples, checked against the engine that reads them.
 *
 * Not pedantry: the "deals a kokushi start to seat 0" line was true right up until tiles started
 * going out four at a time (ADR-0024), and nothing failed when it stopped being true. A wall is
 * positionally meaningful, so an example of one is a claim about the deal — this is the test that
 * makes it one the suite can check. Imported with `?raw` rather than read off disk: the suite runs
 * in jsdom, where `node:fs` is not available and `import.meta.url` is an http:// URL.
 */

/** Every `wall=` the README hands out, picked apart by length rather than by position so another
 *  example added later lands beside these rather than on top of one. */
const WALLS = [...README.matchAll(/wall=([0-9mpsz]+)/g)].map((match) => parseTenhou(match[1]))
const SHORT = WALLS.find((wall) => wall.length === INITIAL_HAND_SIZE)!
const LONG = WALLS.find((wall) => wall.length > INITIAL_HAND_SIZE)!

const OPTIONS = {
  sanma: false,
  aka: false,
  calls: false,
  riichi: false,
  wins: false,
  match: createMatch(false),
}

describe('the README wall examples', () => {
  it('hands the short one out four tiles at a time, to the seats it names', () => {
    const seats: string[][] = [[], [], [], []]
    SHORT.forEach((tile, index) => seats[dealtSeat(index, 4)].push(serializeTenhou([tile])))
    // the README spells out each seat's four; a prefix that stops dealing them there is what makes
    // "the first thirteen are everyone's hand" the point it is
    expect(seats.map((seat) => seat.join(''))).toEqual(['1m9m1p9p', '1s9s1z2z', '3z4z5z6z', '7z'])
    for (const seat of seats) expect(README).toContain(seat.join(''))
  })

  it('really does deal kokushi to East in the long one', () => {
    const round = createRound(LONG, 4, OPTIONS, 'readme')
    expect(serializeTenhou(round.players[0].concealed)).toBe('19m19p19s1234567z')
  })
})
