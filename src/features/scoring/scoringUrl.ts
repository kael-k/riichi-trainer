import type { Meld, MeldKind } from '../../core/agari'
import type { ScoringSituation } from '../../core/generateHand'
import { HONOR, parseTenhou, serializeTenhouOrdered, tileCode } from '../../core/tiles'
import type { WinContext } from '../../core/yaku'
import { WINDS, type Wind } from '../situation/urlCodec'

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
  seed: string
  /** Null means "generate from `seed`"; a pinned hand always carries its own full context. */
  situation: ScoringSituation | null
  /** Rule overrides pinned by the link. A seed only reproduces the same match if the rules the
   *  match was simulated under come with it, so these travel alongside it. */
  sanma?: boolean
  aka?: boolean
  calls?: boolean
  honba?: boolean
}

/** A match reproduces from its seed, so a link to one needs the seed plus the rules it was
 *  played under — no tiles at all, and the receiver replays the whole hand, rivers included. */
export function encodeScoringSeedUrl(
  seed: string,
  options: { sanma: boolean; aka: boolean; openHands: boolean; honba: boolean },
): string {
  const params = new URLSearchParams()
  params.set('seed', seed)
  params.set('sanma', options.sanma ? '1' : '0')
  params.set('aka', options.aka ? '1' : '0')
  params.set('calls', options.openHands ? '1' : '0')
  // not `honba`: on a pinned-hand link that param carries the actual honba count, and the two
  // meanings must not share a name
  params.set('honbaOn', options.honba ? '1' : '0')
  return params.toString()
}

/** Decodes a scoring situation from the query string — the scoring trainer's analogue of
 *  `decodeSituation`, but a standalone param set (not an extension of `Situation`): wall/
 *  river/opponents don't mean anything for a single graded hand. */
export function decodeScoringUrl(params: URLSearchParams): ScoringUrl {
  const seed = params.get('seed') ?? ''
  const handParam = params.get('hand')
  const flag = (name: string): boolean | undefined => {
    const value = params.get(name)
    return value === null ? undefined : value !== '0'
  }
  const sanma = flag('sanma')
  if (!handParam) {
    return {
      seed,
      situation: null,
      sanma,
      aka: flag('aka'),
      calls: flag('calls'),
      honba: flag('honbaOn'),
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
  const honba = Number(params.get('honba') ?? '0') || 0
  const kita = Number(params.get('nuki') ?? '0') || 0
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
    seed,
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
