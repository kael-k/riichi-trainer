import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Table, type SeatView } from '../../components/tiles/Table'
import { splitDrawn } from '../../core/table'
import { Timer, TrainerToggles } from '../../components/TrainerControls'
import { HandDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SeatStrip } from '../table/SeatStrip'
import { ManualControls } from '../table/ManualControls'
import { Verdict } from '../table/Verdict'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useSettings } from '../settings/settingsStore'
import { useTableSettings, type SeatConfig, type TableSettings } from '../settings/tableSettings'
import { decodeSituation } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { EFFICIENCY_VERDICT_TEXT_KEY, efficiencyVerdictSeverity } from './grade'
import { NORTH, useEfficiencyRound, type EfficiencyOptions } from './useEfficiencyRound'

/** 1 lost out of 100 available reads as 99% accuracy; no graded choices yet reads as 100%. */
function accuracy(lost: number, total: number): number {
  return total > 0 ? Math.round((1 - lost / total) * 100) : 100
}

export function EfficiencyPage() {
  const { t } = useTranslation()
  const situation = useUrlData(decodeSituation)
  const rawTable = useSettings((s) => s.table)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)
  const { aka } = useAdvancedSettings()
  const { showOpponentHands, showSeatWaits, claims, seatsEnabled } = useTableSettings('efficiency')
  // `update` only merges at the section level, so a patch of `{ apps: {...} }` would otherwise
  // replace the whole apps layer instead of adding one app's key to it — merge the existing
  // `apps.efficiency` slice in first.
  const updateTable = (patch: Partial<TableSettings>) =>
    update('table', {
      apps: { ...rawTable.apps, efficiency: { ...rawTable.apps.efficiency, ...patch } },
    })

  // per-seat algorithms are board state, not a preference (ADR-0015): page state with the same
  // lifetime as `viewSeat` below — seeded from the link, reset on every new hand — never
  // persisted. `claims` (above) is the one part of the old seat panel that *is* a reader
  // preference, so it stays in settings.
  const [seatConfig, setSeatConfig] = useState<SeatConfig | null>(null)

  // situation overrides pin round behavior so shared links reproduce exactly
  const options = useMemo<EfficiencyOptions>(
    () => ({
      aka: situation.aka ?? aka,
      sanma: situation.sanma ?? sanma,
      seats: seatConfig,
      claims,
      showSeatWaits,
      showOpponentHands,
    }),
    [situation, aka, sanma, seatConfig, claims, showSeatWaits, showOpponentHands],
  )

  const round = useEfficiencyRound(situation, options)

  // perspective is view-only and ephemeral: the page's own state, never the round's — reset to
  // the drill's own seat on every new hand (a link's identity changing, or an explicit restart),
  // never persisted
  const [viewSeat, setViewSeat] = useState<number | null>(null)
  const [lastSituation, setLastSituation] = useState(situation)
  if (situation !== lastSituation) {
    setLastSituation(situation)
    setViewSeat(null)
    setSeatConfig(null)
  }
  const perspective = viewSeat ?? round.seatIndex
  const restart = () => {
    setViewSeat(null)
    setSeatConfig(null)
    round.restart()
  }

  // tiles held four times (hand + the separated drawn tile) can be closed-kanned
  const counts = new Map<number, number>()
  for (const t of round.hand) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
  if (round.drawn) counts.set(round.drawn.id, (counts.get(round.drawn.id) ?? 0) + 1)
  const kanEligible = [...counts.entries()].filter(([, c]) => c === 4).map(([id]) => id)

  // the bottom hand follows perspective, not the acting seat: rotating to watch another seat
  // shows that seat's hand (face-down unless it's a manual seat or the reveal setting is on),
  // never yours. Only when the perspective is genuinely the seat whose turn it is can any of it
  // be acted on — otherwise this is a spectator's read of someone else's tiles
  const viewingManual = round.manualSeats.includes(perspective)
  const { tiles: bottomHand, drawn: bottomDrawn } = splitDrawn(
    round.hands[perspective] ?? [],
    perspective === round.drawnSeat ? round.drawn : undefined,
  )
  const bottomConcealed = !viewingManual && !showOpponentHands
  const canAct = perspective === round.acting && !round.finished
  const bottomMelds =
    perspective === round.acting
      ? round.kans.map((tiles) => ({ kind: 'ankan' as const, tiles }))
      : round.melds[perspective]

  // a manual seat is the reader's own hand wherever it sits, so it is face-up like your own —
  // the reveal setting only ever governed the seats somebody else is playing
  const seats: SeatView[] = round.rivers.map((river, seat) => {
    const mine = round.manualSeats.includes(seat)
    // the felt omits a hand row for whichever seat sits at the bottom of the board — that is
    // where HandDisplay, in the page's own `hand` slot, already sits, and that seat's calls go
    // with it (`bottomMelds` above) rather than on the felt: they belong beside the hand they
    // were called into, at a size that reads against it
    if (seat === perspective) {
      return {
        river,
        riichi: round.riichi[seat],
        points: round.match.points[seat],
      }
    }
    return {
      river,
      melds: round.melds[seat],
      nuki: round.nuki[seat],
      riichi: round.riichi[seat],
      hand: round.hands[seat],
      concealed: !mine && !showOpponentHands,
      points: round.match.points[seat],
    }
  })

  const { canBack, back } = useLogBack()

  const toggles = {
    paused: round.paused,
    onToggle: round.togglePause,
    toggleLabel: t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer'),
    canBack,
    onBack: back,
    backLabel: t('common.undoAction'),
    onReset: restart,
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
      title={t('trainer.efficiency.title')}
      app="efficiency"
      intro={{ text: t('trainer.efficiency.intro'), wikiUrl: TRAINER_WIKI.efficiency }}
      onLogOpen={(open) => open !== round.paused && round.togglePause()}
      status={
        <>
          <Timer elapsedNow={round.elapsedNow} running={round.running} />
          {scoreLines}
        </>
      }
      chrome={<TrainerToggles {...toggles} />}
      board={
        <Table
          seatInfo={(seat, wind) =>
            seatsEnabled && (
              <SeatStrip
                seat={seat}
                players={round.rivers.length}
                defaultOrientation={round.seatIndex}
                config={seatConfig}
                onChange={setSeatConfig}
                claims={claims}
                onClaimsChange={(v) => updateTable({ claims: v })}
                viewSeat={perspective}
                onWatch={setViewSeat}
                read={round.seatReads[seat]}
                showWaits={showSeatWaits}
                wind={wind}
              />
            )
          }
          seats={seats}
          seatIndex={perspective}
          round={situation.round}
          roundNumber={round.match.round}
          dealerRepeat={round.match.dealerRepeat}
          doraIndicators={round.doraIndicators}
          wallCount={round.liveWall.length}
          honba={round.match.honba}
        />
      }
      // one graded choice per notice: `cumulativeTotal` counts exactly those, so a re-render
      // never brings a faded one back and a kita/kan still gets its own
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
        // `drillOver`, not `finished`: a pending claim holds the seat at 13 tiles mid-hand, and
        // the card must not race the prompt it would have to share the board with
        round.drillOver && (
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
              onClick={restart}
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
            viewSeat={perspective}
            onReturn={() => setViewSeat(null)}
          />
          {/* centred on the board above it, not left-aligned in the page: the calls hang off
                  the right of the hand, so a called hand would otherwise sit visibly off-centre
                  from the felt its own seat is drawn on */}
          <div className="flex justify-center">
            <HandDisplay
              tiles={bottomHand}
              drawn={bottomDrawn}
              concealed={bottomConcealed}
              melds={bottomMelds}
              nuki={round.nuki[perspective]}
              onTileClick={canAct ? (i) => round.discard(i) : undefined}
              lockedToDrawn={round.riichi[round.acting]}
            />
          </div>

          {(options.sanma || kanEligible.length > 0) && canAct && (
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
      wall={
        <WallDetails
          dealt={round.dealtTiles}
          liveWall={round.liveWallSnapshot}
          liveWallDrawn={round.liveWallDrawn}
          deadWall={round.deadWallSnapshot}
          replacements={round.replacements}
          players={round.rivers.length}
          seat={perspective}
        />
      }
    />
  )
}
