import { Pause, Play } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Table, type SeatView } from '../../components/tiles/Table'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, River, Tile, WallDetails } from '../../components/tiles/Tile'
import { formatElapsed, formatElapsedMs } from '../../lib/formatElapsed'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
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

  // the table only earns its space once there are other rivers to read; without opponents the
  // round is a solo drill and the flat layout says the same thing in a fraction of the height
  const showTable = options.opponents
  const seats: SeatView[] = round.rivers.map((river, seat) =>
    seat === round.seatIndex
      ? {
          river,
          melds: round.kans.map((tiles) => ({ kind: 'ankan' as const, tiles })),
          nuki: round.nuki,
        }
      : { river },
  )

  const toggle = (key: keyof typeof settings, label: ReactNode) => (
    <SettingRow label={label}>
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
      intro={{ text: t('trainer.efficiency.intro'), wikiUrl: TRAINER_WIKI.efficiency }}
      settings={
        <>
          {toggle(
            'showShanten',
            <Trans
              i18nKey="efficiency.settings.showShanten"
              components={{ term: <GlossaryTerm id="shanten" /> }}
            />,
          )}
          {toggle('timerEnabled', t('efficiency.settings.timer'))}
          {toggle(
            'showUkeire',
            <Trans
              i18nKey="efficiency.settings.showUkeire"
              components={{ term: <GlossaryTerm id="ukeire" /> }}
            />,
          )}
          {toggle('opponents', t('efficiency.settings.opponents'))}
          {toggle('deadWall', t('efficiency.settings.deadWall'))}
          {toggle('aka', t('efficiency.settings.redFives'))}
          {toggle('showWall', t('efficiency.settings.showWall'))}
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
            </span>
          )}
          {/* both live in the table's centre panel when it is up */}
          {!showTable && (
            <span>{t('efficiency.wallStatus', { count: round.liveWall.length })}</span>
          )}
          {!showTable && round.doraIndicators.length > 0 && (
            <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
              <GlossaryTerm id="dora">{t('efficiency.doraIndicator')}</GlossaryTerm>{' '}
              {round.doraIndicators.map((indicator, i) => (
                <Tile key={i} id={indicator.id} red={indicator.red} />
              ))}
            </span>
          )}
          <span className="ml-auto flex flex-col items-end">
            <span>
              <Trans
                i18nKey="efficiency.ukeireLost"
                values={{
                  lost: round.cumulativeLost,
                  total: round.cumulativeTotal,
                  accuracy: accuracy(round.cumulativeLost, round.cumulativeTotal),
                }}
                components={{ term: <GlossaryTerm id="ukeire" /> }}
              />
            </span>
            {settings.timerEnabled && (
              <span>{t('efficiency.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
            )}
          </span>
        </div>

        {/* stacked normally; beside the board when the viewport is too short to stack, which is
            what makes turning the phone sideways actually pay off */}
        <div className="flex flex-col gap-4 short:flex-row short:items-start">
          {showTable && (
            <Table
              seats={seats}
              seatIndex={round.seatIndex}
              round={situation.round}
              doraIndicators={round.doraIndicators}
              wallCount={round.liveWall.length}
            />
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-4">
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

            {/* no opponents means every other river is empty, so only yours is worth the space */}
            {!showTable && (
              <div className="flex flex-wrap gap-4 [--tile-w:calc(var(--tile-w-base)*0.8)]">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-500">
                    {t(`wind.${WINDS[round.seatIndex]}`)} {t('efficiency.you')}
                  </span>
                  {round.rivers[round.seatIndex].length > 0 ? (
                    <River tiles={round.rivers[round.seatIndex]} />
                  ) : (
                    <span className="text-xs text-neutral-400">{t('efficiency.emptyRiver')}</span>
                  )}
                </div>
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
            )}

            {settings.showWall && (
              <WallDetails liveWall={round.liveWall} deadWall={round.deadWall} />
            )}

            <CopyLinkButton query={round.situationQuery} />
          </div>
        </div>
      </div>
    </TrainerLayout>
  )
}
