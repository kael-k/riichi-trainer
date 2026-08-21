import { describe, expect, it } from 'vitest'
import { assessDiscards } from './danger'
import { removeTile, tileCount } from './hand'
import { createMatch } from './match'
import {
  answerClaim,
  beginTurn,
  callAnkan,
  callKita,
  canDeclareRiichi,
  claimOptions,
  createRound,
  findRound,
  finishTurn,
  NORTH,
  playRound,
  stepRound,
  threatViews,
  wallDrawnCount,
  type RoundEvent,
  type RoundOptions,
  type RoundState,
} from './round'
import type { SeatAlgorithm } from './policy'
import { scoreHand } from './score'
import { inTileSet, MAN, NUM_TILE_TYPES, parseTenhou, SOU, type ParsedTile } from './tiles'
import {
  completeWall,
  dealtSeat,
  INITIAL_HAND_SIZE,
  TILES_PER_KIND,
  wallWithHand,
  wallWithHands,
} from './wall'

/** A yonma wall dealing these hands to seats 0, 1, … and filling the rest off `seed`. Hands are
 *  no longer contiguous in the wall (4/4/4+1, `dealtIndices`), so a test that wants an exact shape
 *  on both sides of a discard has to build its wall through this rather than by concatenation. */
function handsWall(seed: string, ...hands: string[]): ParsedTile[] {
  return wallWithHands(hands.map(parseTenhou), false, true, seed)
}

/** `RoundOptions.algorithms` naming just the manual seats — every other seat defaults to
 *  `'efficiency'`, same as an absent entry does. */
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

/** Every copy of every kind has to be somewhere, exactly once — the invariant that catches
 *  almost any bookkeeping slip in the simulator. Also the drift guard for the one deliberate
 *  duplication in `PlayerState`: `concealed` (tiles as held, redness included) is maintained
 *  beside `hand.counts` (the counts-only hot path), so every census asserts the two still agree
 *  per kind, and that `drawn` is exactly `concealed`'s last element whenever it is set. */
function census(state: RoundState): Uint8Array {
  const counts = new Uint8Array(NUM_TILE_TYPES)
  for (const player of state.players) {
    const held = new Uint8Array(NUM_TILE_TYPES)
    for (const t of player.concealed) held[t.id]++
    expect(held).toEqual(player.hand.counts)
    expect(player.drawn === undefined || player.concealed.at(-1) === player.drawn).toBe(true)
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

function summarize(events: RoundEvent[]): string {
  return events
    .map((e) => (e.kind === 'win' ? `win:${e.win.seat}` : `${e.kind}:${'seat' in e ? e.seat : ''}`))
    .join('|')
}

// The stepper every other driver is built on. `playRound`'s own golden hashes
// (`round.golden.test.ts`) already prove it reproduces the whole event stream bit for bit; these
// cover the two things only a generator can do.
describe('stepRound', () => {
  it('suspends between the draw and the discard when the caller stops asking', () => {
    const state = createRound([], 4, YONMA, 'step-lazy')
    for (const event of stepRound(state, YONMA)) {
      if (event.kind === 'draw') break
    }
    // the turn is genuinely half-done: drawn but not discarded. The old eager `[...beginTurn(),
    // ...finishTurn()]` could not express this, which is why stopping at a manual seat needed a
    // second loop of its own
    expect(state.players[state.seat].drawn).toBeDefined()
    expect(state.players[state.seat].river).toHaveLength(0)
    // the one place a census runs mid-turn: `concealed`/`counts`/`drawn` have to agree while a
    // hand is at 14, which is the only state the end-of-round censuses never see
    for (const count of census(state)) expect(count).toBe(TILES_PER_KIND)
  })

  it('canAct refuses a turn before anything is drawn', () => {
    const state = createRound([], 4, YONMA, 'step-canact')
    const wall = state.liveWall.length
    expect([...stepRound(state, YONMA, () => false)]).toEqual([])
    expect(state.liveWall).toHaveLength(wall)
    expect(state.players[state.seat].drawn).toBeUndefined()
    expect(state.players.every((p) => p.river.length === 0)).toBe(true)
  })

  it('plays a manual seat rather than stopping at it, as playRound has always relied on', () => {
    const state = createRound([], 4, { ...YONMA, algorithms: manual(0) }, 'step-manual')
    for (const event of stepRound(state, { ...YONMA, algorithms: manual(0) })) {
      if (event.kind === 'discard') break
    }
    expect(state.players[0].drawn).toBeUndefined()
  })
})

describe('playRound', () => {
  it('replays a seed identically', () => {
    const a = playRound('match-seed', 4, YONMA)
    const b = playRound('match-seed', 4, YONMA)
    expect(summarize(a.events)).toBe(summarize(b.events))
    expect(census(a.state)).toEqual(census(b.state))
  })

  it('diverges on a different seed', () => {
    const a = playRound('match-seed-a', 4, YONMA)
    const b = playRound('match-seed-b', 4, YONMA)
    expect(summarize(a.events)).not.toBe(summarize(b.events))
  })

  it('never loses or duplicates a tile', () => {
    for (let i = 0; i < 40; i++) {
      const { state } = playRound(`census-${i}`, 4, YONMA)
      const counts = census(state)
      for (let id = 0; id < NUM_TILE_TYPES; id++) {
        expect(counts[id], `tile ${id} in seed census-${i}`).toBe(TILES_PER_KIND)
      }
    }
  })

  it('keeps sanma to three seats and the reduced tile set', () => {
    for (let i = 0; i < 15; i++) {
      const { state } = playRound(`sanma-${i}`, 3, SANMA)
      expect(state.players).toHaveLength(3)
      const counts = census(state)
      for (let id = 0; id < NUM_TILE_TYPES; id++) {
        expect(counts[id]).toBe(inTileSet(id, true) ? TILES_PER_KIND : 0)
      }
    }
  })

  it('leaves every hand at a legal size', () => {
    for (let i = 0; i < 20; i++) {
      const { state } = playRound(`sizes-${i}`, 4, YONMA)
      for (const player of state.players) {
        expect(tileCount(player.hand)).toBeGreaterThanOrEqual(13)
        expect(tileCount(player.hand)).toBeLessThanOrEqual(14)
      }
    }
  })

  it('scores every win it declares', () => {
    let wins = 0
    for (let i = 0; i < 40; i++) {
      const { state } = playRound(`wins-${i}`, 4, YONMA)
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
      const { events, state } = playRound(`nowin-${i}`, 4, { ...YONMA, wins: false })
      expect(events.some((e) => e.kind === 'win')).toBe(false)
      expect(state.ended).toBe('exhaustive')
    }
  })

  it('marks tsumogiri from the discarded slot, not tile value — a duplicate-kind hand cannot fool it', () => {
    // one 3s held, then a second 3s drawn: id+red alone can no longer tell tedashi from
    // tsumogiri, which is exactly the bug T1/T3 fix — `fromDrawn` is the only source of truth now
    const wall = wallWithHand(0, parseTenhou('12345678m1122p3s'), false, false, 'dup-kind-1')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('3s')[0]

    const tedashi = createRound(wall, 4, YONMA)
    beginTurn(tedashi, YONMA)
    finishTurn(tedashi, YONMA, { tile: { id: SOU + 2, red: false }, fromDrawn: false })
    expect(tedashi.players[0].river[0]?.tsumogiri).toBeUndefined()

    const tsumogiri = createRound(wall, 4, YONMA)
    beginTurn(tsumogiri, YONMA)
    finishTurn(tsumogiri, YONMA, { tile: { id: SOU + 2, red: false }, fromDrawn: true })
    expect(tsumogiri.players[0].river[0]?.tsumogiri).toBe(true)
  })

  it("an AI's mechanical discard reports tsumogiri from the tile it actually resolves through pickTile, not from an algorithm's kind-level guess", () => {
    // three called-equivalent 5s already held (a complete triplet, three melds fixing the rest of
    // the hand) plus a lone 9z: drawing a 4th 5s (the red one) is pure excess — efficiency cuts
    // that kind (tenpai, tanki on 9z either way) — but `pickTile` always keeps a held red five
    // over a duplicate plain one, so the tile that actually leaves is a *held* plain copy, not the
    // drawn aka. Tedashi, even though the algorithm never distinguished the two by kind alone.
    // riichi off: `isMenzen` reads the actual `melds` array, which this test never populates
    // (only `hand.melds`, chooseDiscard's own input) — an unrelated auto-riichi would otherwise
    // ride along on the same discard and clutter the assertion below
    const options: RoundOptions = { ...YONMA, riichi: false }
    const wall = wallWithHand(0, parseTenhou('123456789m555s9z'), false, true, 'aka-quad-1')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('0s')[0] // seat 0's draw: the red 5s
    const state = createRound(wall, 4, options)
    const player = state.players[0]
    // stand in for three called melds without actually calling them — chooseDiscard only reads
    // `hand.melds`/`hand.counts`, so stripping the filler tiles and bumping `melds` is equivalent
    for (const id of [0, 1, 2, 3, 4, 5, 6, 7, 8]) removeTile(player.hand, id)
    player.hand.melds = 3

    beginTurn(state, options)
    finishTurn(state, options)

    expect(player.river[0]).toEqual({ id: SOU + 4, red: false })
    expect(player.concealed.some((t) => t.id === SOU + 4 && t.red)).toBe(true) // the aka stayed in hand
  })

  it('forces tsumogiri after a riichi declaration', () => {
    for (let i = 0; i < 30; i++) {
      const { state } = playRound(`riichi-${i}`, 4, YONMA)
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
      const { state } = playRound(`riichi-mark-${i}`, 4, YONMA)
      for (const player of state.players) {
        const marked = player.river.filter((t) => t.riichi).length
        // a claimed declaration tile leaves the river with the meld and the mark moves to this
        // seat's next discard — so it is missing only while that discard is still owed, which is
        // where a hand ending on the call itself leaves it
        expect(marked).toBeLessThanOrEqual(player.riichiAt === undefined ? 0 : 1)
      }
    }
  })

  it('re-rotates the next discard when the declaration tile is called away', () => {
    // seat 0 declares on a 9s and seat 1, its shimocha, chis it as 789s — which pops the rotated
    // tile out of seat 0's river along with the meld. The mark says where the river stopped being
    // safe, so it has to land on whatever seat 0 throws next instead of vanishing with the tile.
    const wall = handsWall('riichi-called', '123456789m1122p', '111222333m99p78s')
    const first = 4 * INITIAL_HAND_SIZE
    const nine = wall.findIndex((t, i) => i > first && t.id === SOU + 8)
    ;[wall[first], wall[nine]] = [wall[nine], wall[first]]
    const options: RoundOptions = { ...YONMA, algorithms: manual(0, 1), claims: true }
    const state = createRound(wall, 4, options)

    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: true }, true)
    expect(state.players[0].river[0]?.riichi).toBe(true)

    answerClaim(state, options, { kind: 'chi', from: [SOU + 6, SOU + 7] })
    expect(state.players[1].melds).toHaveLength(1)
    expect(state.players[0].river).toHaveLength(0)

    // seat 0 is in riichi, so its next discard is forced — and takes the mark the call carried off
    const quiet: RoundOptions = { ...options, claims: false }
    while (!state.ended && state.players[0].river.length === 0) {
      beginTurn(state, quiet)
      finishTurn(state, quiet)
    }
    const river = state.players[0].river
    expect(river.filter((t) => t.riichi)).toHaveLength(1)
    expect(river[0].riichi).toBe(true)
    // the slot the call emptied is the slot the next discard fills, so `riichiAt` still points at it
    expect(state.players[0].riichiAt).toBe(0)
  })

  it('keeps re-rotating for as long as the mark keeps being called away', () => {
    // seat 0 is in riichi from its first discard, so every discard after it is its own draw —
    // pinned here to 1s/2s/3s/4s, with seat 1 holding a pair of each of the first three. Three
    // declarations in a row are ponned straight out of the river; the fourth is a lone 4s nobody
    // can take, and that is where the mark has to end up.
    const wall = handsWall('riichi-called-thrice', '123456789m1122p', '456789m1z112233s')
    const draws = ['1s', '2s', '3s', '4s'].map((code) => parseTenhou(code)[0])
    draws.forEach((tile, i) => {
      // seat 1 pons instead of drawing, so seat 0's draws are every third tile off the live wall
      const slot = 4 * INITIAL_HAND_SIZE + i * 3
      const source = wall.findIndex((t, j) => j > slot && t.id === tile.id)
      expect(source).toBeGreaterThan(slot)
      ;[wall[slot], wall[source]] = [wall[source], wall[slot]]
    })
    const options: RoundOptions = {
      ...YONMA,
      // seats 2 and 3 on tsumogiri: they never call and never win, so nothing between seat 0 and
      // seat 1 can take a tile out from under this test
      algorithms: ['manual', 'manual', 'tsumogiri', 'tsumogiri'],
      claims: true,
    }
    const state = createRound(wall, 4, options)

    /** Plays on to seat 0's next turn, passing on every claim raised in between. */
    function toSeatZero() {
      while (!state.ended && state.seat !== 0) {
        if (state.claim) {
          answerClaim(state, options, { kind: 'pass' })
          continue
        }
        beginTurn(state, options)
        const player = state.players[state.seat]
        const manualDiscard = { tile: player.concealed[0], fromDrawn: false }
        finishTurn(state, options, player.algorithm === 'manual' ? manualDiscard : undefined)
      }
    }

    beginTurn(state, options)
    finishTurn(state, options, { tile: draws[0], fromDrawn: true }, true)
    expect(state.players[0].riichiAt).toBe(0)
    expect(state.players[0].river[0]?.riichi).toBe(true)

    for (const tile of draws.slice(0, 3)) {
      expect(state.players[0].river.at(-1)).toMatchObject({ id: tile.id, riichi: true })
      expect(state.claim?.seat).toBe(1)
      answerClaim(state, options, { kind: 'pon', from: [tile.id, tile.id] })
      expect(state.players[0].river).toHaveLength(0)

      toSeatZero()
      beginTurn(state, options)
      // in riichi, so the pinned draw is the discard — no explicit tile needed
      finishTurn(state, options)
    }

    // nobody holds a second 4s, and seat 1's sou tiles all went into the three melds
    expect(state.claim).toBeUndefined()
    expect(state.players[1].melds).toHaveLength(3)
    const river = state.players[0].river
    expect(river).toHaveLength(1)
    expect(river[0]).toMatchObject({ id: draws[3].id, riichi: true })
    expect(state.players[0].riichiAt).toBe(0)
  })

  it('only ever declares riichi on a closed hand', () => {
    for (let i = 0; i < 30; i++) {
      const { state } = playRound(`closed-${i}`, 4, YONMA)
      for (const player of state.players) {
        if (player.riichiAt === undefined) continue
        expect(player.melds.every((m) => m.kind === 'ankan')).toBe(true)
      }
    }
  })

  it('stops early when asked', () => {
    const { events, ended } = playRound('stop-me', 4, YONMA, (e) => e.kind === 'discard')
    expect(ended).toBe('stopped')
    expect(events.at(-1)?.kind).toBe('discard')
  })
})

describe('createRound', () => {
  it('seeds exactly one red five per suit when aka is on, and none when it is off', () => {
    // a red copy is either still in a pile, or held — there is at most one red per kind, so the
    // two counts add up exactly
    const reds = (options: RoundOptions, players: number) => {
      const state = createRound([], players, options, 'aka-seed')
      const inPiles = [state.liveWall, state.deadWall, state.doraStack, state.uraStack]
        .flat()
        .filter((t) => t.red).length
      const held = state.players.reduce(
        (sum, p) => sum + p.concealed.filter((t) => t.red).length,
        0,
      )
      return inPiles + held
    }
    expect(reds(YONMA, 4)).toBe(3)
    expect(reds({ ...YONMA, aka: false }, 4)).toBe(0)
    // sanma has no 5m at all, so it can only seed two
    expect(reds(SANMA, 3)).toBe(2)
  })

  it('honours a wall pinning one seat, filling the rest of the wall itself', () => {
    const wall = wallWithHand(1, parseTenhou('12m'), false, true, 'pinned')
    const state = createRound(wall, 4, YONMA)
    expect(state.players[1].hand.counts[0]).toBeGreaterThan(0)
    expect(state.players[1].hand.counts[1]).toBeGreaterThan(0)
    const counts = census(state)
    for (let id = 0; id < NUM_TILE_TYPES; id++) expect(counts[id]).toBe(TILES_PER_KIND)
  })

  it('honours a short wall prefix as the deal itself, four tiles at a time', () => {
    // 1112m to seat 0, 3456m to seat 1, 7899m to seat 2, the last 9m to seat 3 — a prefix is the
    // start of a deal, not one seat's hand (that is what `wallWithHand` is for)
    const prefix = parseTenhou('1112345678999m')
    const state = createRound(prefix, 4, YONMA)
    for (let i = 0; i < prefix.length; i++) {
      expect(state.players[dealtSeat(i, 4)].concealed).toContainEqual(prefix[i])
    }
    expect(state.players[0].hand.counts[MAN]).toBe(3)
    const counts = census(state)
    for (let id = 0; id < NUM_TILE_TYPES; id++) expect(counts[id]).toBe(TILES_PER_KIND)
  })

  it('deals four at a time in seat order, then one apiece', () => {
    for (const [players, options] of [
      [4, YONMA],
      [3, SANMA],
    ] as const) {
      const wall = completeWall([], options.sanma, options.aka, `deal-order-${players}`)
      const state = createRound(wall, players, options)
      const expected = Array.from({ length: players }, () => new Uint8Array(NUM_TILE_TYPES))
      for (let i = 0; i < players * INITIAL_HAND_SIZE; i++) {
        expected[dealtSeat(i, players)][wall[i].id]++
      }
      for (let seat = 0; seat < players; seat++) {
        expect(state.players[seat].hand.counts).toEqual(expected[seat])
      }
    }
  })

  it('lets liveWallSnapshot plus wallDrawnCount reconstruct what is left', () => {
    // played out (not just dealt), so some seeds exercise kan replacement draws too
    for (let i = 0; i < 20; i++) {
      const { state } = playRound(`wall-snapshot-${i}`, 4, YONMA)
      const drawn = wallDrawnCount(state)
      const reconstructed = state.liveWallSnapshot.slice(drawn, drawn + state.liveWall.length)
      expect(reconstructed).toEqual(state.liveWall)
    }
  })
})

describe('findRound', () => {
  const acceptWin = (outcome: ReturnType<typeof playRound>) => outcome.state.win ?? null

  it('finds a scoreable win and reports the seed that produced it', () => {
    const found = findRound('search', 4, YONMA, acceptWin)
    expect(found).not.toBeNull()
    expect(found!.result.score.han).toBeGreaterThan(0)
    // the reported seed is what reproduces it
    expect(playRound(found!.seed, 4, YONMA).state.win?.seat).toBe(found!.result.seat)
  })

  it('is reproducible', () => {
    const a = findRound('search-again', 4, YONMA, acceptWin)
    const b = findRound('search-again', 4, YONMA, acceptWin)
    expect(a!.seed).toBe(b!.seed)
    expect(a!.result.ctx).toEqual(b!.result.ctx)
  })

  it('finds a win for many different seeds', () => {
    for (let i = 0; i < 10; i++) {
      expect(findRound(`find-${i}`, 4, YONMA, acceptWin), `seed find-${i}`).not.toBeNull()
    }
  })
})

/** Visibility the way `finishTurn` sees it: every face-up tile plus this seat's own hand. */
function seenBy(state: RoundState, seat: number): Uint8Array {
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
  const state = createRound([], 4, YONMA, seed)
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

    const pushing = createRound(wall, 4, YONMA)
    beginTurn(pushing, YONMA)
    expect(pushing.ended).toBe('win')
    expect(pushing.win?.seat).toBe(0)

    const folding = createRound(wall, 4, YONMA)
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

    const pulling = createRound(wall, 3, SANMA)
    beginTurn(pulling, SANMA)
    expect(pulling.players[0].nuki).toEqual([{ id: NORTH, red: false }])

    const folding = createRound(wall, 3, SANMA)
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
    playRound('claims-off', 4, { ...YONMA, algorithms: manual(0) }, (_event, state) => {
      sawClaim ||= state.claim !== undefined
      return false
    })
    expect(sawClaim).toBe(false)
  })

  it('offers a manual seat holding a pair a pon on the matching discard', () => {
    const options: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    // seat 0's hand only needs a spare 9s to discard; seat 1's is scattered everywhere else so it
    // is nowhere near tenpai and the only thing on offer is the pon
    const wall = handsWall('claim-pon-offer', '2468m2468p9s2345z', '13579m13579p99s1z')
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })

    expect(state.claim?.seat).toBe(1)
    expect(state.claim?.from).toBe(0)
    const pon = state.claim?.options.find((o) => o.kind === 'pon')
    expect(pon?.from).toEqual([SOU + 8, SOU + 8])
  })

  it('passing clears the claim, hands the turn on as usual, and leaves the declined win furiten', () => {
    const options: RoundOptions = { ...YONMA, claims: true, calls: false, algorithms: manual(1) }
    // seat 1 is tanki tenpai on 2s (all simples, so tanyao carries the yaku on a ron); seats 2
    // and 3 hold no sou at all, so they cannot react to a sou discard and cannot steal the win
    // out from under the seed's randomness
    const wall = handsWall(
      'claim-pass',
      '189m189p2s123456z',
      '234567m234567p2s',
      '111222333m111p7z',
      '444555666m222p7z',
    )
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 1, red: false }, fromDrawn: false })

    expect(state.claim?.seat).toBe(1)
    expect(state.claim?.options.some((o) => o.kind === 'ron')).toBe(true)

    answerClaim(state, options, { kind: 'pass' })

    expect(state.claim).toBeUndefined()
    expect(state.ended).toBeUndefined()
    expect(state.seat).toBe(1) // the turn moves on exactly as it would with nothing to ask about
    expect(state.players[1].missedWin).toBe(true) // declined a win that was really there

    // temporary furiten lasts until this seat has taken its own turn, and it is the *discard*
    // that ends it, not the draw that opens it: the badge stays up while the reader is deciding,
    // and no ron is possible in between either way — nobody else discards while seat 1 holds 14
    beginTurn(state, options)
    expect(state.players[1].missedWin, 'still furiten while it holds its draw').toBe(true)
    finishTurn(state, options, { tile: state.players[1].drawn!, fromDrawn: true })
    expect(state.players[1].missedWin, 'lifted by its own discard').toBe(false)
  })

  it('leaves a manual seat unfuriten when claims are off — it was never offered the ron', () => {
    // the same declined win as above, except `claims: false` means the engine never asks. A seat
    // that could not have declared cannot have declined, so marking it furiten would poison the
    // hand over a decision nobody was given (the rule `reconsiderClaim` follows too)
    const options: RoundOptions = { ...YONMA, claims: false, calls: false, algorithms: manual(1) }
    const wall = handsWall(
      'claim-never-asked',
      '189m189p2s123456z',
      '234567m234567p2s',
      '111222333m111p7z',
      '444555666m222p7z',
    )
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 1, red: false }, fromDrawn: false })

    expect(state.claim).toBeUndefined()
    expect(state.players[1].missedWin).toBe(false)
  })

  // Req 2.3's second half — furiten already cannot ron (`tryWin`, round.ts:404); these are
  // regression tests, not code changes.
  it("never offers a ron on a tile sitting in the seat's own river (permanent furiten)", () => {
    const options: RoundOptions = { ...YONMA, claims: true, calls: false, algorithms: manual(1) }
    // same tanki-2s tenpai as the pass test above, but seat 1 has already discarded a 2s itself
    const wall = handsWall(
      'furiten-own-river',
      '189m189p2s123456z',
      '234567m234567p2s',
      '111222333m111p7z',
      '444555666m222p7z',
    )
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    state.players[1].river.push({ id: SOU + 1, red: false })

    expect(
      claimOptions(state, options, 1, { id: SOU + 1, red: false }, 0).some((o) => o.kind === 'ron'),
    ).toBe(false)

    finishTurn(state, options, { tile: { id: SOU + 1, red: false }, fromDrawn: false })

    expect(state.claim).toBeUndefined()
    expect(state.win).toBeUndefined()
  })

  it('never offers a ron once the seat has missed a win on this tenpai (temporary furiten)', () => {
    const options: RoundOptions = { ...YONMA, claims: true, calls: false, algorithms: manual(1) }
    const wall = handsWall(
      'claim-pass',
      '189m189p2s123456z',
      '234567m234567p2s',
      '111222333m111p7z',
      '444555666m222p7z',
    )
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 1, red: false }, fromDrawn: false })
    answerClaim(state, options, { kind: 'pass' })
    expect(state.players[1].missedWin).toBe(true)

    expect(
      claimOptions(state, options, 1, { id: SOU + 1, red: false }, 0).some((o) => o.kind === 'ron'),
    ).toBe(false)
  })

  it('answering pon opens the meld and moves the tile from the river into it, keeping the log', () => {
    const options: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wall = handsWall('claim-pon-answer', '2468m2468p9s2345z', '13579m13579p99s1z')
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
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
    const options: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1, 2) }
    // seat order puts seat 1 (pon-eligible) first and seat 2 (ron-eligible, chiitoi tenpai so the
    // terminal wait still carries a yaku) second; seat 3 holds no sou and cannot react at all
    const wall = handsWall(
      'claim-priority',
      '2468m2468p9s2345z',
      '13579m13579p99s1z',
      '11335577m1133p9s',
      '224466m2244p667z',
    )
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })

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
    const options: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wall = handsWall('claim-noop', '2468m2468p9s2345z', '13579m13579p99s1z')
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
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
    const options: RoundOptions = { ...YONMA, algorithms: manual(0), claims: true }
    const state = createRound([], 4, options, 'claim-noop-answer')
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
    const state = createRound([], 4, { ...YONMA, algorithms: ['defense'] }, 'algorithm-seed')
    expect(state.players[0].algorithm).toBe('defense')
    expect(state.players.slice(1).every((p) => p.algorithm === 'efficiency')).toBe(true)
  })

  it('a seat seeded on defense from turn one never declares riichi and never calls', () => {
    for (let i = 0; i < 15; i++) {
      const { state } = playRound(`algorithm-defense-${i}`, 4, {
        ...YONMA,
        algorithms: ['defense'],
      })
      expect(state.players[0].riichiAt, `seed algorithm-defense-${i}`).toBeUndefined()
      expect(state.players[0].melds, `seed algorithm-defense-${i}`).toHaveLength(0)
    }
  })

  it('a seat seeded on tsumogiri never declares riichi, never calls, and discards straight off every draw', () => {
    for (let i = 0; i < 15; i++) {
      const { state } = playRound(`algorithm-tsumogiri-${i}`, 4, {
        ...YONMA,
        algorithms: ['tsumogiri'],
      })
      expect(state.players[0].riichiAt, `seed algorithm-tsumogiri-${i}`).toBeUndefined()
      expect(state.players[0].melds, `seed algorithm-tsumogiri-${i}`).toHaveLength(0)
      for (const tile of state.players[0].river) {
        expect(tile.tsumogiri, `seed algorithm-tsumogiri-${i}`).toBe(true)
      }
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
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    return { state, options }
  }

  it('never auto-declares riichi for a manual seat, even reaching tenpai, unless the caller says so', () => {
    const { state, options } = tenpaiManualState('manual-riichi-1')
    // declareRiichi omitted — this is the same call playRound makes every turn
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: true })
    expect(state.players[0].riichiAt).toBeUndefined()
  })

  it('declares riichi for a manual seat once the caller passes declareRiichi and it is legal', () => {
    const { state, options } = tenpaiManualState('manual-riichi-2')
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: true }, true)
    expect(state.players[0].riichiAt).toBe(0)
    expect(state.players[0].river[0]?.riichi).toBe(true)
    // canDeclareRiichi is the same legality check finishTurn just used — pinning it here is what
    // makes the UI's riichi button trustworthy: it never offers a declaration finishTurn refuses
    expect(canDeclareRiichi(state, options, 0)).toBe(false) // riichiAt is now set, so it's done
  })

  it('throws the drawn tile once in riichi, even handed an explicit tedashi', () => {
    // riichi locks every later discard to tsumogiri. The lock used to sit behind the "no explicit
    // discard" branch, so it only ever reached the seats nobody was deciding for — a manual seat
    // in riichi could hand in any tile it liked and the engine threw it
    const { state, options } = tenpaiManualState('riichi-locks-tedashi')
    const player = state.players[0]
    player.riichiAt = 0
    const drawn = player.drawn!
    const held = player.concealed.find((t) => t.id !== drawn.id)!

    finishTurn(state, options, { tile: held, fromDrawn: false })

    const thrown = player.river.at(-1)!
    expect(thrown.id).toBe(drawn.id)
    expect(thrown.tsumogiri).toBe(true)
    expect(player.concealed.some((t) => t.id === held.id && t.red === held.red)).toBe(true)
  })

  it('deducts 1000 points and adds a riichi stick on declaration (T4)', () => {
    const { state, options } = tenpaiManualState('manual-riichi-3')
    const before = state.match.points[0]
    const sticksBefore = state.match.riichiSticks
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: true }, true)
    expect(state.match.points[0]).toBe(before - 1000)
    expect(state.match.riichiSticks).toBe(sticksBefore + 1)
  })
})

describe('beginTurn declineTsumo', () => {
  it('a manual seat auto-accepts a legal tsumo by default, unchanged from before this option existed', () => {
    const wall = wallWithHand(0, parseTenhou('123456789m1122p'), false, false, 'decline-default')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1p')[0]
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const state = createRound(wall, 4, options)

    beginTurn(state, options)

    expect(state.ended).toBe('win')
    expect(state.win?.seat).toBe(0)
  })

  it('declineTsumo: true keeps the same legal tsumo from ending the hand, and the turn continues', () => {
    const wall = wallWithHand(0, parseTenhou('123456789m1122p'), false, false, 'decline-true')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1p')[0]
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const state = createRound(wall, 4, options)

    beginTurn(state, options, true)

    expect(state.ended).toBeUndefined()
    expect(state.win).toBeUndefined()
    expect(tileCount(state.players[0].hand)).toBe(14) // drawn tile still sitting in hand, ungraded
    expect(state.log).toHaveLength(0) // nothing to log — the decline itself is never logged (ADR-0021)
  })
})

describe('RoundState.log', () => {
  it('records one entry per discard/call/win, matching the returned event stream in order', () => {
    for (let i = 0; i < 10; i++) {
      const { state, events } = playRound(`log-${i}`, 4, YONMA)
      const expected = events.filter(
        (e) => e.kind === 'discard' || e.kind === 'call' || e.kind === 'win',
      )
      expect(state.log, `seed log-${i}`).toHaveLength(expected.length)
      expected.forEach((e, idx) => {
        const entry = state.log[idx]
        expect(entry.kind, `seed log-${i} entry ${idx}`).toBe(e.kind)
        expect(entry.seat, `seed log-${i} entry ${idx}`).toBe(
          e.kind === 'win' ? e.win.seat : e.seat,
        )
      })
    }
  })

  it("logs an AI seat's sanma kita pull without adding a distinct RoundEvent (T0 hazard)", () => {
    // beginTurn's own kita loop must keep returning `draw` events only — state.log is a second,
    // additive output, never something the golden-hash test's `serialize` can see move
    for (let i = 0; i < 40; i++) {
      const { state, events } = playRound(`log-sanma-${i}`, 3, SANMA)
      if (state.log.some((e) => e.kind === 'kita')) {
        expect(events.some((e) => e.kind === 'kita')).toBe(false)
        return
      }
    }
    throw new Error('no seed in range pulled kita under sanma — widen the search')
  })

  it('callKita logs the pull and draws a replacement for a manual seat', () => {
    const options: RoundOptions = { ...SANMA, algorithms: manual(0) }
    const wall = wallWithHand(0, parseTenhou('123456789m112p4z'), true, false, 'kita-manual')
    const state = createRound(wall, 3, options)
    beginTurn(state, options)
    const before = state.log.length

    const events = callKita(state, options, 0)

    expect(events.map((e) => e.kind)).toContain('kita')
    expect(state.log.slice(before)).toEqual([{ kind: 'kita', seat: 0 }])
    expect(state.players[0].nuki).toEqual([{ id: NORTH, red: false }])
    expect(state.players[0].hand.counts[NORTH]).toBe(0)
  })

  it('callAnkan logs the kan, flips a kan-dora, and draws a replacement', () => {
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const wall = wallWithHand(0, parseTenhou('111456789m1122p'), false, false, 'ankan-manual')
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1m')[0] // the fourth 1m, drawn next as seat 0's turn
    const state = createRound(wall, 4, options)
    const indicatorsBefore = state.doraIndicators.length
    beginTurn(state, options)
    const before = state.log.length

    const events = callAnkan(state, MAN, 0)

    expect(events.map((e) => e.kind)).toContain('ankan')
    expect(state.log.slice(before)).toEqual([{ kind: 'ankan', seat: 0, tile: MAN }])
    expect(state.players[0].hand.counts[MAN]).toBe(0)
    expect(state.players[0].melds).toEqual([
      { kind: 'ankan', tiles: expect.arrayContaining([{ id: MAN, red: false }]) },
    ])
    expect(state.doraIndicators.length).toBe(indicatorsBefore + 1)
  })

  it('is a no-op off-turn or once the hand has ended', () => {
    const options: RoundOptions = { ...SANMA, algorithms: manual(0) }
    const wall = wallWithHand(0, parseTenhou('123456789m112p4z'), true, false, 'kita-off-turn')
    const state = createRound(wall, 3, options)
    beginTurn(state, options)

    expect(callKita(state, options, 1)).toEqual([]) // seat 1 is not the acting seat
    expect(callAnkan(state, 1, MAN)).toEqual([])
    expect(state.log).toHaveLength(0)
  })
})
