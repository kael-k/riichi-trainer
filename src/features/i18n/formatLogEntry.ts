import type { TFunction } from 'i18next'
import { parseTenhou, type ParsedTile } from '../../core/tiles'
import { formatElapsedMs } from '../../lib/formatElapsed'
import type { LogDetail, LogEntry } from '../../store/log'
import { WINDS } from '../situation/urlCodec'

interface ShantenResultParams {
  hand: number
  guess: number
  actual: number
  paths: string[]
  correct: boolean
  elapsedMs: number
}

interface ScoringResultParams {
  hand: number
  han: number
  correct: boolean
  elapsedMs: number
}

interface FoldingDiscardParams {
  turn: number
  tile: string
  tier: string
  best: string
  bestTier: string
  correct: boolean
}

/** What ended a round, in exactly the shape both the log row (`log.match.result`) and the
 *  match drill's own round-end card need — `formatMatchResult` below is the one place that turns
 *  it into a sentence, so the two never read a settlement differently. */
export interface MatchResultParams {
  roundWind: string
  roundNumber: number
  honba: number
  kind: 'win' | 'exhaustive' | 'abort'
  seat?: number
  from?: number
}

/** "East 1: South wins off West" / "East 1 · 2: North tsumo" / "East 1: exhaustive draw" /
 *  "East 1: hand abandoned" — shared by the log panel's own row and `MatchPage`'s round-end card,
 *  so the wording can only ever say one thing about a settled round. */
export function formatMatchResult(t: TFunction, p: MatchResultParams): string {
  const round = t(p.honba > 0 ? 'table.roundLineRepeat' : 'table.roundLine', {
    wind: t(`windFull.${p.roundWind}`),
    number: p.roundNumber,
    repeat: p.honba,
  })
  if (p.kind === 'win' && p.seat !== undefined) {
    return p.from === undefined
      ? t('log.match.tsumo', { round, wind: t(`wind.${WINDS[p.seat]}`) })
      : t('log.match.ron', {
          round,
          winner: t(`wind.${WINDS[p.seat]}`),
          loser: t(`wind.${WINDS[p.from]}`),
        })
  }
  return t(p.kind === 'exhaustive' ? 'log.match.exhaustive' : 'log.match.abort', { round })
}

/** Keys carrying a `shanten` param (every efficiency discard/kita/kan outcome) get a trailing
 *  clause naming the resulting shanten — composed here rather than baked in at log time, so a
 *  language switch re-translates the whole line. */
const EFFICIENCY_SHANTEN_KEYS = new Set([
  'log.efficiency.discardBest',
  'log.efficiency.discardBestDrew',
  'log.efficiency.discardMistake',
  'log.efficiency.discardMistakeDrew',
  'log.efficiency.kitaBest',
  'log.efficiency.kitaMistake',
  'log.efficiency.kanBest',
  'log.efficiency.kanMistake',
])

/** Most log entries are a direct t(key, params). The shanten result entry composes two
 *  optional trailing clauses (path names, elapsed time) from raw data at render time, so
 *  switching language re-translates the whole line instead of leaving stale fragments
 *  from whatever language was active when the entry was logged. */
export function formatLogEntry(entry: LogEntry, t: TFunction): string {
  if (entry.key === 'log.shanten.result') {
    const { hand, guess, actual, paths, correct, elapsedMs } =
      entry.params as unknown as ShantenResultParams
    const showPaths = !(paths.length === 1 && paths[0] === 'standard')
    const via = showPaths
      ? ` ${t('shanten.via', { paths: paths.map((p) => t(`shanten.path.${p}`)).join(' / ') })}`
      : ''
    const time = ` ${t('shanten.inTime', { time: formatElapsedMs(elapsedMs) })}`
    return t('log.shanten.result', {
      hand,
      guess,
      actual,
      via,
      result: t(correct ? 'shanten.correct' : 'shanten.wrong'),
      time,
    })
  }
  if (entry.key === 'log.scoring.result') {
    const { hand, han, correct, elapsedMs } = entry.params as unknown as ScoringResultParams
    const time = ` ${t('scoring.inTime', { time: formatElapsedMs(elapsedMs) })}`
    return t('log.scoring.result', {
      hand,
      han,
      result: t(correct ? 'scoring.correct' : 'scoring.wrong'),
      time,
    })
  }
  if (entry.key === 'log.folding.discard') {
    const { turn, tile, tier, best, bestTier, correct } =
      entry.params as unknown as FoldingDiscardParams
    // the tier names are translated here rather than baked in at log time, so switching language
    // re-reads the whole line — same reason the shanten entry composes its clauses at render
    return t(correct ? 'log.folding.safe' : 'log.folding.risky', {
      turn,
      tile,
      tier: t(`folding.tier.${tier}`),
      best,
      bestTier: t(`folding.tier.${bestTier}`),
    })
  }
  if (entry.key === 'log.folding.dealIn') {
    const { seat, points, tile } = entry.params as unknown as {
      seat: number
      points: number
      tile: string
    }
    return t('log.folding.dealIn', { wind: t(`wind.${WINDS[seat]}`), points, tile })
  }
  // same shape as `log.folding.dealIn` above: the seat is logged as a raw number and the wind
  // name is resolved here, so a language switch re-translates it
  if (entry.key === 'log.lab.abort') {
    const { turn, seat } = entry.params as unknown as { turn: number; seat: number }
    return t('log.lab.abort', { turn, wind: t(`wind.${WINDS[seat]}`) })
  }
  if (entry.key === 'log.match.result') {
    return formatMatchResult(t, entry.params as unknown as MatchResultParams)
  }
  // the match's own action log: every seat's turn, not just the reader's, so the wind is resolved
  // here from a raw seat number the same way `log.lab.abort` already does
  if (entry.key === 'log.match.discard') {
    const { turn, seat, tile } = entry.params as unknown as {
      turn: number
      seat: number
      tile: string
    }
    return t('log.match.discard', { turn, wind: t(`wind.${WINDS[seat]}`), tile })
  }
  if (entry.key === 'log.match.riichi') {
    const { seat } = entry.params as unknown as { seat: number }
    return t('log.match.riichi', { wind: t(`wind.${WINDS[seat]}`) })
  }
  if (entry.key === 'log.match.call') {
    const { seat, from, kind } = entry.params as unknown as {
      seat: number
      from: number
      kind: 'pon' | 'chi' | 'minkan'
    }
    return t('log.match.call', {
      wind: t(`wind.${WINDS[seat]}`),
      from: t(`wind.${WINDS[from]}`),
      kind: t(`seats.claim.${kind}`),
    })
  }
  if (entry.key === 'log.match.kita') {
    const { seat } = entry.params as unknown as { seat: number }
    return t('log.match.kita', { wind: t(`wind.${WINDS[seat]}`) })
  }
  if (entry.key === 'log.match.kan') {
    const { seat, tile } = entry.params as unknown as { seat: number; tile: string }
    return t('log.match.kan', { wind: t(`wind.${WINDS[seat]}`), tile })
  }
  if (EFFICIENCY_SHANTEN_KEYS.has(entry.key)) {
    const shanten = (entry.params as { shanten?: number } | undefined)?.shanten
    const shantenSuffix =
      shanten !== undefined ? ` ${t('log.efficiency.shanten', { count: shanten })}` : ''
    return t(entry.key, { ...entry.params, shantenSuffix })
  }
  return t(entry.key, entry.params)
}

/** One expanded-row detail line. Same idea as `formatLogEntry`'s own special cases — the one
 *  key that needs render-time composition (the wind name, looked up from a raw seat number) gets
 *  its own branch, everything else is a plain `t(key, params)`. `termName` resolves a scoring
 *  yaku/yakuman name through the `translatedTerms` setting, the same as `ScoreBreakdown` used to —
 *  passed in rather than read from the store here, so a setting flip re-renders the row. */
export function formatLogDetail(
  detail: LogDetail,
  t: TFunction,
  termName: (group: 'yaku' | 'yakuman' | 'flags', name: string) => string,
): string {
  // "Your 9m — non-suji" / "Safest 1m vs East — genbutsu": the subject is in the key, the tier is
  // translated here (not baked in at log time) and the threat's wind is an optional clause,
  // composed the same way `formatLogEntry` composes its own — only present with more than one
  // threat to tell apart
  if (detail.key === 'log.folding.yourTile' || detail.key === 'log.folding.safestTile') {
    const { seat, tier } = detail.params as unknown as { seat?: number; tier: string }
    const vs = seat === undefined ? '' : t('log.folding.vs', { wind: t(`wind.${WINDS[seat]}`) })
    return t(detail.key, { vs, tier: t(`folding.tier.${tier}`) })
  }
  if (detail.key === 'log.match.delta') {
    const { seat, amount } = detail.params as unknown as { seat: number; amount: string }
    return t('log.match.delta', { wind: t(`wind.${WINDS[seat]}`), amount })
  }
  if (detail.key === 'log.scoring.field') {
    const { labelKey, expected, answer } = detail.params as unknown as {
      labelKey: string
      expected: number
      answer?: number
    }
    const label = t(labelKey)
    return answer === undefined
      ? t('log.scoring.field', { label, expected })
      : t('log.scoring.fieldWrong', { label, expected, answer })
  }
  if (detail.key === 'log.scoring.limit') {
    const { limit } = detail.params as unknown as { limit: string }
    return t(`scoring.limit.${limit}`)
  }
  if (detail.key === 'log.scoring.detailLine') {
    const { group, name, labelKey, valueKey, count } = detail.params as unknown as {
      group?: 'yaku' | 'yakuman'
      name?: string
      labelKey?: string
      valueKey: string
      count?: number
    }
    const label = group && name !== undefined ? termName(group, name) : t(labelKey!)
    const value = count === undefined ? t(valueKey) : t(valueKey, { count })
    return t('log.scoring.detailLine', { label, value })
  }
  return t(detail.key, detail.params)
}

/** A tile named inside an already-formatted sentence: a suited digit (`0m`/`0p`/`0s` being the red
 *  five) or an honour, which only ever run `1z`–`7z`. Nothing else in this prose reads as one —
 *  the numbers it carries (turn, ukeire, points, a clock's `0:02.345`) are never followed straight
 *  by a suit letter, and no locale string contains the shape either. */
const TILE_CODE = /\b(0[mps]|[1-9][mps]|[1-7]z)\b/

/** Splits a formatted sentence into its prose and the tiles it names, so the log can draw them
 *  rather than leave `0p` and `4z` on screen — expert shorthand a beginner cannot read
 *  ([ADR-0018](../../../docs/adr/0018-beginner-defaults-advanced-depth.md)).
 *
 *  Tokenizing the finished sentence rather than giving `LogEntry` tile slots is deliberate: the
 *  codes are unambiguous, and slots would touch every log call site and every special case above
 *  for no rendering gain. It is locale-independent for the same reason — every translation
 *  receives its codes through the same params, so all four are fixed without touching the JSON. */
export function splitTileCodes(text: string): (string | ParsedTile)[] {
  // one capture group, so `split` alternates prose, code, prose, code…; the pattern guarantees
  // `parseTenhou` finds exactly one tile in a code
  return text
    .split(TILE_CODE)
    .flatMap<string | ParsedTile>((part, i) =>
      i % 2 === 0 ? (part ? [part] : []) : parseTenhou(part),
    )
}
