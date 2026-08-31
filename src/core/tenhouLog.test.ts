import { describe, expect, it } from 'vitest'
import { createMatch, settleRound } from './match'
import {
  answerClaim,
  beginTurn,
  callKakan,
  createRound,
  finishTurn,
  roundResult,
  stepRound,
  type RoundOptions,
  type RoundState,
} from './round'
import {
  ankanNaki,
  buildKyoku,
  chiNaki,
  minkanNaki,
  ponNaki,
  tenhouMatchLog,
  tenhouTile,
  type TenhouRoundInput,
  type TenhouRules,
} from './tenhouLog'
import { HONOR, MAN, parseTenhou, PIN, SOU, type ParsedTile } from './tiles'
import { wallWithHands } from './wall'
import type { SeatAlgorithm } from './policy'

function manual(...seats: number[]): SeatAlgorithm[] {
  const algorithms: SeatAlgorithm[] = Array(Math.max(...seats) + 1).fill('efficiency')
  for (const seat of seats) algorithms[seat] = 'manual'
  return algorithms
}

function handsWall(seed: string, ...hands: string[]): ParsedTile[] {
  return wallWithHands(hands.map(parseTenhou), false, true, seed)
}

/** The win/draw payment deltas a finished round's own `settleRound` would produce — exactly what
 *  `TenhouRoundInput.deltas` holds in production (`useMatchRound`'s own `stepped.deltas`), never
 *  the round's *true* per-seat swing (`buildKyoku` folds the riichi correction in on top). */
function settledDeltas(state: RoundState): number[] {
  const rr = roundResult(state)
  if (!rr) throw new Error('round has not ended')
  const sanma = state.match.points.length === 3
  return settleRound(state.match, rr, { sanma, format: 'hanchan' }).deltas
}

const YONMA_RULES: TenhouRules = {
  sanma: false,
  aka: true,
  kiriageMangan: false,
  format: 'hanchan',
}

describe('tenhouTile', () => {
  it.each([
    ['1m', { id: MAN, red: false }, 11],
    ['9m', { id: MAN + 8, red: false }, 19],
    ['5p', { id: PIN + 4, red: false }, 25],
    ['red 5p', { id: PIN + 4, red: true }, 52],
    ['red 5m', { id: MAN + 4, red: true }, 51],
    ['red 5s', { id: SOU + 4, red: true }, 53],
    ['E', { id: HONOR, red: false }, 41],
    ['chun', { id: HONOR + 6, red: false }, 47],
  ])('%s', (_label, tile, code) => {
    expect(tenhouTile(tile)).toBe(code)
  })
})

// Every case below is one of `conv.rs#take_action_to_events`'s own documented decode examples
// (https://github.com/Equim-chan/mjai-reviewer/blob/master/convlog/src/conv.rs), worked backwards
// into the `ParsedTile`s that would encode to it — the decoder is the ground truth a downstream
// tool actually runs, so these pin the encoder against it rather than against this module's own
// derivation of the byte-offset math.
describe('meld naki strings — pinned against conv.rs decode examples', () => {
  it('chi always leads with the called tile, own tiles sorted ascending (red fives included)', () => {
    // "c275226" => chi 7p with a red 5p and a plain 6p from kamicha
    const called = { id: PIN + 6, red: false } // 7p
    const own = [
      { id: PIN + 5, red: false }, // 6p
      { id: PIN + 4, red: true }, // red 5p
    ]
    expect(chiNaki(called, own)).toBe('c275226')
  })

  it('pon from kamicha marks the called tile first', () => {
    // "p252525" => pon 5p from kamicha
    const called = { id: PIN + 4, red: false }
    const own = [
      { id: PIN + 4, red: false },
      { id: PIN + 4, red: false },
    ]
    expect(ponNaki(3, 0, called, own)).toBe('p252525') // from = seat 3, seat = 0 -> rel 3 (kamicha)
  })

  it('pon from toimen marks the called tile second', () => {
    // "12p1212" => pon 2m from toimen
    const called = { id: MAN + 1, red: false }
    const own = [
      { id: MAN + 1, red: false },
      { id: MAN + 1, red: false },
    ]
    expect(ponNaki(2, 0, called, own)).toBe('12p1212') // rel 2 (toimen)
  })

  it('pon from shimocha marks the called tile last', () => {
    // "3737p37" => pon 7s from shimocha
    const called = { id: SOU + 6, red: false }
    const own = [
      { id: SOU + 6, red: false },
      { id: SOU + 6, red: false },
    ]
    expect(ponNaki(1, 0, called, own)).toBe('3737p37') // rel 1 (shimocha)
  })

  it('daiminkan from kamicha marks the called tile first', () => {
    // "m39393939" => kan 9s from kamicha
    const called = { id: SOU + 8, red: false }
    const own = [called, called, called]
    expect(minkanNaki(3, 0, called, own)).toBe('m39393939')
  })

  it('daiminkan from toimen marks the called tile second', () => {
    // "26m262626" => kan 6p from toimen
    const called = { id: PIN + 5, red: false }
    const own = [called, called, called]
    expect(minkanNaki(2, 0, called, own)).toBe('26m262626')
  })

  it('daiminkan from shimocha marks the called tile last (slot 3, not 2)', () => {
    // "131313m13" => kan 3m from shimocha — the one non-obvious slot: not the clean 0/1/2 pon uses
    const called = { id: MAN + 2, red: false }
    const own = [called, called, called]
    expect(minkanNaki(1, 0, called, own)).toBe('131313m13')
  })

  it('ankan always marks the fourth tile', () => {
    // "424242a42" => ankan 2z (South)
    const tiles = Array.from({ length: 4 }, () => ({ id: HONOR + 1, red: false }))
    expect(ankanNaki(tiles)).toBe('424242a42')
  })
})

describe('buildKyoku', () => {
  const YONMA: RoundOptions = {
    sanma: false,
    aka: true,
    match: createMatch(false),
    calls: true,
    riichi: true,
    wins: true,
    claims: true,
    calledKan: true,
  }

  it('wires a pon, a kakan on it, and an ankan through to the exported round', () => {
    // seat 0 holds a concealed 1m triplet (ankan later) and a lone 9s (pon bait); seat 1 holds
    // three 9s — enough to pon seat 0's discard and later kakan the third one. Mirrors the exact
    // scenario `round.test.ts`'s own "called kan" describe block drives by hand.
    const match = createMatch(false)
    const options: RoundOptions = { ...YONMA, match, algorithms: manual(1) }
    const wall = handsWall('tenhou-log-pon-kakan', '111456789m9s12p1z', '999s24689m2468p1z')
    const state = createRound(wall, 4, options)

    beginTurn(state, options) // seat 0's own draw, before its forced discard below
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false }) // seat 0 tedashi 9s
    const claim = state.claim
    if (claim?.kind !== 'discard') throw new Error('expected a discard claim')
    const pon = claim.options.find((o) => o.kind === 'pon')
    if (!pon) throw new Error('expected a legal pon')
    answerClaim(state, options, { kind: 'pon', from: pon.from })
    // consumes the pon's `pendingDraw = false` (the caller holds 14 already, so this draws
    // nothing) — skipping it here would leave the flag stale for `stepRound` to misread as
    // *seat 2's* upcoming turn not drawing either, several turns down the line
    beginTurn(state, options)
    callKakan(state, options, 1, SOU + 8)

    // let the rest of the hand play itself out — every seat's own turn only, nothing scripted
    state.players.forEach((p) => (p.algorithm = 'tsumogiri'))
    for (const _ of stepRound(state, options)) void _
    expect(state.ended).toBeDefined() // sanity: the hand actually finished within the turn cap

    const input: TenhouRoundInput = { match, wall, log: state.log, deltas: settledDeltas(state) }
    const entry = buildKyoku(input, YONMA_RULES)

    const [, , , , haipai0, , discards0, , takes1, discards1] = entry as unknown[][]
    expect(haipai0).toHaveLength(13)
    expect(haipai0.every((c) => typeof c === 'number')).toBe(true)

    // seat 0's forced discard: a plain 9s, tedashi (a bare number, not a "r"-prefixed string)
    expect(discards0[0]).toBe(tenhouTile({ id: SOU + 8, red: false }))

    // seat 1's pon of that 9s, from kamicha (seat 0 is seat 1's kamicha) — slot 0
    expect(takes1[0]).toBe(
      ponNaki(0, 1, { id: SOU + 8, red: false }, [
        { id: SOU + 8, red: false },
        { id: SOU + 8, red: false },
      ]),
    )

    // the kakan immediately follows, in *discards*, replacing the pon's marker with the added tile
    expect(discards1[0]).toBe(String(takes1[0]).replace('p', 'k39'))
  })

  it('every discard/take entry is a tenhou-shaped number or naki string', () => {
    for (let i = 0; i < 5; i++) {
      const match = createMatch(false)
      const options: RoundOptions = { ...YONMA, match, calledKan: true }
      const wall = wallWithHands([], false, true, `tenhou-log-shape-${i}`)
      const state = createRound(wall, 4, options)
      for (const _ of stepRound(state, options)) void _
      expect(state.ended).toBeDefined()

      const input: TenhouRoundInput = { match, wall, log: state.log, deltas: settledDeltas(state) }
      const entry = buildKyoku(input, YONMA_RULES) as unknown[]
      for (let seat = 0; seat < 4; seat++) {
        const takes = entry[5 + seat * 3] as unknown[]
        const discards = entry[6 + seat * 3] as unknown[]
        for (const action of [...takes, ...discards]) {
          const ok =
            typeof action === 'number' || (typeof action === 'string' && /^[a-z0-9]+$/.test(action))
          expect(ok, `seed ${i} seat ${seat}: ${JSON.stringify(action)}`).toBe(true)
        }
      }
      // a win closes the loop within its own round (the winner's payout already folds in every
      // stick on the table, this round's own declarations included) — an exhaustive draw or an
      // abort does not: a stick a seat put up this round carries to a *later* round's winner, so
      // this round's own deltas are short by exactly 1000 per still-unresolved declaration, same
      // as a real tenhou log's per-round deltas are.
      const result = entry.at(-1) as unknown[]
      if (result[0] === '和了') {
        const deltas = result[1] as number[]
        expect(deltas.reduce((a, b) => a + b, 0)).toBe(0)
      }
    }
  })

  // `round.ts`'s own "ask every manual seat, then rons, then calls" order means a lone live-manual
  // seat that sits *behind* the actual caller in `seatsFrom(discarder)` order gets its `pass`
  // logged ahead of the caller's own `call` on the same discard. `replayLog` forces every seat
  // manual, asking the caller first (its own order position, not the log's) — a cursor that only
  // peeked the log's own read position used to read the mismatched `pass` and drop the call,
  // stalling the replay so `buildResult` fell through its bare `九種九牌` default (see this
  // module's own history/CLAUDE.md). Exact wall/answers as `round.test.ts`'s own regression.
  const windowWall = () =>
    handsWall(
      'tenhou-log-window-chi',
      '19m159p19s123456z',
      '23478m346p23466s',
      '19m19p19s1234567z',
      '19m1559p19s12377z',
    )

  it('exports a chi that a same-discard manual pass logged ahead of, never as an abort', () => {
    const match = createMatch(false)
    const options: RoundOptions = { ...YONMA, match, algorithms: manual(3) }
    const state = createRound(windowWall(), 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: PIN + 4, red: false }, fromDrawn: false })
    answerClaim(state, options, { kind: 'pass' })
    expect(state.players[1].melds.map((m) => m.kind)).toEqual(['chi']) // sanity: live really called

    state.players.forEach((p) => (p.algorithm = 'tsumogiri'))
    for (const _ of stepRound(state, options)) void _
    expect(state.ended).toBeDefined()

    const input: TenhouRoundInput = {
      match,
      wall: state.wall,
      log: state.log,
      deltas: settledDeltas(state),
    }
    const entry = buildKyoku(input, YONMA_RULES) as unknown[]
    expect((entry.at(-1) as unknown[])[0]).not.toBe('九種九牌')

    // seat 1's p tiles are 3p/4p/6p — both (3p,4p) and (4p,6p) chi the discarded 5p, and
    // `chooseCall`'s tie-break lands on (3p,4p); this only pins whichever it actually is, since
    // this test is about the replay surviving at all, not about `chooseCall`'s own preference
    const takes1 = entry[8] as unknown[]
    expect(takes1[0]).toBe(
      chiNaki({ id: PIN + 4, red: false }, [
        { id: PIN + 2, red: false },
        { id: PIN + 3, red: false },
      ]),
    )
  })

  it('throws rather than export a replay that never reached the log’s own end as an abort', () => {
    const match = createMatch(false)
    const options: RoundOptions = { ...YONMA, match, algorithms: manual(3) }
    const state = createRound(windowWall(), 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: PIN + 4, red: false }, fromDrawn: false })
    answerClaim(state, options, { kind: 'pass' })
    state.players.forEach((p) => (p.algorithm = 'tsumogiri'))
    for (const _ of stepRound(state, options)) void _
    expect(state.ended).toBeDefined()

    // dropping everything past the call — the shape a stalled replay used to produce on its own
    const truncated = state.log.slice(0, 3)
    const input: TenhouRoundInput = {
      match,
      wall: state.wall,
      log: truncated,
      deltas: settledDeltas(state),
    }
    expect(() => buildKyoku(input, YONMA_RULES)).toThrow()
  })
})

describe('tenhouMatchLog', () => {
  it('pads sanma to a 4-seat shape with the tensoul ghost-seat convention', () => {
    const match = createMatch(true)
    const options: RoundOptions = {
      sanma: true,
      aka: true,
      match,
      calls: true,
      riichi: true,
      wins: true,
      claims: true,
      calledKan: true,
    }
    const wall = wallWithHands([], true, true, 'tenhou-log-sanma')
    const state = createRound(wall, 3, options)
    for (const _ of stepRound(state, options)) void _

    const rules: TenhouRules = { sanma: true, aka: true, kiriageMangan: false, format: 'hanchan' }
    const input: TenhouRoundInput = { match, wall, log: state.log, deltas: [0, 0, 0] }
    const log = tenhouMatchLog([input], [35000, 35000, 35000], rules, ['A', 'B', 'C']) as {
      log: unknown[][]
      name: string[]
      rule: { disp: string }
      ratingc: string
    }

    expect(log.rule.disp).toContain('三')
    expect(log.ratingc).toBe('PF3')
    expect(log.name).toEqual(['A', 'B', 'C', ''])
    const kyoku = log.log[0]
    // seat 3 (the ghost) — haipai of 13 zeros (the format's own "unknown tile"), no actions
    expect(kyoku[13]).toEqual(new Array(13).fill(0))
    expect(kyoku[14]).toEqual([])
    expect(kyoku[15]).toEqual([])
  })
})
