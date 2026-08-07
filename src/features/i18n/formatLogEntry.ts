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

/** Most log entries are a direct t(key, params). The shanten result entry composes two
 *  optional trailing clauses (path names, elapsed time) from raw data at render time, so
 *  switching language re-translates the whole line instead of leaving stale fragments
 *  from whatever language was active when the entry was logged. */
export function formatLogEntry(entry: LogEntry, t: TFunction): string {
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
  return t(entry.key, entry.params)
}
