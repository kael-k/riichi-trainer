import { describe, expect, it } from 'vitest'
import { evaluateDiscards, type DiscardOption } from '../../core/efficiency'
import { addTile, createHand, type Hand } from '../../core/hand'
import { NORTH } from '../../core/round'
import { HONOR, parseTenhou } from '../../core/tiles'
import {
  actionStats,
  discardDetail,
  efficiencyLogRows,
  gradeAction,
  handFromSnapshot,
  lostVs,
  type ActionStats,
} from './grade'

function handFrom(tenhou: string): Hand {
  const hand = createHand()
  for (const t of parseTenhou(tenhou)) addTile(hand, t.id)
  return hand
}

/** Builds the `ActionStats` `gradeAction` expects off a real 14-tile hand, through the same
 *  `actionStats` both efficiency routes use — without going through a live match. */
function statsFor(
  hand: Hand,
  kind: ActionStats['kind'],
  discardId: number,
  sanma = false,
): ActionStats {
  const seen = hand.counts.slice()
  return actionStats(
    { hand, seen, ranked: evaluateDiscards(hand, seen, sanma), danger: [] },
    kind,
    discardId,
    sanma,
  )
}

describe('grade', () => {
  describe('lostVs', () => {
    it('counts the whole best-ukeire when yours is a worse shanten', () => {
      const best: DiscardOption = { discard: 0, shanten: 0, ukeireTiles: [], ukeireCount: 10 }
      const worse: DiscardOption = { discard: 1, shanten: 1, ukeireTiles: [], ukeireCount: 3 }
      expect(lostVs(worse, best)).toBe(10)
    })

    it('counts only the ukeire gap when yours ties shanten', () => {
      const best: DiscardOption = { discard: 0, shanten: 0, ukeireTiles: [], ukeireCount: 10 }
      const tied: DiscardOption = { discard: 2, shanten: 0, ukeireTiles: [], ukeireCount: 6 }
      expect(lostVs(tied, best)).toBe(4)
    })
  })

  describe('gradeAction', () => {
    it('grades a discard that ties the best line as ok, with no missed call', () => {
      // 123456789m + 11223p (14 tiles): discarding one loose 2p reaches tenpai on the 1p/4p
      // ryanmen — the best line (ukeire 6), beating either pair-based shanpon this hand also has
      const hand = handFrom('123456789m11223p')
      const stats = statsFor(hand, 'discard', 10) // 2p
      const result = gradeAction(stats, 3, false)
      expect(result.grade).toBe('ok')
      expect(result.missed).toBeUndefined()
    })

    it('grades a discard that loses shanten/ukeire as error', () => {
      const hand = handFrom('123456789m11223p')
      const stats = statsFor(hand, 'discard', 9) // 1p: also tenpai, but the worse shanpon wait
      const result = gradeAction(stats, 3, false)
      expect(result.grade).toBe('error')
    })

    it('flags a same-value kita as a missed call, graded warning not error (sanma)', () => {
      // 123456789p123s1z4z (14 tiles): the loose North (4z) is the only tenpai-reaching discard,
      // so discarding it plainly ties the best line while pulling it (kita) ties it too
      const hand = handFrom('123456789p123s1z4z')
      const stats = statsFor(hand, 'discard', NORTH, true)
      const result = gradeAction(stats, 5, true)
      expect(result.grade).toBe('warning')
      expect(result.missed).toEqual({ kind: 'kita', tile: NORTH })
    })

    it('flags a same-value closed kan as a missed call, graded warning not error', () => {
      // 123456m78s22p333z + the fourth 3z (14 tiles): discarding a spare 3z reaches tenpai
      // (6s/9s), tying the line kanning the quad would also reach
      const hand = handFrom('123456m78s22p3333z')
      const stats = statsFor(hand, 'discard', HONOR + 2) // 3z
      const result = gradeAction(stats, 4, false)
      expect(result.grade).toBe('warning')
      expect(result.missed).toEqual({ kind: 'kan', tile: HONOR + 2 })
    })

    it('never grades a kita pull warning — only ok or error', () => {
      const hand = handFrom('123456789p123s1z4z')
      const good = statsFor(hand, 'kita', NORTH, true)
      expect(gradeAction(good, 5, true).grade).toBe('ok')

      // pulling a North that is load-bearing (the hand's head) costs shanten
      const pairHand = handFrom('123456789p239s44z')
      const bad = statsFor(pairHand, 'kita', NORTH, true)
      const badResult = gradeAction(bad, 5, true)
      expect(badResult.grade).toBe('error')
      expect(badResult.missed).toBeUndefined()
    })

    it('never grades a kan call warning — only ok or error', () => {
      const hand = handFrom('123456m78s22p3333z')
      const good = statsFor(hand, 'kan', HONOR + 2)
      const goodResult = gradeAction(good, 4, false)
      expect(goodResult.grade).toBe('ok')
      expect(goodResult.missed).toBeUndefined()

      // 788889s decomposes losslessly as 789s + 888s; kanning the four 8s strands the 7s/9s
      const badHand = handFrom('123456m78889s19p8s')
      const bad = statsFor(badHand, 'kan', 25) // 8s
      const badResult = gradeAction(bad, 1, false)
      expect(badResult.grade).toBe('error')
      expect(badResult.missed).toBeUndefined()
    })
  })

  describe('handFromSnapshot', () => {
    it('rebuilds an equivalent Hand from a snapshot hand, its drawn tile and meld count', () => {
      const tiles = parseTenhou('123456789m1122p')
      const hand = handFromSnapshot(tiles, parseTenhou('3p')[0], 1)
      expect(hand.counts[11]).toBe(1) // 3p
      expect(hand.melds).toBe(1)
    })
  })

  describe('discardDetail', () => {
    it('carries the ukeire total on the label, so the list has a size before it is counted', () => {
      const hand = handFrom('123456789m11223p')
      const stats = statsFor(hand, 'discard', 10)
      const result = gradeAction(stats, 3, false)
      const [yours] = discardDetail(result)

      expect(yours.key).toBe('log.efficiency.yourDiscardTotal')
      expect(yours.params).toEqual({ count: result.yours.ukeireCount })
      // the count is copies left in the wall, not kinds — the legend below the block says so
      expect(result.yours.ukeireCount).toBeGreaterThan(result.yours.ukeireTiles.length)
    })

    it('adds the best line with its own total once the choice was an actual mistake', () => {
      const hand = handFrom('123456789m11223p')
      // 9m breaks a finished run: a real shanten regression, not a tie
      const result = gradeAction(statsFor(hand, 'discard', 8), 3, false)
      expect(result.grade).toBe('error')

      const detail = discardDetail(result)
      const best = detail.find((line) => line.key === 'log.efficiency.bestDiscardTotal')!
      expect(best.params).toEqual({ count: result.best.ukeireCount })
      expect(best.tiles).toEqual([{ id: result.best.discard, red: false }])
    })

    it('closes the block with one legend, whether or not the best line is there', () => {
      const hand = handFrom('123456789m11223p')
      const tie = discardDetail(gradeAction(statsFor(hand, 'discard', 10), 3, false))
      const mistake = discardDetail(gradeAction(statsFor(hand, 'discard', 8), 3, false))

      for (const detail of [tie, mistake]) {
        expect(detail.filter((line) => line.key === 'log.detail.ukeireLegend')).toHaveLength(1)
        expect(detail.at(-1)!.key).toBe('log.detail.ukeireLegend')
      }
    })
  })

  describe('efficiencyLogRows', () => {
    it('emits a discardBest row with the drawn tile when best, no drawn-tile variant otherwise', () => {
      const hand = handFrom('123456789m11223p')
      const stats = statsFor(hand, 'discard', 10)
      const result = gradeAction(stats, 3, false)
      const tile = { id: 10, red: false }

      const withDraw = efficiencyLogRows(result, { id: 10, red: false }, tile)
      expect(withDraw[0].key).toBe('log.efficiency.discardBestDrew')

      const withoutDraw = efficiencyLogRows(result, undefined, tile)
      expect(withoutDraw[0].key).toBe('log.efficiency.discardBest')
    })

    it('emits a tenpai row once the graded discard reaches tenpai', () => {
      const hand = handFrom('123456789m11223p')
      const stats = statsFor(hand, 'discard', 10)
      const result = gradeAction(stats, 3, false)
      const rows = efficiencyLogRows(result, undefined, { id: 10, red: false })
      expect(rows.some((row) => row.key === 'log.efficiency.tenpai')).toBe(true)
    })

    it('emits a missedKan row for a warning-graded discard', () => {
      const hand = handFrom('123456m78s22p3333z')
      const stats = statsFor(hand, 'discard', HONOR + 2)
      const result = gradeAction(stats, 4, false)
      const rows = efficiencyLogRows(result, undefined, { id: HONOR + 2, red: false })
      expect(rows.some((row) => row.key === 'log.efficiency.missedKan')).toBe(true)
    })

    it('leaves the tiles its own sentence names to the sentence', () => {
      // the row's prose carries tenhou codes that `splitTileCodes` draws where they stand, so a
      // strip above the row would be the same tiles a second time, one line apart
      const hand = handFrom('123456789m11223p')
      const mistake = gradeAction(statsFor(hand, 'discard', 8), 3, false)
      const rows = efficiencyLogRows(mistake, { id: 10, red: false }, { id: 8, red: false })

      for (const row of rows.filter((r) => r.key !== 'log.efficiency.tenpai')) {
        expect(row.tiles, row.key).toBeUndefined()
      }
      // the waits are the exception the rule is for: nothing in "waiting on" names them
      const tenpai = rows.find((r) => r.key === 'log.efficiency.tenpai')
      if (tenpai) expect(tenpai.tiles?.length).toBeGreaterThan(0)
    })

    it('keeps the kan pair, whose replacement draw the sentence cannot name', () => {
      const hand = handFrom('123456m78s22p3333z')
      const result = gradeAction(statsFor(hand, 'kan', HONOR + 2), 4, false)
      const rows = efficiencyLogRows(result, { id: 10, red: false }, { id: HONOR + 2, red: false })
      expect(rows[0].tiles).toEqual([
        { id: HONOR + 2, red: false },
        { id: 10, red: false },
      ])
    })
  })
})
