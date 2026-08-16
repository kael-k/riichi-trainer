import type { LogEntry } from './match'
import { parseTenhou, tileCode, type TileId } from './tiles'

/**
 * String codec for `MatchState.log` — the format a shared link carries (`log=` param,
 * `urlCodec.ts`/`useFoldingRound.ts`). One short, self-delimiting token per entry, concatenated
 * with no separator: an uppercase kind letter that never appears anywhere else in the alphabet
 * this format uses (tile codes are a digit plus a lowercase suit letter, `tileCode`/`parseTenhou`
 * — the exact machinery every other tile-bearing param already uses, not reinvented here), so a
 * decoder can always tell where the next token starts. Built for density, not readability — the
 * parent plan's own budget (~250 chars for ~70 events) is the bar this is tuned against.
 *
 * Grammar, one line per `LogEntry.kind`:
 * - `discard`: `D` seat tileCode [`T`] [`R`] — `T`/`R` are `fromDrawn`/`riichi`, each present or not.
 * - `call`: `C` seat from kind(`P`|`H` for pon/chi) tileCode tileCode — `call.from`'s two tiles,
 *   always exactly two (a pon's own two matching copies, a chi's two adjacent kinds) — `Call`
 *   (`policy.ts`) carries no redness, so neither does this.
 * - `kita`: `K` seat.
 * - `ankan`: `A` seat tileCode.
 * - `win`: `W` seat (from | `T` for tsumo).
 */

const CALL_KIND_CHARS: Record<'pon' | 'chi', string> = { pon: 'P', chi: 'H' }
const CALL_CHAR_KINDS: Record<string, 'pon' | 'chi'> = { P: 'pon', H: 'chi' }

function encodeEntry(entry: LogEntry): string {
  switch (entry.kind) {
    case 'discard': {
      const flags = (entry.fromDrawn ? 'T' : '') + (entry.riichi ? 'R' : '')
      return `D${entry.seat}${tileCode(entry.tile.id, entry.tile.red)}${flags}`
    }
    case 'call': {
      const [a, b] = entry.call.from
      return `C${entry.seat}${entry.from}${CALL_KIND_CHARS[entry.call.kind]}${tileCode(a)}${tileCode(b)}`
    }
    case 'kita':
      return `K${entry.seat}`
    case 'ankan':
      return `A${entry.seat}${tileCode(entry.tile)}`
    case 'win':
      return `W${entry.seat}${entry.from ?? 'T'}`
  }
}

export function encodeLog(log: readonly LogEntry[]): string {
  return log.map(encodeEntry).join('')
}

/** A single digit character as a seat index, or `undefined` if `s[i]` isn't one — the boundary
 *  check every fixed-width field below shares. */
function digitAt(s: string, i: number): number | undefined {
  const ch = s[i]
  return ch >= '0' && ch <= '9' ? Number(ch) : undefined
}

/** The two-character tile token at `s[i..i+2)`, or `undefined` if it doesn't decode to exactly
 *  one tile — reuses `parseTenhou` rather than hand-rolling a second tile parser. */
function tileAt(s: string, i: number): TileId | undefined {
  const tiles = parseTenhou(s.slice(i, i + 2))
  return tiles.length === 1 ? tiles[0].id : undefined
}

/**
 * Decodes `encodeLog`'s output. Untrusted input (a hand-edited or truncated URL): degrades the way
 * `parseTenhou` already does for a bad tile digit — stops at the first token it can't fully read,
 * returning everything decoded so far, rather than throwing. `replayLog` (`match.ts`) is what
 * actually enforces legality against a live hand; this layer only has to agree on *shape*.
 */
export function decodeLog(s: string): LogEntry[] {
  const log: LogEntry[] = []
  let i = 0
  while (i < s.length) {
    const kind = s[i]
    if (kind === 'D') {
      const seat = digitAt(s, i + 1)
      const id = tileAt(s, i + 2)
      if (seat === undefined || id === undefined) break
      const red = s[i + 2] === '0'
      let j = i + 4
      let fromDrawn = false
      let riichi = false
      if (s[j] === 'T') {
        fromDrawn = true
        j++
      }
      if (s[j] === 'R') {
        riichi = true
        j++
      }
      log.push({ kind: 'discard', seat, tile: { id, red }, fromDrawn, riichi })
      i = j
    } else if (kind === 'C') {
      const seat = digitAt(s, i + 1)
      const from = digitAt(s, i + 2)
      const callKind = CALL_CHAR_KINDS[s[i + 3]]
      const a = tileAt(s, i + 4)
      const b = tileAt(s, i + 6)
      if (
        seat === undefined ||
        from === undefined ||
        !callKind ||
        a === undefined ||
        b === undefined
      ) {
        break
      }
      log.push({ kind: 'call', seat, from, call: { kind: callKind, from: [a, b] } })
      i += 8
    } else if (kind === 'K') {
      const seat = digitAt(s, i + 1)
      if (seat === undefined) break
      log.push({ kind: 'kita', seat })
      i += 2
    } else if (kind === 'A') {
      const seat = digitAt(s, i + 1)
      const tile = tileAt(s, i + 2)
      if (seat === undefined || tile === undefined) break
      log.push({ kind: 'ankan', seat, tile })
      i += 4
    } else if (kind === 'W') {
      const seat = digitAt(s, i + 1)
      if (seat === undefined) break
      const fromChar = s[i + 2]
      const from = fromChar === 'T' ? undefined : digitAt(s, i + 2)
      if (fromChar !== 'T' && from === undefined) break
      log.push({ kind: 'win', seat, from })
      i += 3
    } else {
      break
    }
  }
  return log
}
