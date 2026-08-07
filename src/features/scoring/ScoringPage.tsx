import { CheckCircle2, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, Tile } from '../../components/tiles/Tile'
import type { Meld } from '../../core/agari'
import { HONOR, serializeTenhou } from '../../core/tiles'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useTermName } from '../i18n/useTermName'
import { SettingRow } from '../settings/SettingsDialog'
import { useSettings } from '../settings/settingsStore'
import { ScoreBreakdown } from './ScoreBreakdown'
import { decodeScoringUrl } from './scoringUrl'
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

/** One called set. Ankan is drawn with its two outer tiles face-down, same convention as a
 *  concealed tile elsewhere in the app. Open calls lay their leftmost tile sideways, the usual
 *  "this one was claimed" marker — `Meld` doesn't record which seat it came from, so the
 *  rotated tile is always the first one rather than encoding the caller's direction. */
function MeldDisplay({ meld }: { meld: Meld }) {
  const last = meld.tiles.length - 1
  return (
    <div className="flex items-end">
      {meld.tiles.map((t, i) => {
        const hidden = meld.kind === 'ankan' && (i === 0 || i === last)
        const tile = <Tile id={hidden ? undefined : t.id} red={t.red} />
        if (meld.kind === 'ankan' || i > 0) return <span key={i}>{tile}</span>
        // the rotated tile's box is its own height wide and its width tall, so the wrapper
        // swaps the two and centres the (overflowing) upright tile inside it
        return (
          <span
            key={i}
            className="grid h-(--tile-w) w-[calc(var(--tile-w)*4/3)] place-items-center [&>svg]:rotate-90"
          >
            {tile}
          </span>
        )
      })}
    </div>
  )
}

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
  const [params] = useSearchParams()
  const urlData = useMemo(() => decodeScoringUrl(params), [params])
  const termName = useTermName()
  const settings = useSettings((s) => s.scoring)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)

  // the whole scoring section is the round's options; only the ruleset can come from the URL
  const options = useMemo<RoundOptions>(
    () => ({ ...settings, sanma: urlData.sanma ?? sanma }),
    [urlData, sanma, settings],
  )

  const round = useScoringRound(urlData, options)

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
      settings={
        <>
          {toggle('testHan', 'scoring.settings.testHan', true)}
          {toggle('testFu', 'scoring.settings.testFu', true)}
          {toggle('testPoints', 'scoring.settings.testPoints', true)}
          {toggle('timerEnabled', 'scoring.settings.timer')}
          {toggle('exactFu', 'scoring.settings.exactFu')}
          {toggle('showYaku', 'scoring.settings.showYaku')}
          {toggle('showFu', 'scoring.settings.showFu')}
          {toggle('kiriageMangan', 'scoring.settings.kiriageMangan')}
          {toggle('honba', 'scoring.settings.honba')}
          {toggle('ignoreFuOnLimit', 'scoring.settings.ignoreFuOnLimit')}
          {toggle('openHands', 'scoring.settings.openHands')}
          {toggle('aka', 'scoring.settings.aka')}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>{t('scoring.handNumber', { count: round.handNumber })}</span>
          <span>
            {t('scoring.correctScore', { correct: round.correctCount, total: round.totalCount })}
            {settings.timerEnabled && (
              <> {t('scoring.avgTime', { time: formatElapsedMs(round.averageTime) })}</>
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
              {t('scoring.doraIndicator')}
              {round.situation.doraIndicators.map((id, i) => (
                <Tile key={i} id={id} />
              ))}
            </span>
          )}
          {round.checked && round.situation.uraIndicators.length > 0 && (
            <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
              {t('scoring.uraIndicator')}
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
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
            {t(ctx.tsumo ? 'scoring.tsumo' : 'scoring.ron')}
          </span>
          {FLAG_KEYS.filter((key) => ctx[key]).map((key) => (
            <span
              key={key}
              className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800"
            >
              {termName('flags', key)}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <HandDisplay tiles={restConcealed} drawn={winTile} />
          {round.situation.melds.length > 0 && (
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
            {settings.testHan && <NumberField name="han" label={t('scoring.hanLabel')} autoFocus />}
            {settings.testFu && <NumberField name="fu" label={t('scoring.fuLabel')} />}
            {settings.testPoints && !split && (
              <NumberField name="points" label={singlePointsLabel} step={100} />
            )}
            {settings.testPoints && split && (
              <>
                <NumberField name="pointsMain" label={t('scoring.pointsMainLabel')} step={100} />
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
                expected={String(settings.exactFu ? round.actual.fuExact : round.actual.fu)}
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

        <CopyLinkButton query={round.situationQuery} />
      </div>
    </TrainerLayout>
  )
}
