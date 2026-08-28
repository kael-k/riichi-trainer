import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BoardStage } from '../../components/tiles/BoardStage'
import { BackButton, ResetButton } from '../../components/TrainerControls'
import { Table, type SeatView } from '../../components/tiles/Table'
import { HandDisplay, WallDetails } from '../../components/tiles/Tile'
import { EV_MODELS } from '../../core/evModel'
import { ranks, resultPoints } from '../../core/placement'
import type { MatchFormat, MatchState } from '../../core/match'
import { mulberry32, shuffle } from '../../core/rng'
import { HONOR } from '../../core/tiles'
import { useLogBack } from '../../lib/useLogBack'
import { splitConcealedDrawn } from '../folding/useFoldingRound'
import { formatMatchResult } from '../i18n/formatLogEntry'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { useBotDelay, useSettings } from '../settings/settingsStore'
import { RulesetSettings, SegmentedButton } from '../settings/SettingsDialog'
import { choiceValue, SEAT_CHOICES, SELECT_CLASS } from '../settings/SeatPanel'
import {
  matchDefaultModes,
  resolveSeatConfig,
  useTableSettings,
  withSeatEv,
  withSeatMode,
  type SeatConfig,
} from '../settings/tableSettings'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { decodeSituation, WINDS } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { KitaKanControls, kitaKanVisible } from '../table/KitaKanControls'
import { ManualControls, manualControlsVisible } from '../table/ManualControls'
import { SeatStrip } from '../table/SeatStrip'
import { useMatchRound, type RoundSettlement } from './useMatchRound'

/** What Start hands to the board: the ruleset, captured once rather than read live — a match that
 *  changed player count or red-fives mid-game would corrupt its own carried-over `MatchState`. */
export interface MatchConfig {
  format: MatchFormat
  sanma: boolean
  aka: boolean
  kiriageMangan: boolean
  /** Only the *initial* per-seat algorithms — `MatchBoard` seeds its own live `useState` from
   *  this once and never reads it again, exactly like every other trainer's seat panel. */
  seats: SeatConfig | null
}

/** Step 1: format, ruleset, who plays which seat — the setup screen `docs/adr/0040` describes.
 *  No board exists yet, so this reuses the same shared `RulesetSettings` every trainer's settings
 *  dialog already draws, and the same seat-choice dropdown `SeatPanel.tsx`'s per-seat dialog
 *  offers, laid flat instead of behind a corner button since there is no felt to hang one off yet.
 *  A full-bot cast is legal here (`requireManual: false`) — the reader may move every seat off
 *  manual and just watch. */
function MatchSetup({ onStart }: { onStart: (config: MatchConfig) => void }) {
  const { t } = useTranslation()
  const sanma = useSettings((s) => s.sanma)
  const kiriageMangan = useSettings((s) => s.kiriageMangan)
  const { aka } = useAdvancedSettings()
  const players = sanma ? 3 : 4
  const [format, setFormat] = useState<MatchFormat>('hanchan')
  const [seatConfig, setSeatConfig] = useState<SeatConfig | null>(null)
  // off by default: a real match draws seats rather than asking, so the rows carry no wind until
  // the reader opts into choosing. `resolved` still resolves seat-by-seat position 0..n-1 either
  // way — only the row's label, and whether Start shuffles the result, differ.
  const [chooseSeats, setChooseSeats] = useState(false)
  const resolved = resolveSeatConfig(seatConfig, players, 0, matchDefaultModes(players), false)

  function start() {
    let seats = resolved
    if (!chooseSeats) {
      const order = shuffle(
        Array.from({ length: players }, (_, i) => i),
        mulberry32(String(Date.now())),
      )
      seats = { modes: order.map((i) => resolved.modes[i]), ev: order.map((i) => resolved.ev?.[i]) }
    }
    onStart({ format, sanma, aka, kiriageMangan, seats })
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-neutral-500">{t('match.setup.format')}</span>
        <div className="flex gap-1">
          <SegmentedButton active={format === 'tonpuu'} onClick={() => setFormat('tonpuu')}>
            {t('match.format.tonpuu')}
          </SegmentedButton>
          <SegmentedButton active={format === 'hanchan'} onClick={() => setFormat('hanchan')}>
            {t('match.format.hanchan')}
          </SegmentedButton>
        </div>
      </div>

      <RulesetSettings />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-neutral-500">{t('match.setup.seats')}</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chooseSeats}
              onChange={(e) => setChooseSeats(e.target.checked)}
              className="size-5"
            />
            {t('match.setup.chooseSeats')}
          </label>
        </div>
        {Array.from({ length: players }, (_, seat) => {
          const label = chooseSeats
            ? t(`wind.${WINDS[seat]}`)
            : t('match.setup.seat', { number: seat + 1 })
          return (
            <div key={seat} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{label}</span>
              <select
                aria-label={label}
                value={choiceValue({
                  mode: resolved.modes[seat],
                  model: resolved.ev?.[seat]?.model,
                })}
                onChange={(e) => {
                  const choice = SEAT_CHOICES.find((c) => choiceValue(c) === e.target.value)
                  if (!choice) return
                  setSeatConfig({
                    modes: withSeatMode(seatConfig?.modes ?? [], seat, choice.mode),
                    ev: choice.model
                      ? withSeatEv(seatConfig?.ev, seat, { model: choice.model })
                      : seatConfig?.ev,
                  })
                }}
                className={SELECT_CLASS}
              >
                {SEAT_CHOICES.map((choice) => {
                  const hououReason =
                    choice.model === 'houou' ? EV_MODELS.houou.unsupported(sanma) : null
                  return (
                    <option
                      key={choiceValue(choice)}
                      value={choiceValue(choice)}
                      disabled={hououReason !== null}
                    >
                      {choice.model
                        ? t(`seats.evChoice.${choice.model}`)
                        : t(`seats.mode.${choice.mode}`)}
                    </option>
                  )
                })}
              </select>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={start}
        className="min-h-11 w-fit rounded-lg bg-neutral-900 px-6 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        {t('match.start')}
      </button>
    </div>
  )
}

/** One settled round's card: what happened, each seat's point change, and the button on to the
 *  next round — `formatMatchResult` is the exact sentence the log's own row renders, so the two
 *  never disagree about what a round decided. */
function RoundCard({ settlement, onNext }: { settlement: RoundSettlement; onNext: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-neutral-100 p-4 dark:bg-neutral-900">
      <p className="font-semibold">{formatMatchResult(t, settlement.result)}</p>
      <div className="flex flex-col gap-0.5 text-sm text-neutral-600 dark:text-neutral-400">
        {settlement.deltas.map(
          (delta, seat) =>
            delta !== 0 && (
              <p key={seat}>
                {t(`wind.${WINDS[seat]}`)}: {delta >= 0 ? '+' : ''}
                {delta.toLocaleString()}
              </p>
            ),
        )}
      </div>
      <button
        type="button"
        onClick={onNext}
        className="mt-2 min-h-11 w-fit rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        {t('common.newRound')}
      </button>
    </div>
  )
}

/** The match is over: final standings by rank, raw points, and the Tenhou result points
 *  (`core/placement.ts#resultPoints`) the placement objective is itself maximising. */
function FinalCard({
  match,
  sanma,
  onNewMatch,
}: {
  match: MatchState
  sanma: boolean
  onNewMatch: () => void
}) {
  const { t } = useTranslation()
  const rank = ranks(match.points)
  const order = match.points
    .map((points, seat) => ({ seat, points, rank: rank[seat] }))
    .sort((a, b) => a.rank - b.rank)
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-neutral-100 p-4 dark:bg-neutral-900">
      <p className="font-semibold">{t('match.over')}</p>
      <div className="flex flex-col gap-1 text-sm">
        {order.map(({ seat, points, rank: r }) => {
          const result = resultPoints(points, r, sanma)
          return (
            <p key={seat} className="flex items-baseline justify-between gap-3 tabular-nums">
              <span>
                #{r} {t(`wind.${WINDS[seat]}`)}
              </span>
              <span className="text-neutral-500">{points.toLocaleString()}</span>
              <span className={result >= 0 ? 'text-green-700 dark:text-green-400' : ''}>
                {result >= 0 ? '+' : ''}
                {result.toFixed(1)}
              </span>
            </p>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onNewMatch}
        className="mt-2 min-h-11 w-fit rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        {t('match.newMatch')}
      </button>
    </div>
  )
}

/** Step 2: the match itself, played out on the shared table layer exactly like every other board
 *  trainer — `useMatchRound` is the only thing this component doesn't share with the lab. */
function MatchBoard({ config, onExit }: { config: MatchConfig; onExit: () => void }) {
  const { t } = useTranslation()
  const { showOpponentHands, showSeatWaits, seatsEnabled } = useTableSettings('match')
  const pace = useBotDelay()

  // seats are match state, not per-hand page state: they must NOT reset between rounds the way
  // every graded trainer resets its seat panel on a new hand, since a match's cast doesn't change
  // mid-game. Seeded once from the setup screen's own choice.
  const [seatConfig, setSeatConfig] = useState<SeatConfig | null>(config.seats)
  const [viewSeat, setViewSeat] = useState<number | null>(null)

  // the log's own rewind and the undo button both work by pushing a situation into the URL —
  // `useMatchRound` resyncs the round in progress from it when its identity changes (a real
  // navigation), and leaves ordinary play (`nextRound`'s own local wall/match advance) alone
  const situation = useUrlData(decodeSituation)
  const { canBack, back } = useLogBack()

  const round = useMatchRound(
    {
      format: config.format,
      sanma: config.sanma,
      aka: config.aka,
      kiriageMangan: config.kiriageMangan,
      seats: seatConfig,
      showOpponentHands,
      showSeatWaits,
      pace,
    },
    situation,
  )

  const perspective = viewSeat ?? round.seatIndex

  const seats: SeatView[] = round.rivers.map((river, seat) => {
    // the seat mid-turn holds fourteen: its draw sits apart from the thirteen, the same small gap
    // the bottom hand already keeps, so a reader can see *which* tile a seat just took
    const { tiles: hand, drawn } = splitConcealedDrawn(
      round.boardHands[seat] ?? [],
      seat === round.drawnSeat ? round.drawn : undefined,
    )
    return {
      river,
      melds: seat !== perspective ? round.melds[seat] : undefined,
      nuki: seat !== perspective ? round.nuki[seat] : undefined,
      riichi: round.riichi[seat],
      hand: seat !== perspective ? hand : undefined,
      drawn: seat !== perspective ? drawn : undefined,
      tedashi: round.tedashi?.seat === seat ? round.tedashi.tile : undefined,
      concealed: !(round.finished || showOpponentHands || round.manualSeats.includes(seat)),
      points: round.match.points[seat],
      claiming: round.claim?.kind === 'discard' && round.claim.from === seat,
    }
  })

  const viewingManual = round.manualSeats.includes(perspective)
  const { tiles: bottomHand, drawn: bottomDrawn } = splitConcealedDrawn(
    round.boardHands[perspective] ?? [],
    perspective === round.drawnSeat ? round.drawn : undefined,
  )
  const bottomConcealed = !(round.finished || showOpponentHands || viewingManual)
  const canAct = perspective === round.acting && !round.finished

  const riichiTiles = round.riichiTiles()
  const showKitaKan = kitaKanVisible({
    sanma: config.sanma,
    hand: round.hand,
    drawn: round.drawn,
    melds: round.melds[perspective],
    canAct,
  })
  const showControls =
    showKitaKan ||
    manualControlsVisible({
      acting: round.acting,
      claim: round.claim,
      riichiTiles,
      viewSeat: perspective,
      ended: round.finished,
    })

  const myRank = ranks(round.match.points)[round.seatIndex]

  return (
    <BoardStage
      title={t('trainer.match.title')}
      app="match"
      intro={{ text: t('trainer.match.intro'), wikiUrl: TRAINER_WIKI.match }}
      chrome={
        <>
          <BackButton canBack={canBack} onBack={back} backLabel={t('common.undoAction')} />
          <ResetButton onReset={onExit} resetLabel={t('match.quit')} />
        </>
      }
      status={
        <span className="tabular-nums">
          {t('match.status', { rank: myRank, players: round.rivers.length })} ·{' '}
          {round.match.points[round.seatIndex].toLocaleString()}
        </span>
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
                // a full-bot cast is a real choice on `/match`, not an empty table — see
                // `matchDefaultModes`'s own doc comment
                requireManual={false}
              />
            )
          }
          seats={seats}
          seatIndex={perspective}
          round={WINDS[round.match.prevalentWind - HONOR] ?? 'E'}
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
          <div className="flex flex-wrap items-center justify-center gap-2">
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
            {showKitaKan && (
              <KitaKanControls
                sanma={config.sanma}
                hand={round.hand}
                drawn={round.drawn}
                melds={round.melds[perspective]}
                canAct={canAct}
                onKita={round.kita}
                onKan={round.kan}
                onKakan={round.kakan}
              />
            )}
          </div>
        )
      }
      hand={
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
      end={
        round.settlement &&
        (round.over ? (
          <FinalCard match={round.match} sanma={config.sanma} onNewMatch={onExit} />
        ) : (
          <RoundCard settlement={round.settlement} onNext={round.nextRound} />
        ))
      }
    />
  )
}

/** `/match`: a whole east-only or hanchan match against the bots, nothing graded — the points
 *  are the score (ADR-0040). Two steps, one component each: `MatchSetup` until Start is pressed,
 *  `MatchBoard` for the length of the match — different component types in the same slot, so a
 *  fresh match after "New match" starts from a clean board rather than one that has to notice its
 *  config changed.
 *
 *  The swap goes through one blank render (`settled`) rather than straight from one to the other.
 *  `BoardStage` clears the shared log store inline during its own first render, not from a mount
 *  effect (its own doc comment: effects run children-first, so a page that logs as it mounts would
 *  have those rows wiped a moment later). A direct `config ? <MatchBoard/> : <MatchSetup/>` swap
 *  lets React render the *new* `BoardStage`'s clear() while the *old* one's `LogList` is still
 *  mounted and subscribed to that store — "cannot update a component while rendering a different
 *  component". Rendering neither for one tick lets the old tree fully unmount before the new one
 *  mounts, so the two `BoardStage`s never coexist in the same pass. */
export function MatchPage() {
  const [config, setConfig] = useState<MatchConfig | null>(null)
  const [settled, setSettled] = useState(true)
  const { t } = useTranslation()

  function transition(next: MatchConfig | null) {
    setSettled(false)
    setConfig(next)
  }
  useEffect(() => {
    if (!settled) setSettled(true)
  }, [settled])

  if (!settled) return null
  if (!config) {
    return (
      <BoardStage title={t('trainer.match.title')} intro={{ text: t('trainer.match.intro') }}>
        <MatchSetup onStart={transition} />
      </BoardStage>
    )
  }
  return <MatchBoard config={config} onExit={() => transition(null)} />
}
