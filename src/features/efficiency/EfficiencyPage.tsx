import { Pause, Play } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, River, Tile } from '../../components/tiles/Tile'
import { formatElapsed, formatElapsedMs } from '../../lib/formatElapsed'
import { SettingRow } from '../settings/SettingsDialog'
import { useSettings } from '../settings/settingsStore'
import { decodeSituation, WINDS } from '../situation/urlCodec'
import { DiscardFeedback } from './DiscardFeedback'
import { NORTH, useEfficiencyRound, type RoundOptions } from './useEfficiencyRound'

/** 1 lost out of 100 available reads as 99% accuracy; no graded choices yet reads as 100%. */
function accuracy(lost: number, total: number): number {
  return total > 0 ? Math.round((1 - lost / total) * 100) : 100
}

export function EfficiencyPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const situation = useMemo(() => decodeSituation(params), [params])
  const settings = useSettings((s) => s.efficiency)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)

  // situation overrides pin round behavior so shared links reproduce exactly
  const options = useMemo<RoundOptions>(
    () => ({
      opponents: situation.opponents ?? settings.opponents,
      deadWall: situation.deadWall ?? settings.deadWall,
      aka: situation.aka ?? settings.aka,
      sanma: situation.sanma ?? sanma,
    }),
    [situation, settings.opponents, settings.deadWall, settings.aka, sanma],
  )

  const round = useEfficiencyRound(situation, options, settings.timerEnabled)

  // tiles held four times (hand + the separated drawn tile) can be closed-kanned
  const counts = new Map<number, number>()
  for (const t of round.hand) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
  if (round.drawn) counts.set(round.drawn.id, (counts.get(round.drawn.id) ?? 0) + 1)
  const kanEligible = [...counts.entries()].filter(([, c]) => c === 4).map(([id]) => id)

  const toggle = (key: keyof typeof settings, labelKey: string) => (
    <SettingRow label={t(labelKey)}>
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => update('efficiency', { [key]: e.target.checked })}
        className="size-5"
      />
    </SettingRow>
  )

  return (
    <TrainerLayout
      title={t('trainer.efficiency.title')}
      settings={
        <>
          {toggle('showShanten', 'efficiency.settings.showShanten')}
          {toggle('timerEnabled', 'efficiency.settings.timer')}
          {toggle('showUkeire', 'efficiency.settings.showUkeire')}
          {toggle('opponents', 'efficiency.settings.opponents')}
          {toggle('deadWall', 'efficiency.settings.deadWall')}
          {toggle('aka', 'efficiency.settings.redFives')}
          {toggle('showWall', 'efficiency.settings.showWall')}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
          <span>
            {t('efficiency.roundStatus', { round: t(`wind.${situation.round}`), turn: round.turn })}
          </span>
          {settings.timerEnabled && (
            <span className="flex items-center gap-1">
              <span className="font-mono tabular-nums">{formatElapsed(round.elapsed)}</span>
              <button
                type="button"
                aria-label={t(round.paused ? 'efficiency.resumeTimer' : 'efficiency.pauseTimer')}
                onClick={round.togglePause}
                className="flex size-6 items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                {round.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </button>
              {t('efficiency.avgTime', { time: formatElapsedMs(round.averageTime) })}
            </span>
          )}
          <span>{t('efficiency.wallStatus', { count: round.liveWall.length })}</span>
          {round.doraIndicators.length > 0 && (
            <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
              {t('efficiency.doraIndicator')}{' '}
              {round.doraIndicators.map((indicator, i) => (
                <Tile key={i} id={indicator.id} red={indicator.red} />
              ))}
            </span>
          )}
          <span className="ml-auto">
            {t('efficiency.ukeireLost', {
              lost: round.cumulativeLost,
              total: round.cumulativeTotal,
              accuracy: accuracy(round.cumulativeLost, round.cumulativeTotal),
            })}
          </span>
        </div>

        <HandDisplay
          tiles={round.hand}
          drawn={round.drawn}
          onTileClick={round.finished ? undefined : (i) => round.discard(i)}
        />

        {(options.sanma || kanEligible.length > 0) && !round.finished && (
          <div className="flex flex-wrap gap-2">
            {options.sanma && round.hand.some((tile) => tile.id === NORTH) && (
              <button
                type="button"
                onClick={round.kita}
                className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
              >
                {t('efficiency.kitaButton')}
              </button>
            )}
            {kanEligible.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => round.kan(id)}
                className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
              >
                <span className="[--tile-w:calc(var(--tile-w-base)*0.6)]">
                  <Tile id={id} />
                </span>
                {t('efficiency.kanButton')}
              </button>
            ))}
          </div>
        )}

        {round.lastResult && (
          <DiscardFeedback
            result={round.lastResult}
            showShanten={settings.showShanten}
            showUkeire={settings.showUkeire}
            sanma={options.sanma}
          />
        )}

        {round.finished && (
          <div className="rounded-lg bg-neutral-100 p-4 dark:bg-neutral-900">
            <p className="font-semibold">
              {t(round.tenpai ? 'efficiency.tenpaiReached' : 'efficiency.roundComplete')}
            </p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {t('efficiency.totalLost', {
                count: round.turn,
                turns: round.turn,
                lost: round.cumulativeLost,
                total: round.cumulativeTotal,
                accuracy: accuracy(round.cumulativeLost, round.cumulativeTotal),
              })}
            </p>
            <button
              type="button"
              onClick={round.restart}
              className="mt-3 min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('common.newRound')}
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          {round.rivers.map((river, seat) =>
            seat === round.seatIndex || options.opponents ? (
              <div key={seat} className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">
                  {t(`wind.${WINDS[seat]}`)}
                  {seat === round.seatIndex && ` ${t('efficiency.you')}`}
                </span>
                {river.length > 0 ? (
                  <River tiles={river} />
                ) : (
                  <span className="text-xs text-neutral-400">{t('efficiency.emptyRiver')}</span>
                )}
              </div>
            ) : null,
          )}
          {options.sanma && round.nuki.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">{t('efficiency.nukiPile')}</span>
              <River tiles={round.nuki} />
            </div>
          )}
          {round.kans.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">{t('efficiency.kanPile')}</span>
              <River tiles={round.kans.flat()} />
            </div>
          )}
        </div>

        {settings.showWall && (
          <details className="text-sm text-neutral-500">
            <summary className="cursor-pointer">
              {t('efficiency.wallDetails', { count: round.liveWall.length })}
            </summary>
            <div className="mt-2 flex flex-wrap [--tile-w:calc(var(--tile-w-base)*0.55)]">
              {round.liveWall.map((tile, i) => (
                <Tile key={i} id={tile.id} red={tile.red} />
              ))}
            </div>
          </details>
        )}

        <CopyLinkButton query={round.situationQuery} />
      </div>
    </TrainerLayout>
  )
}
