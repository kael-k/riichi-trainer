import { useMemo, type CSSProperties } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Timer, TrainerToggles } from '../../components/TrainerControls'
import { HandDisplay, River, Tile, WallDetails } from '../../components/tiles/Tile'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { Verdict } from '../table/Verdict'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useSettings } from '../settings/settingsStore'
import { decodeSituation, WINDS } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { EFFICIENCY_VERDICT_TEXT_KEY, efficiencyVerdictSeverity } from '../efficiency/grade'
import { NORTH, useEfficiencySoloRound, type SoloOptions } from './useEfficiencySoloRound'

/** 1 lost out of 100 available reads as 99% accuracy; no graded choices yet reads as 100%. */
function accuracy(lost: number, total: number): number {
  return total > 0 ? Math.round((1 - lost / total) * 100) : 100
}

export function EfficiencySoloPage() {
  const { t } = useTranslation()
  const situation = useUrlData(decodeSituation)
  const sanma = useSettings((s) => s.sanma)
  const { aka } = useAdvancedSettings()

  // situation overrides pin round behavior so shared links reproduce exactly
  const options = useMemo<SoloOptions>(
    () => ({
      aka: situation.aka ?? aka,
      sanma: situation.sanma ?? sanma,
    }),
    [situation, aka, sanma],
  )

  const round = useEfficiencySoloRound(situation, options)

  // tiles held four times (hand + the separated drawn tile) can be closed-kanned
  const counts = new Map<number, number>()
  for (const t of round.hand) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
  if (round.drawn) counts.set(round.drawn.id, (counts.get(round.drawn.id) ?? 0) + 1)
  const kanEligible = [...counts.entries()].filter(([, c]) => c === 4).map(([id]) => id)

  const { canBack, back } = useLogBack()

  const toggles = {
    paused: round.paused,
    onToggle: round.togglePause,
    toggleLabel: t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer'),
    canBack,
    onBack: back,
    backLabel: t('common.undoAction'),
    onReset: round.restart,
    resetLabel: t('common.resetHand'),
  }

  // how the session is going — passed to BoardStage's `status`, which floats it as a HUD over the board
  const scoreLines = (
    <>
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
      <span>{t('efficiency.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
    </>
  )

  return (
    <BoardStage
      title={t('trainer.efficiencySolo.title')}
      intro={{ text: t('trainer.efficiencySolo.intro'), wikiUrl: TRAINER_WIKI.efficiencySolo }}
      status={
        <>
          <Timer elapsedNow={round.elapsedNow} running={round.running} />
          {scoreLines}
        </>
      }
      chrome={<TrainerToggles {...toggles} />}
      hand={
        <div className="flex flex-col gap-4">
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
      noticeKey={round.lastResult ? round.cumulativeTotal : undefined}
      noticeCompact={
        round.lastResult && (
          <Verdict
            severity={efficiencyVerdictSeverity(round.lastResult)}
            text={t(EFFICIENCY_VERDICT_TEXT_KEY[efficiencyVerdictSeverity(round.lastResult)])}
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
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {t('efficiency.avgTime', { time: formatElapsedMs(round.roundAverageTime) })}
            </p>
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
      flow
      wall={
        <WallDetails
          dealt={round.dealtTiles}
          liveWall={round.liveWallSnapshot}
          liveWallDrawn={round.liveWallDrawn}
          deadWall={round.deadWallSnapshot}
          replacements={round.replacements}
        />
      }
    >
      {/* there is no felt here to read the wall and dora off, so this solo trainer says them
          plainly above its own river — all of it in the board area, where a table would be.
          A size container: the river below sizes its own tiles off the width this block is
          given rather than off the hand's, which is what lets a phone spend the room it has
          on the river instead of leaving two thirds of the screen beside it empty */}
      <div className="flex w-full flex-col gap-4 [container-type:inline-size]">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-neutral-500">
          <span>{t('efficiency.wallStatus', { count: round.liveWall.length })}</span>
          {round.doraIndicators.length > 0 && (
            <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
              <GlossaryTerm id="dora">{t('efficiency.doraIndicator')}</GlossaryTerm>{' '}
              {round.doraIndicators.map((indicator, i) => (
                <Tile key={i} id={indicator.id} red={indicator.red} />
              ))}
            </span>
          )}
        </div>
        {/* Twelve tiles to a line, at whichever is smaller: the tile size this screen would draw
            them at, or the twelfth of the room the block actually has. On a phone the second one
            never binds, so the river fills the width it has instead of hugging one edge of it;
            on anything from a tablet up it draws below the hand's own size, where a river read
            off the felt belongs. */}
        <div className="flex flex-wrap justify-center gap-4 [--tile-w:min(var(--tile-w-base),calc((100cqw-0.5rem)/12))] sizable:[--tile-w:min(calc(var(--tile-w-base)*0.8),calc((100cqw-0.5rem)/12))]">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">
              {t(`wind.${WINDS[round.seatIndex]}`)} {t('efficiency.you')}
            </span>
            {/* Both dimensions fixed from the deal: twelve tiles across, and — where the hand
                rides up under it (`roomy:`, the `flow` gate) — as many rows as this round's own
                wall can ever fill. A river that grows into its space walks the hand down the
                screen a row at a time, and a hand that moves under the pointer between turns is
                a hand you misclick. */}
            <div
              style={
                { '--river-rows': Math.ceil(round.liveWallSnapshot.length / 12) } as CSSProperties
              }
              className="w-[calc(var(--tile-w)*12+0.5rem)] roomy:min-h-[calc(var(--river-rows)*var(--tile-w)*4/3)]"
            >
              {round.rivers[round.seatIndex].length > 0 ? (
                <River tiles={round.rivers[round.seatIndex]} wide />
              ) : (
                <span className="text-xs text-neutral-400">{t('efficiency.emptyRiver')}</span>
              )}
            </div>
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
      </div>
    </BoardStage>
  )
}
