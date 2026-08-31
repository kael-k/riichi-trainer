import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alpha } from '../../components/Alpha'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Table, type SeatView } from '../../components/tiles/Table'
import { HandDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { Timer, TrainerToggles } from '../../components/TrainerControls'
import { EV_MODELS, type EvModelName } from '../../core/evModel'
import { HONOR } from '../../core/tiles'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SeatStrip } from '../table/SeatStrip'
import { SettingRow } from '../settings/SettingsDialog'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useBotDelay, useSettings } from '../settings/settingsStore'
import { useTableSettings, type SeatConfig, type TableSettings } from '../settings/tableSettings'
import { WINDS } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { ManualControls, manualControlsVisible } from '../table/ManualControls'
import { Verdict } from '../table/Verdict'
import {
  decodeFoldingUrl,
  FOLDING_VERDICT_TEXT_KEY,
  foldingVerdictSeverity,
  splitConcealedDrawn,
  useFoldingRound,
  type FoldingOptions,
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
  const advanced = useSettings((s) => s.advanced)
  const { evGrading } = useAdvancedSettings()
  const pace = useBotDelay()
  // folding always shows the board (reading it is the drill); the reveal gate below
  // withholds real tile ids until `round.finished` or `showOpponentHands`
  const { showOpponentHands, showSeatWaits, threats, opponentWins, seatsEnabled } =
    useTableSettings('folding')
  // `update` only merges at the section level, so a patch of `{ apps: {...} }` would otherwise
  // replace the whole apps layer instead of adding one app's key to it — merge the existing
  // `apps.folding` slice in first.
  const updateTable = (patch: Partial<TableSettings>) =>
    update('table', { apps: { ...rawTable.apps, folding: { ...rawTable.apps.folding, ...patch } } })

  // per-seat algorithms are board state, not a preference: page state with the same
  // lifetime as `viewSeat` below — seeded from the link, reset on every new hand — never
  // persisted.
  const [seatConfig, setSeatConfig] = useState<SeatConfig | null>(null)

  const options = useMemo<FoldingOptions>(() => {
    const isSanma = urlData.sanma ?? sanma
    return {
      ...settings,
      // the advanced-resolved value, not `settings.evGrading` straight — a hidden row must not
      // mean a live mode (`useAdvancedSettings.ts`, same rule `exactFu` already follows)
      evGrading,
      sanma: isSanma,
      opponentWins: urlData.wins ?? opponentWins,
      // one seat has to be left to fold; a link can pin a count this table cannot seat
      threats: Math.min(urlData.threats ?? threats, (isSanma ? 3 : 4) - 1),
      showOpponentHands,
      showSeatWaits,
      seats: seatConfig,
      pace,
    }
  }, [
    urlData,
    sanma,
    settings,
    evGrading,
    threats,
    opponentWins,
    showOpponentHands,
    showSeatWaits,
    seatConfig,
    pace,
  ])

  const round = useFoldingRound(urlData, options)
  // a hook, so called unconditionally ahead of the loading/failed early return below
  const { canBack, back } = useLogBack()
  const players = options.sanma ? 3 : 4
  // perspective is a pure viewing choice — which seat `Table` draws at the bottom — held as the
  // page's own ephemeral state, never the round's or the settings store's: it never reaches
  // `useFoldingRound` at all, so changing it can never re-search for a new hand or persist across
  // hands. `round.seatIndex` (the drill's own generated seat) is the default until someone picks
  // a different one for this hand; it resets back to that default on every new hand
  const [viewSeat, setViewSeat] = useState<number | null>(null)
  const [lastUrlData, setLastUrlData] = useState(urlData)
  if (urlData !== lastUrlData) {
    setLastUrlData(urlData)
    setViewSeat(null)
    setSeatConfig(null)
  }
  const perspective = viewSeat ?? round.seatIndex
  const nextHand = () => {
    setViewSeat(null)
    setSeatConfig(null)
    round.next()
  }

  const settingsRows = (
    <>
      <SettingRow label={t('folding.settings.feedbackAtEnd')}>
        <input
          type="checkbox"
          checked={settings.feedbackAtEnd}
          onChange={(e) => update('folding', { feedbackAtEnd: e.target.checked })}
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
      {/* alpha: tiers stay the permanent default grading, this only
          switches what a turn is graded *against* — and it is read through `useAdvancedSettings`
          (`evGrading` above), so hiding this row when Advanced is off actually turns the mode off
          rather than leaving it running unseen */}
      {advanced && (
        <>
          <SettingRow
            label={
              <span className="flex items-center gap-1.5">
                {t('folding.settings.evGrading')}
                <Alpha />
              </span>
            }
          >
            <input
              type="checkbox"
              checked={settings.evGrading}
              onChange={(e) => update('folding', { evGrading: e.target.checked })}
              className="size-5"
            />
          </SettingRow>
          {settings.evGrading && (
            <>
              <p className="text-xs text-neutral-500">{t('common.alphaNote')}</p>
              <SettingRow label={t('evGrading.model')}>
                <select
                  value={settings.evModel}
                  onChange={(e) => update('folding', { evModel: e.target.value as EvModelName })}
                  className="min-h-11 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {(Object.keys(EV_MODELS) as EvModelName[]).map((model) => (
                    <option key={model} value={model}>
                      {t(`seats.evModel.${model}`)}
                    </option>
                  ))}
                </select>
              </SettingRow>
              {EV_MODELS[settings.evModel].unsupported(players === 3) && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {EV_MODELS[settings.evModel].unsupported(players === 3)}
                </p>
              )}
              <SettingRow label={t('evGrading.near')}>
                <input
                  type="number"
                  min={0}
                  value={settings.evBands[settings.evModel].near}
                  onChange={(e) =>
                    update('folding', {
                      evBands: {
                        ...settings.evBands,
                        [settings.evModel]: {
                          ...settings.evBands[settings.evModel],
                          near: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="min-h-11 w-24 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </SettingRow>
              <SettingRow label={t('evGrading.wrong')}>
                <input
                  type="number"
                  min={0}
                  value={settings.evBands[settings.evModel].wrong}
                  onChange={(e) =>
                    update('folding', {
                      evBands: {
                        ...settings.evBands,
                        [settings.evModel]: {
                          ...settings.evBands[settings.evModel],
                          wrong: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="min-h-11 w-24 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </SettingRow>
            </>
          )}
        </>
      )}
    </>
  )

  if (round.loading || round.failed) {
    return (
      <BoardStage title={t('trainer.folding.title')} app="folding" settings={settingsRows}>
        <div className="flex flex-col items-center gap-4">
          <p className="text-center text-neutral-500">
            {t(round.failed ? 'folding.noHand' : 'folding.dealing')}
          </p>
          {round.failed && (
            <button
              type="button"
              onClick={nextHand}
              className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('common.newRound')}
            </button>
          )}
        </div>
      </BoardStage>
    )
  }

  const toggles = {
    paused: round.paused,
    onToggle: round.togglePause,
    toggleLabel: t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer'),
    canBack,
    onBack: back,
    backLabel: t('common.undoAction'),
    onReset: nextHand,
    resetLabel: t('common.resetHand'),
  }

  const seats: SeatView[] = round.rivers.map((river, seat) => {
    const mine = round.manualSeats.includes(seat)
    // the seat the board is drawn from — *not* the drill's own graded seat, which is only the
    // same thing until someone moves the perspective. The bottom of the felt is where the hand
    // below the board (`HandDisplay`) already sits, so a hand drawn there too lands on top of it:
    // watching from another side used to leave a face-down row stacked over your own face-up
    // tiles, reading as "your hand, concealed from you". The graded seat, once it is elsewhere,
    // is an ordinary seat on the felt — and a seat you play, so `boardHands` gives it real faces
    // its calls go with them (`HandDisplay`'s own `melds` below), not on the felt: they belong
    // beside the hand they were called into, at a size that reads against it
    if (seat === perspective) {
      return {
        river,
        riichi: round.riichi[seat],
        points: round.match.points[seat],
      }
    }
    // `round.boardHands` is already the reveal gate for a threat: face-down filler at the right
    // count until `round.finished` or `showOpponentHands`, real tiles after (and always real for a
    // seat someone plays, `boardHandsOf`'s own `isManual` check). A bystander's tiles are real
    // throughout, same as an ordinary opponent's elsewhere — and the seat mid-turn holds fourteen,
    // so its draw is split off into the same small gap the bottom hand already keeps, filler
    // included (`splitConcealedDrawn` takes the last back when the tiles have no identity)
    const { tiles: hand, drawn } = splitConcealedDrawn(
      round.boardHands[seat] ?? [],
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
    }
  })
  // everything that would tell you how the fold is going so far, held back mid-hand when asked
  const answersHeld = settings.feedbackAtEnd && !round.finished

  // the bottom hand follows perspective, not the drill's own graded seat: rotating to watch
  // another seat shows that seat's hand — `boardHands` already carries the reveal gate, so a
  // threat's tiles stay filler at the data level regardless of where the board is drawn from.
  // Only when the perspective is genuinely the seat whose turn it is can any of it be acted on
  const viewingManual = round.manualSeats.includes(perspective)
  const { tiles: bottomHand, drawn: bottomDrawn } = splitConcealedDrawn(
    round.boardHands[perspective] ?? [],
    perspective === round.drawnSeat ? round.drawn : undefined,
  )
  const bottomConcealed = !viewingManual && !showOpponentHands
  const canAct = perspective === round.acting && !round.finished
  const riichiTiles = round.riichiTiles()
  // whether `controls` has anything to float at all — mirrors `ManualControls`' own "nothing to
  // show" branches, so `BoardStage`'s positioned card is never rendered empty (and, being
  // `pointer-events-auto`, never left standing as an invisible dead zone over the felt)
  const showControls = manualControlsVisible({
    acting: round.acting,
    claim: round.claim,
    riichiTiles,
    viewSeat: perspective,
    ended: round.finished,
  })

  // how the session is going — passed to BoardStage's `status`, which floats it as a HUD over the board
  const scoreLines = (
    <>
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
      <span>{t('folding.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
    </>
  )

  return (
    <BoardStage
      title={t('trainer.folding.title')}
      app="folding"
      intro={{ text: t('trainer.folding.intro'), wikiUrl: TRAINER_WIKI.folding }}
      settings={settingsRows}
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
                players={players}
                defaultOrientation={round.seatIndex}
                config={seatConfig}
                onChange={setSeatConfig}
                fallbackModes={round.algorithms}
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
          round={WINDS[round.round - HONOR]}
          roundNumber={round.match.round}
          dealerRepeat={round.match.dealerRepeat}
          doraIndicators={round.doraIndicators}
          wallCount={round.liveWall.length}
          honba={round.match.honba}
          activeSeat={round.finished ? undefined : round.acting}
          call={round.callBanner}
        />
      }
      controls={
        showControls && (
          <ManualControls
            acting={round.acting}
            claim={round.claim}
            riichiTiles={riichiTiles}
            riichiArmed={round.riichiArmed}
            onArmRiichi={round.armRiichi}
            onAnswer={round.answer}
            viewSeat={perspective}
            ended={round.finished}
          />
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
            melds={round.melds[perspective]}
            nuki={round.nuki[perspective]}
            onTileClick={canAct ? (i) => round.discard(i) : undefined}
            lockedToDrawn={round.riichi[round.acting]}
          />
        </div>
      }
      // one notice per graded throw. Under `feedbackAtEnd` there is nothing to key off until
      // the hand is over, and the whole run then lands in the end card instead
      noticeKey={settings.feedbackAtEnd ? undefined : round.results.length}
      noticeCompact={
        !settings.feedbackAtEnd &&
        round.lastResult && (
          <Verdict
            severity={foldingVerdictSeverity(round.lastResult)}
            text={t(FOLDING_VERDICT_TEXT_KEY[foldingVerdictSeverity(round.lastResult)])}
          />
        )
      }
      end={
        // a claim pending on the hand's final discard holds the round suspended with `end`
        // already derivable — the card waits for the answer, never shares the board with it
        round.end &&
        !round.claim && (
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
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {t('folding.avgTime', { time: formatElapsedMs(round.roundAverageTime) })}
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
              onClick={nextHand}
              className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('folding.newSituation')}
            </button>
          </div>
        )
      }
      wall={
        <WallDetails
          dealt={round.dealtTiles}
          liveWall={round.liveWallSnapshot}
          liveWallDrawn={round.liveWallDrawn}
          deadWall={round.deadWallSnapshot}
          replacements={round.replacements}
          players={players}
          seat={perspective}
        />
      }
    />
  )
}
