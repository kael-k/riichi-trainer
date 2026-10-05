import { decompose, type Block } from './agari'
import { NUM_TILE_TYPES, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

/** How the winning tile completes the hand: the three taatsu (two-tile run partials), a pair that
 *  becomes a triplet, a lone tile that becomes the pair, and the two non-standard forms. */
export type WaitShape =
  'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki' | 'chiitoitsu' | 'kokushi'

/** One block of the 13-tile hand. `wait` is the part the winning tile completes — a taatsu for a
 *  ryanmen/kanchan/penchan, a pair for a shanpon, a lone tile for a tanki — and never a complete
 *  set, which is why it is a role of its own rather than a `mentsu` or a `toitsu`. */
export interface WaitBlock {
  role: 'mentsu' | 'toitsu' | 'wait'
  tiles: TileId[]
}

/** One way of reading the 13 tiles as waiting on a given tile. `blocks` holds every tile exactly
 *  once, mentsu first, then the pair(s), then the waiting part — each group ascending. */
export interface WaitReading {
  shape: WaitShape
  blocks: WaitBlock[]
}

export interface HandWait {
  tile: TileId
  /** Every distinct reading — at least one. A chinitsu wait often has several, and seeing them
   *  side by side is the whole lesson. */
  readings: WaitReading[]
}

function blockTiles(block: Block): TileId[] {
  if (block.kind === 'run') return [block.tile, block.tile + 1, block.tile + 2]
  if (block.kind === 'triplet') return [block.tile, block.tile, block.tile]
  return [block.tile, block.tile]
}

/** The shape a run leaves when `win` is taken back out of it. `win` is always one of its three. */
function runShape(low: TileId, win: TileId): WaitShape {
  if (win === low + 1) return 'kanchan'
  // the edge the remaining two tiles sit against: 12 waiting on 3, or 89 waiting on 7
  if (win === low + 2) return low % 9 === 0 ? 'penchan' : 'ryanmen'
  return (low + 2) % 9 === 8 ? 'penchan' : 'ryanmen'
}

function readingKey(reading: WaitReading): string {
  return `${reading.shape}|${reading.blocks.map((b) => `${b.role}:${b.tiles.join(',')}`).join('|')}`
}

/** Mentsu ascending, then toitsu ascending, then the waiting part — the order the issue's
 *  "mentsu, toitsu and taatsu" reads in, and the one a reader scans for the odd block out. */
function ordered(blocks: WaitBlock[]): WaitBlock[] {
  const rank = { mentsu: 0, toitsu: 1, wait: 2 }
  // a triplet and a run can share their lowest tile (111 beside 123): the second tile breaks it,
  // so the order is total and two equal readings always serialise to the same key
  return [...blocks].sort(
    (a, b) =>
      rank[a.role] - rank[b.role] ||
      a.tiles[0] - b.tiles[0] ||
      (a.tiles[1] ?? -1) - (b.tiles[1] ?? -1),
  )
}

/** Every reading of a 14-tile winning arrangement as "13 tiles waiting on `win`": one per block
 *  `win` could have been the last tile of. */
function readingsOf(counts: Uint8Array, win: TileId): WaitReading[] {
  const readings: WaitReading[] = []
  for (const arrangement of decompose(counts, [])) {
    if (arrangement.kind === 'kokushi') {
      const tiles: TileId[] = []
      for (let id = 0; id < NUM_TILE_TYPES; id++) {
        for (let k = 0; k < counts[id]; k++) tiles.push(id)
      }
      tiles.splice(tiles.indexOf(win), 1)
      readings.push({ shape: 'kokushi', blocks: [{ role: 'wait', tiles }] })
      continue
    }
    if (arrangement.kind === 'chiitoi') {
      readings.push({
        shape: 'chiitoitsu',
        blocks: [
          ...arrangement.pairs
            .filter((id) => id !== win)
            .map<WaitBlock>((id) => ({ role: 'toitsu', tiles: [id, id] })),
          { role: 'wait', tiles: [win] },
        ],
      })
      continue
    }
    arrangement.blocks.forEach((block, i) => {
      const tiles = blockTiles(block)
      if (!tiles.includes(win)) return
      const rest = arrangement.blocks
        .filter((_, j) => j !== i)
        .map<WaitBlock>((b) => ({
          role: b.kind === 'pair' ? 'toitsu' : 'mentsu',
          tiles: blockTiles(b),
        }))
      const waiting = [...tiles]
      waiting.splice(waiting.indexOf(win), 1)
      const shape: WaitShape =
        block.kind === 'pair'
          ? 'tanki'
          : block.kind === 'triplet'
            ? 'shanpon'
            : runShape(block.tile, win)
      readings.push({ shape, blocks: ordered([...rest, { role: 'wait', tiles: waiting }]) })
    })
  }
  const seen = new Set<string>()
  return readings.filter((reading) => {
    const key = readingKey(reading)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Every tile that completes this closed 13-tile hand, each with every way the hand reads as
 * waiting on it. Empty when the hand is not tenpai.
 *
 * A tile the hand already holds all four copies of is **not** a wait, even where it completes the
 * shape: it can never be drawn or discarded. That is the same rule `ukeire.ts#improvingTiles` (and
 * so `policy.ts#waits`) applies, and this function is cross-checked against it.
 */
export function readWaits(counts: Uint8Array): HandWait[] {
  const probe = counts.slice()
  const result: HandWait[] = []
  for (let tile = 0; tile < NUM_TILE_TYPES; tile++) {
    if (probe[tile] >= TILES_PER_KIND) continue
    probe[tile]++
    const readings = readingsOf(probe, tile)
    probe[tile]--
    if (readings.length > 0) result.push({ tile, readings })
  }
  return result
}

/** Tiles that complete the hand's shape but are already all in it — karaten. `readWaits` drops
 *  them; a generator that wants to pose only honest waits rejects a hand that has any. */
export function karatenTiles(counts: Uint8Array): TileId[] {
  const probe = counts.slice()
  const result: TileId[] = []
  for (let tile = 0; tile < NUM_TILE_TYPES; tile++) {
    if (probe[tile] < TILES_PER_KIND) continue
    probe[tile]++
    if (decompose(probe, []).length > 0) result.push(tile)
    probe[tile]--
  }
  return result
}
