import { HONOR, NUM_TILE_TYPES } from './tiles'
import type { Hand } from './hand'

const MAX_BLOCKS = 4

function evaluate(sets: number, partials: number, hasPair: boolean): number {
  const cappedPartials = Math.min(partials, MAX_BLOCKS - sets)
  return 8 - 2 * sets - cappedPartials - (hasPair ? 1 : 0)
}

/** Backtracking search over the 5-block decomposition (4 sets + 1 pair). Mutates `counts` but restores it. */
function search(counts: Uint8Array, i: number, sets: number, partials: number, hasPair: boolean): number {
  if (i >= NUM_TILE_TYPES) return evaluate(sets, partials, hasPair)
  if (counts[i] === 0) return search(counts, i + 1, sets, partials, hasPair)

  let best = search(counts, i + 1, sets, partials, hasPair)

  if (counts[i] >= 3) {
    counts[i] -= 3
    best = Math.min(best, search(counts, i, sets + 1, partials, hasPair))
    counts[i] += 3
  }
  if (counts[i] >= 2) {
    counts[i] -= 2
    if (!hasPair) best = Math.min(best, search(counts, i, sets, partials, true))
    best = Math.min(best, search(counts, i, sets, partials + 1, hasPair))
    counts[i] += 2
  }

  const rank = i % 9
  const inSuit = i < HONOR
  if (inSuit && rank <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--
    counts[i + 1]--
    counts[i + 2]--
    best = Math.min(best, search(counts, i, sets + 1, partials, hasPair))
    counts[i]++
    counts[i + 1]++
    counts[i + 2]++
  }
  if (inSuit && rank <= 7 && counts[i + 1] > 0) {
    counts[i]--
    counts[i + 1]--
    best = Math.min(best, search(counts, i, sets, partials + 1, hasPair))
    counts[i]++
    counts[i + 1]++
  }
  if (inSuit && rank <= 6 && counts[i + 2] > 0) {
    counts[i]--
    counts[i + 2]--
    best = Math.min(best, search(counts, i, sets, partials + 1, hasPair))
    counts[i]++
    counts[i + 2]++
  }

  return best
}

export function standardShanten(hand: Hand): number {
  return search(hand.counts.slice(), 0, hand.melds, 0, false)
}

export function chiitoiShanten(hand: Hand): number {
  let pairs = 0
  let kinds = 0
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    if (hand.counts[i] >= 1) kinds++
    if (hand.counts[i] >= 2) pairs++
  }
  return 6 - pairs + Math.max(0, 7 - kinds)
}

const KOKUSHI_TILES = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

export function kokushiShanten(hand: Hand): number {
  let kinds = 0
  let hasPair = false
  for (const id of KOKUSHI_TILES) {
    if (hand.counts[id] >= 1) kinds++
    if (hand.counts[id] >= 2) hasPair = true
  }
  return 13 - kinds - (hasPair ? 1 : 0)
}

export function shanten(hand: Hand): number {
  // chiitoitsu and kokushi musou both require a fully concealed hand
  if (hand.melds > 0) return standardShanten(hand)
  return Math.min(standardShanten(hand), chiitoiShanten(hand), kokushiShanten(hand))
}
