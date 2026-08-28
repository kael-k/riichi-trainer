import { describe, expect, it } from 'vitest'
import { assessDiscards } from './danger'
import { removeTile, tileCount } from './hand'
import { createMatch } from './match'
import {
  answerClaim,
  beginTurn,
  callAnkan,
  callKakan,
  callKita,
  canDeclareKyuushu,
  canDeclareRiichi,
  claimOptions,
  createRound,
  findRound,
  finishTurn,
  NORTH,
  playRound,
  reconsiderClaim,
  replayLog,
  stepRound,
  threatViews,
  wallDrawnCount,
  type PendingDiscardClaim,
  type RoundEvent,
  type RoundOptions,
  type RoundState,
} from './round'
import type { SeatAlgorithm } from './policy'
import { scoreHand } from './score'
import { shanten } from './shanten'
import { inTileSet, MAN, NUM_TILE_TYPES, parseTenhou, SOU, type ParsedTile } from './tiles'
import {
  completeWall,
  dealtSeat,
  DEAD_WALL_SIZE,
  INITIAL_HAND_SIZE,
  TILES_PER_KIND,
  wallWithHand,
  wallWithHands,
} from './wall'

/** The pending claim as a reaction to a discard, which is what every claim in this file is —
 *  `PendingClaim` is a union since kyuushu kyuuhai suspends the turn through the same field. */
function discardClaim(state: RoundState): PendingDiscardClaim {
  const claim = state.claim
  if (claim?.kind !== 'discard') throw new Error('no discard claim pending')
  return claim
}

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

  it('forwards beforeReactions, firing once a turn with the discard already on the river', () => {
    const state = createRound([], 4, YONMA, 'step-before-reactions')
    // what the seam is worth to a driver: the length of the discarding seat's own river at the
    // moment it fires. One fire per turn, and the tile is already on it
    const fires: number[] = []
    let discards = 0
    for (const event of stepRound(state, YONMA, undefined, (s) =>
      fires.push(s.players[s.seat].river.length),
    )) {
      if (event.kind === 'discard') discards++
      if (discards === 6) break
    }
    expect(discards).toBe(6)
    expect(fires).toHaveLength(6)
    expect(fires.every((length) => length > 0)).toBe(true)
  })
})

describe('finishTurn beforeReactions', () => {
  it('fires with the claimed tile still on the river and the claiming seat unmelded', () => {
    // the frame a paced board commits: `finishTurn` resolves the whole turn before it yields
    // anything, so without this seam a ponned tile is only ever on screen inside the meld it
    // ends up in. Same pinned board the pon tests above use
    const options: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wall = handsWall('before-reactions-pon', '2468m2468p9s2345z', '13579m13579p99s1z')
    const state = createRound(wall, 4, options)
    beginTurn(state, options)

    const frames: { river: number; melds: number }[] = []
    finishTurn(
      state,
      options,
      { tile: { id: SOU + 8, red: false }, fromDrawn: false },
      false,
      (s) => frames.push({ river: s.players[0].river.length, melds: s.players[1].melds.length }),
    )
    expect(frames).toEqual([{ river: 1, melds: 0 }])

    const pon = discardClaim(state).options.find((o) => o.kind === 'pon')
    answerClaim(state, options, { kind: 'pon', from: pon!.from })
    // and the reason the frame had to be taken when it was: by now the tile has left the river
    expect(state.players[0].river).toHaveLength(0)
    expect(state.players[1].melds).toHaveLength(1)
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

  it('cuts the dead wall the way a table does — five dora stacks, then the rinshan tiles', () => {
    const state = createRound([], 4, YONMA, 'dead-wall-stacks')
    const dead = state.deadWallSnapshot
    expect(dead.length).toBe(DEAD_WALL_SIZE)
    // the four tiles nearest the break are the rinshan, and `drawReplacement` pops from that end
    expect(state.deadWall).toEqual(dead.slice(10))
    // the five stacks before them are indicator-over-ura pairs, flipped from the rinshan end back
    // toward the live wall: the deal's own indicator is dead[8], the last kan dora would be dead[0]
    const indicators = [...state.doraIndicators, ...state.doraStack]
    expect(indicators.length).toBe(5)
    for (let n = 0; n < indicators.length; n++) {
      const stack = 4 - n
      expect(indicators[n]).toBe(dead[stack * 2])
      expect(state.uraStack[n]).toBe(dead[stack * 2 + 1])
    }
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
    // comparison a plain discard would make — is unambiguous, not just a tie.
    // The pull happens in `finishTurn` now, not `beginTurn`: a seat's own kita competes with its
    // discard and its kans, so all three are asked at the one moment (ADR-0043).
    const hand = parseTenhou('123456789p1122s')
    const wall = wallWithHand(0, hand, true, false, 'kita-t3-seed')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('4z')[0] // seat 0's draw: North

    const pulling = createRound(wall, 3, SANMA)
    beginTurn(pulling, SANMA)
    expect(pulling.players[0].nuki).toHaveLength(0)
    finishTurn(pulling, SANMA)
    expect(pulling.players[0].nuki).toEqual([{ id: NORTH, red: false }])

    const folding = createRound(wall, 3, SANMA)
    folding.players[0].algorithm = 'defense'
    beginTurn(folding, SANMA)
    finishTurn(folding, SANMA)
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
    expect(state.claim?.kind === 'discard' && state.claim.from).toBe(0)
    const pon = discardClaim(state).options.find((o) => o.kind === 'pon')
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
    expect(discardClaim(state).options.some((o) => o.kind === 'ron')).toBe(true)

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
    const pon = discardClaim(state).options.find((o) => o.kind === 'pon')
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

  it("reports an AI seat's sanma kita pull as the same event a manual seat's raises", () => {
    // it used to raise none at all: the pull was `beginTurn`'s own inline mutation and only its
    // replacement `draw` reached the stream, so nothing watching a board could tell a nukidora
    // from an ordinary draw. Routing every pull through `callKita` (ADR-0043) is what fixed it,
    // and it is the whole of why the sanma golden hashes moved.
    for (let i = 0; i < 40; i++) {
      const { state, events } = playRound(`log-sanma-${i}`, 3, SANMA)
      const logged = state.log.filter((e) => e.kind === 'kita')
      if (logged.length > 0) {
        expect(events.filter((e) => e.kind === 'kita')).toHaveLength(logged.length)
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

/** Daiminkan (kan on a discard) and kakan (an added kan on an open pon) — match-only
 *  (`RoundOptions.calledKan`), ADR-0010's amendment. Seat 1 in every case here holds a triplet
 *  of 9s, which is both pon- and minkan-eligible on the same discard — leaving one 9s behind
 *  after a pon is exactly what a kakan test needs, so the same two hands serve both. */
describe('called kan', () => {
  const CALLER_HAND = '999s24689m2468p1z' // pon/minkan-eligible triplet plus filler, 13 tiles

  it('offers a minkan claim only when calledKan is on', () => {
    const off: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wallOff = handsWall('minkan-offer-off', '2468m2468p9s2345z', CALLER_HAND)
    const stateOff = createRound(wallOff, 4, off)
    beginTurn(stateOff, off)
    finishTurn(stateOff, off, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    expect(discardClaim(stateOff).options.some((o) => o.kind === 'minkan')).toBe(false)

    const on: RoundOptions = { ...off, calledKan: true }
    const wallOn = handsWall('minkan-offer-on', '2468m2468p9s2345z', CALLER_HAND)
    const stateOn = createRound(wallOn, 4, on)
    beginTurn(stateOn, on)
    finishTurn(stateOn, on, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    const minkan = discardClaim(stateOn).options.find((o) => o.kind === 'minkan')
    expect(minkan?.from).toEqual([SOU + 8, SOU + 8, SOU + 8])
  })

  it('answering minkan melds all four tiles, flips a kan-dora, and draws a replacement, leaving the turn with the caller', () => {
    const options: RoundOptions = { ...YONMA, claims: true, calledKan: true, algorithms: manual(1) }
    const wall = handsWall('minkan-answer', '2468m2468p9s2345z', CALLER_HAND)
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    const minkan = discardClaim(state).options.find((o) => o.kind === 'minkan')
    expect(minkan).toBeDefined()
    const indicatorsBefore = state.doraIndicators.length

    const events = answerClaim(state, options, { kind: 'minkan', from: minkan!.from })

    expect(events.map((e) => e.kind)).toEqual(['call', 'draw'])
    expect(state.claim).toBeUndefined()
    const meld = state.players[1].melds.at(-1)
    expect(meld?.kind).toBe('minkan')
    expect(meld?.tiles).toHaveLength(4)
    expect(state.players[1].hand.melds).toBe(1)
    expect(state.players[1].hand.counts[SOU + 8]).toBe(0)
    // the claimed tile leaves the discarder's river into the meld, same as a pon
    expect(state.players[0].river).toHaveLength(0)
    expect(state.doraIndicators.length).toBe(indicatorsBefore + 1)
    expect(state.seat).toBe(1)
    expect(state.pendingDraw).toBe(false)
  })

  it('an AI seat never calls minkan even with calledKan on — the bot never sees the option', () => {
    const options: RoundOptions = { ...YONMA, calledKan: true } // every seat AI
    const wall = handsWall('minkan-ai-declines', '2468m2468p9s2345z', CALLER_HAND)
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })

    expect(state.players[1].melds.some((m) => m.kind === 'minkan')).toBe(false)
  })

  it('callKakan upgrades an existing pon into a kan, flips a kan-dora, and draws a replacement', () => {
    const options: RoundOptions = { ...YONMA, claims: true, calledKan: true, algorithms: manual(1) }
    const wall = handsWall('kakan-manual', '2468m2468p9s2345z', CALLER_HAND)
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    const pon = discardClaim(state).options.find((o) => o.kind === 'pon')
    expect(pon).toBeDefined()
    answerClaim(state, options, { kind: 'pon', from: pon!.from })
    // pon only spent two of the three held 9s — the kakan-eligible copy is what's left
    expect(state.players[1].hand.counts[SOU + 8]).toBe(1)

    const indicatorsBefore = state.doraIndicators.length
    const before = state.log.length
    const events = callKakan(state, options, 1, SOU + 8)

    expect(events.map((e) => e.kind)).toContain('kakan')
    expect(state.log.slice(before)).toEqual([{ kind: 'kakan', seat: 1, tile: SOU + 8 }])
    const meld = state.players[1].melds.at(-1)
    expect(meld?.kind).toBe('minkan')
    expect(meld?.tiles).toHaveLength(4)
    expect(state.players[1].hand.melds).toBe(1) // upgraded in place, not a second block
    expect(state.players[1].hand.counts[SOU + 8]).toBe(0)
    expect(state.doraIndicators.length).toBe(indicatorsBefore + 1)
  })

  it('callKakan is a no-op with calledKan off, off-turn, or with no matching pon', () => {
    const off: RoundOptions = { ...YONMA, claims: true, algorithms: manual(1) }
    const wall = handsWall('kakan-off', '2468m2468p9s2345z', CALLER_HAND)
    const state = createRound(wall, 4, off)
    beginTurn(state, off)
    finishTurn(state, off, { tile: { id: SOU + 8, red: false }, fromDrawn: false })
    const pon = discardClaim(state).options.find((o) => o.kind === 'pon')
    answerClaim(state, off, { kind: 'pon', from: pon!.from })

    expect(callKakan(state, off, 1, SOU + 8)).toEqual([]) // calledKan is off
    const on: RoundOptions = { ...off, calledKan: true }
    expect(callKakan(state, on, 0, SOU + 8)).toEqual([]) // not seat 0's pon
    expect(callKakan(state, on, 1, MAN)).toEqual([]) // no pon of 1m to upgrade
  })
})

describe('the turn seam', () => {
  /** Seat 0 is dealt three 1m and draws the fourth, so a closed kan is on the table from its very
   *  first turn — and the hand is tenpai (shanpon on 1p/2p) either way, which is what lets the EV
   *  model price a win at all: above 2-shanten the collapsed chain prices none, and the kan rule's
   *  sum comes out at exactly zero. */
  const QUAD_HAND = '111m456789m1122p'
  const EV: RoundOptions = {
    ...YONMA,
    algorithms: ['ev'],
    ev: [{ model: 'statistical', objective: 'points' }],
  }
  function quadWall(seed: string): ParsedTile[] {
    const wall = wallWithHand(0, parseTenhou(QUAD_HAND), false, false, seed)
    wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1m')[0]
    return wall
  }

  it('an ev seat declares a closed kan that efficiency leaves alone', () => {
    const wall = quadWall('turn-seam-kan')

    const priced = createRound(wall, 4, EV)
    beginTurn(priced, EV)
    finishTurn(priced, EV)
    expect(priced.players[0].melds.map((m) => m.kind)).toEqual(['ankan'])
    expect(priced.log.some((e) => e.kind === 'ankan')).toBe(true)

    // ukeire ranks the discards of whatever hand it is handed and has no opinion on changing its
    // shape — the same reasoning `efficiency.abort` gives
    const plain = createRound(wall, 4, YONMA)
    beginTurn(plain, YONMA)
    finishTurn(plain, YONMA)
    expect(plain.players[0].melds).toHaveLength(0)
  })

  it('never auto-kans a manual seat, the way it never auto-pulls its north', () => {
    // the same seat, carrying the same EV pricing, but on `'manual'`: an algorithm is never
    // consulted for it at all (ADR-0007/ADR-0011), so the kan the row above takes is left for the
    // reader's own `callAnkan`
    const options: RoundOptions = { ...EV, algorithms: manual(0) }
    const state = createRound(quadWall('turn-seam-manual'), 4, options)
    beginTurn(state, options)
    finishTurn(state, options)

    expect(state.players[0].melds).toHaveLength(0)
    expect(state.log.some((e) => e.kind === 'ankan')).toBe(false)
  })

  it('declares no kan in riichi, where no wait-preserving rule is modelled', () => {
    const state = createRound(quadWall('turn-seam-riichi'), 4, EV)
    beginTurn(state, EV)
    state.players[0].riichiAt = 0 // declared on a previous turn; the hand is locked

    finishTurn(state, EV)

    expect(state.players[0].melds).toHaveLength(0)
    expect(state.players[0].river[0].tsumogiri).toBe(true)
  })

  it('still pulls a north in riichi, which nukidora has always allowed', () => {
    // the half the seam must not lose: a pull replaces the tile a declared seat is locked to and
    // leaves its wait exactly where it was, so it is legal where a kan is not
    const wall = wallWithHand(0, parseTenhou('123456789p1122s'), true, false, 'kita-t3-seed')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('4z')[0]
    const state = createRound(wall, 3, SANMA)
    beginTurn(state, SANMA)
    state.players[0].riichiAt = 0

    finishTurn(state, SANMA)

    expect(state.players[0].nuki).toEqual([{ id: NORTH, red: false }])
    expect(state.players[0].river[0].tsumogiri).toBe(true)
  })

  it('takes the kan on a quiet board and declines the same one into a riichi', () => {
    // the two ends of the sign rule on one hand. A kan multiplies every hand at the table by the
    // same expected han — yours and every threat's alike — so it is worth taking exactly when the
    // scaled terms already sum in your favour. This hand is middling enough for one declared seat
    // to turn that sum negative, where the tenpai hand above stays worth kanning against three.
    const MIDDLING = '111m456m78p1234s'
    const kanned = (threats: number): boolean => {
      const wall = wallWithHand(0, parseTenhou(MIDDLING), false, false, 'turn-seam-kan')
      wall[4 * INITIAL_HAND_SIZE] = parseTenhou('1m')[0]
      const state = createRound(wall, 4, EV)
      beginTurn(state, EV)
      for (let seat = 1; seat <= threats; seat++) {
        state.players[seat].riichiAt = 0
        state.players[seat].riichiTurn = 1
      }
      finishTurn(state, EV)
      return state.players[0].melds.length > 0
    }

    expect(kanned(0)).toBe(true)
    expect(kanned(1)).toBe(false)
  })

  /** Sanma, one `'ev'` seat on the derived model — the configuration the nukidora questions below
   *  are asked in. */
  const EV_SANMA: RoundOptions = {
    ...SANMA,
    algorithms: ['ev'],
    ev: [{ model: 'statistical', objective: 'points' }],
  }

  it('does not pull a north that is holding up a suushiihou', () => {
    // 111z 222z 333z 444z + a haku tanki: four concealed wind triplets, tenpai for daisuushii.
    // Three of those winds are north, and nukidora would spend one — so the *ukeire* rule is what
    // protects the yakuman, not a yaku-aware carve-out: discarding a north drops the hand off
    // tenpai, so north's own `evaluateDiscards` entry cannot tie the best discard.
    const wall = wallWithHand(0, parseTenhou('111z222z333z444z5z'), true, false, 'suushiihou-nuki')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('6z')[0] // a hatsu: junk, and never the tanki tile
    const state = createRound(wall, 3, EV_SANMA)

    beginTurn(state, EV_SANMA)
    finishTurn(state, EV_SANMA)

    expect(state.players[0].nuki).toHaveLength(0)
    expect(state.log.some((e) => e.kind === 'kita')).toBe(false)
    expect(state.players[0].hand.counts[NORTH]).toBe(3)
  })

  it('pulls a north the hand is not using, off an ordinary tenpai', () => {
    // the other side of the same rule: `123456789p 1122s` is tenpai on a 1s/2s shanpon with all
    // thirteen tiles committed, so the north that arrives on the draw is spare by construction —
    // its `evaluateDiscards` entry ties the best discard on offer, and the pull is free dora
    const wall = wallWithHand(0, parseTenhou('123456789p1122s'), true, false, 'ordinary-nuki')
    wall[3 * INITIAL_HAND_SIZE] = parseTenhou('4z')[0]
    const state = createRound(wall, 3, EV_SANMA)

    beginTurn(state, EV_SANMA)
    finishTurn(state, EV_SANMA)

    expect(state.players[0].nuki).toEqual([{ id: NORTH, red: false }])
    expect(state.log.some((e) => e.kind === 'kita')).toBe(true)
  })

  it('takes a rinshan tsumo off an AI kan, which callAnkan never checks for itself', () => {
    // `callAnkan`/`callKakan`/`callKita` draw a replacement and never price it — the win check is
    // the turn loop's, and without it a hand completed by a kan's replacement vanishes silently
    const wall = quadWall('turn-seam-rinshan')
    wall[wall.length - 1] = parseTenhou('1p')[0] // the first rinshan tile drawReplacement pops
    const state = createRound(wall, 4, EV)
    beginTurn(state, EV)
    finishTurn(state, EV)

    expect(state.ended).toBe('win')
    expect(state.win?.seat).toBe(0)
    expect(state.win?.from).toBeUndefined() // a tsumo
    expect(state.players[0].melds.map((m) => m.kind)).toEqual(['ankan'])
  })
})

/**
 * Daiminkan is offered to a person and to nobody else, and these pin both halves of that: the case
 * where declining is obviously right, and the case where it is obviously wrong. **Both come out the
 * same**, because `chooseCall` never receives `RoundOptions.calledKan` and so never sees a minkan
 * at all (ADR-0041), and threading the flag through would not help — `shantenAfterCall` removes
 * three tiles and adds a meld, so a hand holding a concealed triplet lands on the *same* shanten
 * (the triplet was already a complete block) and the `after >= current` guard rejects it, always.
 * A daiminkan needs a price of its own, on the call gate, which is `ADR-0043`'s stated rejection.
 */
describe("daiminkan is never an AI seat's call", () => {
  /** The AI seats that call at all. `defense` and `tsumogiri` return `null` from `call`
   *  unconditionally, so they would pass these by not being asked a question. */
  const AI_MODES = [
    ['efficiency', undefined],
    ['ev, statistical', 'statistical'],
    ['ev, houou', 'houou'],
  ] as const

  function aiOptions(model: 'statistical' | 'houou' | undefined): RoundOptions {
    return {
      ...YONMA,
      calledKan: true,
      algorithms: ['efficiency', model ? 'ev' : 'efficiency'],
      ev: model ? [undefined, { model, objective: 'points' }] : undefined,
    }
  }

  // --- declining is right: the kan would break a suuankou ---------------------------------------

  /** Four concealed triplets and a 5s tanki. A daiminkan on the fourth 1m opens that triplet, and
   *  suuankou wants all four concealed — the yakuman dies for one extra dora indicator. */
  const SUUANKOU = '111m222m333m444p5s'
  /** Seat 0: holds the last 1m and throws it. */
  const THROWS_THE_LAST_1M = '1m456m789m123s456s'

  it.each(AI_MODES)('%s declines the kan that would break its suuankou', (_label, model) => {
    const options = aiOptions(model)
    const state = createRound(handsWall('suuankou-kan', THROWS_THE_LAST_1M, SUUANKOU), 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: parseTenhou('1m')[0], fromDrawn: false })

    expect(state.players[1].melds).toHaveLength(0)
    expect(state.players[1].hand.counts[MAN]).toBe(3) // all three still concealed
  })

  it('and the kan was genuinely on offer — a manual seat in the same seat is shown it', () => {
    // without this the row above would pass on a board where no kan was ever available
    const options: RoundOptions = { ...YONMA, calledKan: true, claims: true, algorithms: manual(1) }
    const state = createRound(handsWall('suuankou-kan', THROWS_THE_LAST_1M, SUUANKOU), 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: parseTenhou('1m')[0], fromDrawn: false })

    expect(discardClaim(state).options.map((o) => o.kind)).toContain('minkan')
  })

  // --- declining is wrong: the kan is free ------------------------------------------------------

  /** Seat 1 pons the haku, throws its spare west, and is left **open, tenpai and already yaku-ful**
   *  on a 5s/8s ryanmen with `111m` sitting concealed beside it, doing nothing but being a set.
   *  Kanning the fourth 1m leaves the wait exactly where it is, flips a dora indicator and draws a
   *  replacement: free by every reading, and declined anyway. */
  const PONS_THEN_TENPAI = '55z111m234p99s67s3z'
  const THROWS_THE_HAKU = '5z456m789m123s456s'
  const THROWS_THE_LAST_1M_TOO = '1m234m567m888p123p'

  /** Plays seat 1 into that open tenpai with the seat still manual, and stops with seat 2 about to
   *  act. The caller decides what seat 1 becomes before the fourth 1m is thrown — algorithms are
   *  live, so flipping it here is the ordinary way to ask an AI a question a person set up. */
  function openTenpai(): { state: RoundState; options: RoundOptions } {
    const options: RoundOptions = { ...YONMA, calledKan: true, claims: true, algorithms: manual(1) }
    const wall = wallWithHands(
      [THROWS_THE_HAKU, PONS_THEN_TENPAI, THROWS_THE_LAST_1M_TOO].map(parseTenhou),
      false,
      true,
      'daiminkan-free',
    )
    const state = createRound(wall, 4, options)
    beginTurn(state, options)
    finishTurn(state, options, { tile: parseTenhou('5z')[0], fromDrawn: false })
    const pon = discardClaim(state).options.find((o) => o.kind === 'pon')!
    answerClaim(state, options, { kind: 'pon', from: pon.from })
    finishTurn(state, options, { tile: parseTenhou('3z')[0], fromDrawn: false })
    return { state, options }
  }

  it('sets the free-kan board up: seat 1 open, tenpai, holding a concealed 111m', () => {
    const { state } = openTenpai()

    expect(state.players[1].melds.map((m) => m.kind)).toEqual(['pon'])
    expect(state.players[1].hand.counts[MAN]).toBe(3)
    expect(shanten(state.players[1].hand)).toBe(0)
    expect(state.seat).toBe(2) // nobody called the west; seat 2 is about to throw the fourth 1m
  })

  it.each(AI_MODES)('%s declines the free kan too, which is the known gap', (_label, model) => {
    const { state, options } = openTenpai()
    state.players[1].algorithm = model ? 'ev' : 'efficiency'
    if (model) state.players[1].ev = { model, objective: 'points' }

    beginTurn(state, options)
    finishTurn(state, options, { tile: parseTenhou('1m')[0], fromDrawn: false })

    expect(state.players[1].melds.map((m) => m.kind)).toEqual(['pon'])
    expect(state.players[1].hand.counts[MAN]).toBe(3)
  })

  it('and that kan was on offer as well — the same board, seat 1 left manual', () => {
    const { state, options } = openTenpai()

    beginTurn(state, options)
    finishTurn(state, options, { tile: parseTenhou('1m')[0], fromDrawn: false })

    expect(discardClaim(state).options.map((o) => o.kind)).toContain('minkan')
  })
})

describe('kyuushu kyuuhai', () => {
  /** Nine distinct terminals and honours (1m 9m 1p 9p 1s 9s 1z 2z 3z), three shanten by every
   *  path — legal to abort, nowhere near a win, so the fourteenth tile can never end the hand
   *  first and change what is being tested. */
  const KYUUSHU = '1119m199p199s123z'

  function kyuushuRound(seed: string, options: RoundOptions): RoundState {
    return createRound(handsWall(seed, KYUUSHU), 4, options)
  }

  it('lets an EV seat abort the hand, and logs it', () => {
    const options: RoundOptions = { ...YONMA, algorithms: ['ev'] }
    const state = kyuushuRound('kyuushu-ev', options)
    const events = beginTurn(state, options)

    expect(events.at(-1)).toEqual({ kind: 'abort', seat: 0, reason: 'kyuushu' })
    expect(state.ended).toBe('abort')
    expect(state.log.at(-1)).toEqual({ kind: 'abort', seat: 0 })
  })

  it('is declined by every hand-written algorithm, which is why the golden hashes hold', () => {
    for (const algorithm of ['efficiency', 'defense', 'tsumogiri'] as const) {
      const options: RoundOptions = { ...YONMA, algorithms: [algorithm] }
      const state = kyuushuRound('kyuushu-ai', options)
      const events = beginTurn(state, options)

      expect(events.some((e) => e.kind === 'abort')).toBe(false)
      expect(state.ended).toBeUndefined()
    }
  })

  it('asks a manual seat instead of deciding, and suspends the turn while it waits', () => {
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const state = kyuushuRound('kyuushu-manual', options)
    beginTurn(state, options)

    expect(state.claim).toEqual({ kind: 'abort', seat: 0, kinds: 9 })
    // the same suspension a claim on a discard gets: nothing draws and nothing discards
    expect(beginTurn(state, options)).toEqual([])
    expect(finishTurn(state, options)).toEqual([])
    expect(tileCount(state.players[0].hand)).toBe(14)

    const events = answerClaim(state, options, { kind: 'abort' })
    expect(events).toEqual([{ kind: 'abort', seat: 0, reason: 'kyuushu' }])
    expect(state.ended).toBe('abort')
  })

  it('hands the turn straight back when declined, and never offers it again', () => {
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const state = kyuushuRound('kyuushu-decline', options)
    beginTurn(state, options)

    expect(answerClaim(state, options, { kind: 'pass' })).toEqual([])
    expect(state.claim).toBeUndefined()
    expect(state.ended).toBeUndefined()
    // still mid-turn with its fourteenth tile, exactly where `beginTurn` suspended it
    expect(tileCount(state.players[0].hand)).toBe(14)
    expect(canDeclareKyuushu(state, options, 0)).toBe(true)

    // and once the seat has discarded, its own first draw is behind it for good
    finishTurn(state, options, { tile: state.players[0].concealed[0], fromDrawn: false })
    expect(canDeclareKyuushu(state, options, 0)).toBe(false)
  })

  it('is not offered at all with abortive draws turned off', () => {
    const options: RoundOptions = { ...YONMA, abortiveDraws: false, algorithms: manual(0) }
    const state = kyuushuRound('kyuushu-off', options)
    beginTurn(state, options)

    expect(state.claim).toBeUndefined()
    expect(canDeclareKyuushu(state, options, 0)).toBe(false)
  })

  it('reconsiders when the seat being asked stops being manual mid-offer', () => {
    const options: RoundOptions = { ...YONMA, algorithms: manual(0) }
    const state = kyuushuRound('kyuushu-flip', options)
    beginTurn(state, options)
    expect(state.claim?.kind).toBe('abort')

    // still manual: the question is still theirs
    expect(reconsiderClaim(state, options)).toEqual([])
    expect(state.claim?.kind).toBe('abort')

    state.players[0].algorithm = 'ev'
    expect(reconsiderClaim(state, options)).toEqual([{ kind: 'abort', seat: 0, reason: 'kyuushu' }])
    expect(state.ended).toBe('abort')
  })

  it('replays off the log, for the seats that took it and the ones that did not', () => {
    const options: RoundOptions = { ...YONMA, algorithms: ['ev'] }
    const wall = handsWall('kyuushu-replay', KYUUSHU)
    const played = createRound(wall, 4, options)
    beginTurn(played, options)
    expect(played.ended).toBe('abort')

    const fresh = createRound(wall, 4, options)
    replayLog(fresh, options, played.log)
    expect(fresh.ended).toBe('abort')
    expect(fresh.log).toEqual(played.log)

    // and a log that does not name the abort replays a hand that carried on, even though replay
    // forces every seat manual and so raises the offer for all of them
    const declined = createRound(wall, 4, { ...options, algorithms: ['efficiency'] })
    beginTurn(declined, options)
    finishTurn(declined, options)
    const carriedOn = createRound(wall, 4, { ...options, algorithms: ['efficiency'] })
    replayLog(carriedOn, options, declined.log)
    expect(carriedOn.ended).toBeUndefined()
    expect(carriedOn.players[0].river.length).toBe(1)
  })
})
