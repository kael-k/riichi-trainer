import { describe, expect, it } from 'vitest'
import { evaluateDiscards, type DiscardOption } from '../../core/efficiency'
import { addTile, createHand, type Hand } from '../../core/hand'
import { NORTH } from '../../core/match'
import { HONOR, parseTenhou } from '../../core/tiles'
import {
  actionStats,
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

  describe('efficiencyLogRows', () => {
    it('emits a discardBest row with the drawn tile when best, no drawn-tile variant otherwise', () => {
      const hand = handFrom('123456789m11223p')
      const stats = statsFor(hand, 'discard', 10)
      const result = gradeAction(stats, 3, false)
      const tile = { id: 10, red: false }

      const withDraw = efficiencyLogRows(result, { id: 10, red: false }, tile)
      expect(withDraw[0][0]).toBe('log.efficiency.discardBestDrew')

      const withoutDraw = efficiencyLogRows(result, undefined, tile)
      expect(withoutDraw[0][0]).toBe('log.efficiency.discardBest')
    })

    it('emits a tenpai row once the graded discard reaches tenpai', () => {
      const hand = handFrom('123456789m11223p')
      const stats = statsFor(hand, 'discard', 10)
      const result = gradeAction(stats, 3, false)
      const rows = efficiencyLogRows(result, undefined, { id: 10, red: false })
      expect(rows.some(([key]) => key === 'log.efficiency.tenpai')).toBe(true)
    })

    it('emits a missedKan row for a warning-graded discard', () => {
      const hand = handFrom('123456m78s22p3333z')
      const stats = statsFor(hand, 'discard', HONOR + 2)
      const result = gradeAction(stats, 4, false)
      const rows = efficiencyLogRows(result, undefined, { id: HONOR + 2, red: false })
      expect(rows.some(([key]) => key === 'log.efficiency.missedKan')).toBe(true)
    })
  })
})
