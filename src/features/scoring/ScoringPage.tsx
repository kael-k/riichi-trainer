import { Check, CheckCircle2, Link as LinkIcon, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, Tile } from '../../components/tiles/Tile'
import type { Meld } from '../../core/agari'
import { HONOR } from '../../core/tiles'
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
  const [copied, setCopied] = useState(false)

  const options = useMemo<RoundOptions>(
    () => ({
      sanma: urlData.sanma ?? sanma,
      aka: settings.aka,
      openHands: settings.openHands,
      honba: settings.honba,
      kiriageMangan: settings.kiriageMangan,
      exactFu: settings.exactFu,
      ignoreFuOnLimit: settings.ignoreFuOnLimit,
      testHan: settings.testHan,
      testFu: settings.testFu,
      testPoints: settings.testPoints,
    }),
    [urlData, sanma, settings],
  )

  const round = useScoringRound(urlData, options, settings.timerEnabled)

  const [hanInput, setHanInput] = useState('')
  const [fuInput, setFuInput] = useState('')
  const [pointsInput, setPointsInput] = useState('')
  const [pointsMainInput, setPointsMainInput] = useState('')
  const [pointsFromDealerInput, setPointsFromDealerInput] = useState('')
  useEffect(() => {
    setHanInput('')
    setFuInput('')
    setPointsInput('')
    setPointsMainInput('')
    setPointsFromDealerInput('')
  }, [round.situation])

  const split = round.actual.payments.fromDealer !== undefined
  const ctx = round.situation.ctx
  const dealer = ctx.seat === HONOR
  // a single points field is either a ron total or a dealer tsumo, where every other seat pays
  // that same amount — the "(each)" label the split fields already use says exactly that
  const singlePointsLabel = t(ctx.tsumo ? 'scoring.pointsMainLabel' : 'scoring.pointsLabel')
  const limitName = round.actual.limit ? t(`scoring.limit.${round.actual.limit}`) : undefined

  const submit = () => {
    const answer: Answer = {
      han: settings.testHan ? Number(hanInput) : undefined,
      fu: settings.testFu ? Number(fuInput) : undefined,
      points: settings.testPoints && !split ? Number(pointsInput) : undefined,
      pointsMain: settings.testPoints && split ? Number(pointsMainInput) : undefined,
      pointsFromDealer: settings.testPoints && split ? Number(pointsFromDealerInput) : undefined,
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

  const copySituation = async () => {
    const query = round.situationQuery()
    await navigator.clipboard.writeText(
      `${location.origin}${location.pathname}${query ? `?${query}` : ''}`,
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="flex flex-col gap-3"
          >
            {settings.testHan && (
              <label className="flex items-center justify-between gap-3">
                <span>{t('scoring.hanLabel')}</span>
                <input
                  type="number"
                  min={0}
                  autoFocus
                  value={hanInput}
                  onChange={(e) => setHanInput(e.target.value)}
                  className="min-h-11 w-24 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
            )}
            {settings.testFu && (
              <label className="flex items-center justify-between gap-3">
                <span>{t('scoring.fuLabel')}</span>
                <input
                  type="number"
                  min={0}
                  value={fuInput}
                  onChange={(e) => setFuInput(e.target.value)}
                  className="min-h-11 w-24 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
            )}
            {settings.testPoints && !split && (
              <label className="flex items-center justify-between gap-3">
                <span>{singlePointsLabel}</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={pointsInput}
                  onChange={(e) => setPointsInput(e.target.value)}
                  className="min-h-11 w-28 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
            )}
            {settings.testPoints && split && (
              <>
                <label className="flex items-center justify-between gap-3">
                  <span>{t('scoring.pointsMainLabel')}</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={pointsMainInput}
                    onChange={(e) => setPointsMainInput(e.target.value)}
                    className="min-h-11 w-28 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>{t('scoring.pointsFromDealerLabel')}</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={pointsFromDealerInput}
                    onChange={(e) => setPointsFromDealerInput(e.target.value)}
                    className="min-h-11 w-28 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
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

        <button
          type="button"
          onClick={copySituation}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
        >
          {copied ? <Check className="size-4" /> : <LinkIcon className="size-4" />}
          {copied ? t('common.copied') : t('scoring.copySituationLink')}
        </button>
      </div>
    </TrainerLayout>
  )
}
