import { CheckCircle2, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BoardStage } from '../../components/tiles/BoardStage'
import { useFullscreenBoard } from '../../components/tiles/useFullscreenBoard'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Table, type SeatView } from '../../components/tiles/Table'
import {
  FullscreenToggle,
  TrainerStatusBar,
  TrainerToggles,
} from '../../components/TrainerControls'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { concealedTiles, wallDrawnCount } from '../../core/round'
import { HONOR, serializeTenhou } from '../../core/tiles'
import { INITIAL_HAND_SIZE } from '../../core/wall'
import { WINDS } from '../situation/urlCodec'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { useTermName } from '../i18n/useTermName'
import { SettingRow, SettingsButton } from '../settings/SettingsDialog'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useSettings } from '../settings/settingsStore'
import { useTableSettings } from '../settings/tableSettings'
import { ScoreBreakdown } from './ScoreBreakdown'
import { decodeScoringUrl } from './scoringUrl'
import { useUrlData } from '../situation/useUrlData'
import { useScoringRound, type Answer, type ScoringOptions } from './useScoringRound'

const FLAG_KEYS = [
  'riichi',
  'doubleRiichi',
  'ippatsu',
  'haitei',
  'houtei',
  'rinshan',
  'chankan',
] as const

/** One numeric answer field; the value is read at submit from the form's `FormData`. */
function NumberField({
  name,
  label,
  step,
  autoFocus,
}: {
  name: string
  label: string
  step?: number
  autoFocus?: boolean
}) {
  return (
    // the label is a hint inside the field rather than a word parked beside it: "Han" against an
    // empty box says the same thing in a third of the width, which is what lets the fields stand
    // in one row on anything wider than a phone held upright. It rides up to the field's top edge
    // once there is a value to read, so the question never disappears behind the answer
    <label className="relative flex min-w-28 flex-1 flex-col">
      <input
        type="number"
        name={name}
        min={0}
        step={step}
        autoFocus={autoFocus}
        inputMode="numeric"
        // `placeholder=" "`: `:placeholder-shown` is the only pure-CSS read of "this field is
        // empty", and it needs a placeholder to shadow
        placeholder=" "
        className="peer min-h-14 w-full rounded-lg border border-neutral-300 bg-transparent px-3 pt-5 pb-1 text-lg tabular-nums [appearance:textfield] focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pointer-events-none absolute top-1 left-3 text-xs text-neutral-500 transition-all peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-focus:top-1 peer-focus:translate-y-0 peer-focus:text-xs">
        {label}
      </span>
    </label>
  )
}

function FieldFeedback({
  correct,
  label,
  expected,
  note,
}: {
  correct: boolean
  label: string
  expected: string
  /** Extra context shown whether or not the answer was right — the limit name, on points. */
  note?: string
}) {
  const { t } = useTranslation()
  return (
    <p
      className={`flex flex-wrap items-center gap-1.5 text-sm font-medium ${correct ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {correct ? (
        <CheckCircle2 className="size-4 shrink-0" />
      ) : (
        <XCircle className="size-4 shrink-0" />
      )}
      {label}
      {!correct && (
        <span className="font-normal">{t('scoring.correctWas', { value: expected })}</span>
      )}
      {note && (
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {note}
        </span>
      )}
    </p>
  )
}

export function ScoringPage() {
  const { t } = useTranslation()
  const urlData = useUrlData(decodeScoringUrl)
  const termName = useTermName()
  const settings = useSettings((s) => s.scoring)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)
  const advanced = useSettings((s) => s.advanced)
  const { aka, exactFu } = useAdvancedSettings()
  const { showWall, showOpponentHands } = useTableSettings('scoring')

  // the scoring section supplies the round's options, but a link can pin the rules the round was
  // simulated under — without them the same seed would replay into a different hand. exactFu is
  // the advanced-resolved value, not settings.exactFu straight — grading must fall back the same
  // way the display does when Advanced is off
  const options = useMemo<ScoringOptions>(
    () => ({
      ...settings,
      exactFu,
      sanma: urlData.sanma ?? sanma,
      aka: urlData.aka ?? aka,
      openHands: urlData.calls ?? settings.openHands,
      honba: urlData.honba ?? settings.honba,
    }),
    [urlData, sanma, aka, exactFu, settings],
  )

  const round = useScoringRound(urlData, options)
  // hooks, so called unconditionally ahead of the loading early return below
  const { full, toggle: toggleFull } = useFullscreenBoard()
  const { canBack, back } = useLogBack()

  if (round.loading || !round.situation || !round.actual) {
    return (
      <TrainerLayout title={t('trainer.scoring.title')}>
        <p className="p-8 text-center text-neutral-500">{t('scoring.dealing')}</p>
      </TrainerLayout>
    )
  }

  const split = round.actual.payments.fromDealer !== undefined
  const ctx = round.situation.ctx
  const dealer = ctx.seat === HONOR
  // a single points field is either a ron total or a dealer tsumo, where every other seat pays
  // that same amount — the "(each)" label the split fields already use says exactly that
  const singlePointsLabel = t(ctx.tsumo ? 'scoring.pointsMainLabel' : 'scoring.pointsLabel')
  const limitName = round.actual.limit ? t(`scoring.limit.${round.actual.limit}`) : undefined

  const submit = (form: HTMLFormElement) => {
    const fields = new FormData(form)
    const num = (name: string) => Number(fields.get(name))
    const answer: Answer = {
      han: settings.testHan ? num('han') : undefined,
      fu: settings.testFu ? num('fu') : undefined,
      points: settings.testPoints && !split ? num('points') : undefined,
      pointsMain: settings.testPoints && split ? num('pointsMain') : undefined,
      pointsFromDealer: settings.testPoints && split ? num('pointsFromDealer') : undefined,
    }
    round.check(answer)
  }

  const winIndex = round.situation.concealed.findIndex((tile) => tile.id === ctx.winTile)
  // the hand reads as a hand, sorted, with the winning tile pulled out to the right; melds keep
  // their called order
  const restConcealed = (
    winIndex >= 0
      ? [
          ...round.situation.concealed.slice(0, winIndex),
          ...round.situation.concealed.slice(winIndex + 1),
        ]
      : [...round.situation.concealed]
  ).sort((a, b) => a.id - b.id)
  const winTile =
    winIndex >= 0 ? round.situation.concealed[winIndex] : { id: ctx.winTile, red: false }
  // nuki are counted, not held: the situation carries how many norths were pulled, and each one
  // draws as a plain north beside the melds
  const handNuki = Array.from({ length: round.situation.kita }, () => ({
    id: HONOR + 3,
    red: false,
  }))
  // a ron tile belongs to the discarder's river, where the board rings it; only a tsumo is
  // genuinely a tile you drew. Without the board there is no river to read it from, so it has
  // to sit beside the hand regardless.
  const showWinTileInHand = ctx.tsumo || !settings.table || !round.round

  const badge = (text: string) => (
    <span className="rounded bg-neutral-100 px-2 py-0.5 font-medium dark:bg-neutral-800">
      {text}
    </span>
  )
  // the win conditions read the same in either presentation, so they are built once and handed
  // either to the table's centre panel or to the flat bar. The ron/tsumo badge is separate
  // because the table does not need it: the winning tile is ringed wherever it lies, so a ron
  // rings it in the discarder's river as well as in the hand, and a tsumo only in the hand
  const flagBadges = FLAG_KEYS.filter((key) => ctx[key]).map((key) => (
    <span key={key}>{badge(termName('flags', key))}</span>
  ))
  // a hand that was really played says all of this on the board, and reading the board is the
  // drill: riichi is the bet stick (double riichi, the declaration lying on the first discard),
  // haitei/houtei is the wall count at zero, ippatsu is the win landing before the declarer's own
  // next discard. A link-pinned or generated hand has no rivers and no wall behind it, so there
  // the badges are the only place those conditions exist and they stay.
  const tableFlagBadges = round.round
    ? []
    : FLAG_KEYS.filter((key) => key !== 'riichi' && ctx[key]).map((key) => (
        <span key={key}>{badge(termName('flags', key))}</span>
      ))
  const winBadge = badge(t(ctx.tsumo ? 'scoring.tsumo' : 'scoring.ron'))

  // the hand was actually played, so the board shows the real thing: every seat's real river,
  // the ronned tile ringed where it truly was discarded, real melds. A link-pinned or fallback
  // hand has no round behind it and still shows only the winds and the winner's melds.
  const players = options.sanma ? 3 : 4
  const tableSeatIndex = Math.min(round.seat, players - 1)
  // the seat the board is drawn from has no hand out on the felt — it is the one below the board —
  // so its calls do not belong out there either: they ride at the right-hand end of `HandDisplay`
  // instead, the same split every other board trainer makes. Left on the felt they piled up on the
  // seat's own edge, above the hand they belong beside
  const seats: SeatView[] = round.round
    ? round.round.players.map((player, seat) => ({
        river: player.river,
        ...(seat !== tableSeatIndex && { melds: player.melds, nuki: player.nuki }),
        riichi: player.riichiAt !== undefined,
        hand: seat !== round.seat ? concealedTiles(player) : undefined,
        concealed: !showOpponentHands,
      }))
    : Array.from({ length: players }, (_, seat) => ({
        ...(seat === tableSeatIndex && { riichi: ctx.riichi || ctx.doubleRiichi }),
      }))

  const testsEnabled = [settings.testHan, settings.testFu, settings.testPoints].filter(
    Boolean,
  ).length
  const toggle = (key: keyof typeof settings, labelKey: string, disableWhenLast = false) => (
    <SettingRow label={t(labelKey)}>
      <input
        type="checkbox"
        checked={settings[key] as boolean}
        disabled={disableWhenLast && (settings[key] as boolean) && testsEnabled === 1}
        onChange={(e) => update('scoring', { [key]: e.target.checked })}
        className="size-5"
      />
    </SettingRow>
  )

  const settingsRows = (
    <>
      {toggle('testHan', 'scoring.settings.testHan', true)}
      {toggle('testFu', 'scoring.settings.testFu', true)}
      {toggle('testPoints', 'scoring.settings.testPoints', true)}
      {toggle('timerEnabled', 'scoring.settings.timer')}
      {toggle('table', 'scoring.settings.table')}
      {advanced && toggle('exactFu', 'scoring.settings.exactFu')}
      {toggle('showYaku', 'scoring.settings.showYaku')}
      {toggle('showFu', 'scoring.settings.showFu')}
      {toggle('kiriageMangan', 'scoring.settings.kiriageMangan')}
      {toggle('honba', 'scoring.settings.honba')}
      {toggle('ignoreFuOnLimit', 'scoring.settings.ignoreFuOnLimit')}
      {toggle('openHands', 'scoring.settings.openHands')}
    </>
  )

  // the same command bar the status bar draws, so the fullscreen board can draw them too rather
  // than sending you back out to the page for them
  const toggles = {
    showToggle: settings.timerEnabled,
    paused: round.paused,
    onToggle: round.togglePause,
    toggleLabel: t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer'),
    canBack,
    onBack: back,
    backLabel: t('common.undoAction'),
    onReset: round.next,
    resetLabel: t('common.resetHand'),
    full,
    onToggleFull: toggleFull,
    fullscreenLabel: t(full ? 'table.exitFullscreen' : 'table.fullscreen'),
  }

  return (
    <TrainerLayout
      title={t('trainer.scoring.title')}
      intro={{ text: t('trainer.scoring.intro'), wikiUrl: TRAINER_WIKI.scoring }}
      settings={settingsRows}
    >
      <div className="flex flex-col gap-4">
        <TrainerStatusBar
          {...toggles}
          elapsedNow={round.elapsedNow}
          running={round.running}
          timerEnabled={settings.timerEnabled}
        >
          <span>
            {t('scoring.correctScore', { correct: round.correctCount, total: round.totalCount })}
          </span>
          {settings.timerEnabled && (
            <span>{t('scoring.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
          )}
        </TrainerStatusBar>

        {round.invalidLink && (
          <p className="rounded-lg border border-amber-400 p-3 text-sm text-amber-700 dark:text-amber-400">
            {t('scoring.invalidLink')}
          </p>
        )}

        {/* stacked in the page, or filling the screen outright behind the fullscreen button —
            same shape every other board-drawing trainer uses */}
        <BoardStage
          title={t('trainer.scoring.title')}
          intro={{ text: t('trainer.scoring.intro'), wikiUrl: TRAINER_WIKI.scoring }}
          full={full}
          onLogOpen={(open) => open !== round.paused && round.togglePause()}
          chrome={
            <>
              <SettingsButton title={t('trainer.scoring.title')}>{settingsRows}</SettingsButton>
              <TrainerToggles {...toggles} compact />
              <FullscreenToggle {...toggles} compact />
            </>
          }
          // the table itself is opt-in (`settings.table`) — off, this is the boardless shape
          // shanten/solo use: no `board` prop, and the round/seat/dora readout that would
          // otherwise live on the felt moves into `hand` instead so it survives into fullscreen,
          // where it is what the question is asking about
          board={
            settings.table ? (
              <Table
                seats={seats}
                seatIndex={tableSeatIndex}
                round={WINDS[ctx.round - HONOR]}
                doraIndicators={round.situation!.doraIndicators.map((id) => ({
                  id,
                  red: false,
                }))}
                uraIndicators={round.situation!.uraIndicators.map((id) => ({
                  id,
                  red: false,
                }))}
                wallCount={round.round?.liveWall.length}
                honba={round.situation!.honba}
              >
                {tableFlagBadges.length > 0 && (
                  <span className="flex flex-wrap items-center justify-center gap-[1cqw]">
                    {tableFlagBadges}
                  </span>
                )}
              </Table>
            ) : undefined
          }
          hand={
            <div className="flex flex-col gap-4">
              {!settings.table && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
                    {t('scoring.roundWind')} <Tile id={ctx.round} />
                  </span>
                  <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
                    {t('scoring.seatWind')} <Tile id={ctx.seat} />
                    {dealer && <span className="text-neutral-500">({t('scoring.dealer')})</span>}
                  </span>
                  {round.situation.doraIndicators.length > 0 && (
                    <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
                      <GlossaryTerm id="dora">{t('scoring.doraIndicator')}</GlossaryTerm>
                      {round.situation.doraIndicators.map((id, i) => (
                        <Tile key={i} id={id} />
                      ))}
                    </span>
                  )}
                  {round.situation.uraIndicators.length > 0 && (
                    <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
                      <GlossaryTerm id="uraDora">{t('scoring.uraIndicator')}</GlossaryTerm>
                      {round.situation.uraIndicators.map((id, i) => (
                        <Tile key={i} id={id} />
                      ))}
                    </span>
                  )}
                  {round.situation.honba > 0 && (
                    <span>{t('scoring.honbaCount', { count: round.situation.honba })}</span>
                  )}
                  {round.situation.kita > 0 && (
                    <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
                      {t('scoring.kitaLabel')}
                      {Array.from({ length: round.situation.kita }, (_, i) => (
                        <Tile key={i} id={HONOR + 3} />
                      ))}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    {winBadge}
                    {flagBadges}
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {/* which tile completed the hand decides the wait fu and menzen ron, so it is
                    part of the question, not part of the answer — always ringed, never gated on
                    the reveal. The slot beside the hand means "you drew this", so it is only
                    right for a tsumo: on a ron the tile is a discard, and the board already rings
                    it in the river it was discarded into. With no board up there is nothing to
                    point at, so it stays here. */}
                {/* the calls sit at the right-hand end of the hand, not on a row of their own
                    under it — an open hand is read left to right along one line, and stacked
                    they read as a second hand. True with the board up or down: the felt drops
                    this seat's melds for exactly this reason (see `seats` above) */}
                <HandDisplay
                  tiles={restConcealed}
                  drawn={showWinTileInHand ? winTile : undefined}
                  drawnClassName="rounded-sm outline-2 outline-red-500"
                  melds={round.situation.melds}
                  nuki={handNuki}
                />
              </div>

              {!round.checked && (
                // uncontrolled: the form is keyed to the hand, so a new hand remounts it empty
                <form
                  key={serializeTenhou(round.situation.concealed)}
                  onSubmit={(e) => {
                    e.preventDefault()
                    submit(e.currentTarget)
                  }}
                  // one field per line on a phone held upright, one row everywhere there is width
                  // for it — a tablet, a desktop, or a phone held sideways (`short:`, the same
                  // viewport test the board itself uses). The submit button joins the row rather
                  // than sitting under it: the answer is one thought, so it reads as one line
                  className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch short:flex-row short:flex-wrap short:items-stretch"
                >
                  {settings.testHan && (
                    <NumberField name="han" label={t('scoring.hanLabel')} autoFocus />
                  )}
                  {settings.testFu && <NumberField name="fu" label={t('scoring.fuLabel')} />}
                  {settings.testPoints && !split && (
                    <NumberField name="points" label={singlePointsLabel} step={100} />
                  )}
                  {settings.testPoints && split && (
                    <>
                      <NumberField
                        name="pointsMain"
                        label={t('scoring.pointsMainLabel')}
                        step={100}
                      />
                      <NumberField
                        name="pointsFromDealer"
                        label={t('scoring.pointsFromDealerLabel')}
                        step={100}
                      />
                    </>
                  )}
                  <button
                    type="submit"
                    className="min-h-14 shrink-0 rounded-lg bg-neutral-900 px-5 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    {t('scoring.checkAnswer')}
                  </button>
                </form>
              )}
            </div>
          }
          end={
            round.checked &&
            round.lastResult && (
              <div className="flex flex-col gap-3">
                {settings.testHan && (
                  <FieldFeedback
                    correct={round.lastResult.correctHan}
                    label={t('scoring.hanLabel')}
                    expected={String(round.actual!.han)}
                  />
                )}
                {settings.testFu && (
                  <FieldFeedback
                    correct={round.lastResult.correctFu}
                    label={t('scoring.fuLabel')}
                    expected={String(options.exactFu ? round.actual!.fuExact : round.actual!.fu)}
                  />
                )}
                {settings.testPoints && !split && (
                  <FieldFeedback
                    correct={round.lastResult.correctPoints}
                    label={singlePointsLabel}
                    expected={String(round.actual!.payments.main)}
                    note={limitName}
                  />
                )}
                {settings.testPoints && split && (
                  <FieldFeedback
                    correct={round.lastResult.correctPoints}
                    label={`${t('scoring.pointsMainLabel')} / ${t('scoring.pointsFromDealerLabel')}`}
                    expected={`${round.actual!.payments.main} / ${round.actual!.payments.fromDealer}`}
                    note={limitName}
                  />
                )}
                {/* the limit name rides along with the points row; without one it needs its own line */}
                {!settings.testPoints && limitName && (
                  <p className="text-sm text-neutral-500">{limitName}</p>
                )}
                {(settings.showYaku || settings.showFu) && (
                  <ScoreBreakdown
                    result={round.actual!}
                    showYaku={settings.showYaku}
                    showFu={settings.showFu}
                  />
                )}
                <button
                  type="button"
                  onClick={round.next}
                  className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {t('scoring.newHand')}
                </button>
              </div>
            )
          }
        >
          {showWall && round.round && (
            <WallDetails
              dealt={round.round.wall.slice(0, round.round.players.length * INITIAL_HAND_SIZE)}
              liveWall={round.round.liveWallSnapshot}
              liveWallDrawn={wallDrawnCount(round.round)}
              deadWall={round.round.deadWallSnapshot}
              replacements={round.round.replacements}
            />
          )}

          <CopyLinkButton query={round.situationQuery} />
        </BoardStage>
      </div>
    </TrainerLayout>
  )
}
