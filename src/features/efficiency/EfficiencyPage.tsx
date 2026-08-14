import { useMemo, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Table, type SeatView } from '../../components/tiles/Table'
import { TrainerStatusBar } from '../../components/TrainerControls'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SeatButton } from '../settings/SeatPanel'
import { SettingRow } from '../settings/SettingsDialog'
import { ManualControls } from '../table/ManualControls'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useSettings } from '../settings/settingsStore'
import { useTableSettings, type TableSettings } from '../settings/tableSettings'
import { decodeSituation } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { DiscardFeedback } from './DiscardFeedback'
import { NORTH, useEfficiencyRound, type RoundOptions } from './useEfficiencyRound'

/** 1 lost out of 100 available reads as 99% accuracy; no graded choices yet reads as 100%. */
function accuracy(lost: number, total: number): number {
  return total > 0 ? Math.round((1 - lost / total) * 100) : 100
}

export function EfficiencyPage() {
  const { t } = useTranslation()
  const situation = useUrlData(decodeSituation)
  const settings = useSettings((s) => s.efficiency)
  const rawTable = useSettings((s) => s.table)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)
  const { aka } = useAdvancedSettings()
  const {
    deadWall,
    showWall,
    showOpponentHands,
    hideConcealedHands,
    seats: seatConfig,
    seatsEnabled,
  } = useTableSettings('efficiency')
  // `update` only merges at the section level, so a patch of `{ apps: {...} }` would otherwise
  // replace the whole apps layer instead of adding one app's key to it — merge the existing
  // `apps.efficiency` slice in first.
  const updateTable = (patch: Partial<TableSettings>) =>
    update('table', {
      apps: { ...rawTable.apps, efficiency: { ...rawTable.apps.efficiency, ...patch } },
    })

  // situation overrides pin round behavior so shared links reproduce exactly
  const options = useMemo<RoundOptions>(
    () => ({
      deadWall: situation.deadWall ?? deadWall,
      aka: situation.aka ?? aka,
      sanma: situation.sanma ?? sanma,
      seats: seatConfig,
    }),
    [situation, deadWall, aka, sanma, seatConfig],
  )

  const round = useEfficiencyRound(situation, options, settings.timerEnabled)

  // tiles held four times (hand + the separated drawn tile) can be closed-kanned
  const counts = new Map<number, number>()
  for (const t of round.hand) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
  if (round.drawn) counts.set(round.drawn.id, (counts.get(round.drawn.id) ?? 0) + 1)
  const kanEligible = [...counts.entries()].filter(([, c]) => c === 4).map(([id]) => id)

  // a manual seat is the reader's own hand wherever it sits, so it is face-up like your own —
  // the reveal setting only ever governed the seats somebody else is playing
  const seats: SeatView[] = round.rivers.map((river, seat) => {
    const mine = round.manualSeats.includes(seat)
    if (seat === round.seatIndex) {
      return {
        river,
        melds: round.kans.map((tiles) => ({ kind: 'ankan' as const, tiles })),
        nuki: round.nuki[seat],
        riichi: round.riichi[seat],
      }
    }
    return {
      river,
      melds: round.melds[seat],
      nuki: round.nuki[seat],
      riichi: round.riichi[seat],
      hand: mine || showOpponentHands || !hideConcealedHands ? round.hands[seat] : undefined,
      concealed: !mine && !showOpponentHands,
    }
  })

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
          <SettingRow label={t('efficiency.settings.deadWall')}>
            <input
              type="checkbox"
              checked={deadWall}
              onChange={(e) => updateTable({ deadWall: e.target.checked })}
              className="size-5"
            />
          </SettingRow>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TrainerStatusBar
          showToggle={settings.timerEnabled}
          paused={round.paused}
          onToggle={round.togglePause}
          toggleLabel={t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer')}
          onReset={round.restart}
          resetLabel={t('common.resetHand')}
          elapsedNow={round.elapsedNow}
          running={round.running}
          timerEnabled={settings.timerEnabled}
        >
          {/* also lives in the table's own centre panel */}
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
        </TrainerStatusBar>

        {/* stacked normally; beside the board when the viewport is too short to stack, and
            filling the screen outright behind the fullscreen button */}
        <BoardStage
          onLogOpen={(open) => open !== round.paused && round.togglePause()}
          board={(controls) => (
            <Table
              controls={controls}
              seatControl={(seat) =>
                seatsEnabled && (
                  <SeatButton
                    seat={seat}
                    players={round.rivers.length}
                    defaultOrientation={round.seatIndex}
                    config={seatConfig}
                    onChange={(next) => updateTable({ seats: next })}
                  />
                )
              }
              seats={seats}
              seatIndex={round.seatIndex}
              round={situation.round}
              doraIndicators={round.doraIndicators}
              wallCount={round.liveWall.length}
            />
          )}
          // one graded choice per notice: `cumulativeTotal` counts exactly those, so a re-render
          // never brings a faded one back and a kita/kan still gets its own
          noticeKey={round.lastResult ? round.cumulativeTotal : undefined}
          notice={
            round.lastResult && (
              <DiscardFeedback
                result={round.lastResult}
                showShanten={settings.showShanten}
                showUkeire={settings.showUkeire}
                sanma={options.sanma}
              />
            )
          }
          end={
            round.finished && (
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
                {settings.timerEnabled && (
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {t('efficiency.avgTime', { time: formatElapsedMs(round.roundAverageTime) })}
                  </p>
                )}
                <button
                  type="button"
                  onClick={round.restart}
                  className="mt-3 min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {t('common.newRound')}
                </button>
              </div>
            )
          }
          hand={
            <div className="flex flex-col gap-4">
              <ManualControls
                seatIndex={round.seatIndex}
                acting={round.acting}
                claim={round.claim}
                riichiTiles={round.riichiTiles()}
                riichiArmed={round.riichiArmed}
                onArmRiichi={round.armRiichi}
                onAnswer={round.answer}
              />
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
            </div>
          }
        >
          {showWall && (
            <WallDetails
              dealt={round.dealtTiles}
              liveWall={round.liveWallSnapshot}
              liveWallDrawn={round.liveWallDrawn}
              deadWall={round.deadWallSnapshot}
              replacements={round.replacements}
            />
          )}

          <CopyLinkButton query={round.situationQuery} />
        </BoardStage>
      </div>
    </TrainerLayout>
  )
}
