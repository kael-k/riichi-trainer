import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Table, type SeatView } from '../../components/tiles/Table'
import { HandDisplay, Tile, UkeireTiles, WallDetails } from '../../components/tiles/Tile'
import { BackButton } from '../../components/TrainerControls'
import type { SafetyTier, TileDanger } from '../../core/danger'
import type { DiscardOption } from '../../core/efficiency'
import type { DiscardEv, EvTerm } from '../../core/ev'
import type { SeatEv } from '../../core/table'
import type { LogEntry } from '../../core/round'
import { parseTenhou, serializeTenhouOrdered, tileCode, type ParsedTile } from '../../core/tiles'
import { validateWall, wallWithHand, type WallError } from '../../core/wall'
import { splitConcealedDrawn } from '../folding/useFoldingRound'
import type { GlossaryTermId } from '../i18n/glossary'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SeatStrip } from '../table/SeatStrip'
import { SettingRow } from '../settings/SettingsDialog'
import { ManualControls, manualControlsVisible } from '../table/ManualControls'
import { useBotDelay, useSettings } from '../settings/settingsStore'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useTableSettings, type SeatConfig, type TableSettings } from '../settings/tableSettings'
import { decodeSituation, resolveSanma, WINDS, type Situation } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { useLogBack } from '../../lib/useLogBack'
import { useLabRound, type LabOptions } from './useLabRound'

/** Only the tiers with a glossary entry get the popover — same subset `FoldFeedback` uses, since
 *  the rest (honour, non-suji, walled) aren't jargon that needs unpacking beyond the reason line. */
const TIER_GLOSSARY: Partial<Record<SafetyTier, GlossaryTermId>> = {
  genbutsu: 'genbutsu',
  suji: 'suji',
  doubleSuji: 'suji',
  halfSuji: 'suji',
}

/** One row of the full ukeire ranking — `DiscardFeedback`'s row shape (tile, shanten/ukeire
 *  label, improving tiles), rendered once per discard instead of once for a best/chosen pair. */
function RankedRow({ option }: { option: DiscardOption }) {
  const { t } = useTranslation()
  return (
    <div className="py-0.5">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <Tile id={option.discard} />
        <span className="text-neutral-500">
          <Trans
            i18nKey="discardFeedback.shantenLine"
            values={{ count: option.shanten }}
            components={{ term: <GlossaryTerm id="shanten" /> }}
          />
        </span>
        <span className="text-neutral-500">
          {t('discardFeedback.tilesSuffix', { count: option.ukeireCount })}
        </span>
      </div>
      <UkeireTiles tiles={option.ukeireTiles} />
    </div>
  )
}

/** How a term reads on screen: how often, times how much, equals what goes into the total. Kept
 *  to three cells so a reader can check the multiplication by eye, which is the whole reason to
 *  prefer a formula to a network that would be more accurate (`plans/EV-3` §9). */
function EvTermRow({ term, seats }: { term: EvTerm; seats: number[] }) {
  const { t } = useTranslation()
  const seat = term.seat === undefined ? '' : ` (${t(`wind.${WINDS[term.seat]}`)})`
  return (
    <div className="flex items-baseline justify-between gap-2 tabular-nums">
      <span className="text-neutral-500">
        {t(`lab.evTerm.${term.kind}`)}
        {seats.length > 1 ? seat : ''}
      </span>
      <span className="text-neutral-500">
        {(term.probability * 100).toFixed(1)}% × {Math.round(term.value)}
      </span>
      <span className={term.points < 0 ? 'text-red-600 dark:text-red-400' : ''}>
        {term.points >= 0 ? '+' : ''}
        {Math.round(term.points)}
      </span>
    </div>
  )
}

/** One priced branch: the tile, what it is worth, and every term underneath it. `plans/EV-3` §9's
 *  screen — the fold row is the same shape as a push row because it is the same expression with
 *  `P(win)` at zero, not a second kind of answer. */
function EvRow({
  entry,
  label,
  chosen,
  seats,
}: {
  entry: DiscardEv
  label: string
  chosen: boolean
  seats: number[]
}) {
  return (
    <div className={`py-1 ${chosen ? '' : 'opacity-70'}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <Tile id={entry.tile} />
        <span className="text-neutral-500">{label}</span>
        <span className="tabular-nums">
          {entry.ev >= 0 ? '+' : ''}
          {Math.round(entry.ev)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 pl-1 text-xs">
        {entry.terms.map((term, i) => (
          <EvTermRow key={i} term={term} seats={seats} />
        ))}
      </div>
    </div>
  )
}

/** One row of the full danger-tier breakdown — `FoldFeedback`'s row shape (tile, tier label,
 *  per-threat reasons), rendered once per held tile rather than once for the thrown/safest pair.
 *  Renders with no per-threat reasons when nobody is in riichi — `assessDiscards` is total over
 *  an empty threat list, so this is not an empty state. */
function DangerRow({ entry, seats }: { entry: TileDanger; seats: number[] }) {
  const { t } = useTranslation()
  return (
    <div className="py-0.5">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <Tile id={entry.tile} />
        <span className="text-neutral-500">{t(`folding.tier.${entry.tier}`)}</span>
      </div>
      {entry.against.length > 0 && (
        <div className="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
          {entry.against.map((against, i) => (
            <p key={i} className="flex flex-wrap items-center gap-1.5">
              {entry.against.length > 1 && (
                <span className="text-neutral-500">{t(`wind.${WINDS[seats[i]]}`)}</span>
              )}
              <span className="font-medium">
                {TIER_GLOSSARY[against.tier] ? (
                  <GlossaryTerm id={TIER_GLOSSARY[against.tier]!}>
                    {t(`folding.tier.${against.tier}`)}
                  </GlossaryTerm>
                ) : (
                  t(`folding.tier.${against.tier}`)
                )}
              </span>
              <span>
                {t(`folding.reason.${against.tier}`, {
                  count: against.tier === 'honour' ? entry.visible : against.because.length,
                })}
              </span>
              <span className="flex items-center [--tile-w:calc(var(--tile-w-base)*0.55)]">
                {against.because.map((tile) => (
                  <Tile key={tile} id={tile} />
                ))}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** The inline, single-sentence wall-validation error (ADR-0005): names the offending zone and tile,
 *  in the same red the wrong-answer feedback rows already use — never a modal, never a repaired
 *  board. */
function wallErrorMessage(
  t: (key: string, opts?: Record<string, unknown>) => string,
  error: WallError,
): string {
  const zone = t(`lab.zone.${error.zone}`)
  const detail = t(`lab.reason.${error.reason}`, {
    tile: error.tile !== undefined ? tileCode(error.tile) : '',
  })
  return t('lab.error', { zone, detail })
}

// stable references so an unchanged "nothing loaded"/"just reset" state doesn't hand
// useLabRound a fresh array identity every render — that would look like a new wall to
// useTableRound and redeal on every render instead of once
const EMPTY_WALL: ParsedTile[] = []
const EMPTY_LOG: LogEntry[] = []

export function LabPage() {
  const { t } = useTranslation()
  const urlSituation = useUrlData(decodeSituation)
  const sanma = useSettings((s) => s.sanma)
  const pace = useBotDelay()
  const kiriageMangan = useSettings((s) => s.kiriageMangan)
  const { aka } = useAdvancedSettings()
  const rawTable = useSettings((s) => s.table)
  const update = useSettings((s) => s.update)
  const { opponentWins, showOpponentHands, showSeatWaits, seatsEnabled } = useTableSettings('lab')
  // `update` only merges at the section level, so a patch of `{ apps: {...} }` would otherwise
  // replace the whole apps layer instead of adding one app's key to it — merge the existing
  // `apps.lab` slice in first.
  const updateTable = (patch: Partial<TableSettings>) =>
    update('table', { apps: { ...rawTable.apps, lab: { ...rawTable.apps.lab, ...patch } } })

  // per-seat algorithms are board state, not a preference (ADR-0015): page state with the same
  // lifetime as `viewSeat` below — seeded from the link, reset on every new hand — never
  // persisted.
  const [seatConfig, setSeatConfig] = useState<SeatConfig | null>(null)

  const [wallInput, setWallInput] = useState('')
  // null: nothing hand-authored yet, fall back to the URL's own wall. Set once per Load/Build
  // press — `sanma` is resolved from the pasted wall's own length the same way a shared link's
  // is, so a pasted sanma wall doesn't get padded back out to 136 tiles under a stale yonma setting.
  const [manual, setManual] = useState<{
    wall: ParsedTile[]
    error?: WallError
    sanma: boolean
  } | null>(null)

  const loadWall = () => {
    const parsed = parseTenhou(wallInput)
    const wallSanma = resolveSanma(parsed, urlSituation.sanma, sanma)
    const error = validateWall(parsed, wallSanma ? 3 : 4, wallSanma)
    setManual(
      error ? { wall: EMPTY_WALL, error, sanma: wallSanma } : { wall: parsed, sanma: wallSanma },
    )
  }
  // seeds the input from a fresh random wall so the reader edits a real board rather than typing
  // 136 tiles from nothing — parsed and validated only once Load is pressed afterward
  const buildWall = () => setWallInput(serializeTenhouOrdered(wallWithHand(0, [], sanma, aka)))
  // no confirmation dialog: the cleared state is session-local and reconstructable by re-loading
  // the same link, the same reasoning the log panel's clear button already relies on
  const resetWall = () => {
    setWallInput('')
    setManual(null)
  }

  const situation: Situation = useMemo(
    () =>
      manual
        ? {
            ...urlSituation,
            wall: manual.wall,
            wallError: manual.error,
            log: EMPTY_LOG,
            sanma: manual.sanma,
          }
        : urlSituation,
    [urlSituation, manual],
  )

  const options = useMemo<LabOptions>(
    () => ({
      aka: situation.aka ?? aka,
      sanma: situation.sanma ?? sanma,
      opponentWins,
      kiriageMangan,
      showOpponentHands,
      showSeatWaits,
      seats: seatConfig,
      pace,
    }),
    [
      situation,
      aka,
      sanma,
      opponentWins,
      kiriageMangan,
      showOpponentHands,
      showSeatWaits,
      seatConfig,
      pace,
    ],
  )

  const round = useLabRound(situation, options)
  const threatSeats = round.riichi.flatMap((inRiichi, seat) => (inRiichi ? [seat] : []))
  const { canBack, back } = useLogBack()

  // perspective is view-only and ephemeral: the page's own state, never the round's — reset to
  // the drill's own seat on every new hand, never persisted
  const [viewSeat, setViewSeat] = useState<number | null>(null)
  const [lastSituation, setLastSituation] = useState(situation)
  if (situation !== lastSituation) {
    setLastSituation(situation)
    setViewSeat(null)
    setSeatConfig(null)
  }
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
      // the felt omits a hand row for whichever seat sits at the bottom of the board — that is
      // where HandDisplay, in the page's own `hand` slot, already sits, and that seat's calls go
      // beside it there rather than on the felt's edge, where nothing sizes them against its hand
      melds: seat !== perspective ? round.melds[seat] : undefined,
      nuki: seat !== perspective ? round.nuki[seat] : undefined,
      riichi: round.riichi[seat],
      hand: seat !== perspective ? hand : undefined,
      drawn: seat !== perspective ? drawn : undefined,
      tedashi: round.tedashi?.seat === seat ? round.tedashi.tile : undefined,
      // finished alone has always revealed here (a post-game reveal, same as reading a real score
      // sheet); showOpponentHands now does the same live, mid-hand — previously this page never
      // read that setting at all, so toggling it did nothing. A manual seat is the reader's own
      // hand and never concealed from them, wherever it sits
      concealed: !(round.finished || showOpponentHands || round.manualSeats.includes(seat)),
      points: round.match.points[seat],
      claiming: round.claim?.kind === 'discard' && round.claim.from === seat,
    }
  })

  // the bottom hand follows perspective, not the drill's own graded seat: rotating to watch
  // another seat shows that seat's hand — `boardHands` already carries the reveal gate above, so
  // an unrevealed seat's tiles stay filler at the data level regardless of where the board is
  // drawn from. Only when the perspective is genuinely the seat whose turn it is can any of it be
  // acted on
  const viewingManual = round.manualSeats.includes(perspective)
  const { tiles: bottomHand, drawn: bottomDrawn } = splitConcealedDrawn(
    round.boardHands[perspective] ?? [],
    perspective === round.drawnSeat ? round.drawn : undefined,
  )
  const bottomConcealed = !(round.finished || showOpponentHands || viewingManual)
  const canAct = perspective === round.acting && !round.finished

  // the priced turn is kept until the board moves rather than recomputed: it is the expensive
  // answer on this page, and it is an answer about one particular turn. `at` is what says which
  const [ev, setEv] = useState<(SeatEv & { at: number }) | null>(null)
  const fresh = ev && ev.at === round.discardCount ? ev : null

  const wallError = situation.wallError
  const loaded = situation.wall.length > 0 && !wallError
  const riichiTiles = loaded ? round.riichiTiles() : []
  // whether `controls` has anything to float at all — mirrors `ManualControls`' own "nothing to
  // show" branches, so `BoardStage`'s positioned card is never rendered empty (and, being
  // `pointer-events-auto`, never left standing as an invisible dead zone over the felt)
  const showControls =
    loaded &&
    manualControlsVisible({
      acting: round.acting,
      claim: round.claim,
      riichiTiles,
      viewSeat: perspective,
      ended: round.finished,
    })

  const settingsRows = (
    <>
      <SettingRow label={t('folding.settings.opponentWins')}>
        <input
          type="checkbox"
          checked={opponentWins}
          onChange={(e) => updateTable({ opponentWins: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
    </>
  )

  // the wall this page is here to author, and everything it says about the one it has. Both live
  // in the session panel: the board is what the lab is looking at, and this is what you type at it
  const wallPanel = (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor="lab-wall-input" className="text-xs font-medium text-neutral-500">
          {t('lab.wallInputLabel')}
        </label>
        <input
          id="lab-wall-input"
          type="text"
          value={wallInput}
          onChange={(e) => setWallInput(e.target.value)}
          className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadWall}
            className="min-h-11 w-fit rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t('lab.loadWall')}
          </button>
          <button
            type="button"
            onClick={buildWall}
            className="min-h-11 w-fit rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
          >
            {t('lab.buildWall')}
          </button>
          <button
            type="button"
            onClick={resetWall}
            className="min-h-11 w-fit rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
          >
            {t('lab.resetWall')}
          </button>
        </div>
      </div>

      {loaded && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-neutral-500">{t('lab.ranking')}</span>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
              {round.ranked.map((option) => (
                <RankedRow key={option.discard} option={option} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-neutral-500">{t('lab.danger')}</span>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
              {round.danger.map((entry) => (
                <DangerRow key={entry.tile} entry={entry} seats={threatSeats} />
              ))}
            </div>
          </div>

          {/* asked for rather than computed every turn: an exact ranking is hundreds of
              milliseconds where the two lists above are a handful, and a board that priced every
              turn on the chance somebody looked would be a board nobody wants to play on */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-neutral-500">{t('lab.ev')}</span>
            {fresh ? (
              <div className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                <p className="text-xs text-neutral-500">
                  {t('lab.evUnder', {
                    wind: t(`wind.${WINDS[fresh.seat]}`),
                    model: t(`seats.evModel.${fresh.model}`),
                    objective: t(`seats.evObjective.${fresh.objective}`),
                  })}
                </p>
                {fresh.unsupported && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t('lab.evUnsupported', { reason: fresh.unsupported })}
                  </p>
                )}
                <div className="max-h-64 overflow-y-auto">
                  {fresh.push.map((entry) => (
                    <EvRow
                      key={entry.tile}
                      entry={entry}
                      label={t('lab.evPush')}
                      chosen={fresh.best === 'push' && entry === fresh.push[0]}
                      seats={threatSeats}
                    />
                  ))}
                  <EvRow
                    entry={fresh.fold}
                    label={t('lab.evFold')}
                    chosen={fresh.best === 'fold'}
                    seats={threatSeats}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEv(round.priceTurn())}
                className="min-h-11 w-fit rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
              >
                {t('lab.priceTurn')}
              </button>
            )}
          </div>
        </>
      )}
    </>
  )

  return (
    <BoardStage
      title={t('trainer.lab.title')}
      app="lab"
      intro={{ text: t('trainer.lab.intro'), wikiUrl: TRAINER_WIKI.lab }}
      settings={settingsRows}
      chrome={<BackButton canBack={canBack} onBack={back} backLabel={t('common.undoAction')} />}
      wall={
        loaded ? (
          <WallDetails
            dealt={round.dealtTiles}
            liveWall={round.liveWallSnapshot}
            liveWallDrawn={round.liveWallDrawn}
            deadWall={round.deadWallSnapshot}
            replacements={round.replacements}
            players={round.rivers.length}
            seat={perspective}
          />
        ) : undefined
      }
      panel={wallPanel}
      board={
        loaded ? (
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
            activeSeat={round.finished ? undefined : round.acting}
            call={round.callBanner}
          />
        ) : undefined
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
        loaded ? (
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
        ) : undefined
      }
    >
      {/* nothing dealt: the board area says why instead of standing empty */}
      {wallError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{wallErrorMessage(t, wallError)}</p>
      ) : (
        !loaded && <p className="text-sm text-neutral-500">{t('lab.empty')}</p>
      )}
    </BoardStage>
  )
}
