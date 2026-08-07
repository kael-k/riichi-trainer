import type { Hand } from './hand'
import { inTileSet, isHonor, NUM_TILE_TYPES, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

/**
 * How dangerous each tile in your hand is against the seats threatening to ron — the folding
 * trainer's grader, and (later) the defensive half of `policy.ts`.
 *
 * Ordinal, never probabilistic. Published betaori tables exist, but a number typed in from memory
 * becomes a number the reader learns, so tiles are ranked into tiers and graded on tier ordering.
 * If precise deal-in rates are ever wanted they should be measured by simulation over the
 * reachable hand space, not written here.
 *
 * Judged on **public information only**: what the threat actually holds is never consulted, so a
 * correct call that happens to deal in still ranks correct. Pure and total, like `policy.ts` —
 * same inputs, same output, every ranking tie broken explicitly rather than by sort stability.
 */

export type SafetyTier =
  /** In their own discards, or passed on since they declared: they cannot ron it. */
  | 'genbutsu'
  /** Every run shape that could wait on it is exhausted; only tanki/shanpon remain. */
  | 'noChance'
  /** Every such shape has a single copy left of the tile it needs. */
  | 'oneChance'
  /** 4/5/6 with both n-3 and n+3 genbutsu: both ryanmen are furiten. */
  | 'doubleSuji'
  /** Outer tile whose only possible ryanmen is furiten. */
  | 'suji'
  /** Wind or dragon, ranked by how many copies are already visible. */
  | 'honour'
  /** 4/5/6 with only one side genbutsu — the other ryanmen is still live. */
  | 'halfSuji'
  /** No protection at all. */
  | 'nonSuji'

/** What is publicly known about one threatening seat. Both fields come from the match event log
 *  rather than `PlayerState.river`, because `finishTurn` pops a claimed discard out of the river
 *  and it is still a tile that seat threw. */
export interface ThreatView {
  seat: number
  /** Every tile this seat has discarded: they are furiten on all of them. */
  discards: TileId[]
  /** Tiles anyone discarded after this seat declared, which it did not ron — it passed on them,
   *  so it may not ron them now either. Empty on the turn the declaration lands, and the reason
   *  late folding gets easier: this set only grows. */
  passed: TileId[]
}

export interface ThreatDanger {
  tier: SafetyTier
  /** Tiles that explain the tier — the genbutsu copy, the suji partner(s), the walled
   *  neighbour(s). Ids, not prose: the four locales phrase it, `core/` stays language-free. */
  because: TileId[]
}

export interface TileDanger {
  tile: TileId
  /** One entry per threat, in the order they were given. */
  against: ThreatDanger[]
  /** Worst tier across the threats; what the ranking sorts on. */
  tier: SafetyTier
  /** Copies already accounted for: every river, meld and dora indicator, plus your own hand. */
  visible: number
  /** Ordinal, 0 = safest. Equal ranks are genuinely equivalent choices — grade on `rank === 0`,
   *  never on list position. */
  rank: number
}

/**
 * Danger score per tier, lower = safer. This is the calibration knob for the whole trainer, so it
 * lives in one table rather than scattered through the rules.
 *
 * Two deliberate placements: `halfSuji` sits inside the non-suji outer band (a 4p with only 1p
 * discarded is still wide open to the 5p6p ryanmen, so it plays about like a non-suji 2p, not like
 * a genuinely protected 1p), and honours rank ahead of every non-suji number, which follows the
 * tier order but is a little optimistic for a lone unseen yakuhai.
 */
const TIER_SCORE: Record<SafetyTier, number> = {
  genbutsu: 0,
  noChance: 10,
  oneChance: 20,
  doubleSuji: 30,
  suji: 40,
  // + (3 - copies visible): three visible can only be a tanki, none visible could be anything
  honour: 50,
  halfSuji: 63,
  // + distance from the middle, below
  nonSuji: 60,
}

/** Non-suji numbers by distance from the middle: fewer ryanmen shapes reach a terminal, so 1/9 is
 *  the safest number you can throw with no protection and 4/5/6 the most dangerous. */
const NON_SUJI_DISTANCE = [0, 2, 4, 6, 6, 6, 4, 2, 0]

function tierScore(tier: SafetyTier, id: TileId, visible: number): number {
  if (tier === 'honour') return TIER_SCORE.honour + (3 - Math.min(visible, 3))
  if (tier === 'nonSuji') return TIER_SCORE.nonSuji + NON_SUJI_DISTANCE[id % 9]
  return TIER_SCORE[tier]
}

/** A two-tile run shape, as offsets from the tile it waits on. `(n+1, n+2)` and `(n-2, n-1)` are
 *  the ryanmen (each also waits on the far end, which is what suji reads); `(n-1, n+1)` is the
 *  kanchan, which no amount of suji protects against but a wall does. */
const RYANMEN: [number, number][] = [
  [1, 2],
  [-2, -1],
]
const RUN_SHAPES: [number, number][] = [...RYANMEN, [-1, 1]]

/** Stand-in when no seat is threatening: nothing is genbutsu and nothing is suji, so tiles still
 *  rank by wall and shape alone. Keeps `assessDiscards` total — it never assumes a riichi is out. */
const NO_THREAT: ThreatView = { seat: -1, discards: [], passed: [] }

export function assessDiscards(
  hand: Hand,
  threats: ThreatView[],
  visible: Uint8Array,
  sanma: boolean,
): TileDanger[] {
  // a tile that is not in the ruleset (2m-8m under sanma) can never be drawn or held, so every
  // shape needing it is as dead as one whose four copies are all face up
  const seen = (id: TileId): number => (inTileSet(id, sanma) ? visible[id] : TILES_PER_KIND)

  const entries: TileDanger[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (hand.counts[id] === 0) continue
    const against = threats.map((threat) => assess(id, threat, seen))
    // several threats: the worst tier decides. Slightly optimistic — the real risk is the union
    // of dealing in to any of them — but ordinal, and the per-threat tiers stay in `against`
    const worst = against.reduce(
      (acc, one) =>
        tierScore(one.tier, id, seen(id)) > tierScore(acc.tier, id, seen(id)) ? one : acc,
      against[0] ?? assess(id, NO_THREAT, seen),
    )
    entries.push({ tile: id, against, tier: worst.tier, visible: seen(id), rank: 0 })
  }

  // total order: score, then tile id. Ranks are dense over the score alone, so tiles that only
  // differ by id come out genuinely tied rather than one arbitrarily "better"
  const score = (entry: TileDanger) => tierScore(entry.tier, entry.tile, entry.visible)
  entries.sort((a, b) => score(a) - score(b) || a.tile - b.tile)
  let rank = -1
  let previous = NaN
  for (const entry of entries) {
    const value = score(entry)
    if (value !== previous) {
      rank++
      previous = value
    }
    entry.rank = rank
  }
  return entries
}

/** One tile against one threat. */
function assess(id: TileId, threat: ThreatView, seen: (id: TileId) => number): ThreatDanger {
  const safe = (tile: TileId) => threat.discards.includes(tile) || threat.passed.includes(tile)
  if (safe(id)) return { tier: 'genbutsu', because: [id] }
  if (isHonor(id)) return { tier: 'honour', because: [] }

  const rank = id % 9
  const inSuit = (offset: number) => rank + offset >= 0 && rank + offset <= 8

  // kabe first: a wall kills the shape outright, which beats any furiten argument about it
  const live: [number, number][] = RUN_SHAPES.filter(
    ([a, b]) =>
      inSuit(a) && inSuit(b) && seen(id + a) < TILES_PER_KIND && seen(id + b) < TILES_PER_KIND,
  )
  if (live.length === 0) {
    const walls = RUN_SHAPES.flatMap(([a, b]) => [a, b])
      .filter((offset) => inSuit(offset) && seen(id + offset) === TILES_PER_KIND)
      .map((offset) => id + offset)
    return { tier: 'noChance', because: [...new Set(walls)] }
  }
  if (live.every(([a, b]) => seen(id + a) === 3 || seen(id + b) === 3)) {
    const scarce = live
      .flatMap(([a, b]) => [a, b])
      .filter((offset) => seen(id + offset) === 3)
      .map((offset) => id + offset)
    return { tier: 'oneChance', because: [...new Set(scarce)] }
  }

  // suji: a ryanmen waiting on this tile also waits on its far end, so a genbutsu far end makes
  // that whole ryanmen furiten. A shape whose far end runs off the suit is a penchan, not a
  // ryanmen (12p waits on 3p only), and suji says nothing about penchan — nor kanchan, tanki or
  // shanpon, which is why no tier below `noChance` may ever be called "safe" in the UI
  const partners: TileId[] = []
  let open = 0
  for (const [a, b] of RYANMEN) {
    const far = a > 0 ? 3 : -3
    if (!inSuit(a) || !inSuit(b) || !inSuit(far)) continue
    if (safe(id + far)) partners.push(id + far)
    else open++
  }
  if (open === 0) {
    // both sides genbutsu is only reachable for 4/5/6, the ranks with a ryanmen on each side
    return { tier: partners.length === 2 ? 'doubleSuji' : 'suji', because: partners }
  }
  if (partners.length > 0) return { tier: 'halfSuji', because: partners }
  return { tier: 'nonSuji', because: [] }
}
