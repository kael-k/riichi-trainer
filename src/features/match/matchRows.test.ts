import { describe, expect, it } from 'vitest'
import { createMatch } from '../../core/match'
import { createRound, stepRound, type RoundOptions } from '../../core/round'
import { importTenhou } from '../../core/tenhouImport'
import convlog from '../../core/testdata/convlog.json'
import { tileCode } from '../../core/tiles'
import { actionRow, replayRows, rowsBefore, type MatchRow } from './matchRows'

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

describe('replayRows', () => {
  const imported = importTenhou(convlog)
  if (!('game' in imported)) throw new Error('the fixture imports')
  const { game } = imported
  const rules = { sanma: false, aka: game.rules.aka, kiriageMangan: false }
  const rows = replayRows(game, rules)

  it('tags every action with its seat and its own log index, and prices the free ones', () => {
    const actions = rows.filter((r) => r.seat !== undefined)
    expect(actions.length).toBeGreaterThan(100)
    for (const row of actions) {
      const log = game.rounds[row.round].log
      expect(log[row.at].seat).toBe(row.seat)
      if (row.stats) expect(row.stats.at).toBe(row.at)
    }
    const free = actions.filter((r) => r.key === 'log.match.discard')
    expect(free.length).toBeGreaterThan(0)
    expect(free.every((r) => r.stats !== undefined)).toBe(true)
    expect(rows.some((r) => r.key === 'log.match.call' && r.params?.kind === 'minkan')).toBe(true)
    expect(rows.some((r) => r.key === 'log.match.riichi')).toBe(true)
    // ids are stable and unique: the log keys its rows on them
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it('ends every round with the engine’s own result, and seat-less boundary rows', () => {
    game.rounds.forEach((round, i) => {
      const own = rows.filter((r) => r.round === i)
      expect(own[0]).toMatchObject({ key: 'log.dealt', at: -1 })
      expect(own.at(-1)).toMatchObject({ key: 'log.match.result', at: round.log.length - 1 })
      expect(own[0].seat).toBeUndefined()
      expect(own.at(-1)!.seat).toBeUndefined()
    })
    // the fixture imports clean, so no notice rows
    expect(rows.some((r) => r.key.startsWith('log.match.notice'))).toBe(false)
  })

  it("closes a round with the import's notice, a settlement disagreement naming both sides", () => {
    const record = [8000, -8000, 0, 0]
    const engine = game.rounds[0].deltas
    const noted = replayRows(
      {
        ...game,
        rounds: [{ ...game.rounds[0], notice: { code: 'pays', record, engine } }],
      },
      rules,
    )
    const notice = noted.at(-1)!
    expect(notice).toMatchObject({ key: 'log.match.notice.pays', round: 0 })
    expect(notice.at).toBe(game.rounds[0].log.length - 1)
    expect(notice.seat).toBeUndefined()
    expect(notice.detail).toHaveLength(4)
    expect(notice.detail![0].params!.amount).toBe(
      `+8,000 → ${engine[0] >= 0 ? '+' : ''}${engine[0].toLocaleString()}`,
    )
  })

  it('shows only the deal at step 0, and the result only once the round is over', () => {
    const start = rowsBefore(rows, { round: 0, step: 0 })
    expect(start.map((r) => r.key)).toEqual(['log.dealt'])
    const length = game.rounds[0].log.length
    const before = rowsBefore(rows, { round: 0, step: length - 1 })
    expect(before.some((r) => r.key === 'log.match.result')).toBe(false)
    const end = rowsBefore(rows, { round: 0, step: length })
    expect(end.at(-1)!.key).toBe('log.match.result')
    // the next round's step 0 adds exactly its deal
    expect(rowsBefore(rows, { round: 1, step: 0 })).toEqual([
      ...end,
      rows.find((r) => r.round === 1)!,
    ])
  })
})
