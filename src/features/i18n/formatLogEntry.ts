import type { TFunction } from 'i18next'
import { formatElapsedMs } from '../../lib/formatElapsed'
import type { LogEntry } from '../../store/log'
import { WINDS } from '../situation/urlCodec'

interface ShantenResultParams {
  hand: number
  guess: number
  actual: number
  paths: string[]
  correct: boolean
  timerEnabled: boolean
  elapsedMs: number
}

interface ScoringResultParams {
  hand: number
  han: number
  correct: boolean
  timerEnabled: boolean
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

/** Keys carrying a `shanten` param (every efficiency discard/kita/kan outcome) get an
 *  optional trailing clause here, gated on the live setting rather than baked in at log
 *  time — matches the discard feedback panel, which is the same toggle. */
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
export function formatLogEntry(entry: LogEntry, t: TFunction, showShanten: boolean): string {
  if (entry.key === 'log.shanten.result') {
    const { hand, guess, actual, paths, correct, timerEnabled, elapsedMs } =
      entry.params as unknown as ShantenResultParams
    const showPaths = !(paths.length === 1 && paths[0] === 'standard')
    const via = showPaths
      ? ` ${t('shanten.via', { paths: paths.map((p) => t(`shanten.path.${p}`)).join(' / ') })}`
      : ''
    const time = timerEnabled ? ` ${t('shanten.inTime', { time: formatElapsedMs(elapsedMs) })}` : ''
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
    const { hand, han, correct, timerEnabled, elapsedMs } =
      entry.params as unknown as ScoringResultParams
    const time = timerEnabled ? ` ${t('scoring.inTime', { time: formatElapsedMs(elapsedMs) })}` : ''
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
      showShanten && shanten !== undefined
        ? ` ${t('log.efficiency.shanten', { count: shanten })}`
        : ''
    return t(entry.key, { ...entry.params, shantenSuffix })
  }
  return t(entry.key, entry.params)
}
