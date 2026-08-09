import { CheckCircle2, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Table, type SeatView } from '../../components/tiles/Table'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, MeldDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { concealedTiles, wallDrawnCount } from '../../core/match'
import { HONOR, serializeTenhou } from '../../core/tiles'
import { WINDS } from '../situation/urlCodec'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { useTermName } from '../i18n/useTermName'
import { SettingRow } from '../settings/SettingsDialog'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useSettings } from '../settings/settingsStore'
import { ScoreBreakdown } from './ScoreBreakdown'
import { decodeScoringUrl } from './scoringUrl'
import { useUrlData } from '../situation/useUrlData'
import { useScoringRound, type Answer, type RoundOptions } from './useScoringRound'

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
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        step={step}
        autoFocus={autoFocus}
        className="min-h-11 w-28 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
      />
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
  const { aka, showWall, showOpponentHands, exactFu } = useAdvancedSettings()

  // the scoring section supplies the round's options, but a link can pin the rules the match was
  // simulated under — without them the same seed would replay into a different hand. exactFu is
  // the advanced-resolved value, not settings.exactFu straight — grading must fall back the same
  // way the display does when Advanced is off
  const options = useMemo<RoundOptions>(
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
  // a ron tile belongs to the discarder's river, where the board rings it; only a tsumo is
  // genuinely a tile you drew. Without the board there is no river to read it from, so it has
  // to sit beside the hand regardless.
  const showWinTileInHand = ctx.tsumo || !settings.table || !round.match

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
  const tableFlagBadges = round.match
    ? []
    : FLAG_KEYS.filter((key) => key !== 'riichi' && ctx[key]).map((key) => (
        <span key={key}>{badge(termName('flags', key))}</span>
      ))
  const winBadge = badge(t(ctx.tsumo ? 'scoring.tsumo' : 'scoring.ron'))

  // the hand was actually played, so the board shows the real thing: every seat's real river,
  // the ronned tile ringed where it truly was discarded, real melds. A link-pinned or fallback
  // hand has no match behind it and still shows only the winds and the winner's melds.
  const players = options.sanma ? 3 : 4
  const tableSeatIndex = Math.min(round.seat, players - 1)
  const seats: SeatView[] = round.match
    ? round.match.players.map((player, seat) => ({
        river: player.river,
        melds: player.melds,
        nuki: player.nuki,
        riichi: player.riichiAt !== undefined,
        hand: showOpponentHands && seat !== round.seat ? concealedTiles(player) : undefined,
      }))
    : Array.from({ length: players }, (_, seat) => ({
        ...(seat === tableSeatIndex && {
          melds: round.situation!.melds,
          nuki: Array.from({ length: round.situation!.kita }, () => ({
            id: HONOR + 3,
            red: false,
          })),
          riichi: ctx.riichi || ctx.doubleRiichi,
        }),
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

  return (
    <TrainerLayout
      title={t('trainer.scoring.title')}
      intro={{ text: t('trainer.scoring.intro'), wikiUrl: TRAINER_WIKI.scoring }}
      settings={
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
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>{t('scoring.handNumber', { count: round.handNumber })}</span>
          <span className="flex flex-col items-end">
            <span>
              {t('scoring.correctScore', { correct: round.correctCount, total: round.totalCount })}
            </span>
            {settings.timerEnabled && (
              <span>{t('scoring.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
            )}
          </span>
        </div>

        {settings.timerEnabled && (
          <span className="self-end font-mono text-sm tabular-nums text-neutral-500">
            {formatElapsedMs(round.elapsed)}
          </span>
        )}

        {round.invalidLink && (
          <p className="rounded-lg border border-amber-400 p-3 text-sm text-amber-700 dark:text-amber-400">
            {t('scoring.invalidLink')}
          </p>
        )}

        {/* stacked normally; beside the board when the viewport is too short to stack, which is
            what makes turning the phone sideways actually pay off */}
        <div className="flex flex-col gap-4 short:flex-row short:items-start">
          {/* ura is not held back until the reveal: it counts into the han the question asks for,
              and a real hand flips it the moment the riichi wins, so hiding it made the answer
              unknowable. Only a riichi win ever has any, so the list gates itself */}
          {settings.table ? (
            <Table
              seats={seats}
              seatIndex={tableSeatIndex}
              round={WINDS[ctx.round - HONOR]}
              doraIndicators={round.situation.doraIndicators.map((id) => ({ id, red: false }))}
              uraIndicators={round.situation.uraIndicators.map((id) => ({ id, red: false }))}
              wallCount={round.match?.liveWall.length}
              honba={round.situation.honba}
            >
              {tableFlagBadges.length > 0 && (
                <span className="flex flex-wrap items-center justify-center gap-[1cqw]">
                  {tableFlagBadges}
                </span>
              )}
            </Table>
          ) : (
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

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-col gap-2">
              {/* which tile completed the hand decides the wait fu and menzen ron, so it is part of
              the question, not part of the answer — always ringed, never gated on the reveal.
              The slot beside the hand means "you drew this", so it is only right for a tsumo: on
              a ron the tile is a discard, and the board already rings it in the river it was
              discarded into. With no board up there is nothing to point at, so it stays here. */}
              <HandDisplay
                tiles={restConcealed}
                drawn={showWinTileInHand ? winTile : undefined}
                drawnClassName="rounded-sm outline-2 outline-red-500"
              />
              {!settings.table && round.situation.melds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {round.situation.melds.map((meld, i) => (
                    <MeldDisplay key={i} meld={meld} />
                  ))}
                </div>
              )}
            </div>

            {!round.checked && (
              // uncontrolled: the form is keyed to the hand, so a new hand remounts it empty
              <form
                key={serializeTenhou(round.situation.concealed)}
                onSubmit={(e) => {
                  e.preventDefault()
                  submit(e.currentTarget)
                }}
                className="flex flex-col gap-3"
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
                  className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {t('scoring.checkAnswer')}
                </button>
              </form>
            )}

            {round.checked && round.lastResult && (
              <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                {settings.testHan && (
                  <FieldFeedback
                    correct={round.lastResult.correctHan}
                    label={t('scoring.hanLabel')}
                    expected={String(round.actual.han)}
                  />
                )}
                {settings.testFu && (
                  <FieldFeedback
                    correct={round.lastResult.correctFu}
                    label={t('scoring.fuLabel')}
                    expected={String(options.exactFu ? round.actual.fuExact : round.actual.fu)}
                  />
                )}
                {settings.testPoints && !split && (
                  <FieldFeedback
                    correct={round.lastResult.correctPoints}
                    label={singlePointsLabel}
                    expected={String(round.actual.payments.main)}
                    note={limitName}
                  />
                )}
                {settings.testPoints && split && (
                  <FieldFeedback
                    correct={round.lastResult.correctPoints}
                    label={`${t('scoring.pointsMainLabel')} / ${t('scoring.pointsFromDealerLabel')}`}
                    expected={`${round.actual.payments.main} / ${round.actual.payments.fromDealer}`}
                    note={limitName}
                  />
                )}
                {/* the limit name rides along with the points row; without one it needs its own line */}
                {!settings.testPoints && limitName && (
                  <p className="text-sm text-neutral-500">{limitName}</p>
                )}
                {(settings.showYaku || settings.showFu) && (
                  <ScoreBreakdown
                    result={round.actual}
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
            )}

            {showWall && round.match && (
              <WallDetails
                liveWall={round.match.liveWallSnapshot}
                liveWallDrawn={wallDrawnCount(round.match)}
                deadWall={round.match.deadWallSnapshot}
                replacements={round.match.replacements}
              />
            )}

            <CopyLinkButton query={round.situationQuery} />
          </div>
        </div>
      </div>
    </TrainerLayout>
  )
}
