import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { assessDiscards } from '../../core/danger'
import { handFromTenhou } from '../../core/hand'
import type { LogEntry } from '../../core/round'
import type { SeatAlgorithm } from '../../core/policy'
import { parseTenhou, type ParsedTile } from '../../core/tiles'
import { completeWall } from '../../core/wall'
import { useLog } from '../../store/log'
import { EV_GRADE_BANDS } from './evGrade'
import {
  BACK_TILE,
  decodeFoldingUrl,
  encodeFoldingUrl,
  splitConcealedDrawn,
  useFoldingRound,
  type FoldingUrl,
  type FoldingOptions,
} from './useFoldingRound'

const OPTIONS: FoldingOptions = {
  sanma: false,
  threats: 1,
  opponentWins: true,
  feedbackAtEnd: false,
  evGrading: false,
  evModel: 'statistical',
  evBands: EV_GRADE_BANDS,
  showOpponentHands: false,
  // unpaced, so the whole board settles inside a synchronous `act()`
  pace: 0,
  showSeatWaits: false,
  seats: null,
}

/** The wall from the report that named both bugs — a called riichi declaration tile. */
const REPORTED_WALL =
  '4s4m6s9p8m1p71z27m3s0m6s3z1m64z1m70p2z3p9s5z95m8s3z4s1p5m3p7s5p6s2z7226994p2s1m7s' +
  '6p4z4p3z1p9s12z6m6p7s6m53p2291s8p9m3p3m7p0s8p4s4p8s5z43m7z6p4z75p8m31s1p5s1z8s678' +
  '399m8s2m26z5s5z47m6z1m6s6z8m15s228p49s7z6m3s7m5z94p2m1z52m7z2s3m3z8p4z3s4m17s'

/** A deterministic pseudo-random full wall — not necessarily a worthwhile board on its own (a
 *  pinned wall that isn't falls through to a fresh search), just a repeatable one to hand the
 *  hook in place of the old seed strings. */
function wall(seed: string, sanma = false): ParsedTile[] {
  return completeWall([], sanma, true, seed)
}

/** Generation is a wall search, so hands arrive a tick (or several) later. */
async function deal(urlData: FoldingUrl, options: FoldingOptions = OPTIONS) {
  const { result } = renderHook(() => useFoldingRound(urlData, options))
  await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 })
  return result
}

/** Index of a tile in the on-screen hand (the drawn tile sits at `hand.length`). */
function indexOf(hand: { id: number }[], drawn: { id: number } | undefined, tile: number): number {
  const i = hand.findIndex((t) => t.id === tile)
  return i >= 0 ? i : drawn?.id === tile ? hand.length : -1
}

describe('useFoldingRound', () => {
  it('deals a hand with a threat already in riichi and the decision on you', async () => {
    const result = await deal({ wall: wall('fold-seed') })
    expect(result.current.failed).toBe(false)
    expect(result.current.threatSeats.length).toBeGreaterThanOrEqual(1)
    expect(result.current.threatSeats).not.toContain(result.current.seatIndex)
    // 13 + the tile you just drew, minus whatever the AI already called before the handover
    const meldTiles = result.current.melds[result.current.seatIndex].reduce(
      (n, m) => n + m.tiles.length,
      0,
    )
    expect(result.current.hand.length + (result.current.drawn ? 1 : 0) + meldTiles).toBe(14)
    const threat = result.current.threatSeats[0]
    // not the river's own riichi-flagged tile: a called declaration tile is popped back out of
    // the river, but the seat is still in riichi
    expect(result.current.riichi[threat]).toBe(true)
  })

  it('only offers hands where the choice matters', async () => {
    const result = await deal({ wall: wall('worth-seed') })
    const ranked = result.current.ranked()
    expect(ranked[0].tier).toBe('genbutsu')
    expect(ranked.some((e) => e.tier === 'nonSuji' || e.tier === 'halfSuji')).toBe(true)
    expect(result.current.finished).toBe(false)
  })

  it('is reproducible: the same wall rebuilds the same board', async () => {
    const seeded = await deal({ wall: wall('repeat-seed') })
    const sameWall = seeded.current.wall
    const a = await deal({ wall: sameWall })
    const b = await deal({ wall: sameWall })
    expect(a.current.hand).toEqual(b.current.hand)
    expect(a.current.rivers).toEqual(b.current.rivers)
    expect(a.current.seatIndex).toBe(b.current.seatIndex)
  })

  it('the same wall always deals the same round wind and seat', async () => {
    const seeded = await deal({ wall: wall('wind-seed') })
    const sameWall = seeded.current.wall
    const a = await deal({ wall: sameWall })
    const b = await deal({ wall: sameWall })
    expect(a.current.round).toBe(b.current.round)
    expect(a.current.seatIndex).toBe(b.current.seatIndex)
  })

  it('the share link replays into the identical board', async () => {
    const first = await deal({ wall: wall('share-seed') })
    const query = first.current.situationQuery()
    const shared = await deal(decodeFoldingUrl(new URLSearchParams(query)))
    expect(shared.current.hand).toEqual(first.current.hand)
    expect(shared.current.rivers).toEqual(first.current.rivers)
    expect(shared.current.threatSeats).toEqual(first.current.threatSeats)
    expect(shared.current.seatIndex).toBe(first.current.seatIndex)
  })

  it('seats you somewhere other than always the declarer’s shimocha', async () => {
    const seats = new Set<number>()
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      const result = await deal({ wall: wall(seed) })
      const threat = result.current.threatSeats[0]
      seats.add((result.current.seatIndex - threat + 4) % 4)
    }
    expect(seats.size).toBeGreaterThan(1)
  })

  it('a mid-hand link replays the discards behind it, and logs them', async () => {
    const first = await deal({ wall: wall('midhand-seed') })
    for (let i = 0; i < 2 && !first.current.finished; i++) {
      const safe = first.current.ranked()[0]
      act(() => first.current.discard(indexOf(first.current.hand, first.current.drawn, safe.tile)))
    }
    const query = first.current.situationQuery()
    expect(new URLSearchParams(query).get('log')).toBeTruthy()

    act(() => useLog.getState().clear())
    const shared = await deal(decodeFoldingUrl(new URLSearchParams(query)))
    expect(shared.current.hand).toEqual(first.current.hand)
    expect(shared.current.rivers).toEqual(first.current.rivers)
    expect(shared.current.turn).toBe(first.current.turn)
    // the replayed turns land on the log, each rewindable to the turn before it
    const replayed = useLog.getState().entries.filter((e) => e.key === 'log.replay')
    expect(replayed).toHaveLength(2)
    expect(new URLSearchParams(replayed[0].situation!).get('log')).toBeNull()
  })

  it('grades a safest-tier discard correct and anything else wrong', async () => {
    const result = await deal({ wall: wall('grade-seed') })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))
    expect(result.current.lastResult?.correct).toBe(true)
    expect(result.current.correctCount).toBe(1)

    const ranked = result.current.ranked()
    const risky = ranked[ranked.length - 1]
    if (risky.rank > 0) {
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, risky.tile)),
      )
      expect(result.current.lastResult?.correct).toBe(false)
      expect(result.current.lastResult?.safest[0].rank).toBe(0)
      expect(result.current.correctCount).toBe(1)
      expect(result.current.totalCount).toBe(2)
    }
  })

  it('scores accuracy against the turn’s own worst tile, not just right/wrong', async () => {
    const result = await deal({ wall: wall('accuracy-seed') })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))
    expect(result.current.accuracy).toBe(1)

    const ranked = result.current.ranked()
    const worst = ranked[ranked.length - 1]
    if (worst.rank > 0) {
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, worst.tile)),
      )
      // the most dangerous tile in hand scores zero, so two turns average to a half
      expect(result.current.accuracy).toBeCloseTo(0.5, 5)
      expect(result.current.correctCount).toBe(1)
    }
  })

  it('grades on the EV model instead of tiers when evGrading is on, and shows the band it graded against', async () => {
    act(() => useLog.getState().clear())
    const result = await deal({ wall: wall('ev-grade-seed') }, { ...OPTIONS, evGrading: true })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))

    // the tier model's own safest tile is graded through the EV branch instead of `rank === 0`
    expect(result.current.lastResult?.ev).toBeDefined()
    expect(result.current.lastResult?.ev?.model).toBe('statistical')
    expect(result.current.lastResult?.ev?.bands).toEqual(EV_GRADE_BANDS.statistical)

    const entry = useLog.getState().entries.find((e) => e.key === 'log.folding.discard')!
    const band = entry.detail!.find((d) => d.key === 'log.folding.evBand')!
    expect(band.params).toMatchObject({ model: 'statistical' })
    // every candidate priced, the reader's own tile marked, and the best entry marked as such —
    // `plans/EV-5` §2.5's "the grading UI must show the band it graded against"
    expect(band.bars!.length).toBeGreaterThan(1)
    expect(band.bars!.filter((b) => b.chosen)).toHaveLength(1)
    expect(band.bars!.filter((b) => b.best)).toHaveLength(1)
    expect(Math.max(...band.bars!.map((b) => b.fraction))).toBe(1)
    expect(Math.min(...band.bars!.map((b) => b.fraction))).toBe(0)
  })

  it('falls back to tier grading when EV grading is off', async () => {
    act(() => useLog.getState().clear())
    const result = await deal({ wall: wall('ev-off-seed') })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))
    expect(result.current.lastResult?.ev).toBeUndefined()
    const entry = useLog.getState().entries.find((e) => e.key === 'log.folding.discard')!
    expect(entry.detail!.some((d) => d.key === 'log.folding.evBand')).toBe(false)
  })

  it('plays the fold out: every turn to the end of the hand is graded', async () => {
    const result = await deal({ wall: wall('multi-seed') })
    let turns = 0
    for (let i = 0; i < 4 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
      turns++
    }
    // the drill is the whole fold, not one question: the board keeps handing the turn back
    expect(turns).toBeGreaterThan(1)
    expect(result.current.totalCount).toBe(turns)
    expect(result.current.correctCount).toBe(turns)
  })

  it('holds every graded turn back to the end of the hand when asked', async () => {
    const result = await deal({ wall: wall('held-seed') }, { ...OPTIONS, feedbackAtEnd: true })
    act(() => useLog.getState().clear())
    let turns = 0
    for (let i = 0; i < 40 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
      turns++
      // the log names the safest tile of each turn, so mid-hand it would answer the next one
      if (!result.current.finished) {
        expect(useLog.getState().entries).toHaveLength(0)
      }
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.results).toHaveLength(turns)
    expect(useLog.getState().entries.filter((e) => e.key === 'log.folding.discard')).toHaveLength(
      turns,
    )
  })

  it('with opponent wins off, the hand plays to the wall instead of ending on a win', async () => {
    const result = await deal({ wall: wall('nowin-seed') }, { ...OPTIONS, opponentWins: false })
    // deliberately the most dangerous tile every turn: with wins off nobody can collect
    for (let i = 0; i < 40 && !result.current.finished; i++) {
      const ranked = result.current.ranked()
      const risky = ranked[ranked.length - 1]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, risky.tile)),
      )
    }
    expect(result.current.finished).toBe(true)
    expect(result.current.end!.kind).not.toBe('dealIn')
    expect(result.current.end!.seat).toBeUndefined()
    // still a real fold: the ranking graded every one of those throws
    expect(result.current.totalCount).toBeGreaterThan(1)
  })

  it('never lets a folding opponent declare a second riichi', async () => {
    const result = await deal({ wall: wall('multi-seed') })
    const initialThreats = result.current.threatSeats.length
    for (let i = 0; i < 30 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
      expect(result.current.threatSeats.length).toBe(initialThreats)
    }
  })

  it('holds the reveal back until the hand is over', async () => {
    // wins off: a threat that won its own hand via tsumo would show a 14-tile complete hand and
    // no waits, which isn't what this test is after — wins off keeps every threat tenpai at 13
    // all the way to exhaustive/wall
    const result = await deal({ wall: wall('reveal-seed') }, { ...OPTIONS, opponentWins: false })
    expect(result.current.end).toBeNull()
    for (let i = 0; i < 40 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
    }
    expect(result.current.finished).toBe(true)
    const end = result.current.end!
    expect(end.threats.length).toBeGreaterThanOrEqual(1)
    // a threat in riichi is tenpai by construction, so it has a real wait to show
    expect(end.threats[0].hand.length).toBe(13)
    expect(end.threats[0].waits.length).toBeGreaterThan(0)
  })

  it('keeps the rotated tile on a threat’s river, and never calls the tile it is folding against', async () => {
    // the board this was reported on: seat 0 declared riichi on a 4s and seat 1 — a seat the
    // drill flips to `'defense'` the instant that declaration lands — chi'd it, which both took
    // the rotated tile off the river and gave a folding seat a fresh meld on the tile it was
    // about to spend the hand defending against
    const boards = [
      parseTenhou(REPORTED_WALL),
      wall('rotate-1'),
      wall('rotate-2'),
      wall('rotate-3'),
    ]
    for (const board of boards) {
      const result = await deal({ wall: board })
      expect(result.current.threatSeats.length).toBeGreaterThan(0)
      for (const seat of result.current.threatSeats) {
        expect(result.current.rivers[seat].filter((t) => t.riichi)).toHaveLength(1)
      }
    }
  })

  it('never lets the engine call for the player', async () => {
    const result = await deal({ wall: wall('nocall-seed') })
    // a seat can arrive holding a meld it called before the drill started; what must never grow
    // is the pile after the board is handed over
    const atHandover = result.current.melds[result.current.seatIndex]
    for (let i = 0; i < 10 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
    }
    expect(result.current.melds[result.current.seatIndex]).toEqual(atHandover)
  })

  it('deals sanma boards without 2m-8m', async () => {
    const result = await deal({ wall: wall('sanma-seed', true) }, { ...OPTIONS, sanma: true })
    expect(result.current.rivers).toHaveLength(3)
    expect(result.current.hand.some((t) => t.id >= 1 && t.id <= 7)).toBe(false)
  })

  it('next() deals a different hand', async () => {
    const result = await deal({ wall: wall('next-seed') })
    const first = result.current.hand
    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 })
    expect(result.current.hand).not.toEqual(first)
    expect(result.current.lastResult).toBeNull()
  })

  it('next() writes its own dealt row', async () => {
    // keyed on the board, not the link: a new hand arrives under a link that never moved, and
    // used to leave the log with no row to rewind or share it from
    const result = await deal({ wall: wall('dealt-row-seed') })
    act(() => useLog.getState().clear())
    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 })
    await waitFor(() =>
      expect(useLog.getState().entries.filter((e) => e.key === 'log.dealt')).toHaveLength(1),
    )
  })

  it('clearing the log resets the session score', async () => {
    const result = await deal({ wall: wall('log-seed') })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))
    expect(result.current.totalCount).toBe(1)
    act(() => useLog.getState().clear())
    expect(result.current.totalCount).toBe(0)
    expect(result.current.averageTime).toBe(0)
  })

  it('an invalid wall link falls back to a fresh search instead of dealing an impossible board', async () => {
    const urlData = decodeFoldingUrl(new URLSearchParams('wall=11111m'))
    expect(urlData.wallError).toBeTruthy()
    expect(urlData.wall).toHaveLength(0)
    const result = await deal(urlData)
    expect(result.current.failed).toBe(false)
    expect(result.current.wall.length).toBeGreaterThan(0)
  })
})

describe('per-seat manual configuration', () => {
  it('every seat the panel marks manual plays for real, not only the drill’s own generated seat', async () => {
    const seats = { modes: ['manual', 'manual', 'manual', 'manual'] as SeatAlgorithm[] }
    const result = await deal({ wall: wall('manual-seat-seed') }, { ...OPTIONS, seats })
    expect([...result.current.manualSeats].sort()).toEqual([0, 1, 2, 3])
  })

  it('changing only the orientation never rebuilds the round — it is a viewing perspective, not a rule', async () => {
    // hoisted, not rebuilt inline: `useFoldingRound`'s "adjust state while rendering" reset keys
    // on `urlData`'s own identity, so a fresh `{ wall }` literal every render would itself trigger
    // a rebuild on every rerender — the exact thing this test is checking does *not* happen
    const urlData: FoldingUrl = { wall: wall('orientation-seed') }
    const { result, rerender } = renderHook(
      ({ options }: { options: FoldingOptions }) => useFoldingRound(urlData, options),
      {
        initialProps: {
          options: { ...OPTIONS, seats: { modes: [] } },
        },
      },
    )
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 })
    const safe = result.current.ranked()[0]
    act(() => result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)))
    const turnAfterDiscard = result.current.turn
    const handAfterDiscard = result.current.hand

    // a fresh `seats` object with the same modes — proof this is keyed by value, not identity
    rerender({ options: { ...OPTIONS, seats: { modes: [] } } })

    // a rebuild would replay only `urlData.log` (none here), landing back at the handover turn
    // with a fresh hand — so the turn/hand staying put is proof no rebuild happened
    expect(result.current.turn).toBe(turnAfterDiscard)
    expect(result.current.hand).toEqual(handAfterDiscard)
  })

  it('flipping a seat’s mode mid-hand patches the live match instead of rebuilding it (ADR-0008, ADR-0015)', async () => {
    const urlData: FoldingUrl = { wall: wall('live-flip-seed') }
    const { result, rerender } = renderHook(
      ({ options }: { options: FoldingOptions }) => useFoldingRound(urlData, options),
      { initialProps: { options: OPTIONS } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 })
    const { turn, hand, liveWall } = result.current
    // any seat but the drill's own graded one — flipping that one is a different feature (ADR-0008)
    const other = [0, 1, 2, 3].find((seat) => seat !== result.current.seatIndex)!
    const flipped: SeatAlgorithm =
      result.current.algorithms[other] === 'defense' ? 'efficiency' : 'defense'
    const modes: SeatAlgorithm[] = []
    modes[other] = flipped

    rerender({ options: { ...OPTIONS, seats: { modes } } })

    // the live-sync effect actually applied the flip...
    expect(result.current.algorithms[other]).toBe(flipped)
    // ...without rebuilding the round out from under it
    expect(result.current.turn).toBe(turn)
    expect(result.current.hand).toEqual(hand)
    expect(result.current.liveWall).toEqual(liveWall)
  })

  it('answering with no claim pending is a no-op', async () => {
    const result = await deal({ wall: wall('no-claim-seed') })
    expect(result.current.claim).toBeUndefined()
    act(() => result.current.answer({ kind: 'pass' }))
    expect(result.current.claim).toBeUndefined()
    expect(result.current.finished).toBe(false)
  })
})

describe('boardHands (the reveal gate)', () => {
  it('gives every threat face-down filler at the right count, mid-hand', async () => {
    const result = await deal({ wall: wall('boardhands-seed') })
    expect(result.current.threatSeats.length).toBeGreaterThan(0)
    for (const seat of result.current.threatSeats) {
      const real = result.current.hands[seat]
      expect(result.current.boardHands[seat]).toHaveLength(real.length)
      // every filler entry is the same identity-free tile — no real tile id leaks through
      expect(new Set(result.current.boardHands[seat].map((t) => t.id)).size).toBe(1)
    }
  })

  it('gives a bystander seat real tiles mid-hand — it is not the answer being graded', async () => {
    const result = await deal({ wall: wall('boardhands-seed') })
    const bystanders = result.current.hands
      .map((_, seat) => seat)
      .filter(
        (seat) => seat !== result.current.seatIndex && !result.current.threatSeats.includes(seat),
      )
    expect(bystanders.length).toBeGreaterThan(0)
    for (const seat of bystanders) {
      expect(result.current.boardHands[seat]).toEqual(result.current.hands[seat])
    }
  })

  it('always shows your own seat for real, even mid-hand', async () => {
    const result = await deal({ wall: wall('boardhands-self-seed') })
    const own = result.current.boardHands[result.current.seatIndex]
    expect(own).toEqual(result.current.hands[result.current.seatIndex])
    expect(own.length).toBe(result.current.hand.length + (result.current.drawn ? 1 : 0))
  })

  it('the board reveal switch shows a threat for real too, mid-hand — it is a debug switch, not a narrower answer key', async () => {
    const result = await deal(
      { wall: wall('boardhands-seed') },
      { ...OPTIONS, showOpponentHands: true },
    )
    expect(result.current.finished).toBe(false)
    expect(result.current.threatSeats.length).toBeGreaterThan(0)
    for (const seat of result.current.threatSeats) {
      expect(result.current.boardHands[seat]).toEqual(result.current.hands[seat])
    }
  })

  it('reveals real tiles once the hand is over, matching the reveal panel', async () => {
    // wins off, same reasoning as the reveal-panel test above: keeps every threat tenpai so this
    // exercises a genuinely riichi'd hand rather than a completed one
    const result = await deal(
      { wall: wall('boardhands-reveal-seed') },
      { ...OPTIONS, opponentWins: false },
    )
    for (let i = 0; i < 40 && !result.current.finished; i++) {
      const safe = result.current.ranked()[0]
      act(() =>
        result.current.discard(indexOf(result.current.hand, result.current.drawn, safe.tile)),
      )
    }
    expect(result.current.finished).toBe(true)
    for (const threat of result.current.end!.threats) {
      expect(result.current.boardHands[threat.seat]).toEqual(threat.hand)
    }
  })
})

describe('splitConcealedDrawn', () => {
  it('splits a real hand by identity, like splitDrawn', () => {
    const hand = parseTenhou('123456789m11p').map((t) => ({ id: t.id, red: t.red }))
    const drawn = hand[2]
    const { tiles, drawn: split } = splitConcealedDrawn(hand, drawn)
    expect(split).toEqual(drawn)
    expect(tiles).not.toContainEqual(drawn)
    expect(tiles.length).toBe(hand.length - 1)
  })

  it('splits filler positionally, since every backed slot is the same identity-free tile', () => {
    const filler = Array.from({ length: 14 }, () => BACK_TILE)
    const { tiles, drawn } = splitConcealedDrawn(filler, BACK_TILE)
    expect(drawn).toBe(BACK_TILE)
    expect(tiles.length).toBe(13)
    expect(tiles.every((t) => t === BACK_TILE)).toBe(true)
  })

  it('passes through unchanged when nothing is drawn, filler or not', () => {
    const filler = Array.from({ length: 13 }, () => BACK_TILE)
    expect(splitConcealedDrawn(filler, undefined)).toEqual({ tiles: filler, drawn: undefined })
  })
})

describe('the folding link', () => {
  it('round-trips the wall and the rules the board was built under', () => {
    const w = wall('link-seed', true)
    const query = encodeFoldingUrl(w, { sanma: true, threats: 2, wins: true })
    expect(decodeFoldingUrl(new URLSearchParams(query))).toEqual({
      wall: w,
      sanma: true,
      wins: true,
      threats: 2,
      log: undefined,
    })
  })

  it('round-trips the log played since the handover', () => {
    const w = wall('link-seed-2')
    const played: LogEntry[] = [
      { kind: 'discard', seat: 0, tile: { id: 0, red: false }, fromDrawn: false, riichi: false },
      { kind: 'discard', seat: 1, tile: { id: 8, red: false }, fromDrawn: true, riichi: false },
    ]
    const query = encodeFoldingUrl(w, { sanma: false, threats: 1, wins: true }, played)
    expect(decodeFoldingUrl(new URLSearchParams(query)).log).toEqual(played)
  })

  it('leaves unset rules undefined, so the reader keeps their own settings', () => {
    expect(decodeFoldingUrl(new URLSearchParams(''))).toEqual({
      wall: [],
      sanma: undefined,
      wins: undefined,
      threats: undefined,
      log: undefined,
    })
  })

  it('an invalid wall sets wallError and leaves wall empty', () => {
    const decoded = decodeFoldingUrl(new URLSearchParams('wall=11111m'))
    expect(decoded.wallError).toBeTruthy()
    expect(decoded.wall).toHaveLength(0)
  })
})

describe('assessDiscards through the hook', () => {
  it('is the same ranking the trainer grades on', () => {
    // guards the contract the hook relies on: rank 0 is the safest tier, ties included
    const ranked = assessDiscards(
      handFromTenhou('123m456p789s11z'),
      [{ seat: 1, discards: [0], passed: [] }],
      new Uint8Array(34),
      false,
    )
    expect(ranked[0].rank).toBe(0)
    expect(ranked.filter((e) => e.rank === 0).every((e) => e.tier === ranked[0].tier)).toBe(true)
  })
})
