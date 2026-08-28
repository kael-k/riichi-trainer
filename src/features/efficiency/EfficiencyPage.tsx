import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Table, type SeatView } from '../../components/tiles/Table'
import { splitDrawn } from '../../core/table'
import { Timer, TrainerToggles } from '../../components/TrainerControls'
import { HandDisplay, WallDetails } from '../../components/tiles/Tile'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SeatStrip } from '../table/SeatStrip'
import { KitaKanControls, kitaKanVisible } from '../table/KitaKanControls'
import { ManualControls, manualControlsVisible } from '../table/ManualControls'
import { Verdict } from '../table/Verdict'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useBotDelay, useSettings } from '../settings/settingsStore'
import { useTableSettings, type SeatConfig } from '../settings/tableSettings'
import { decodeSituation } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { EFFICIENCY_VERDICT_TEXT_KEY, efficiencyVerdictSeverity } from './grade'
import { useEfficiencyRound, type EfficiencyOptions } from './useEfficiencyRound'

/** 1 lost out of 100 available reads as 99% accuracy; no graded choices yet reads as 100%. */
function accuracy(lost: number, total: number): number {
  return total > 0 ? Math.round((1 - lost / total) * 100) : 100
}

export function EfficiencyPage() {
  const { t } = useTranslation()
  const situation = useUrlData(decodeSituation)
  const sanma = useSettings((s) => s.sanma)
  const pace = useBotDelay()
  const { aka } = useAdvancedSettings()
  const { showOpponentHands, showSeatWaits, seatsEnabled } = useTableSettings('efficiency')

  // per-seat algorithms are board state, not a preference (ADR-0015): page state with the same
  // lifetime as `viewSeat` below — seeded from the link, reset on every new hand — never
  // persisted.
  const [seatConfig, setSeatConfig] = useState<SeatConfig | null>(null)

  // situation overrides pin round behavior so shared links reproduce exactly
  const options = useMemo<EfficiencyOptions>(
    () => ({
      aka: situation.aka ?? aka,
      sanma: situation.sanma ?? sanma,
      seats: seatConfig,
      showSeatWaits,
      showOpponentHands,
      pace,
    }),
    [situation, aka, sanma, seatConfig, showSeatWaits, showOpponentHands, pace],
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
  // `actingPlayable`, not `!round.finished`: `finished` is anchored to the graded seat and stays
  // true for the whole window a second manual seat plays its own turn in — the freeze
  // `NOTE-efficiency-multi-manual-freeze.md` found (ADR-0034)
  const canAct = perspective === round.acting && round.actingPlayable
  const showKitaKan = kitaKanVisible({
    sanma: options.sanma,
    hand: round.hand,
    drawn: round.drawn,
    canAct,
  })
  const riichiTiles = round.riichiTiles()
  // whether `controls` has anything to float at all — `showKitaKan` covers the kita/kan row,
  // `manualControlsVisible` mirrors `ManualControls`' own "nothing to show" branches exactly, so
  // the positioned card in `BoardStage` is never rendered empty (and, being `pointer-events-auto`,
  // never left standing as an invisible dead zone over the felt)
  const showControls =
    showKitaKan ||
    manualControlsVisible({
      acting: round.acting,
      claim: round.claim,
      riichiTiles,
      viewSeat: perspective,
      ended: round.drillOver,
    })
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
    const claiming = round.claim?.kind === 'discard' && round.claim.from === seat
    if (seat === perspective) {
      return {
        river,
        riichi: round.riichi[seat],
        points: round.match.points[seat],
        claiming,
      }
    }
    // the seat mid-turn holds fourteen: its draw sits apart from the thirteen, the same small gap
    // the bottom hand already keeps, so a reader can see *which* tile a seat just took
    const { tiles: hand, drawn } = splitDrawn(
      round.hands[seat],
      seat === round.drawnSeat ? round.drawn : undefined,
    )
    return {
      river,
      melds: round.melds[seat],
      nuki: round.nuki[seat],
      riichi: round.riichi[seat],
      hand,
      drawn,
      tedashi: round.tedashi?.seat === seat ? round.tedashi.tile : undefined,
      concealed: !mine && !showOpponentHands,
      points: round.match.points[seat],
      claiming,
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
          activeSeat={round.drillOver ? undefined : round.acting}
          call={round.callBanner}
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
      controls={
        showControls && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ManualControls
              acting={round.acting}
              claim={round.claim}
              riichiTiles={riichiTiles}
              riichiArmed={round.riichiArmed}
              onArmRiichi={round.armRiichi}
              onAnswer={round.answer}
              viewSeat={perspective}
              ended={round.drillOver}
            />
            {showKitaKan && (
              <KitaKanControls
                sanma={options.sanma}
                hand={round.hand}
                drawn={round.drawn}
                canAct={canAct}
                onKita={round.kita}
                onKan={round.kan}
              />
            )}
          </div>
        )
      }
      hand={
        // centred on the board above it, not left-aligned in the page: the calls hang off the
        // right of the hand, so a called hand would otherwise sit visibly off-centre from the
        // felt its own seat is drawn on
        <div className="flex justify-center">
          <HandDisplay
            tiles={bottomHand}
            drawn={bottomDrawn}
            tedashi={round.tedashi?.seat === perspective ? round.tedashi.tile : undefined}
            concealed={bottomConcealed}
            melds={bottomMelds}
            nuki={round.nuki[perspective]}
            onTileClick={canAct ? (i) => round.discard(i) : undefined}
            lockedToDrawn={round.riichi[round.acting]}
          />
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
