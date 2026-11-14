import { describe, expect, it } from 'vitest'
import { createMatch, settleRound, type MatchState } from './match'
import { kanOptions, type SeatAlgorithm } from './policy'
import { mulberry32, type Rng } from './rng'
import {
  answerClaim,
  beginTurn,
  callAnkan,
  callKakan,
  callKita,
  createRound,
  finishTurn,
  NORTH,
  replayLog,
  roundResult,
  stepRound,
  type ClaimAnswer,
  type LogEntry,
  type PendingClaim,
  type RoundOptions,
  type RoundState,
} from './round'
import { importTenhou, type ImportedGame, type ImportedRound } from './tenhouImport'
import {
  buildKyoku,
  tenhouMatchLog,
  tenhouTile,
  type TenhouRoundInput,
  type TenhouRules,
} from './tenhouLog'
import convlog from './testdata/convlog.json'
import { HONOR, parseTenhou, PIN, SOU } from './tiles'
import { completeWall, wallWithHands } from './wall'

const YONMA: TenhouRules = { sanma: false, aka: true, kiriageMangan: false, format: 'hanchan' }
const SANMA: TenhouRules = { ...YONMA, sanma: true }

/** What `buildKyoku` replays an exported round with — and what a match plays it with. */
function matchOptions(rules: TenhouRules, match: MatchState): RoundOptions {
  return { ...rules, match, calls: true, riichi: true, wins: true, claims: true, calledKan: true }
}

function imported(json: unknown): ImportedGame {
  const result = importTenhou(json)
  if ('error' in result) throw new Error(`import failed: ${JSON.stringify(result)}`)
  return result.game
}

function replayed(round: ImportedRound, rules: TenhouRules) {
  const options = matchOptions(rules, round.match)
  const state = createRound(round.wall, rules.sanma ? 3 : 4, options)
  return { state, consumed: replayLog(state, options, round.log) }
}

function settled(state: RoundState, rules: TenhouRules): number[] {
  const rr = roundResult(state)
  if (!rr) throw new Error('round has not ended')
  return settleRound(state.match, rr, rules).deltas
}

/** Export, import, export again: the second file is the first, and every imported log is the
 *  played one with its `pass` entries — which replay infers — left out. */
function roundTrip(inputs: TenhouRoundInput[], rules: TenhouRules): ImportedGame {
  const names = ['A', 'B', 'C', 'D'].slice(0, rules.sanma ? 3 : 4)
  const points = inputs[inputs.length - 1].match.points
  const exported = JSON.parse(JSON.stringify(tenhouMatchLog(inputs, points, rules, names)))
  const game = imported(exported)
  expect(game.rules).toEqual(rules)
  expect(game.names).toEqual(names)
  game.rounds.forEach((round, i) => {
    expect(round.notice, `round ${i}`).toBeUndefined()
    expect(round.log, `round ${i}`).toEqual(inputs[i].log.filter((e) => e.kind !== 'pass'))
  })
  expect(tenhouMatchLog(game.rounds, points, rules, names)).toEqual(exported)
  return game
}

describe('importTenhou — a real record (convlog)', () => {
  const game = imported(convlog)
  const record = convlog.log as unknown[][]

  it('reads the header and every round’s starting match', () => {
    expect(game.rules).toEqual(YONMA)
    expect(game.names).toEqual(['上家', '私', '下家', '対面'])
    expect(game.rounds).toHaveLength(10)
    // [3,1,0]: the North seat's dealership, repeated once
    expect(game.rounds[4].match).toMatchObject({
      prevalentWind: HONOR,
      round: 4,
      dealer: 3,
      honba: 1,
      dealerRepeat: 1,
      riichiSticks: 0,
    })
    // [7,1,1]: South 4, a stick on the table
    expect(game.rounds[9].match).toEqual({
      prevalentWind: HONOR + 1,
      round: 4,
      dealer: 3,
      honba: 1,
      dealerRepeat: 0,
      riichiSticks: 1,
      points: [43800, 26400, 21700, 7100],
    })
  })

  it('replays every round, whole, to the ending the record names', () => {
    game.rounds.forEach((round, i) => {
      const { state, consumed } = replayed(round, game.rules)
      expect(consumed, `kyoku ${i}`).toBe(round.log.length)
      const result = record[i][16] as unknown[]
      if (result[0] === '和了') {
        const [who, from] = result[2] as number[]
        expect(state.win?.seat, `kyoku ${i}`).toBe(who)
        expect(state.win?.from ?? who, `kyoku ${i}`).toBe(from)
      } else {
        expect(state.ended, `kyoku ${i}`).toBe('exhaustive')
      }
    })
  })

  it('re-exports every haipai, take, discard and dora indicator verbatim', () => {
    game.rounds.forEach((round, i) => {
      const entry = buildKyoku(round, game.rules) as unknown[]
      expect(entry.slice(0, 16), `kyoku ${i}`).toEqual(record[i].slice(0, 16))
    })
  })

  it('re-exports the deltas the record wrote, riichi deposits left out', () => {
    // 0, 6, 8 and 9 each have a riichi, and their deltas match `settleRound`'s own
    game.rounds.forEach((round, i) => {
      if (round.notice) return
      const result = (buildKyoku(round, game.rules) as unknown[])[16] as unknown[]
      expect(result[1], `kyoku ${i}`).toEqual((record[i][16] as unknown[])[1])
    })
  })

  it('flags exactly the rounds the engine settles differently from the record', () => {
    // 3 and 5: a riichi declared on the tile that was ronned. The record never takes the deposit,
    // the engine already has (`finishTurn` deducts before anyone reacts).
    expect(game.rounds.map((r) => r.notice?.code)).toEqual([
      undefined,
      undefined,
      undefined,
      'pays',
      undefined,
      'pays',
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(game.rounds[3].notice).toEqual({
      code: 'pays',
      record: [0, 0, -7700, 8700],
      engine: [0, 0, -7700, 9700],
    })
  })
})

/** Plays a round with every seat manual and a scripted, seeded hand on each decision — every kan
 *  and kita it may take, most calls, a riichi half the time — so the logs carry the actions no AI
 *  takes (daiminkan, kakan) alongside the ones it does, `pass` entries included. */
function playRecorded(seed: string, rules: TenhouRules, index: number): TenhouRoundInput {
  const players = rules.sanma ? 3 : 4
  const match = createMatch(rules.sanma, {
    prevalentWind: HONOR + (index % 2),
    round: (index % players) + 1,
    dealer: index % players,
    honba: index % 3,
    riichiSticks: index % 2,
  })
  const options: RoundOptions = {
    ...matchOptions(rules, match),
    algorithms: Array<SeatAlgorithm>(players).fill('manual'),
  }
  const state = createRound(completeWall([], rules.sanma, rules.aka, seed), players, options)
  const rng = mulberry32(seed)
  for (let guard = 0; guard < 1000 && !state.ended; guard++) {
    if (state.claim) {
      answerClaim(state, options, answer(state.claim, rng))
      continue
    }
    const seat = state.seat
    const player = state.players[seat]
    if (player.drawn === undefined) {
      beginTurn(state, options)
      if (state.claim || state.ended) continue
    }
    // the format has no kan or kita off the last tile, and neither does a table
    if (state.liveWall.length > 0) {
      const kan = player.riichiAt === undefined && kanOptions(player.hand, player.melds, true)[0]
      if (kan) {
        if (kan.kind === 'ankan') callAnkan(state, options, seat, kan.tile)
        else callKakan(state, options, seat, kan.tile)
        continue
      }
      if (rules.sanma && player.hand.counts[NORTH] > 0) {
        callKita(state, options, seat)
        continue
      }
    }
    finishTurn(state, options, undefined, rng() < 0.5)
  }
  if (!state.ended) throw new Error(`${seed} did not finish`)
  return { match, wall: state.wall, log: [...state.log], deltas: settled(state, rules) }
}

function answer(claim: PendingClaim, rng: Rng): ClaimAnswer {
  if (claim.kind === 'win') return { kind: 'tsumo' }
  if (claim.kind === 'abort') return { kind: rng() < 0.5 ? 'abort' : 'pass' }
  if (claim.options.some((o) => o.kind === 'ron') && rng() < 0.9) return { kind: 'ron' }
  for (const [kind, odds] of [
    ['minkan', 0.8],
    ['pon', 0.5],
    ['chi', 0.3],
  ] as const) {
    const option = claim.options.find((o) => o.kind === kind)
    if (option && rng() < odds) return { kind, from: option.from }
  }
  return { kind: 'pass' }
}

/** A pon or daiminkan naki re-written with its from-seat taken mod 3, the other sanma convention
 *  the importer reads. */
function nakiMod3(naki: string, seat: number): string {
  const tokens = naki.match(/[a-z]?\d\d/g)!
  const at = tokens.findIndex((t) => /^[pm]/.test(t))
  if (at < 0) return naki
  const pon = tokens[at][0] === 'p'
  const from = (seat + (pon ? 3 - at : [3, 2, -1, 1][at])) % 4
  const rel3 = (from - seat + 3) % 3 // 1 shimocha, 2 kamicha
  const marked = tokens.splice(at, 1)[0]
  tokens.splice(pon ? 3 - rel3 : rel3 === 2 ? 1 : 3, 0, marked)
  return tokens.join('')
}

describe('importTenhou — round trip through the exporter', () => {
  it.each([
    ['yonma', YONMA],
    ['sanma', SANMA],
  ])('%s: 20 played rounds export, import and re-export unchanged', (label, rules) => {
    const inputs = Array.from({ length: 20 }, (_, i) =>
      playRecorded(`tenhou-import-${label}-${i}`, rules, i),
    )
    roundTrip(inputs, rules)

    // the property is only as strong as what the rounds actually did
    const logs = inputs.flatMap((r) => r.log)
    const calls = new Set(logs.flatMap((e) => (e.kind === 'call' ? [e.call.kind] : [])))
    const kinds = new Set(logs.map((e) => e.kind))
    expect(calls).toContain('minkan')
    expect(calls).toContain('pon')
    expect(kinds).toContain('kakan')
    expect(kinds).toContain('ankan')
    expect(kinds).toContain('win')
    if (rules.sanma) expect(kinds).toContain('kita')
  })

  it('sanma: reads a ghost seat of [] and from-seats taken mod 3', () => {
    const inputs = Array.from({ length: 6 }, (_, i) =>
      playRecorded(`tenhou-import-mod3-${i}`, SANMA, i),
    )
    const exported = JSON.parse(
      JSON.stringify(tenhouMatchLog(inputs, inputs[0].match.points, SANMA, ['A', 'B', 'C'])),
    )
    exported.rule.disp = '南喰赤' // sanma now only from the ghost seat
    let rewritten = 0
    for (const kyoku of exported.log as unknown[][]) {
      kyoku[13] = []
      for (let seat = 0; seat < 3; seat++) {
        const takes = kyoku[5 + 3 * seat] as unknown[]
        takes.forEach((take, i) => {
          if (typeof take !== 'string') return
          takes[i] = nakiMod3(take, seat)
          if (takes[i] !== take) rewritten++
        })
      }
    }
    expect(rewritten).toBeGreaterThan(0) // some call genuinely reads differently mod 3
    const game = imported(exported)
    expect(game.rules.sanma).toBe(true)
    game.rounds.forEach((round, i) => {
      expect(round.log).toEqual(inputs[i].log.filter((e) => e.kind !== 'pass'))
    })
  })

  const handsWall = (seed: string, ...hands: string[]) =>
    wallWithHands(hands.map(parseTenhou), false, true, seed)

  it('round-trips a pon and the kakan on it', () => {
    // `tenhouLog.test.ts`'s own pon → kakan scenario
    const match = createMatch(false)
    const options: RoundOptions = {
      ...matchOptions(YONMA, match),
      algorithms: ['efficiency', 'manual'],
    }
    const wall = handsWall('tenhou-log-pon-kakan', '111456789m9s12p1z', '999s24689m2468p1z')
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    answerClaim(state, options, { kind: 'pon', from: [SOU + 8, SOU + 8] })
    beginTurn(state, options)
    callKakan(state, options, 1, SOU + 8)
    state.players.forEach((p) => (p.algorithm = 'tsumogiri'))
    for (const _ of stepRound(state, options)) void _

    const game = roundTrip([{ match, wall, log: state.log, deltas: settled(state, YONMA) }], YONMA)
    expect(game.rounds[0].log.slice(0, 3).map((e) => e.kind)).toEqual(['discard', 'call', 'kakan'])
  })

  it('keeps a red five the record kept out of a call', () => {
    // seat 1 holds the red 5p and both plain ones left: it pons seat 0's 5p with the plain pair,
    // keeping the red — which it throws next, so a call spending it would fail the census
    const match = createMatch(false)
    const options: RoundOptions = {
      ...matchOptions(YONMA, match),
      algorithms: ['efficiency', 'manual'],
    }
    const wall = handsWall('tenhou-import-keep-red', '123456789m5p111z', '055p123456789s2z')
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: PIN + 4, red: false }, fromDrawn: false })
    answerClaim(state, options, { kind: 'pon', from: [PIN + 4, PIN + 4], keepRed: true })
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: PIN + 4, red: true }, fromDrawn: false })
    state.players.forEach((p) => (p.algorithm = 'tsumogiri'))
    for (const _ of stepRound(state, options)) void _

    const game = roundTrip([{ match, wall, log: state.log, deltas: settled(state, YONMA) }], YONMA)
    expect(game.rounds[0].log[1]).toEqual({
      kind: 'call',
      seat: 1,
      from: 0,
      call: { kind: 'pon', from: [PIN + 4, PIN + 4], keepRed: true },
    })
  })
})

const codes = (hand: string) => parseTenhou(hand).map(tenhouTile)

/** One East 1 kyoku from tenhou-notation hands; `seats` are each seat's takes and discards,
 *  already in the format's own codes. */
function kyoku(hands: string[], seats: unknown[][][], result: unknown[]): unknown[] {
  return [
    [0, 0, 0],
    [25000, 25000, 25000, 25000],
    codes('9p'),
    [],
    ...hands.flatMap((hand, s) => [codes(hand), ...seats[s]]),
    result,
  ]
}

const file = (...log: unknown[][]) => ({
  name: ['A', 'B', 'C', 'D'],
  rule: { disp: '南喰赤' },
  log,
})

// every seat holds one East; each draws an honour and throws its East
const WINDS = ['123456789m123p1z', '123456789m456p1z', '123456789m789p1z', '123456789s123s1z']
const fourWinds = (result: unknown[]) =>
  kyoku(
    WINDS,
    [
      [[42], [41]],
      [[43], [41]],
      [[44], [41]],
      [[45], [41]],
    ],
    result,
  )

describe('importTenhou — endings the engine does not model', () => {
  const only = (json: unknown) => imported(json).rounds[0]
  const east = (seat: number): LogEntry => ({
    kind: 'discard',
    seat,
    tile: { id: HONOR, red: false },
    fromDrawn: false,
    riichi: false,
  })

  it('suufon renda: the four discards, then nothing', () => {
    const round = only(file(fourWinds(['四風連打'])))
    expect(round.notice).toEqual({ code: 'suufonRenda' })
    expect(round.log).toEqual([east(0), east(1), east(2), east(3)])
    expect(replayed(round, YONMA).consumed).toBe(4)
  })

  it('double ron: stops at the discard both seats won on', () => {
    // a single discard into two winners — the importer stops before the ending, so whether the
    // hands could really ron it is the engine's business, not this test's
    const round = only(
      file(
        kyoku(
          WINDS,
          [
            [[42], [41]],
            [[], []],
            [[], []],
            [[], []],
          ],
          [
            '和了',
            [-1000, 1000, 0, 0],
            [1, 0, 1, '1000点'],
            [-1000, 0, 1000, 0],
            [2, 0, 2, '1000点'],
          ],
        ),
      ),
    )
    expect(round.notice).toEqual({ code: 'doubleRon' })
    expect(round.log).toEqual([east(0)])
  })

  it('chankan: drops the kan the ron interrupted', () => {
    const round = only(
      file(
        kyoku(
          ['111456789m9s12p1z', '999s24689m2468p1z', '345m345p345s2223z', '345m345p345s3444z'],
          [
            [[47], [39]],
            [['p393939'], ['k39393939']],
            [[], []],
            [[], []],
          ],
          ['和了', [0, -1000, 1000, 0], [2, 1, 2, '1000点']],
        ),
      ),
    )
    expect(round.notice).toEqual({ code: 'chankan' })
    expect(round.log.map((e) => e.kind)).toEqual(['discard', 'call'])
    expect(replayed(round, YONMA).consumed).toBe(2)
  })

  it('nagashi mangan: the whole hand, without the payment', () => {
    const match = createMatch(false)
    const options: RoundOptions = { ...matchOptions(YONMA, match), wins: false, riichi: false }
    const wall = completeWall([], false, true, 'tenhou-import-nagashi')
    const state = createRound(wall, 4, options)
    for (const _ of stepRound(state, options)) void _
    expect(state.ended).toBe('exhaustive')
    const input = { match, wall, log: state.log, deltas: settled(state, YONMA) }
    const entry = buildKyoku(input, YONMA)
    entry[16] = ['流し満貫', [12000, -4000, -4000, -4000]]

    const round = only(file(entry))
    expect(round.notice).toEqual({ code: 'nagashiMangan' })
    expect(round.log).toEqual(state.log.filter((e) => e.kind !== 'pass'))
    expect(round.deltas).toEqual([12000, -4000, -4000, -4000])
  })
})

describe('importTenhou — malformed input', () => {
  it.each([
    ['not an object', null, { error: 'notTenhou' }],
    ['no rounds', { log: [] }, { error: 'notTenhou' }],
    ['a code that is no tile', file(fourWinds(['四風連打']).with(5, [10])), 'notTenhou'],
    ['an ending nobody plays', file(fourWinds(['八連荘'])), 'notTenhou'],
    // a fifth East, as the dora indicator
    ['five copies of a tile', file(fourWinds(['四風連打']).with(2, [41])), 'tiles'],
    // seat 0 throws a chun it never held
    ['a discard of a tile never held', file(fourWinds(['四風連打']).with(6, [47])), 'tiles'],
  ])('%s', (_label, json, expected) => {
    const result = importTenhou(json)
    expect(result).toEqual(typeof expected === 'string' ? { error: expected, kyoku: 0 } : expected)
  })

  it('a red five under a ruleset without them', () => {
    const json = {
      ...file(fourWinds(['四風連打']).with(4, codes('123406789m123p1z'))),
      rule: { disp: '南喰', aka51: 0, aka52: 0, aka53: 0 },
    }
    expect(importTenhou(json)).toEqual({ error: 'rules', kyoku: 0 })
  })

  it('names the round that failed', () => {
    const json = file(fourWinds(['四風連打']), fourWinds(['四風連打']).with(5, [10]))
    expect(importTenhou(json)).toEqual({ error: 'notTenhou', kyoku: 1 })
  })
})
