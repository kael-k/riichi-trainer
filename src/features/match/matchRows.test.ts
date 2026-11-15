import { describe, expect, it } from 'vitest'
import { createMatch } from '../../core/match'
import { createRound, stepRound, type RoundOptions } from '../../core/round'
import { tileCode } from '../../core/tiles'
import { actionRow, type MatchRow } from './matchRows'

const OPTIONS: RoundOptions = {
  sanma: false,
  aka: true,
  kiriageMangan: false,
  match: createMatch(false),
  calls: true,
  riichi: true,
  wins: true,
  calledKan: true,
}

/** Plays seeded rounds and builds every row the way `useMatchRound` does — at report time, inside
 *  the step loop, once the turn has been applied. */
function rowsOf(seed: string): MatchRow[] {
  const state = createRound([], 4, OPTIONS, seed)
  const rows: MatchRow[] = []
  for (const event of stepRound(state, OPTIONS)) {
    const row = actionRow(event, { round: state, options: OPTIONS })
    if (row) rows.push(row)
  }
  return rows
}

describe('actionRow', () => {
  it("names a riichi seat's later throws as forced, and the declaration as a free discard", () => {
    // the first seed whose round has a seat declare and then keep discarding
    const rows = Array.from({ length: 40 }, (_, i) => rowsOf(`rows-${i}`)).find((r) =>
      r.some((row) => row.key === 'log.match.discardForced'),
    )!
    expect(rows).toBeDefined()
    const declarer = rows.find((r) => r.key === 'log.match.riichi')!.seat
    const own = rows.filter((r) => r.seat === declarer && r.key.startsWith('log.match.discard'))
    const declared = rows.findIndex((r) => r.key === 'log.match.riichi')
    // the declaration tile is the row straight after the riichi row, and it is a free choice
    expect(rows[declared + 1]).toMatchObject({ key: 'log.match.discard', seat: declarer })
    // every throw of that seat after it is forced, and only a declared seat's ever is
    const after = own.slice(own.indexOf(rows[declared + 1]) + 1)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((r) => r.key === 'log.match.discardForced')).toBe(true)
    const declarers = new Set(rows.filter((r) => r.key === 'log.match.riichi').map((r) => r.seat))
    expect(rows.every((r) => r.key !== 'log.match.discardForced' || declarers.has(r.seat))).toBe(
      true,
    )
  })
})

describe('actionRow stats jobs', () => {
  it("point at the row's own entry: a discard's tile, a call's caller, nothing past it", () => {
    const rows = Array.from({ length: 10 }, (_, i) => rowsOf(`jobs-${i}`)).flat()
    const calls = rows.filter((r) => r.key === 'log.match.call')
    expect(calls.length).toBeGreaterThan(0)
    for (const row of rows) {
      const job = row.stats
      if (row.key === 'log.match.discardForced' || !row.key.match(/discard$|call$/)) {
        expect(job).toBeUndefined()
        continue
      }
      expect(job).toBeDefined()
      const entry = job!.round.log[job!.at]
      // the slice ends on the action itself, so the job can never price what came after it
      expect(job!.round.log).toHaveLength(job!.at + 1)
      expect(job!.round.match).toBe(OPTIONS.match)
      expect(entry.seat).toBe(row.seat)
      if (row.key === 'log.match.call') expect(entry.kind).toBe('call')
      else if (entry.kind === 'discard') {
        expect(tileCode(entry.tile.id, entry.tile.red)).toBe(row.params?.tile)
      } else throw new Error(`expected a discard, got ${entry.kind}`)
    }
  })
})
