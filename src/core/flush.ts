import { createHand, type Hand } from './hand'
import { mulberry32, shuffle } from './rng'
import { shanten } from './shanten'
import { HONOR, MAN, NUM_TILE_TYPES, PIN, SOU, type ParsedTile, type TileId } from './tiles'
import { TILES_PER_KIND, INITIAL_HAND_SIZE } from './wall'
import { karatenTiles, readWaits } from './waits'

export type FlushSuit = 'm' | 'p' | 's'

/** Which one-suit hands to pose: chinitsu (the suit alone), honitsu (the suit plus honours), or
 *  either, picked per hand. */
export type FlushHands = 'chinitsu' | 'honitsu' | 'both'

export const FLUSH_SUIT_BASE: Record<FlushSuit, TileId> = { m: MAN, p: PIN, s: SOU }

/** The honour part of a honitsu, as the size of each distinct honour's group. Drawn uniformly from
 *  this list, so a repeat is a weight: triplets and pairs are what honours mostly sit in, a lone
 *  honour (a tanki on it) is rarer, and two honour groups rarer still — they leave the suit too few
 *  tiles to say much. Stated, not measured: it only decides how often each kind of hand is asked. */
const HONOR_PATTERNS: readonly (readonly number[])[] = [
  [3],
  [3],
  [3],
  [2],
  [2],
  [2],
  [2],
  [1],
  [3, 2],
  [3, 2],
  [3, 3],
  [2, 2],
]

/** How often a hand with a single wait is kept. Uniform over tenpai thirteens, a third of chinitsu
 *  hands have one wait — fine to read once, but the drill exists for the many-sided shapes, so half
 *  of those are thrown back. Stated, like the patterns above. */
const SINGLE_WAIT_KEEP = 0.5

/** Bounded, never `while (true)`: a random chinitsu thirteen is tenpai often enough that this is
 *  never close, but a seed must always return. */
const MAX_ATTEMPTS = 2000

function handOf(counts: Uint8Array): Hand {
  const hand = createHand()
  hand.counts.set(counts)
  return hand
}

function tilesOf(counts: Uint8Array): ParsedTile[] {
  const tiles: ParsedTile[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    for (let k = 0; k < counts[id]; k++) tiles.push({ id, red: false })
  }
  return tiles
}

/** How many waits these thirteen would be posed on — 0 when they are not worth posing at all:
 *  not tenpai, or tenpai on a karaten wait. That hand is rejected outright rather than graded on a
 *  technicality — "you hold all four" is a rule a reader can be right about and still pick, and
 *  the drill is about reading shapes. `shanten` goes first because it is the cheap, cached gate
 *  almost every attempt fails. */
function poseableWaits(counts: Uint8Array): number {
  if (shanten(handOf(counts)) !== 0) return 0
  if (karatenTiles(counts).length > 0) return 0
  return readWaits(counts).length
}

/** A known-tenpai hand for when every attempt came up empty — chuuren's nine-sided shape for a
 *  chinitsu, `12345678` plus a honour triplet and pair (a three-sided 3-6-9) for a honitsu.
 *  Exported only so a test can hold it to the same standard as a dealt hand. */
export function flushFallback(suit: FlushSuit, honitsu: boolean): ParsedTile[] {
  const base = FLUSH_SUIT_BASE[suit]
  const counts = new Uint8Array(NUM_TILE_TYPES)
  if (honitsu) {
    for (let rank = 0; rank < 8; rank++) counts[base + rank]++
    counts[HONOR] = 3
    counts[HONOR + 1] = 2
  } else {
    for (const rank of [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8]) counts[base + rank]++
  }
  return tilesOf(counts)
}

/**
 * A seeded tenpai hand in one suit — the chinitsu trainer's whole round, as `deal` is the shanten
 * trainer's. Rejection-sampled: thirteen tiles off a shuffled copy of the suit's 36 (after the
 * honour part, for a honitsu), kept the first time they are worth posing — a single wait only
 * some of the time. Same seed and options, same hand. Sorted, plain tiles: a red five changes
 * nothing about a wait.
 */
export function dealFlushHand(seed: string, suit: FlushSuit, hands: FlushHands): ParsedTile[] {
  const rng = mulberry32(seed)
  const base = FLUSH_SUIT_BASE[suit]
  let honitsu = hands === 'honitsu'
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    honitsu = hands === 'honitsu' || (hands === 'both' && rng() < 0.5)
    const counts = new Uint8Array(NUM_TILE_TYPES)
    let size = 0
    if (honitsu) {
      const honors = shuffle([0, 1, 2, 3, 4, 5, 6], rng)
      const pattern = HONOR_PATTERNS[Math.floor(rng() * HONOR_PATTERNS.length)]
      pattern.forEach((n, i) => {
        counts[HONOR + honors[i]] = n
        size += n
      })
    }
    const suitTiles = shuffle(
      Array.from({ length: 9 * TILES_PER_KIND }, (_, i) => base + (i % 9)),
      rng,
    )
    for (let i = 0; size < INITIAL_HAND_SIZE; i++, size++) counts[suitTiles[i]]++
    const waits = poseableWaits(counts)
    if (waits === 0 || (waits === 1 && rng() >= SINGLE_WAIT_KEEP)) continue
    return tilesOf(counts)
  }
  return flushFallback(suit, honitsu)
}
