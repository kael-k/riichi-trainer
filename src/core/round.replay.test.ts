import { describe, expect, it } from 'vitest'
import { tileCount } from './hand'
import { createMatch } from './match'
import {
  answerClaim,
  beginTurn,
  callAnkan,
  callKita,
  createRound,
  finishTurn,
  playRound,
  replayLog,
  type LogEntry,
  type RoundOptions,
  type RoundState,
} from './round'
import type { SeatAlgorithm } from './policy'
import { MAN, parseTenhou, SOU } from './tiles'
import { INITIAL_HAND_SIZE, wallWithHand } from './wall'

/**
 * `replayLog`'s regression net (PLAN-action-log.md T2). Not a hash like `round.golden.test.ts` —
 * a structural comparison between a live-played match's final state and the state a *fresh* match
 * reaches by replaying that live match's own `log` from the same wall. `log` itself is excluded
 * from the projection (that's `round.test.ts`'s job); this proves replay reproduces the *board*.
 */

function manual(...seats: number[]): SeatAlgorithm[] {
  const algorithms: SeatAlgorithm[] = Array(Math.max(...seats) + 1).fill('efficiency')
  for (const seat of seats) algorithms[seat] = 'manual'
  return algorithms
}

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  deadWall: true,
  calls: true,
  riichi: true,
  wins: true,
}

const SANMA: RoundOptions = { ...YONMA, sanma: true, match: createMatch(true) }

/** Everything about a match that matters for "is this the same board" — hands, melds, rivers,
 *  riichi/furiten state, dora, whose turn it is, whether it ended and how. Deliberately excludes
 *  `log` (a separate concern, covered in `round.test.ts`) and `wall`/`liveWallSnapshot`/
 *  `deadWallSnapshot` (identical by construction — both states are built from the same wall array). */
function project(state: RoundState) {
  return {
    ended: state.ended,
    win: state.win,
    seat: state.seat,
    turn: state.turn,
    pendingDraw: state.pendingDraw,
    claim: state.claim && {
      seat: state.claim.seat,
      from: state.claim.from,
      tile: state.claim.tile,
    },
    liveWallLength: state.liveWall.length,
    doraIndicators: state.doraIndicators,
    players: state.players.map((p) => ({
      counts: Array.from(p.hand.counts),
      drawn: p.drawn,
      concealed: p.concealed,
      melds: p.melds,
      river: p.river,
      riichiAt: p.riichiAt,
      missedWin: p.missedWin,
      nuki: p.nuki,
    })),
  }
}

/** Replays `original`'s own log onto a fresh match dealt from the same wall, under the same
 *  seeded algorithms `original` was built with (irrelevant to what gets replayed — `replayLog`
 *  forces every seat manual regardless — but matching them is what makes the *restored* algorithm
 *  after replay meaningful to assert on). */
function replayed(original: RoundState, options: RoundOptions): RoundState {
  const fresh = createRound(original.wall, original.players.length, options)
  replayLog(fresh, options, original.log)
  return fresh
}

describe('replayLog', () => {
  it('reproduces a live AI match exactly, from its own log', () => {
    for (let i = 0; i < 20; i++) {
      const { state } = playRound(`replay-${i}`, 4, YONMA)
      const fresh = replayed(state, YONMA)
      expect(project(fresh), `seed replay-${i}`).toEqual(project(state))
    }
  })

  it('reproduces a live sanma match exactly, including any AI kita pulls', () => {
    for (let i = 0; i < 20; i++) {
      const { state } = playRound(`replay-sanma-${i}`, 3, SANMA)
      const fresh = replayed(state, SANMA)
      expect(project(fresh), `seed replay-sanma-${i}`).toEqual(project(state))
    }
  })

  it('restores every seat to its pre-replay algorithm, win or no win', () => {
    const options: RoundOptions = { ...YONMA, algorithms: ['efficiency', 'defense', 'tsumogiri'] }
    const { state } = playRound('replay-restore', 4, options)
    const fresh = createRound(state.wall, 4, options)
    replayLog(fresh, options, state.log)
    expect(fresh.players.map((p) => p.algorithm)).toEqual([
      'efficiency',
      'defense',
      'tsumogiri',
      'efficiency',
    ])
  })

  it('replays a defense seat declining a mid-hand tsumo — the log never claims it, and replay never takes it either', () => {
    // shanpon tenpai on 1p/2p; the very next draw completes it, but a defense-algorithm seat
    // never takes a win it draws into (ADR-0021's whole reason for existing)
    const wall = wallWithHand(0, parseTenhou('123456789m1122p'), false, false, 'replay-decline')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1p')[0]
    const options: RoundOptions = { ...YONMA, algorithms: ['defense'] }
    const state = createRound(wall, 4, options)

    beginTurn(state, options)
    expect(state.ended).toBeUndefined() // declined, as chosen
    expect(tileCount(state.players[0].hand)).toBe(14)
    finishTurn(state, options) // the same turn's own discard, from the now-14-tile hand

    // play the hand on a few more turns so the log has real content past the decline
    for (let t = 0; t < 8 && !state.ended; t++) {
      beginTurn(state, options)
      finishTurn(state, options)
    }

    expect(state.log.some((e) => e.kind === 'win' && e.seat === 0 && e.from === undefined)).toBe(
      false,
    )
    const fresh = replayed(state, options)
    expect(project(fresh)).toEqual(project(state))
  })

  it('replays a manual seat pulling kita then discarding', () => {
    const wall = wallWithHand(0, parseTenhou('123456789m112p4z'), true, false, 'replay-kita')
    const options: RoundOptions = { ...SANMA, algorithms: manual(0) }
    const state = createRound(wall, 3, options)

    beginTurn(state, options)
    callKita(state, options, 0)
    finishTurn(state, options, { tile: { id: MAN, red: false }, fromDrawn: false })
    for (let t = 0; t < 6 && !state.ended; t++) {
      beginTurn(state, options)
      finishTurn(state, options)
    }

    expect(state.log[0]).toEqual({ kind: 'kita', seat: 0 })
    const fresh = replayed(state, options)
    expect(project(fresh)).toEqual(project(state))
  })

  it('replays a manual seat closed-kanning then discarding, kan-dora included', () => {
    const wall = wallWithHand(0, parseTenhou('111456789m1122p'), false, false, 'replay-ankan')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1m')[0]
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const state = createRound(wall, 4, options)

    beginTurn(state, options)
    callAnkan(state, 0, MAN)
    finishTurn(state, options, { tile: state.players[0].drawn!, fromDrawn: true })
    for (let t = 0; t < 6 && !state.ended; t++) {
      beginTurn(state, options)
      finishTurn(state, options)
    }

    expect(state.log[0]).toEqual({ kind: 'ankan', seat: 0, tile: MAN })
    const fresh = replayed(state, options)
    expect(project(fresh)).toEqual(project(state))
  })

  it("never leaves a claim stuck when the caller's real options.claims was off — forcing it on to drive replay must not invent a genuine pending decision the original recording never had", () => {
    // claims stays unset (falsy) on every seed here — resolveReactions' ask-loop never suspends
    // in these original matches at all, so any claim replayLog raises internally (via its own
    // forced claims:true) must always resolve itself before returning, at every possible cut
    // point, or a caller like useTableRound's buildRound would be left unable to draw the next
    // live tile after replaying a link built under `claims: false` (the efficiency trainer's
    // default) — this is the exact scenario that motivated the `options.claims` check.
    for (let i = 0; i < 15; i++) {
      const { state } = playRound(`no-claims-${i}`, 4, YONMA)
      for (let cut = 1; cut < state.log.length; cut += 3) {
        const prefix = state.log.slice(0, cut)
        const fresh = createRound(state.wall, 4, YONMA)
        const consumed = replayLog(fresh, YONMA, prefix)
        expect(fresh.claim, `seed no-claims-${i} cut ${cut}`).toBeUndefined()
        expect(consumed, `seed no-claims-${i} cut ${cut}`).toBeGreaterThanOrEqual(cut)
      }
    }
  })

  it('replays two claims answered in sequence on the same discard', () => {
    const options: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1, 2) }
    // seat 0 discards 9s; seat 1 (kamicha) can chi it with 7s8s, seat 2 can pon it with 99s —
    // seat order asks 1 before 2, and only seat1's chi needs no extra copies of 9s itself, which
    // is what keeps this within the 4-copy census (seat0's 1 + seat2's 2 = 3, one spare)
    const wall = [
      ...parseTenhou('2468m2468p9s2345z'),
      ...parseTenhou('13579m13579p78s1z'),
      ...parseTenhou('12345m123456p99s'),
      ...parseTenhou('123456m123456p7z'),
    ]
    const state = createRound(wall, 4, options, 'replay-two-claims')
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    expect(state.claim?.seat).toBe(1)
    answerClaim(state, options, { kind: 'pass' }) // seat 1 declines the pon
    expect(state.claim?.seat).toBe(2) // seat 2 is asked next
    answerClaim(state, options, { kind: 'pass' })
    for (let t = 0; t < 6 && !state.ended; t++) {
      beginTurn(state, options)
      finishTurn(state, options)
    }

    const fresh = replayed(state, options)
    expect(project(fresh)).toEqual(project(state))
  })

  it('stops with the claim still pending when the log ends exactly there, and never invents a pass', () => {
    const options: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wall = [
      ...parseTenhou('2468m2468p9s2345z'),
      ...parseTenhou('13579m13579p99s1z'),
      ...parseTenhou('123456m123456p7s'),
      ...parseTenhou('123456m123456p7z'),
    ]
    const original = createRound(wall, 4, options, 'replay-mid-claim')
    beginTurn(original, options)
    finishTurn(original, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    expect(original.claim?.seat).toBe(1)

    // a link generated at exactly this moment: the discard is logged, nothing answers it yet
    const truncatedLog: LogEntry[] = [...original.log]

    const fresh = createRound(wall, 4, options, 'replay-mid-claim')
    const consumed = replayLog(fresh, options, truncatedLog)

    expect(fresh.claim?.seat).toBe(1)
    expect(fresh.claim?.from).toBe(0)
    expect(fresh.players[1].missedWin).toBe(false) // no pass was invented
    expect(consumed).toBe(truncatedLog.length)

    // replaying the same (still-truncated) log again is a no-op past where it already stopped
    const again = replayLog(fresh, options, truncatedLog)
    expect(again).toBe(truncatedLog.length)
    expect(fresh.claim?.seat).toBe(1)
  })
})
