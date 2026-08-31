import { addTile, createHand, type Hand } from './hand'
import { mulberry32, shuffle } from './rng'
import {
  HONOR,
  inTileSet,
  MAN,
  NUM_TILE_TYPES,
  PIN,
  SOU,
  type ParsedTile,
  type TileId,
} from './tiles'

export const TILES_PER_KIND = 4
export const DEAD_WALL_SIZE = 14
export const INITIAL_HAND_SIZE = 13

/** Full wall in draw order, deterministically shuffled from `seed`: 136 tiles (34 kinds),
 *  or 108 (27 kinds) with `sanma` — 2m-8m never enter the wall. */
export function buildWall(seed: string, sanma = false): TileId[] {
  const tiles: TileId[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (!inTileSet(id, sanma)) continue
    for (let copy = 0; copy < TILES_PER_KIND; copy++) tiles.push(id)
  }
  return shuffle(tiles, mulberry32(seed))
}

/** Deals a hand off the front of a seeded wall — the shanten trainer's whole round. Rounds that
 *  keep drawing (the efficiency trainer) build their own wall split from `buildWall`. */
export function deal(seed: string, handSize = INITIAL_HAND_SIZE, sanma = false): Hand {
  const wall = buildWall(seed, sanma)
  const hand = createHand()
  for (let i = 0; i < handSize; i++) addTile(hand, wall[i])
  return hand
}

/** Kinds that carry a red five under this ruleset — sanma has no 5m at all. */
export function redFiveIds(sanma: boolean): TileId[] {
  return sanma ? [PIN + 4, SOU + 4] : [MAN + 4, PIN + 4, SOU + 4]
}

/** Tile count of a complete wall: 136 (34 kinds) yonma, 108 (27 kinds) sanma. */
export function fullWallSize(sanma: boolean): number {
  let kinds = 0
  for (let id = 0; id < NUM_TILE_TYPES; id++) if (inTileSet(id, sanma)) kinds++
  return kinds * TILES_PER_KIND
}

/** Completes a wall `prefix` to `fullWallSize(sanma)` tiles: `prefix` verbatim, then a remainder
 *  drawn from a random (or `seed`-built, for reproducible tests/random-fallback generation) wall
 *  with `prefix`'s own copies already filtered out — the "used" idiom `createRound` used to apply
 *  to its pinned prefix, generalized to the whole wall. When `aka` is on, one red copy per suit not
 *  already named red by `prefix` is marked into the remainder; when it's off the remainder carries
 *  no red of its own (a red already inside `prefix` is left exactly as given — the link said so). */
export function completeWall(
  prefix: ParsedTile[],
  sanma: boolean,
  aka: boolean,
  seed?: string,
): ParsedTile[] {
  const used = new Uint8Array(NUM_TILE_TYPES)
  const prefixReds = new Set<TileId>()
  for (const t of prefix) {
    used[t.id]++
    if (t.red) prefixReds.add(t.id)
  }

  const remainder: ParsedTile[] = buildWall(seed ?? String(Math.random()), sanma)
    .filter((id) => {
      if (used[id] === 0) return true
      used[id]--
      return false
    })
    .map((id) => ({ id, red: false }))

  if (aka) {
    for (const redId of redFiveIds(sanma)) {
      if (prefixReds.has(redId)) continue
      const i = remainder.findIndex((t) => t.id === redId)
      if (i >= 0) remainder[i] = { id: redId, red: true }
    }
  }

  return [...prefix, ...remainder]
}

/** A rejected wall, naming where the fault sits and never repaired into a playable one:
 *  `zone` is which part of the wall the offending tile sits in, `seat` is set only for
 *  `zone: 'hand'`, and `tile` is unset only for a `'length'` fault, which has no single tile. */
export interface WallError {
  zone: 'hand' | 'wall' | 'deadWall'
  seat?: number
  tile?: TileId
  reason: 'length' | 'copies' | 'red' | 'tileSet'
}

/** How a deal comes off the wall: three rounds of four tiles per seat, then one apiece — what a
 *  live table does, rather than four solid blocks of thirteen. Sums to `INITIAL_HAND_SIZE`.
 *  Seats are served in index order, which is wind order whenever the dealer is seat 0 (every board
 *  this app builds today); keeping the dealer out of it is what lets `dealtSeat` map a wall index
 *  back to a seat without a `MatchState`. */
export const DEAL_CHUNKS = [4, 4, 4, 1]

/** Which seat the `index`-th tile of a wall was dealt to, `-1` once the deal is over. */
export function dealtSeat(index: number, players: number): number {
  let i = index
  for (const size of DEAL_CHUNKS) {
    const chunkRound = size * players
    if (i < chunkRound) return Math.floor(i / size)
    i -= chunkRound
  }
  return -1
}

/** The wall indices one seat's starting hand occupies, in dealing order — `dealtSeat` inverted,
 *  for the two places that build a wall around a known hand rather than reading one. */
export function dealtIndices(seat: number, players: number): number[] {
  const out: number[] = []
  let cut = 0
  for (const size of DEAL_CHUNKS) {
    for (let s = 0; s < players; s++, cut += size) {
      if (s === seat) for (let i = 0; i < size; i++) out.push(cut + i)
    }
  }
  return out
}

function zoneAt(
  index: number,
  length: number,
  players: number,
  sanma: boolean,
): { zone: WallError['zone']; seat?: number } {
  const handSize = players * INITIAL_HAND_SIZE
  if (index < handSize) return { zone: 'hand', seat: dealtSeat(index, players) }
  // "trailing 14 of a full wall" only applies once the wall actually reaches its full length —
  // a short/partial wall has no dead wall yet, positionally
  if (length >= fullWallSize(sanma) && index >= length - DEAD_WALL_SIZE) return { zone: 'deadWall' }
  return { zone: 'wall' }
}

/** Untrusted-input gate for a `wall=` link: length within bounds, no kind exceeding four
 *  copies (exactly four once the wall reaches full length), at most one red per suit, no 2m-8m
 *  under sanma. Returns the first fault found, naming its zone and tile — never mutates `tiles`
 *  and never returns a repaired wall, since a repaired wall is a different board than the one the
 *  link claimed to share. `null` means `tiles` is a valid full wall or a valid short prefix. */
export function validateWall(
  tiles: ParsedTile[],
  players: number,
  sanma: boolean,
): WallError | null {
  const max = fullWallSize(sanma)
  if (tiles.length > max) return { zone: 'wall', reason: 'length' }

  const counts = new Uint8Array(NUM_TILE_TYPES)
  const redSeen = new Set<TileId>()
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    const { zone, seat } = zoneAt(i, tiles.length, players, sanma)
    if (!inTileSet(tile.id, sanma)) return { zone, seat, tile: tile.id, reason: 'tileSet' }
    if (tile.red) {
      const isFive = tile.id % 9 === 4 && tile.id < HONOR
      if (!isFive || redSeen.has(tile.id)) return { zone, seat, tile: tile.id, reason: 'red' }
      redSeen.add(tile.id)
    }
    counts[tile.id]++
    if (counts[tile.id] > TILES_PER_KIND) return { zone, seat, tile: tile.id, reason: 'copies' }
  }

  if (tiles.length === max) {
    for (let id = 0; id < NUM_TILE_TYPES; id++) {
      if (inTileSet(id, sanma) && counts[id] !== TILES_PER_KIND) {
        return { zone: 'wall', tile: id, reason: 'copies' }
      }
    }
  }

  return null
}

/** A wall dealing the named seats exactly these hands: a random (or `seed`-built) full wall with
 *  their copies removed, then each hand laid into the slots that seat is actually dealt
 *  (`dealtIndices`, 4/4/4+1 — no seat's thirteen sit in one block any more, so a wall pinning two
 *  seats cannot be built by concatenating them). `hands` is seat-indexed and may skip a seat with
 *  `undefined`; `players` decides where the slots fall, so a solo round (one seat) has to say so. */
export function wallWithHands(
  hands: readonly (ParsedTile[] | undefined)[],
  sanma: boolean,
  aka: boolean,
  seed?: string,
  players = sanma ? 3 : 4,
): ParsedTile[] {
  // routed through `completeWall` itself rather than filtering padding by id: it already strips
  // a prefix's own copies before marking red among the survivors and already skips a suit whose
  // red sits inside the prefix (`prefixReds`) — filtering by id alone let a plain five in a pinned
  // hand strip the padding's *red* copy instead of a plain one
  const pinnedTiles = hands.flatMap((hand) => hand ?? [])
  const padding = completeWall(pinnedTiles, sanma, aka, seed).slice(pinnedTiles.length)
  const pinned = new Map<number, ParsedTile>()
  hands.forEach((hand, seat) => {
    const slots = dealtIndices(seat, players)
    hand?.forEach((tile, i) => pinned.set(slots[i], tile))
  })
  let filler = 0
  return Array.from(
    { length: padding.length + pinned.size },
    (_, i) => pinned.get(i) ?? padding[filler++],
  )
}

/** One seat's starting hand pinned. What a link pinning a hand encodes, and what the lab's
 *  hand-authoring surface builds its walls with. */
export function wallWithHand(
  seat: number,
  hand: ParsedTile[],
  sanma: boolean,
  aka: boolean,
  seed?: string,
  players = sanma ? 3 : 4,
): ParsedTile[] {
  const hands = Array<ParsedTile[] | undefined>(seat + 1).fill(undefined)
  hands[seat] = hand
  return wallWithHands(hands, sanma, aka, seed, players)
}
