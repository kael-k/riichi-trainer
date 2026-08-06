import { HONOR, NUM_TILE_TYPES, type ParsedTile, type TileId } from './tiles'

export type MeldKind = 'chi' | 'pon' | 'minkan' | 'ankan'

/** A called set. `tiles` sorted ascending; chi/pon hold 3, kans hold 4. Kakan (added kan)
 *  scores identically to a daiminkan, so it is represented as 'minkan' too. */
export interface Meld {
  kind: MeldKind
  tiles: ParsedTile[]
}

export type BlockKind = 'run' | 'triplet' | 'pair'

/** One block of a standard decomposition. `tile` is the run's lowest tile, or the tile
 *  itself for a triplet/pair. `meld` is set for a called block (chi/pon/kan); undefined
 *  blocks are built from the concealed hand and may still be "closed" triplets. */
export interface Block {
  kind: BlockKind
  tile: TileId
  meld?: Meld
}

export type Arrangement =
  | { kind: 'standard'; blocks: Block[] }
  | { kind: 'chiitoi'; pairs: TileId[] }
  | { kind: 'kokushi'; pair: TileId }

export const KOKUSHI_TILES = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

function chiitoiArrangement(counts: Uint8Array): Arrangement | null {
  const pairs: TileId[] = []
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    if (counts[i] === 2) pairs.push(i)
    else if (counts[i] !== 0) return null // 1, 3 or 4 copies of a kind breaks chiitoitsu
  }
  return pairs.length === 7 ? { kind: 'chiitoi', pairs } : null
}

function kokushiArrangement(counts: Uint8Array): Arrangement | null {
  let pair: TileId | null = null
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    if (!KOKUSHI_TILES.includes(i)) {
      if (counts[i] !== 0) return null
      continue
    }
    if (counts[i] === 0 || counts[i] > 2) return null
    if (counts[i] === 2) {
      if (pair !== null) return null
      pair = i
    }
  }
  return pair !== null ? { kind: 'kokushi', pair } : null
}

/** Backtracking search for every exact partition of `counts` into `setsNeeded` sets plus
 *  (if `needPair`) one pair — mutates `counts` but restores it. Unlike shanten's search,
 *  there is no "leave this tile unused" branch: every copy must end up in some block, so a
 *  tile that can't be fully consumed by any combination simply dead-ends the branch. */
function collect(
  counts: Uint8Array,
  i: number,
  blocks: Block[],
  setsNeeded: number,
  needPair: boolean,
  results: Block[][],
): void {
  if (i >= NUM_TILE_TYPES) {
    if (setsNeeded === 0 && !needPair) results.push([...blocks])
    return
  }
  if (counts[i] === 0) {
    collect(counts, i + 1, blocks, setsNeeded, needPair, results)
    return
  }

  if (setsNeeded > 0 && counts[i] >= 3) {
    counts[i] -= 3
    blocks.push({ kind: 'triplet', tile: i })
    collect(counts, i, blocks, setsNeeded - 1, needPair, results)
    blocks.pop()
    counts[i] += 3
  }
  if (needPair && counts[i] >= 2) {
    counts[i] -= 2
    blocks.push({ kind: 'pair', tile: i })
    collect(counts, i, blocks, setsNeeded, false, results)
    blocks.pop()
    counts[i] += 2
  }
  const rank = i % 9
  const inSuit = i < HONOR
  if (setsNeeded > 0 && inSuit && rank <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--
    counts[i + 1]--
    counts[i + 2]--
    blocks.push({ kind: 'run', tile: i })
    collect(counts, i, blocks, setsNeeded - 1, needPair, results)
    blocks.pop()
    counts[i]++
    counts[i + 1]++
    counts[i + 2]++
  }
}

/** Every valid winning arrangement of a complete hand (concealed `counts` plus already-called
 *  `melds`); empty if the hand isn't actually complete. Usually one arrangement, occasionally
 *  a few for ambiguous shapes (e.g. `22334455p` reads as either two ryanmen runs+pair or
 *  ryanpeikou) — callers score every one and keep the best, same as the original app's rule. */
export function decompose(counts: Uint8Array, melds: Meld[]): Arrangement[] {
  const arrangements: Arrangement[] = []
  if (melds.length === 0) {
    const chiitoi = chiitoiArrangement(counts)
    if (chiitoi) arrangements.push(chiitoi)
    const kokushi = kokushiArrangement(counts)
    if (kokushi) arrangements.push(kokushi)
  }
  const setsNeeded = 4 - melds.length
  if (setsNeeded >= 0) {
    const meldBlocks: Block[] = melds.map((meld) => ({
      kind: meld.kind === 'chi' ? 'run' : 'triplet',
      tile: meld.kind === 'chi' ? Math.min(...meld.tiles.map((t) => t.id)) : meld.tiles[0].id,
      meld,
    }))
    const results: Block[][] = []
    collect(counts.slice(), 0, meldBlocks, setsNeeded, true, results)
    for (const blocks of results) arrangements.push({ kind: 'standard', blocks })
  }
  return arrangements
}
