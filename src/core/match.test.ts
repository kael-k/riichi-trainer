import { describe, expect, it } from 'vitest'
import { assessDiscards } from './danger'
import { handFromTenhou, tileCount } from './hand'
import {
  answerClaim,
  beginTurn,
  canDeclareRiichi,
  claimOptions,
  createMatch,
  findMatch,
  finishTurn,
  NORTH,
  playMatch,
  threatViews,
  wallDrawnCount,
  type MatchEvent,
  type MatchOptions,
  type MatchState,
} from './match'
import type { SeatAlgorithm } from './policy'
import { scoreHand } from './score'
import { HONOR, inTileSet, NUM_TILE_TYPES, parseTenhou, SOU } from './tiles'
import { INITIAL_HAND_SIZE, TILES_PER_KIND, wallWithHand } from './wall'

/** `MatchOptions.algorithms` naming just the manual seats — every other seat defaults to
 *  `'efficiency'`, same as an absent entry does. */
function manual(...seats: number[]): SeatAlgorithm[] {
  const algorithms: SeatAlgorithm[] = Array(Math.max(...seats) + 1).fill('efficiency')
  for (const seat of seats) algorithms[seat] = 'manual'
  return algorithms
}

const YONMA: MatchOptions = {
  sanma: false,
  aka: true,
  round: HONOR,
  deadWall: true,
  calls: true,
  riichi: true,
  wins: true,
}

const SANMA: MatchOptions = { ...YONMA, sanma: true }

/** Every copy of every kind has to be somewhere, exactly once — the invariant that catches
 *  almost any bookkeeping slip in the simulator. */
function census(state: MatchState): Uint8Array {
  const counts = new Uint8Array(NUM_TILE_TYPES)
  for (const player of state.players) {
    for (let id = 0; id < NUM_TILE_TYPES; id++) counts[id] += player.hand.counts[id]
    for (const meld of player.melds) for (const t of meld.tiles) counts[t.id]++
    for (const t of player.river) counts[t.id]++
    for (const t of player.nuki) counts[t.id]++
  }
  for (const pile of [
    state.liveWall,
    state.deadWall,
    state.doraStack,
    state.uraStack,
    state.doraIndicators,
  ]) {
    for (const t of pile) counts[t.id]++
  }
  return counts
}

function summarize(events: MatchEvent[]): string {
  return events
    .map((e) => (e.kind === 'win' ? `win:${e.win.seat}` : `${e.kind}:${'seat' in e ? e.seat : ''}`))
    .join('|')
}

describe('playMatch', () => {
  it('replays a seed identically', () => {
    const a = playMatch('match-seed', 4, YONMA)
    const b = playMatch('match-seed', 4, YONMA)
    expect(summarize(a.events)).toBe(summarize(b.events))
    expect(census(a.state)).toEqual(census(b.state))
  })

  it('diverges on a different seed', () => {
    const a = playMatch('match-seed-a', 4, YONMA)
    const b = playMatch('match-seed-b', 4, YONMA)
    expect(summarize(a.events)).not.toBe(summarize(b.events))
  })

  it('never loses or duplicates a tile', () => {
    for (let i = 0; i < 40; i++) {
      const { state } = playMatch(`census-${i}`, 4, YONMA)
      const counts = census(state)
      for (let id = 0; id < NUM_TILE_TYPES; id++) {
        expect(counts[id], `tile ${id} in seed census-${i}`).toBe(TILES_PER_KIND)
      }
    }
  })

  it('keeps sanma to three seats and the reduced tile set', () => {
    for (let i = 0; i < 15; i++) {
      const { state } = playMatch(`sanma-${i}`, 3, SANMA)
      expect(state.players).toHaveLength(3)
      const counts = census(state)
      for (let id = 0; id < NUM_TILE_TYPES; id++) {
        expect(counts[id]).toBe(inTileSet(id, true) ? TILES_PER_KIND : 0)
      }
    }
  })

  it('leaves every hand at a legal size', () => {
    for (let i = 0; i < 20; i++) {
      const { state } = playMatch(`sizes-${i}`, 4, YONMA)
      for (const player of state.players) {
        expect(tileCount(player.hand)).toBeGreaterThanOrEqual(13)
        expect(tileCount(player.hand)).toBeLessThanOrEqual(14)
      }
    }
  })

  it('scores every win it declares', () => {
    let wins = 0
    for (let i = 0; i < 40; i++) {
      const { state } = playMatch(`wins-${i}`, 4, YONMA)
      if (!state.win) continue
      wins++
      const { ctx, concealed, melds, doraIndicators, uraIndicators, kita } = state.win
      const rescored = scoreHand({
        concealed,
        melds,
        ctx,
        doraIndicators,
        uraIndicators,
        kita,
        rules: { kiriageMangan: false, honba: 0, sanma: false },
      })
      expect(rescored, `seed wins-${i}`).not.toBeNull()
      expect(rescored!.han).toBeGreaterThan(0)
    }
    // a natural hand ends in a win often enough that zero would mean the win path is dead
    expect(wins).toBeGreaterThan(0)
  })

  it('never declares a win with wins turned off', () => {
    for (let i = 0; i < 25; i++) {
      const { events, state } = playMatch(`nowin-${i}`, 4, { ...YONMA, wins: false })
      expect(events.some((e) => e.kind === 'win')).toBe(false)
      expect(state.ended).toBe('exhaustive')
    }
  })

  it('forces tsumogiri after a riichi declaration', () => {
    for (let i = 0; i < 30; i++) {
      const { state } = playMatch(`riichi-${i}`, 4, YONMA)
      for (const player of state.players) {
        if (player.riichiAt === undefined) continue
        for (const tile of player.river.slice(player.riichiAt + 1)) {
          expect(tile.tsumogiri).toBe(true)
        }
      }
    }
  })

  it('marks exactly one river tile per riichi, and none without one', () => {
    for (let i = 0; i < 30; i++) {
      const { state } = playMatch(`riichi-mark-${i}`, 4, YONMA)
      for (const player of state.players) {
        const marked = player.river.filter((t) => t.riichi).length
        // a claimed declaration tile leaves the river with the meld, so the marker can be gone
        expect(marked).toBeLessThanOrEqual(player.riichiAt === undefined ? 0 : 1)
      }
    }
  })

  it('only ever declares riichi on a closed hand', () => {
    for (let i = 0; i < 30; i++) {
      const { state } = playMatch(`closed-${i}`, 4, YONMA)
      for (const player of state.players) {
        if (player.riichiAt === undefined) continue
        expect(player.melds.every((m) => m.kind === 'ankan')).toBe(true)
      }
    }
  })

  it('stops early when asked', () => {
    const { events, ended } = playMatch('stop-me', 4, YONMA, (e) => e.kind === 'discard')
    expect(ended).toBe('stopped')
    expect(events.at(-1)?.kind).toBe('discard')
  })
})

describe('createMatch', () => {
  it('seeds exactly one red five per suit when aka is on, and none when it is off', () => {
    // a red copy is either still in a pile, or held — `reds` names the kinds a player holds one
    // of, and there is at most one red per kind, so the two counts add up exactly
    const reds = (options: MatchOptions, players: number) => {
      const state = createMatch([], players, options, 'aka-seed')
      const inPiles = [state.liveWall, state.deadWall, state.doraStack, state.uraStack]
        .flat()
        .filter((t) => t.red).length
      const held = state.players.reduce((sum, p) => sum + p.reds.size, 0)
      return inPiles + held
    }
    expect(reds(YONMA, 4)).toBe(3)
    expect(reds({ ...YONMA, aka: false }, 4)).toBe(0)
    // sanma has no 5m at all, so it can only seed two
    expect(reds(SANMA, 3)).toBe(2)
  })

  it('honours a wall pinning one seat, filling the rest of the wall itself', () => {
    const wall = wallWithHand(1, parseTenhou('12m'), false, true, 'pinned')
    const state = createMatch(wall, 4, YONMA)
    expect(state.players[1].hand.counts[0]).toBeGreaterThan(0)
    expect(state.players[1].hand.counts[1]).toBeGreaterThan(0)
    const counts = census(state)
    for (let id = 0; id < NUM_TILE_TYPES; id++) expect(counts[id]).toBe(TILES_PER_KIND)
  })

  it('honours a short wall prefix as seat 0’s exact starting hand', () => {
    const state = createMatch(parseTenhou('1112345678999m'), 4, YONMA)
    expect(state.players[0].hand.counts).toEqual(handFromTenhou('1112345678999m').counts)
    const counts = census(state)
    for (let id = 0; id < NUM_TILE_TYPES; id++) expect(counts[id]).toBe(TILES_PER_KIND)
  })

  it('lets liveWallSnapshot plus wallDrawnCount reconstruct what is left', () => {
    // played out (not just dealt), so some seeds exercise kan replacement draws too
    for (let i = 0; i < 20; i++) {
      const { state } = playMatch(`wall-snapshot-${i}`, 4, YONMA)
      const drawn = wallDrawnCount(state)
      const reconstructed = state.liveWallSnapshot.slice(drawn, drawn + state.liveWall.length)
      expect(reconstructed).toEqual(state.liveWall)
    }
  })
})

describe('findMatch', () => {
  const acceptWin = (outcome: ReturnType<typeof playMatch>) => outcome.state.win ?? null

  it('finds a scoreable win and reports the seed that produced it', () => {
    const found = findMatch('search', 4, YONMA, acceptWin)
    expect(found).not.toBeNull()
    expect(found!.result.score.han).toBeGreaterThan(0)
    // the reported seed is what reproduces it
    expect(playMatch(found!.seed, 4, YONMA).state.win?.seat).toBe(found!.result.seat)
  })

  it('is reproducible', () => {
    const a = findMatch('search-again', 4, YONMA, acceptWin)
    const b = findMatch('search-again', 4, YONMA, acceptWin)
    expect(a!.seed).toBe(b!.seed)
    expect(a!.result.ctx).toEqual(b!.result.ctx)
  })

  it('finds a win for many different seeds', () => {
    for (let i = 0; i < 10; i++) {
      expect(findMatch(`find-${i}`, 4, YONMA, acceptWin), `seed find-${i}`).not.toBeNull()
    }
  })
})

/** Visibility the way `finishTurn` sees it: every face-up tile plus this seat's own hand. */
function seenBy(state: MatchState, seat: number): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = Math.min(TILES_PER_KIND, state.visible[i] + state.players[seat].hand.counts[i])
  }
  return seen
}

/** Plays a seed to its first riichi, switches every other seat to `'defense'` right there — the
 *  same handoff the folding trainer performs — then plays the rest of the hand out, checking every
 *  folding seat's discard against what `assessDiscards` would itself pick. */
function playWithDefense(seed: string) {
  const state = createMatch([], 4, YONMA, seed)
  let declarer = -1
  let switched = false
  let sawCall = false
  let sawExtraRiichi = false
  let foldingDiscards = 0
  let mismatches = 0
  let sawWinByDefendingSeat = false

  for (let guard = 0; guard < 400 && !state.ended; guard++) {
    const acting = state.seat
    // the flip to defense happens after the declaring turn finishes, so a call reacting to that
    // same discard is still made under efficiency play — only a call on a later turn, once every
    // other seat has actually flipped, would mean a folding seat called
    const switchedBefore = switched
    beginTurn(state, YONMA)

    // computed with exactly what `finishTurn` hands `chooseFold`: the post-draw hand, before it
    // removes the chosen tile
    let expected: number | undefined
    if (switchedBefore && acting !== declarer) {
      const ranked = assessDiscards(
        state.players[acting].hand,
        threatViews(state),
        seenBy(state, acting),
        false,
      )
      expected = ranked[0]?.tile
    }

    for (const event of finishTurn(state, YONMA)) {
      if (event.kind === 'riichi') {
        if (declarer < 0) declarer = event.seat
        else sawExtraRiichi = true
      }
      if (event.kind === 'call' && switchedBefore) sawCall = true
      if (event.kind === 'discard' && expected !== undefined) {
        foldingDiscards++
        if (event.tile.id !== expected) mismatches++
      }
      if (event.kind === 'win' && switchedBefore)
        sawWinByDefendingSeat ||= event.win.seat !== declarer
    }

    if (declarer >= 0 && !switched) {
      for (const [seat, player] of state.players.entries()) {
        if (seat !== declarer) player.algorithm = 'defense'
      }
      switched = true
    }
  }
  return {
    state,
    declarer,
    sawCall,
    sawExtraRiichi,
    foldingDiscards,
    mismatches,
    sawWinByDefendingSeat,
  }
}

describe('defensive policy', () => {
  it(
    'folds every non-declaring seat once one riichis: no further riichi, no calls, every ' +
      "discard is that seat's own safest tile, and no tile is lost or duplicated",
    () => {
      let declared = 0
      let totalFoldingDiscards = 0
      let totalMismatches = 0
      let sawCall = false
      let sawExtraRiichi = false
      let sawWinByDefendingSeat = false

      for (let i = 0; i < 30; i++) {
        const result = playWithDefense(`defense-${i}`)
        if (result.declarer < 0) continue
        declared++
        totalFoldingDiscards += result.foldingDiscards
        totalMismatches += result.mismatches
        sawCall = sawCall || result.sawCall
        sawExtraRiichi = sawExtraRiichi || result.sawExtraRiichi
        sawWinByDefendingSeat = sawWinByDefendingSeat || result.sawWinByDefendingSeat

        const counts = census(result.state)
        for (let id = 0; id < NUM_TILE_TYPES; id++) {
          expect(counts[id], `tile ${id} in seed defense-${i}`).toBe(TILES_PER_KIND)
        }
      }

      // enough seeds reach a riichi that a zero here would mean the setup is broken, not the seeds
      expect(declared).toBeGreaterThan(5)
      expect(totalFoldingDiscards).toBeGreaterThan(0)
      expect(totalMismatches).toBe(0)
      expect(sawCall).toBe(false)
      expect(sawExtraRiichi).toBe(false)
      // a folding seat is trying to leave the hand, not win it — same reasoning tryWin applies
      expect(sawWinByDefendingSeat).toBe(false)
    },
  )

  it('never tsumos for a defense-algorithm seat, but does for the same tenpai hand under efficiency', () => {
    // shanpon tenpai on 1p/2p, drawing either completes it
    const wall = wallWithHand(0, parseTenhou('123456789m1122p'), false, false, 'tryWin-defense')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1p')[0]

    const pushing = createMatch(wall, 4, YONMA)
    beginTurn(pushing, YONMA)
    expect(pushing.ended).toBe('win')
    expect(pushing.win?.seat).toBe(0)

    const folding = createMatch(wall, 4, YONMA)
    folding.players[0].algorithm = 'defense'
    beginTurn(folding, YONMA)
    expect(folding.ended).toBeUndefined()
    expect(folding.win).toBeUndefined()
    expect(tileCount(folding.players[0].hand)).toBe(14) // drawn tile still sitting in hand, ungraded
  })

  it('pulls a held north under efficiency; a defense seat never does (T3)', () => {
    // tenpai (shanpon on 1s/2s) plus a pinned North draw: discarding North is the unique best
    // line (every other discard breaks the tenpai), so pulling it — the same evaluateDiscards
    // comparison a plain discard would make — is unambiguous, not just a tie
    const hand = parseTenhou('123456789p1122s')
    const wall = wallWithHand(0, hand, true, false, 'kita-t3-seed')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('4z')[0] // seat 0's draw: North

    const pulling = createMatch(wall, 3, SANMA)
    beginTurn(pulling, SANMA)
    expect(pulling.players[0].nuki).toEqual([{ id: NORTH, red: false }])

    const folding = createMatch(wall, 3, SANMA)
    folding.players[0].algorithm = 'defense'
    beginTurn(folding, SANMA)
    expect(folding.players[0].nuki).toHaveLength(0)
  })
})

// `claims: true` is what turns a discard into a question instead of a decision the engine makes
// for a manual seat. These hands are built tile-by-tile (rather than seeded and searched for)
// because a claim needs an exact shape on both sides of the discard — a random deal would only
// prove the mechanism works on whichever seed happened to offer one.
describe('manual claims', () => {
  it('never sets state.claim when claims stays off, even with a manual seat at the table', () => {
    // this is every existing trainer's setup (nobody passes `claims: true` today) — if turning a
    // seat manual alone started suspending turns, every one of them would silently break
    let sawClaim = false
    playMatch('claims-off', 4, { ...YONMA, algorithms: manual(0) }, (_event, state) => {
      sawClaim ||= state.claim !== undefined
      return false
    })
    expect(sawClaim).toBe(false)
  })

  it('offers a manual seat holding a pair a pon on the matching discard', () => {
    const options: MatchOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    // seat 0's hand only needs a spare 9s to discard; seat 1's is scattered everywhere else so it
    // is nowhere near tenpai and the only thing on offer is the pon
    const wall = [...parseTenhou('2468m2468p9s2345z'), ...parseTenhou('13579m13579p99s1z')]
    const state = createMatch(wall, 4, options, 'claim-pon-offer')
    beginTurn(state, options)
    finishTurn(state, options, { id: SOU + 8, red: false })

    expect(state.claim?.seat).toBe(1)
    expect(state.claim?.from).toBe(0)
    const pon = state.claim?.options.find((o) => o.kind === 'pon')
    expect(pon?.from).toEqual([SOU + 8, SOU + 8])
  })

  it('passing clears the claim, hands the turn on as usual, and leaves the declined win furiten', () => {
    const options: MatchOptions = { ...YONMA, claims: true, calls: false, algorithms: manual(1) }
    // seat 1 is tanki tenpai on 2s (all simples, so tanyao carries the yaku on a ron); seats 2
    // and 3 hold no sou at all, so they cannot react to a sou discard and cannot steal the win
    // out from under the seed's randomness
    const wall = [
      ...parseTenhou('189m189p2s123456z'),
      ...parseTenhou('234567m234567p2s'),
      ...parseTenhou('111222333m111p7z'),
      ...parseTenhou('444555666m222p7z'),
    ]
    const state = createMatch(wall, 4, options, 'claim-pass')
    beginTurn(state, options)
    finishTurn(state, options, { id: SOU + 1, red: false })

    expect(state.claim?.seat).toBe(1)
    expect(state.claim?.options.some((o) => o.kind === 'ron')).toBe(true)

    answerClaim(state, options, { kind: 'pass' })

    expect(state.claim).toBeUndefined()
    expect(state.ended).toBeUndefined()
    expect(state.seat).toBe(1) // the turn moves on exactly as it would with nothing to ask about
    expect(state.players[1].missedWin).toBe(true) // declined a win that was really there
  })

  // Req 2.3's second half — furiten already cannot ron (`tryWin`, match.ts:404); these are
  // regression tests, not code changes.
  it("never offers a ron on a tile sitting in the seat's own river (permanent furiten)", () => {
    const options: MatchOptions = { ...YONMA, claims: true, calls: false, algorithms: manual(1) }
    // same tanki-2s tenpai as the pass test above, but seat 1 has already discarded a 2s itself
    const wall = [
      ...parseTenhou('189m189p2s123456z'),
      ...parseTenhou('234567m234567p2s'),
      ...parseTenhou('111222333m111p7z'),
      ...parseTenhou('444555666m222p7z'),
    ]
    const state = createMatch(wall, 4, options, 'furiten-own-river')
    beginTurn(state, options)
    state.players[1].river.push({ id: SOU + 1, red: false })

    expect(
      claimOptions(state, options, 1, { id: SOU + 1, red: false }, 0).some((o) => o.kind === 'ron'),
    ).toBe(false)

    finishTurn(state, options, { id: SOU + 1, red: false })

    expect(state.claim).toBeUndefined()
    expect(state.win).toBeUndefined()
  })

  it('never offers a ron once the seat has missed a win on this tenpai (temporary furiten)', () => {
    const options: MatchOptions = { ...YONMA, claims: true, calls: false, algorithms: manual(1) }
    const wall = [
      ...parseTenhou('189m189p2s123456z'),
      ...parseTenhou('234567m234567p2s'),
      ...parseTenhou('111222333m111p7z'),
      ...parseTenhou('444555666m222p7z'),
    ]
    const state = createMatch(wall, 4, options, 'claim-pass')
    beginTurn(state, options)
    finishTurn(state, options, { id: SOU + 1, red: false })
    answerClaim(state, options, { kind: 'pass' })
    expect(state.players[1].missedWin).toBe(true)

    expect(
      claimOptions(state, options, 1, { id: SOU + 1, red: false }, 0).some((o) => o.kind === 'ron'),
    ).toBe(false)
  })

  it('answering pon opens the meld and moves the tile from the river into it, keeping the log', () => {
    const options: MatchOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wall = [...parseTenhou('2468m2468p9s2345z'), ...parseTenhou('13579m13579p99s1z')]
    const state = createMatch(wall, 4, options, 'claim-pon-answer')
    beginTurn(state, options)
    finishTurn(state, options, { id: SOU + 8, red: false })
    const pon = state.claim?.options.find((o) => o.kind === 'pon')
    expect(pon).toBeDefined()

    answerClaim(state, options, { kind: 'pon', from: pon!.from })

    expect(state.claim).toBeUndefined()
    const meld = state.players[1].melds.at(-1)
    expect(meld?.kind).toBe('pon')
    expect(meld?.tiles.map((t) => t.id)).toEqual([SOU + 8, SOU + 8, SOU + 8])
    expect(state.players[1].hand.melds).toBe(1)
    // the claimed tile leaves the discarder's river — it now lives in the meld instead — but
    // `discards` is the append-only log genbutsu depends on, so it keeps the record
    expect(state.players[0].river).toHaveLength(0)
    expect(state.discards.some((d) => d.seat === 0 && d.tile.id === SOU + 8)).toBe(true)
    expect(state.seat).toBe(1)
    expect(state.pendingDraw).toBe(false)
  })

  it('lets a ron outrank a pon even when the ponning seat is asked and answers first', () => {
    const options: MatchOptions = { ...YONMA, claims: true, algorithms: manual(1, 2) }
    // seat order puts seat 1 (pon-eligible) first and seat 2 (ron-eligible, chiitoi tenpai so the
    // terminal wait still carries a yaku) second; seat 3 holds no sou and cannot react at all
    const wall = [
      ...parseTenhou('2468m2468p9s2345z'),
      ...parseTenhou('13579m13579p99s1z'),
      ...parseTenhou('11335577m1133p9s'),
      ...parseTenhou('224466m2244p667z'),
    ]
    const state = createMatch(wall, 4, options, 'claim-priority')
    beginTurn(state, options)
    finishTurn(state, options, { id: SOU + 8, red: false })

    // seat 1 is asked first purely by seat order, and commits to the pon before seat 2 is even asked
    expect(state.claim?.seat).toBe(1)
    answerClaim(state, options, { kind: 'pon', from: [SOU + 8, SOU + 8] })

    expect(state.claim?.seat).toBe(2)
    answerClaim(state, options, { kind: 'ron' })

    expect(state.win?.seat).toBe(2)
    // the pon was answered first but never actually applied — ron is resolved as its own phase,
    // strictly before calls are, regardless of which order the manual seats replied in
    expect(state.players[1].melds).toHaveLength(0)
  })

  it('is a no-op for beginTurn and finishTurn while a claim is pending', () => {
    const options: MatchOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wall = [...parseTenhou('2468m2468p9s2345z'), ...parseTenhou('13579m13579p99s1z')]
    const state = createMatch(wall, 4, options, 'claim-noop')
    beginTurn(state, options)
    finishTurn(state, options, { id: SOU + 8, red: false })
    expect(state.claim).toBeDefined()

    const before = {
      seat: state.seat,
      turn: state.turn,
      discardsLength: state.discards.length,
      hand0: [...state.players[0].hand.counts],
      hand1: [...state.players[1].hand.counts],
      liveWallLength: state.liveWall.length,
    }

    expect(beginTurn(state, options)).toEqual([])
    expect(finishTurn(state, options)).toEqual([])

    expect(state.seat).toBe(before.seat)
    expect(state.turn).toBe(before.turn)
    expect(state.discards.length).toBe(before.discardsLength)
    expect([...state.players[0].hand.counts]).toEqual(before.hand0)
    expect([...state.players[1].hand.counts]).toEqual(before.hand1)
    expect(state.liveWall.length).toBe(before.liveWallLength)
    expect(state.claim).toBeDefined()
  })

  it('is a no-op when nothing is pending, so double-tapping an answer cannot skip a seat', () => {
    const options: MatchOptions = { ...YONMA, algorithms: manual(0), claims: true }
    const state = createMatch([], 4, options, 'claim-noop-answer')
    expect(state.claim).toBeUndefined()
    const before = { seat: state.seat, turn: state.turn, discardsLength: state.discards.length }

    expect(answerClaim(state, options, { kind: 'pass' })).toEqual([])

    expect(state.claim).toBeUndefined()
    expect(state.seat).toBe(before.seat)
    expect(state.turn).toBe(before.turn)
    expect(state.discards.length).toBe(before.discardsLength)
  })
})

describe('algorithms option', () => {
  it('seeds each seat’s starting algorithm from options.algorithms, defaulting the rest to efficiency', () => {
    const state = createMatch([], 4, { ...YONMA, algorithms: ['defense'] }, 'algorithm-seed')
    expect(state.players[0].algorithm).toBe('defense')
    expect(state.players.slice(1).every((p) => p.algorithm === 'efficiency')).toBe(true)
  })

  it('a seat seeded on defense from turn one never declares riichi and never calls', () => {
    for (let i = 0; i < 15; i++) {
      const { state } = playMatch(`algorithm-defense-${i}`, 4, {
        ...YONMA,
        algorithms: ['defense'],
      })
      expect(state.players[0].riichiAt, `seed algorithm-defense-${i}`).toBeUndefined()
      expect(state.players[0].melds, `seed algorithm-defense-${i}`).toHaveLength(0)
    }
  })
})

describe('manual riichi declaration', () => {
  // seat 0 is dealt straight into a shanpon tenpai (1p/2p) and draws a tile that cannot complete
  // it, so the hand is still exactly as tenpai after tsumogiri-ing that draw straight back out —
  // which is what makes canDeclareRiichi hold on the discard that follows
  function tenpaiManualState(seed: string) {
    const wall = wallWithHand(0, parseTenhou('123456789m1122p'), false, false, seed)
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('9s')[0]
    const options: MatchOptions = { ...YONMA, algorithms: manual(0) }
    const state = createMatch(wall, 4, options)
    beginTurn(state, options)
    return { state, options }
  }

  it('never auto-declares riichi for a manual seat, even reaching tenpai, unless the caller says so', () => {
    const { state, options } = tenpaiManualState('manual-riichi-1')
    // declareRiichi omitted — this is the same call playMatch makes every turn
    finishTurn(state, options, { id: SOU + 8, red: false })
    expect(state.players[0].riichiAt).toBeUndefined()
  })

  it('declares riichi for a manual seat once the caller passes declareRiichi and it is legal', () => {
    const { state, options } = tenpaiManualState('manual-riichi-2')
    finishTurn(state, options, { id: SOU + 8, red: false }, true)
    expect(state.players[0].riichiAt).toBe(0)
    expect(state.players[0].river[0]?.riichi).toBe(true)
    // canDeclareRiichi is the same legality check finishTurn just used — pinning it here is what
    // makes the UI's riichi button trustworthy: it never offers a declaration finishTurn refuses
    expect(canDeclareRiichi(state, options, 0)).toBe(false) // riichiAt is now set, so it's done
  })
})
