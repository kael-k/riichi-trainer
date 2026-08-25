import type { TFunction } from 'i18next'
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
