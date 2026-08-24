import type { Meld, MeldKind } from '../../core/agari'
import type { ScoringSituation } from '../../core/generateHand'
import {
  HONOR,
  parseTenhou,
  serializeTenhouOrdered,
  tileCode,
  type ParsedTile,
} from '../../core/tiles'
import { validateWall, type WallError } from '../../core/wall'
import type { WinContext } from '../../core/yaku'
import { resolveSanma, WINDS, type Wind } from '../situation/urlCodec'

const MELD_KIND_CHARS: Record<MeldKind, string> = { chi: 'c', pon: 'p', minkan: 'k', ankan: 'a' }
const MELD_CHAR_KINDS: Record<string, MeldKind> = { c: 'chi', p: 'pon', k: 'minkan', a: 'ankan' }

const FLAG_KEYS = [
  'tsumo',
  'riichi',
  'doubleRiichi',
  'ippatsu',
  'haitei',
  'houtei',
  'rinshan',
  'chankan',
] as const satisfies readonly (keyof WinContext)[]

function encodeMeld(m: Meld): string {
  return MELD_KIND_CHARS[m.kind] + serializeTenhouOrdered(m.tiles)
}

function decodeMeld(s: string): Meld | null {
  const kind = MELD_CHAR_KINDS[s[0]]
  if (!kind) return null
  const tiles = parseTenhou(s.slice(1))
  return tiles.length > 0 ? { kind, tiles } : null
}

function parseWind(v: string | null): Wind {
  return v !== null && (WINDS as readonly string[]).includes(v) ? (v as Wind) : 'E'
}

export interface ScoringUrl {
  /** Explicit wall in draw order, exactly `urlCodec.ts`'s `Situation.wall` (ADR-0005): a full
   *  wall, or a short prefix `createRound` pads at random. Empty means "generate a fresh hand". */
  wall: ParsedTile[]
  /** Set when `wall` failed `validateWall` (ADR-0005) — `wall` is then empty and a generated hand
   *  takes over, same as an empty link, rather than dealing an impossible board. */
  wallError?: WallError
  /** Null means "generate from `wall` (or fresh, when `wall` is empty)"; a pinned hand always
   *  carries its own full context. */
  situation: ScoringSituation | null
  /** Rule overrides pinned by the link. A wall only reproduces the same match if the rules the
   *  match was simulated under come with it, so these travel alongside it. */
  sanma?: boolean
  aka?: boolean
}

/** A match reproduces from its wall, so a link to one needs the wall plus the rules it was
 *  played under — the receiver replays the whole hand, rivers included, from `playWall`. */
export function encodeScoringWallUrl(
  wall: ParsedTile[],
  options: { sanma: boolean; aka: boolean },
): string {
  const params = new URLSearchParams()
  params.set('wall', serializeTenhouOrdered(wall))
  params.set('sanma', options.sanma ? '1' : '0')
  params.set('aka', options.aka ? '1' : '0')
  return params.toString()
}

/** Decodes a scoring situation from the query string — the scoring trainer's analogue of
 *  `decodeSituation`, but a standalone param set (not an extension of `Situation`): river/
 *  opponents don't mean anything for a single graded hand. */
export function decodeScoringUrl(params: URLSearchParams): ScoringUrl {
  const handParam = params.get('hand')
  const flag = (name: string): boolean | undefined => {
    const value = params.get(name)
    return value === null ? undefined : value !== '0'
  }
  const sanma = flag('sanma')

  let wall = parseTenhou(params.get('wall') ?? '')
  let wallError: WallError | undefined
  // untrusted input: reject a malformed/over-counted wall by name rather than let it reach
  // playWall (ADR-0005) — see `urlCodec.decodeSituation`'s identical gate. No global setting is
  // available at this pure-codec boundary, so a partial wall with no explicit sanma flag
  // validates against yonma.
  const resolvedSanma = resolveSanma(wall, sanma, false)
  const error = validateWall(wall, resolvedSanma ? 3 : 4, resolvedSanma)
  if (error) {
    wallError = error
    wall = []
  }

  if (!handParam) {
    return {
      wall,
      wallError,
      situation: null,
      sanma,
      aka: flag('aka'),
    }
  }

  const concealed = parseTenhou(handParam)
  const melds = (params.get('melds') ?? '')
    .split('-')
    .filter(Boolean)
    .map(decodeMeld)
    .filter((m): m is Meld => m !== null)
  const winParsed = parseTenhou(params.get('win') ?? '')
  const winTile = winParsed[0]?.id ?? concealed[concealed.length - 1]?.id ?? 0
  const doraIndicators = parseTenhou(params.get('dora') ?? '').map((t) => t.id)
  const uraIndicators = parseTenhou(params.get('ura') ?? '').map((t) => t.id)
  const round = parseWind(params.get('round'))
  const seat = parseWind(params.get('seat'))
  const honba = Math.max(0, Number(params.get('honba') ?? '0') || 0)
  const kita = Math.max(0, Number(params.get('nuki') ?? '0') || 0)
  const flags = new Set((params.get('flags') ?? '').split('-'))

  const ctx: WinContext = {
    round: HONOR + WINDS.indexOf(round),
    seat: HONOR + WINDS.indexOf(seat),
    tsumo: flags.has('tsumo'),
    riichi: flags.has('riichi'),
    doubleRiichi: flags.has('doubleRiichi'),
    ippatsu: flags.has('ippatsu'),
    haitei: flags.has('haitei'),
    houtei: flags.has('houtei'),
    rinshan: flags.has('rinshan'),
    chankan: flags.has('chankan'),
    winTile,
  }

  return {
    wall,
    wallError,
    situation: { concealed, melds, ctx, doraIndicators, uraIndicators, kita, honba },
    sanma,
  }
}

/** Query string for the current hand — self-describing (no seed dependency), so it keeps
 *  reproducing the same round even if the generator's algorithm changes later. */
export function encodeScoringUrl(situation: ScoringSituation, sanma?: boolean): string {
  const params = new URLSearchParams()
  if (situation.concealed.length > 0) {
    params.set('hand', serializeTenhouOrdered(situation.concealed))
    if (situation.melds.length > 0) params.set('melds', situation.melds.map(encodeMeld).join('-'))
    params.set('win', tileCode(situation.ctx.winTile))
    if (situation.doraIndicators.length > 0) {
      params.set('dora', situation.doraIndicators.map((id) => tileCode(id)).join(''))
    }
    if (situation.uraIndicators.length > 0) {
      params.set('ura', situation.uraIndicators.map((id) => tileCode(id)).join(''))
    }
    const round = WINDS[situation.ctx.round - HONOR]
    const seat = WINDS[situation.ctx.seat - HONOR]
    if (round && round !== 'E') params.set('round', round)
    if (seat && seat !== 'E') params.set('seat', seat)
    if (situation.honba) params.set('honba', String(situation.honba))
    if (situation.kita) params.set('nuki', String(situation.kita))
    const flags = FLAG_KEYS.filter((f) => situation.ctx[f])
    if (flags.length > 0) params.set('flags', flags.join('-'))
  }
  if (sanma !== undefined) params.set('sanma', sanma ? '1' : '0')
  return params.toString()
}
