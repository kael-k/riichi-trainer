import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Table, type SeatView } from '../../components/tiles/Table'
import { HandDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { TrainerStatusBar } from '../../components/TrainerControls'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HONOR } from '../../core/tiles'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SeatButton } from '../settings/SeatPanel'
import { SettingRow } from '../settings/SettingsDialog'
import { useSettings } from '../settings/settingsStore'
import { resolveSeatConfig, useTableSettings, type TableSettings } from '../settings/tableSettings'
import { WINDS } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { ManualControls } from '../table/ManualControls'
import { FoldFeedback } from './FoldFeedback'
import {
  decodeFoldingUrl,
  useFoldingRound,
  type RoundOptions,
  type ThreatReveal,
} from './useFoldingRound'

/** What each threat was actually holding. Held back until the hand is over — this is the payoff,
 *  and it is also the answer key for every turn, so it cannot appear a moment earlier. */
function Reveal({ threat, seats }: { threat: ThreatReveal; seats: number }) {
  const { t } = useTranslation()
  const wind = t(`wind.${WINDS[threat.seat]}`)
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-sm font-medium">
        {t(seats > 1 ? 'folding.threatHandOf' : 'folding.threatHand', { wind })}
      </p>
      <div className="flex flex-wrap [--tile-w:calc(var(--tile-w-base)*0.7)]">
        {threat.hand.map((tile, i) => (
          <Tile key={i} id={tile.id} red={tile.red} />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-neutral-500">{t('folding.waitingOn')}</span>
        <span className="flex items-center [--tile-w:calc(var(--tile-w-base)*0.7)]">
          {threat.waits.map((tile) => (
            <Tile key={tile} id={tile} />
          ))}
        </span>
      </p>
      {threat.hits.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          {t('folding.youThrew')}
          <span className="flex items-center [--tile-w:calc(var(--tile-w-base)*0.55)]">
            {threat.hits.map((tile) => (
              <Tile key={tile} id={tile} />
            ))}
          </span>
        </p>
      )}
    </div>
  )
}

export function FoldingPage() {
  const { t } = useTranslation()
  const urlData = useUrlData(decodeFoldingUrl)
  const settings = useSettings((s) => s.folding)
  const rawTable = useSettings((s) => s.table)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)
  // no hideConcealedHands here: folding always shows the board (reading it is the drill), and the
  // D-14 reveal gate below already withholds real tile ids until `round.finished` or
  // `showOpponentHands` regardless of any other setting
  const {
    showWall,
    showOpponentHands,
    threats,
    opponentWins,
    seats: seatConfig,
    seatsEnabled,
  } = useTableSettings('folding')
  // `update` only merges at the section level, so a patch of `{ apps: {...} }` would otherwise
  // replace the whole apps layer instead of adding one app's key to it — merge the existing
  // `apps.folding` slice in first.
  const updateTable = (patch: Partial<TableSettings>) =>
    update('table', { apps: { ...rawTable.apps, folding: { ...rawTable.apps.folding, ...patch } } })

  const options = useMemo<RoundOptions>(() => {
    const isSanma = urlData.sanma ?? sanma
    return {
      ...settings,
      sanma: isSanma,
      opponentWins: urlData.wins ?? opponentWins,
      // one seat has to be left to fold; a link can pin a count this table cannot seat
      threats: Math.min(urlData.threats ?? threats, (isSanma ? 3 : 4) - 1),
      showOpponentHands,
      seats: seatConfig,
    }
  }, [urlData, sanma, settings, threats, opponentWins, showOpponentHands, seatConfig])

  const round = useFoldingRound(urlData, options)
  const players = options.sanma ? 3 : 4
  // orientation is a pure viewing perspective — which seat `Table` draws at the bottom — kept
  // out of the round's own rebuild key (`useFoldingRound`'s `seatKey`), so changing it here never
  // resets the hand. `round.seatIndex` (the drill's own generated seat) is only the default until
  // someone picks a different one; a link built from a non-default perspective is not
  // reproducible, which is the trade a reader is opting into by moving it
  const viewSeat = resolveSeatConfig(seatConfig, players, round.seatIndex).orientation

  const settingsRows = (
    <>
      <SettingRow label={t('folding.settings.timer')}>
        <input
          type="checkbox"
          checked={settings.timerEnabled}
          onChange={(e) => update('folding', { timerEnabled: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
      <SettingRow label={t('folding.settings.feedbackAtEnd')}>
        <input
          type="checkbox"
          checked={settings.feedbackAtEnd}
          onChange={(e) => update('folding', { feedbackAtEnd: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
      <SettingRow label={t('folding.settings.showEquallySafe')}>
        <input
          type="checkbox"
          checked={settings.showEquallySafe}
          onChange={(e) => update('folding', { showEquallySafe: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
      <SettingRow label={t('folding.settings.opponentWins')}>
        <input
          type="checkbox"
          checked={opponentWins}
          onChange={(e) => updateTable({ opponentWins: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
      <SettingRow label={t('folding.settings.threats')}>
        <select
          value={Math.min(threats, players - 1)}
          onChange={(e) => updateTable({ threats: Number(e.target.value) })}
          className="min-h-11 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {Array.from({ length: players - 1 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </SettingRow>
    </>
  )

  if (round.loading || round.failed) {
    return (
      <TrainerLayout title={t('trainer.folding.title')} settings={settingsRows}>
        <p className="p-8 text-center text-neutral-500">
          {t(round.failed ? 'folding.noHand' : 'folding.dealing')}
        </p>
        {round.failed && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={round.next}
              className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('common.newRound')}
            </button>
          </div>
        )}
      </TrainerLayout>
    )
  }

  const seats: SeatView[] = round.rivers.map((river, seat) => {
    const mine = round.manualSeats.includes(seat)
    if (seat === round.seatIndex) {
      // the drill's own generated seat: its hand is the one below the board (`HandDisplay`),
      // whether or not it is also the seat `Table` is drawn from right now
      return { river, melds: round.melds[seat], nuki: round.nuki[seat], riichi: round.riichi[seat] }
    }
    return {
      river,
      melds: round.melds[seat],
      nuki: round.nuki[seat],
      riichi: round.riichi[seat],
      // `round.boardHands` is already the D-14 gate for a threat: face-down filler at the right
      // count until `round.finished` or `showOpponentHands`, real tiles after (and always real
      // for a seat someone plays, `boardHandsOf`'s own `isHuman` check). A bystander's tiles are
      // real throughout, same as `hideConcealedHands` never withholds an ordinary opponent
      // elsewhere
      hand: round.boardHands[seat],
      concealed: !mine && !showOpponentHands,
    }
  })
  // everything that would tell you how the fold is going so far, held back mid-hand when asked
  const answersHeld = settings.feedbackAtEnd && !round.finished

  return (
    <TrainerLayout
      title={t('trainer.folding.title')}
      intro={{ text: t('trainer.folding.intro'), wikiUrl: TRAINER_WIKI.folding }}
      settings={settingsRows}
    >
      <div className="flex flex-col gap-4">
        <TrainerStatusBar
          showToggle={settings.timerEnabled}
          paused={round.paused}
          onToggle={round.togglePause}
          toggleLabel={t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer')}
          onReset={round.next}
          resetLabel={t('common.resetHand')}
          elapsedNow={round.elapsedNow}
          running={round.running}
          timerEnabled={settings.timerEnabled}
        >
          {/* the running score says "that last one was wrong" as loudly as the panel does, so it
              waits with it — the clock is not an answer and keeps running either way */}
          {!answersHeld && (
            <>
              <span>
                {t('folding.score', { correct: round.correctCount, total: round.totalCount })}
              </span>
              {/* safest-or-not is pass/fail; this says how close the rest were, measured against
                  the most dangerous tile each hand actually held */}
              {round.totalCount > 0 && (
                <span>{t('folding.accuracy', { percent: Math.round(round.accuracy * 100) })}</span>
              )}
            </>
          )}
          {settings.timerEnabled && (
            <span>{t('folding.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
          )}
        </TrainerStatusBar>

        {/* stacked normally; beside the board when the viewport is too short to stack, which is
            what makes turning the phone sideways actually pay off */}
        <BoardStage
          onLogOpen={(open) => open !== round.paused && round.togglePause()}
          board={(controls) => (
            <Table
              controls={controls}
              seatControl={(seat) =>
                seatsEnabled && (
                  <SeatButton
                    seat={seat}
                    players={players}
                    defaultOrientation={round.seatIndex}
                    config={seatConfig}
                    onChange={(next) => updateTable({ seats: next })}
                    fallbackModes={round.policies}
                  />
                )
              }
              seats={seats}
              seatIndex={viewSeat}
              round={WINDS[round.round - HONOR]}
              doraIndicators={round.doraIndicators}
              wallCount={round.liveWall.length}
            />
          )}
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
            </div>
          }
          // one notice per graded throw. Under `feedbackAtEnd` there is nothing to key off until
          // the hand is over, and the whole run then lands in the end card instead
          noticeKey={settings.feedbackAtEnd ? undefined : round.results.length}
          notice={
            !settings.feedbackAtEnd &&
            round.lastResult && <FoldFeedback result={round.lastResult} seats={round.threatSeats} />
          }
          end={
            round.end && (
              <div className="flex flex-col gap-3">
                {/* under `feedbackAtEnd` every turn of the hand, in play order, arrives here */}
                {settings.feedbackAtEnd &&
                  round.results.map((result, i) => (
                    <FoldFeedback key={i} result={result} seats={round.threatSeats} />
                  ))}
                <div className="rounded-lg bg-neutral-100 p-4 dark:bg-neutral-900">
                  <p className="font-semibold">
                    {t(`folding.end.${round.end.kind}`, {
                      wind: round.end.seat === undefined ? '' : t(`wind.${WINDS[round.end.seat]}`),
                      points: round.end.points ?? 0,
                    })}
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {t('folding.sessionLine', {
                      correct: round.correctCount,
                      total: round.totalCount,
                    })}
                  </p>
                  {settings.timerEnabled && (
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      {t('folding.avgTime', { time: formatElapsedMs(round.roundAverageTime) })}
                    </p>
                  )}
                </div>
                {round.end.threats.map((threat) => (
                  <Reveal key={threat.seat} threat={threat} seats={round.end!.threats.length} />
                ))}
                {/* the whole point of grading on public information: a safest-tier pick that
                    landed in the wait was still the right call */}
                {round.end.threats.some((threat) => threat.hits.length > 0) && (
                  <p className="text-sm text-neutral-500">{t('folding.hindsight')}</p>
                )}
                <button
                  type="button"
                  onClick={round.next}
                  className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {t('folding.newSituation')}
                </button>
              </div>
            )
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
