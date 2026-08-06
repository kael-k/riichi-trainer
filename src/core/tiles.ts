export const NUM_TILE_TYPES = 34

export const MAN = 0
export const PIN = 9
export const SOU = 18
export const HONOR = 27

export type TileId = number // 0-33

export interface ParsedTile {
  id: TileId
  red: boolean
}

const SUIT_OFFSET: Record<string, number> = { m: MAN, p: PIN, s: SOU }

export function isTerminal(id: TileId): boolean {
  return id < HONOR && (id % 9 === 0 || id % 9 === 8)
}

export function isTerminalOrHonor(id: TileId): boolean {
  return id >= HONOR || id % 9 === 0 || id % 9 === 8
}

/** Sanma (three-player) drops 2m-8m from the tile set; everything else is unchanged. */
export function inTileSet(id: TileId, sanma: boolean): boolean {
  return !sanma || id < MAN + 1 || id > MAN + 7
}

export function suitOf(id: TileId): 'm' | 'p' | 's' | 'z' {
  if (id < PIN) return 'm'
  if (id < SOU) return 'p'
  if (id < HONOR) return 's'
  return 'z'
}

/** Parses tenhou notation, e.g. "123m456p789s11z", "0" = red five. */
export function parseTenhou(input: string): ParsedTile[] {
  const tiles: ParsedTile[] = []
  let digits = ''
  for (const ch of input) {
    if (ch >= '0' && ch <= '9') {
      digits += ch
      continue
    }
    if (ch === 'm' || ch === 'p' || ch === 's') {
      const offset = SUIT_OFFSET[ch]
      for (const d of digits) {
        const n = Number(d)
        if (n === 0) tiles.push({ id: offset + 4, red: true })
        else tiles.push({ id: offset + (n - 1), red: false })
      }
      digits = ''
    } else if (ch === 'z') {
      for (const d of digits) {
        const n = Number(d)
        tiles.push({ id: HONOR + (n - 1), red: false })
      }
      digits = ''
    }
    // any other character (whitespace, separators) resets pending digits silently
  }
  return tiles
}

/** Serializes tiles to tenhou notation, grouped by suit, ascending rank, red five as "0". */
export function serializeTenhou(tiles: ParsedTile[]): string {
  const groups: Record<'m' | 'p' | 's' | 'z', ParsedTile[]> = {
    m: [],
    p: [],
    s: [],
    z: [],
  }
  for (const tile of tiles) groups[suitOf(tile.id)].push(tile)

  let out = ''
  for (const suit of ['m', 'p', 's'] as const) {
    const group = groups[suit]
    if (group.length === 0) continue
    group.sort((a, b) => a.id - b.id)
    out += group.map((t) => (t.red ? '0' : String((t.id % 9) + 1))).join('') + suit
  }
  const honors = groups.z
  if (honors.length > 0) {
    honors.sort((a, b) => a.id - b.id)
    out += honors.map((t) => String(t.id - HONOR + 1)).join('') + 'z'
  }
  return out
}

/** Tenhou code for one tile, e.g. "3m", "7z", "0p" for a red five. */
export function tileCode(id: TileId, red = false): string {
  return serializeTenhou([{ id, red }])
}

/**
 * Serializes tiles to tenhou notation preserving the given order (adjacent
 * same-suit tiles share one suit letter). Use for walls/rivers where draw or
 * discard order matters; `serializeTenhou` sorts and is for hands/display.
 */
export function serializeTenhouOrdered(tiles: ParsedTile[]): string {
  let out = ''
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    const suit = suitOf(tile.id)
    out += tile.red ? '0' : String(suit === 'z' ? tile.id - HONOR + 1 : (tile.id % 9) + 1)
    if (i === tiles.length - 1 || suitOf(tiles[i + 1].id) !== suit) out += suit
  }
  return out
}

// prettier-ignore
const TILE_NAMES = [
  '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m',
  '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p',
  '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s',
  'E', 'S', 'W', 'N', 'haku', 'hatsu', 'chun',
]

export function tileName(id: TileId): string {
  return TILE_NAMES[id]
}

const HONOR_LABELS = ['E', 'S', 'W', 'N', 'Wh', 'G', 'R']

/**
 * Short corner label for the tile overlay: the rank alone for suited tiles
 * (`0` for a red five), wind letters and dragon initials (white/green/red) for
 * honors. Deliberately not tenhou notation — the suit is already the artwork.
 */
export function tileLabel(id: TileId, red = false): string {
  if (id >= HONOR) return HONOR_LABELS[id - HONOR]
  return red ? '0' : String((id % 9) + 1)
}
