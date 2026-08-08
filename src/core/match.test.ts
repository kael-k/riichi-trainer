import { describe, expect, it } from 'vitest'
import { assessDiscards } from './danger'
import { tileCount } from './hand'
import {
  beginTurn,
  createMatch,
  findMatch,
  finishTurn,
  playMatch,
  threatViews,
  wallDrawnCount,
  type MatchEvent,
  type MatchOptions,
  type MatchState,
} from './match'
import { scoreHand } from './score'
import { HONOR, inTileSet, NUM_TILE_TYPES } from './tiles'
import { TILES_PER_KIND } from './wall'

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
      const state = createMatch('aka-seed', players, options)
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

  it('honours a pinned hand and wall prefix', () => {
    const pinned = {
      seat: 1,
      hand: [
        { id: 0, red: false },
        { id: 1, red: false },
      ],
      wall: [{ id: 33, red: false }],
    }
    const state = createMatch('pinned', 4, YONMA, pinned)
    expect(state.players[1].hand.counts[0]).toBeGreaterThan(0)
    expect(state.players[1].hand.counts[1]).toBeGreaterThan(0)
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
  const state = createMatch(seed, 4, YONMA)
  let declarer = -1
  let switched = false
  let sawCall = false
  let sawExtraRiichi = false
  let foldingDiscards = 0
  let mismatches = 0

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
    }

    if (declarer >= 0 && !switched) {
      for (const [seat, player] of state.players.entries()) {
        if (seat !== declarer) player.policy = 'defense'
      }
      switched = true
    }
  }
  return { state, declarer, sawCall, sawExtraRiichi, foldingDiscards, mismatches }
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

      for (let i = 0; i < 30; i++) {
        const result = playWithDefense(`defense-${i}`)
        if (result.declarer < 0) continue
        declared++
        totalFoldingDiscards += result.foldingDiscards
        totalMismatches += result.mismatches
        sawCall = sawCall || result.sawCall
        sawExtraRiichi = sawExtraRiichi || result.sawExtraRiichi

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
    },
  )
})
