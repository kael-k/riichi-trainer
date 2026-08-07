import { KOKUSHI_TILES } from './agari'
import { HONOR, NUM_TILE_TYPES } from './tiles'
import type { Hand } from './hand'

const MAX_BLOCKS = 4

function evaluate(sets: number, partials: number, hasPair: boolean): number {
  const cappedPartials = Math.min(partials, MAX_BLOCKS - sets)
  return 8 - 2 * sets - cappedPartials - (hasPair ? 1 : 0)
}

/**
 * Reference implementation: one backtracking search over the whole 34-tile hand. Correct, and
 * the specification `standardShanten` is proved against in `shanten.test.ts` — but it re-derives
 * every combination across all four tile groups at once, which costs ~500us per call. Nothing
 * outside that test should use it.
 *
 * Mutates `counts` but restores it.
 */
function search(
  counts: Uint8Array,
  i: number,
  sets: number,
  partials: number,
  hasPair: boolean,
): number {
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

export function referenceStandardShanten(hand: Hand): number {
  return search(hand.counts.slice(), 0, hand.melds, 0, false)
}

/**
 * The three numbered suits and the honours never share a block, so each can be decomposed on its
 * own and the results combined. That is the whole optimisation: a group is nine ranks rather
 * than thirty-four, its search is tiny, and — because a probe like "what if I draw this tile"
 * only ever perturbs *one* group — the other three come straight back out of the cache.
 *
 * A group's result is the most partials it can reach for each (pair used, sets) pair. Partials
 * are worth strictly less than sets and more is never worse, so keeping only the maximum per
 * cell loses nothing.
 */
const GROUP_SLOTS = 10 // (pair used ? 1 : 0) * 5 + sets
const GROUPS: [offset: number, size: number][] = [
  [0, 9],
  [9, 9],
  [18, 9],
  [HONOR, 7],
]

// ponytail: unbounded until the cap, then cleared wholesale; a real suit alphabet is 5^9 but
// play only ever visits a few thousand of them
const groupCache = new Map<number, Int8Array>()
const GROUP_CACHE_CAP = 1 << 16

function groupSearch(
  counts: Uint8Array,
  size: number,
  i: number,
  sets: number,
  partials: number,
  hasPair: boolean,
  out: Int8Array,
): void {
  if (i >= size) {
    const slot = (hasPair ? 5 : 0) + Math.min(sets, MAX_BLOCKS)
    const value = Math.min(partials, MAX_BLOCKS)
    if (value > out[slot]) out[slot] = value
    return
  }
  if (counts[i] === 0) {
    groupSearch(counts, size, i + 1, sets, partials, hasPair, out)
    return
  }

  groupSearch(counts, size, i + 1, sets, partials, hasPair, out)

  if (counts[i] >= 3) {
    counts[i] -= 3
    groupSearch(counts, size, i, sets + 1, partials, hasPair, out)
    counts[i] += 3
  }
  if (counts[i] >= 2) {
    counts[i] -= 2
    if (!hasPair) groupSearch(counts, size, i, sets, partials, true, out)
    groupSearch(counts, size, i, sets, partials + 1, hasPair, out)
    counts[i] += 2
  }
  // honours have no runs, which is exactly what makes their group seven ranks wide, not nine
  if (size !== 9) return

  if (i <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--
    counts[i + 1]--
    counts[i + 2]--
    groupSearch(counts, size, i, sets + 1, partials, hasPair, out)
    counts[i]++
    counts[i + 1]++
    counts[i + 2]++
  }
  if (i <= 7 && counts[i + 1] > 0) {
    counts[i]--
    counts[i + 1]--
    groupSearch(counts, size, i, sets, partials + 1, hasPair, out)
    counts[i]++
    counts[i + 1]++
  }
  if (i <= 6 && counts[i + 2] > 0) {
    counts[i]--
    counts[i + 2]--
    groupSearch(counts, size, i, sets, partials + 1, hasPair, out)
    counts[i]++
    counts[i + 2]++
  }
}

const scratch = new Uint8Array(9)

function groupTable(counts: Uint8Array, offset: number, size: number): Int8Array {
  let key = size
  for (let i = 0; i < size; i++) key = key * 5 + counts[offset + i]
  const cached = groupCache.get(key)
  if (cached) return cached

  for (let i = 0; i < size; i++) scratch[i] = counts[offset + i]
  const table = new Int8Array(GROUP_SLOTS).fill(-1)
  groupSearch(scratch, size, 0, 0, 0, false, table)

  if (groupCache.size >= GROUP_CACHE_CAP) groupCache.clear()
  groupCache.set(key, table)
  return table
}

/** Merges two groups' tables: sets add, partials add, and at most one of them may hold the pair. */
function merge(a: Int8Array, b: Int8Array): Int8Array {
  const out = new Int8Array(GROUP_SLOTS).fill(-1)
  for (let pairA = 0; pairA < 2; pairA++) {
    for (let setsA = 0; setsA <= MAX_BLOCKS; setsA++) {
      const partialsA = a[pairA * 5 + setsA]
      if (partialsA < 0) continue
      for (let pairB = 0; pairB < 2; pairB++) {
        if (pairA && pairB) continue
        for (let setsB = 0; setsA + setsB <= MAX_BLOCKS; setsB++) {
          const partialsB = b[pairB * 5 + setsB]
          if (partialsB < 0) continue
          const slot = (pairA || pairB ? 5 : 0) + setsA + setsB
          const value = Math.min(partialsA + partialsB, MAX_BLOCKS)
          if (value > out[slot]) out[slot] = value
        }
      }
    }
  }
  return out
}

export function standardShanten(hand: Hand): number {
  let table = groupTable(hand.counts, GROUPS[0][0], GROUPS[0][1])
  for (let g = 1; g < GROUPS.length; g++) {
    table = merge(table, groupTable(hand.counts, GROUPS[g][0], GROUPS[g][1]))
  }

  let best = 8
  for (let pair = 0; pair < 2; pair++) {
    for (let sets = 0; sets <= MAX_BLOCKS; sets++) {
      const partials = table[pair * 5 + sets]
      if (partials < 0) continue
      const total = sets + hand.melds
      if (total > MAX_BLOCKS) continue
      best = Math.min(best, evaluate(total, partials, pair === 1))
    }
  }
  return best
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
