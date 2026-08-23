import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { DiscardOption } from '../../core/efficiency'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Tile, UkeireTiles } from '../../components/tiles/Tile'
import { NORTH, type TurnResult } from './useEfficiencyRound'

function FeedbackRow({ label, option }: { label: string; option: DiscardOption }) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="text-neutral-500">{label}</span>
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

export function DiscardFeedback({
  result,
  sanma,
}: {
  result: TurnResult
  /** Whether "best" pointing at north should read as "Kita" rather than a plain discard —
   *  north is just an ordinary honor tile outside sanma, where kita doesn't exist. */
  sanma: boolean
}) {
  const { t } = useTranslation()
  const shantenGap = result.yours.shanten - result.best.shanten
  const yoursLabel = t(
    result.kind === 'kita'
      ? 'discardFeedback.yourKita'
      : result.kind === 'kan'
        ? 'discardFeedback.yourKan'
        : 'discardFeedback.yourDiscard',
  )
  // when best turns out to be the kita entry (sanma only), the recommended move was pulling
  // it, not discarding it plainly — a real discard of north is strictly worse for the same cost.
  // Kan never surfaces as `best` this way: it's never a real discard option, only ever its own
  // separate (always <=) comparison, so no analogous relabeling is needed for it here.
  const bestLabel = t(
    sanma && result.best.discard === NORTH
      ? 'discardFeedback.bestKita'
      : 'discardFeedback.bestDiscard',
  )
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <FeedbackRow label={yoursLabel} option={result.yours} />
      {result.grade !== 'error' ? (
        <>
          <p className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-4" /> {bestLabel}
          </p>
          {result.grade === 'warning' && result.missed && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-4 shrink-0" />
              {t(
                result.missed.kind === 'kita'
                  ? 'discardFeedback.missedKita'
                  : 'discardFeedback.missedKan',
              )}
              <Tile id={result.missed.tile} />
            </p>
          )}
        </>
      ) : (
        <>
          <FeedbackRow label={bestLabel} option={result.best} />
          <p className="text-sm text-red-600 dark:text-red-400">
            {shantenGap > 0
              ? t('discardFeedback.shantenWorse', { count: shantenGap })
              : t('discardFeedback.fewerTiles', {
                  count: result.best.ukeireCount - result.yours.ukeireCount,
                })}
          </p>
        </>
      )}
    </div>
  )
}
