import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { Table, type SeatView } from '../../components/tiles/Table'
import { HandDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HONOR } from '../../core/tiles'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SettingRow } from '../settings/SettingsDialog'
import { useSettings } from '../settings/settingsStore'
import { WINDS } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
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
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)
  const showWall = useSettings((s) => s.showWall)
  const showOpponentHands = useSettings((s) => s.showOpponentHands)

  const options = useMemo<RoundOptions>(() => {
    const isSanma = urlData.sanma ?? sanma
    return {
      ...settings,
      sanma: isSanma,
      opponentWins: urlData.wins ?? settings.opponentWins,
      // one seat has to be left to fold; a link can pin a count this table cannot seat
      threats: Math.min(urlData.threats ?? settings.threats, (isSanma ? 3 : 4) - 1),
    }
  }, [urlData, sanma, settings])

  const round = useFoldingRound(urlData, options)
  const players = options.sanma ? 3 : 4

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
          checked={settings.opponentWins}
          onChange={(e) => update('folding', { opponentWins: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
      <SettingRow label={t('folding.settings.threats')}>
        <select
          value={Math.min(settings.threats, players - 1)}
          onChange={(e) => update('folding', { threats: Number(e.target.value) })}
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

  const seats: SeatView[] = round.rivers.map((river, seat) => ({
    river,
    melds: round.melds[seat],
    nuki: round.nuki[seat],
    riichi: round.riichi[seat],
    hand: showOpponentHands && seat !== round.seatIndex ? round.hands[seat] : undefined,
  }))
  const threatWinds = round.threatSeats.map((seat) => t(`wind.${WINDS[seat]}`)).join(' · ')

  return (
    <TrainerLayout
      title={t('trainer.folding.title')}
      intro={{ text: t('trainer.folding.intro'), wikiUrl: TRAINER_WIKI.folding }}
      settings={settingsRows}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
          <span>{t('folding.turnStatus', { turn: round.turn })}</span>
          {settings.timerEnabled && (
            <span className="font-mono tabular-nums">{formatElapsedMs(round.elapsed)}</span>
          )}
          <span className="ml-auto flex flex-col items-end">
            <span>
              {t('folding.score', { correct: round.correctCount, total: round.totalCount })}
            </span>
            {/* safest-or-not is pass/fail; this says how close the rest were, measured against the
                most dangerous tile each hand actually held */}
            {round.totalCount > 0 && (
              <span>{t('folding.accuracy', { percent: Math.round(round.accuracy * 100) })}</span>
            )}
            {settings.timerEnabled && (
              <span>{t('folding.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
            )}
          </span>
        </div>

        {/* says plainly what is being asked: this is a folding drill, and it grades the tile, not
            the decision to fold. Anything vaguer invites the reader to think push/fold is scored */}
        <p className="rounded-lg border border-amber-400 p-3 text-sm text-amber-700 dark:text-amber-400">
          {t('folding.prompt', { count: round.threatSeats.length, winds: threatWinds })}
        </p>

        {/* stacked normally; beside the board when the viewport is too short to stack, which is
            what makes turning the phone sideways actually pay off */}
        <div className="flex flex-col gap-4 short:flex-row short:items-start">
          <Table
            seats={seats}
            seatIndex={round.seatIndex}
            round={WINDS[round.round - HONOR]}
            doraIndicators={round.doraIndicators}
            wallCount={round.liveWall.length}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <HandDisplay
              tiles={round.hand}
              drawn={round.drawn}
              onTileClick={round.finished ? undefined : (i) => round.discard(i)}
            />

            {round.lastResult && (
              <FoldFeedback result={round.lastResult} seats={round.threatSeats} />
            )}

            {round.end && (
              <div className="flex flex-col gap-3">
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
            )}

            {showWall && (
              <WallDetails
                liveWall={round.liveWallSnapshot}
                liveWallDrawn={round.liveWallDrawn}
                deadWall={round.deadWallSnapshot}
                replacements={round.replacements}
              />
            )}

            <CopyLinkButton query={round.situationQuery} />
          </div>
        </div>
      </div>
    </TrainerLayout>
  )
}
