import { describe, expect, it } from 'vitest'
import { assessDiscards, type SafetyTier, type ThreatView, type TileDanger } from './danger'
import { handFromTenhou } from './hand'
import { createMatch } from './match'
import { beginTurn, createRound, finishTurn, type RoundOptions, type RoundState } from './round'
import { isFuriten, waits } from './policy'
import { HONOR, MAN, NUM_TILE_TYPES, parseTenhou, PIN, SOU, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

function threat(discards: string, passed = ''): ThreatView {
  return {
    seat: 1,
    discards: parseTenhou(discards).map((t) => t.id),
    passed: parseTenhou(passed).map((t) => t.id),
  }
}

/** Visibility array from tenhou notation: every listed copy counts as already accounted for. */
function visible(tiles: string): Uint8Array {
  const counts = new Uint8Array(NUM_TILE_TYPES)
  for (const tile of parseTenhou(tiles)) counts[tile.id]++
  return counts
}

function tierOf(hand: string, tile: TileId, view: ThreatView, seen = ''): SafetyTier {
  const ranked = assessDiscards(handFromTenhou(hand), [view], visible(seen), false)
  return ranked.find((entry) => entry.tile === tile)!.tier
}

function rankOf(ranked: TileDanger[], tile: TileId): number {
  return ranked.find((entry) => entry.tile === tile)!.rank
}

const SUITS: [string, number][] = [
  ['m', MAN],
  ['p', PIN],
  ['s', SOU],
]

describe('genbutsu', () => {
  it('marks tiles the threat discarded itself', () => {
    expect(tierOf('123456789m123p1z', PIN, threat('1p'))).toBe('genbutsu')
  })

  it('marks tiles anyone passed on after the declaration', () => {
    expect(tierOf('123456789m123p1z', PIN, threat('9m', '1p'))).toBe('genbutsu')
  })

  it('covers honours, ahead of the honour tier', () => {
    expect(tierOf('123456789m123p1z', HONOR, threat('1z'))).toBe('genbutsu')
    expect(tierOf('123456789m123p1z', HONOR, threat(''))).toBe('honour')
  })

  it('ranks every genbutsu tile equally', () => {
    const ranked = assessDiscards(
      handFromTenhou('123456789m123p'),
      [threat('1p2p')],
      visible(''),
      false,
    )
    expect(rankOf(ranked, PIN)).toBe(0)
    expect(rankOf(ranked, PIN + 1)).toBe(0)
    expect(rankOf(ranked, PIN + 2)).toBeGreaterThan(0)
  })
})

describe('suji', () => {
  it.each(SUITS)('reads the 1/4/7 chain in %s', (_suit, offset) => {
    const view: ThreatView = { seat: 1, discards: [offset + 3], passed: [] }
    expect(tierOf('147m147p147s11z', offset, view)).toBe('suji')
    expect(tierOf('147m147p147s11z', offset + 6, view)).toBe('suji')
  })

  it.each(SUITS)('reads the 2/5/8 and 3/6/9 chains in %s', (_suit, offset) => {
    const fives: ThreatView = { seat: 1, discards: [offset + 4], passed: [] }
    expect(tierOf('258m258p258s11z', offset + 1, fives)).toBe('suji')
    expect(tierOf('258m258p258s11z', offset + 7, fives)).toBe('suji')

    const sixes: ThreatView = { seat: 1, discards: [offset + 5], passed: [] }
    expect(tierOf('369m369p369s11z', offset + 2, sixes)).toBe('suji')
    expect(tierOf('369m369p369s11z', offset + 8, sixes)).toBe('suji')
  })

  it('protects a middle tile only from both sides at once', () => {
    expect(tierOf('456789m1234p1234s', PIN + 3, threat('1p7p'))).toBe('doubleSuji')
    expect(tierOf('456789m1234p1234s', PIN + 3, threat('1p'))).toBe('halfSuji')
    expect(tierOf('456789m1234p1234s', PIN + 3, threat('7p'))).toBe('halfSuji')
    expect(tierOf('456789m1234p1234s', PIN + 3, threat(''))).toBe('nonSuji')
  })

  it('has double suji on 4/5/6 and nowhere else', () => {
    for (const rank of [0, 1, 2, 6, 7, 8]) {
      // every other rank has a ryanmen on one side only, so one partner is the whole protection
      const partners = [rank - 3, rank + 3].filter((r) => r >= 0 && r <= 8).map((r) => PIN + r)
      expect(tierOf('123456789p', PIN + rank, { seat: 1, discards: partners, passed: [] })).toBe(
        'suji',
      )
    }
    for (const rank of [3, 4, 5]) {
      const partners = [PIN + rank - 3, PIN + rank + 3]
      expect(tierOf('123456789p', PIN + rank, { seat: 1, discards: partners, passed: [] })).toBe(
        'doubleSuji',
      )
    }
  })

  it('does not mistake a penchan for a ryanmen: 3p is suji off 6p, not off 1p', () => {
    // 1p2p also waits on 3p, but it is a penchan — no far end to be furiten on, which is exactly
    // why suji is a tier and not safety
    expect(tierOf('123456789p', PIN + 2, threat('6p'))).toBe('suji')
    expect(tierOf('123456789p', PIN + 2, threat('1p'))).toBe('nonSuji')
  })
})

describe('kabe', () => {
  it('calls a tile no-chance when every run shape that reaches it is walled', () => {
    // 4p is waited on by 5p6p, 2p3p and 3p5p; with all four 3p and 5p face up, none can exist
    expect(tierOf('456789m1234p1234s', PIN + 3, threat(''), '3333p5555p')).toBe('noChance')
  })

  it('calls it one-chance at exactly three copies, and nothing at two', () => {
    expect(tierOf('456789m1234p1234s', PIN + 3, threat(''), '333p555p')).toBe('oneChance')
    expect(tierOf('456789m1234p1234s', PIN + 3, threat(''), '33p55p')).toBe('nonSuji')
  })

  it('wants every surviving shape limited, not just one of them', () => {
    // 3p at three copies limits 2p3p and 3p5p, but 5p6p is untouched and fully live
    expect(tierOf('456789m1234p1234s', PIN + 3, threat(''), '333p')).toBe('nonSuji')
  })

  it('beats suji when both apply — a wall kills the shape, furiten only kills the wait', () => {
    expect(tierOf('456789m1234p1234s', PIN + 3, threat('1p7p'), '3333p5555p')).toBe('noChance')
  })

  it('walls terminals with the one shape that reaches them', () => {
    expect(tierOf('123456789p', PIN, threat(''), '2222p')).toBe('noChance')
    expect(tierOf('123456789p', PIN + 8, threat(''), '8888p')).toBe('noChance')
    expect(tierOf('123456789p', PIN, threat(''), '222p')).toBe('oneChance')
  })
})

describe('honours', () => {
  it('ranks by copies visible: three seen can only be a tanki', () => {
    const ranked = assessDiscards(
      handFromTenhou('4567z'),
      [threat('')],
      visible('444z55z6z'),
      false,
    )
    expect(rankOf(ranked, HONOR + 3)).toBeLessThan(rankOf(ranked, HONOR + 4))
    expect(rankOf(ranked, HONOR + 4)).toBeLessThan(rankOf(ranked, HONOR + 5))
    expect(rankOf(ranked, HONOR + 5)).toBeLessThan(rankOf(ranked, HONOR + 6))
  })

  it('sits ahead of every unprotected number', () => {
    const ranked = assessDiscards(handFromTenhou('19m45p1z'), [threat('')], visible(''), false)
    expect(rankOf(ranked, HONOR)).toBeLessThan(rankOf(ranked, MAN))
  })
})

describe('ordering', () => {
  it('ranks non-suji numbers by distance from the middle', () => {
    const ranked = assessDiscards(handFromTenhou('1235p'), [threat('')], visible(''), false)
    expect(rankOf(ranked, PIN)).toBeLessThan(rankOf(ranked, PIN + 1))
    expect(rankOf(ranked, PIN + 1)).toBeLessThan(rankOf(ranked, PIN + 2))
    expect(rankOf(ranked, PIN + 2)).toBeLessThan(rankOf(ranked, PIN + 4))
  })

  it('puts half suji in the non-suji outer band, not with real suji', () => {
    // 1p discarded: 4p is half suji, still wide open to the 5p6p ryanmen
    const ranked = assessDiscards(handFromTenhou('4p1235s'), [threat('1p')], visible(''), false)
    const half = rankOf(ranked, PIN + 3)
    expect(half).toBeGreaterThan(rankOf(ranked, SOU)) // safer than it: non-suji terminal
    expect(half).toBeLessThan(rankOf(ranked, SOU + 2)) // more dangerous: non-suji 3s
    expect(half).toBeLessThan(rankOf(ranked, SOU + 4))
  })

  it('walks the whole tier order, worst last', () => {
    // 9m genbutsu · 1s walled by four 2s · 5s one-chance off three 4s and three 6s
    // 5p double suji (2p and 8p out) · 1m suji (4m out) · 1z lone honour · 9s bare · 4p half suji
    const ranked = assessDiscards(
      handFromTenhou('19m45p159s1z'),
      [threat('49m128p')],
      visible('2222s444s666s'),
      false,
    )
    expect(ranked.map((entry) => entry.tier)).toEqual([
      'genbutsu',
      'noChance',
      'oneChance',
      'doubleSuji',
      'suji',
      'honour',
      'nonSuji',
      'halfSuji',
    ])
    expect(ranked.map((entry) => entry.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe('several threats', () => {
  const west: ThreatView = { seat: 2, discards: [PIN + 3], passed: [] }
  const north: ThreatView = { seat: 3, discards: [], passed: [] }

  it('takes the worst tier across threats', () => {
    const ranked = assessDiscards(handFromTenhou('4p12s'), [west, north], visible(''), false)
    const entry = ranked.find((e) => e.tile === PIN + 3)!
    expect(entry.against.map((a) => a.tier)).toEqual(['genbutsu', 'nonSuji'])
    expect(entry.tier).toBe('nonSuji')
  })

  it('keeps a tile safe only when it is safe against everyone', () => {
    const both: ThreatView = { seat: 3, discards: [PIN + 3], passed: [] }
    const ranked = assessDiscards(handFromTenhou('4p12s'), [west, both], visible(''), false)
    expect(ranked.find((e) => e.tile === PIN + 3)!.tier).toBe('genbutsu')
    expect(rankOf(ranked, PIN + 3)).toBe(0)
  })

  it('is total with no threats at all', () => {
    const ranked = assessDiscards(handFromTenhou('4p12s1z'), [], visible(''), false)
    expect(ranked).toHaveLength(4)
    expect(ranked.every((entry) => entry.against.length === 0)).toBe(true)
    expect(ranked.some((entry) => entry.tier === 'genbutsu')).toBe(false)
  })
})

describe('sanma', () => {
  it('walls off shapes that need a tile the ruleset does not have', () => {
    // no 2m-8m exist, so no run can ever wait on 1m or 9m
    expect(tierOfSanma('19m123456789p', MAN)).toBe('noChance')
    expect(tierOfSanma('19m123456789p', MAN + 8)).toBe('noChance')
  })

  it('leaves the suits that are still whole alone', () => {
    expect(tierOfSanma('19m123456789p', PIN + 4)).toBe('nonSuji')
  })
})

function tierOfSanma(hand: string, tile: TileId): SafetyTier {
  const ranked = assessDiscards(handFromTenhou(hand), [threat('')], new Uint8Array(34), true)
  return ranked.find((entry) => entry.tile === tile)!.tier
}

describe('the ranking itself', () => {
  const hand = handFromTenhou('1234m5678p12s11z')
  const view = threat('3m9p')

  it('returns exactly one entry per kind held', () => {
    const ranked = assessDiscards(hand, [view], visible(''), false)
    expect(ranked).toHaveLength(11)
    expect(new Set(ranked.map((entry) => entry.tile)).size).toBe(11)
  })

  it('is dense and monotone: starts at 0, never skips, equal scores tie', () => {
    const ranked = assessDiscards(hand, [view], visible(''), false)
    expect(ranked[0].rank).toBe(0)
    for (let i = 1; i < ranked.length; i++) {
      const step = ranked[i].rank - ranked[i - 1].rank
      expect(step === 0 || step === 1).toBe(true)
    }
  })

  it('is deterministic and leaves the hand alone', () => {
    const counts = Uint8Array.from(hand.counts)
    expect(assessDiscards(hand, [view], visible(''), false)).toEqual(
      assessDiscards(hand, [view], visible(''), false),
    )
    expect(hand.counts).toEqual(counts)
  })
})

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  deadWall: true,
  calls: true,
  riichi: true,
  wins: true,
}

/** Plays a seed until someone declares riichi, then `extraTurns` further turns so tiles have been
 *  passed on since. Discards come off the event log in play order, the way the trainer reads them. */
function playPastRiichi(seed: string, extraTurns: number) {
  const state = createRound([], 4, YONMA, seed)
  const thrown: { seat: number; tile: TileId }[] = []
  let declaredAt = -1
  let declaredAfter = 0
  for (let guard = 0; guard < 400 && !state.ended; guard++) {
    for (const event of [...beginTurn(state, YONMA), ...finishTurn(state, YONMA)]) {
      if (event.kind === 'discard') thrown.push({ seat: event.seat, tile: event.tile.id })
      if (event.kind === 'riichi' && declaredAt < 0) {
        declaredAt = event.seat
        declaredAfter = thrown.length
      }
    }
    if (declaredAt >= 0 && --extraTurns < 0) break
  }
  return { state, declaredAt, thrown, declaredAfter }
}

describe('genbutsu never lies (property, over generated matches)', () => {
  // 150 full match simulations plus per-seat assessDiscards is legitimately heavier than the
  // 5000ms default; under parallel test-file contention it can miss that window without being
  // an actual hang, which is what flaked this in CI.
  it('nothing ranked genbutsu is a tile that threat could actually ron', () => {
    let checked = 0
    let hands = 0
    for (let i = 0; i < 150; i++) {
      const { state, declaredAt, thrown, declaredAfter } = playPastRiichi(`danger-${i}`, 4)
      if (declaredAt < 0 || state.ended) continue
      hands++

      const threatSeat = state.players[declaredAt]
      const view: ThreatView = {
        seat: declaredAt,
        discards: thrown.filter((t) => t.seat === declaredAt).map((t) => t.tile),
        // everything anyone threw after the declaration; a ron would have ended the hand, so
        // every one of them was passed on
        passed: thrown.slice(declaredAfter).map((t) => t.tile),
      }
      const waitTiles = waits(threatSeat.hand, false)
      const furiten = isFuriten(waitTiles, threatSeat.river) || threatSeat.missedWin

      for (let seat = 0; seat < 4; seat++) {
        if (seat === declaredAt) continue
        const ranked = assessDiscards(state.players[seat].hand, [view], seenBy(state, seat), false)
        for (const entry of ranked) {
          if (entry.tier !== 'genbutsu') continue
          checked++
          expect(
            !waitTiles.includes(entry.tile) || furiten,
            `${entry.tile} ranked genbutsu against seat ${declaredAt}, but is a live wait`,
          ).toBe(true)
        }
      }
    }
    expect(hands).toBeGreaterThan(30)
    expect(checked).toBeGreaterThan(200)
  }, 15000)
})

function seenBy(state: RoundState, seat: number): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = Math.min(TILES_PER_KIND, state.visible[i] + state.players[seat].hand.counts[i])
  }
  return seen
}
