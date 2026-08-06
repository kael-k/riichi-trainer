import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isBestDiscard, type DiscardOption } from '../../core/efficiency'
import { Tile, UkeireTiles } from '../../components/tiles/Tile'
import { NORTH, type TurnResult } from './useEfficiencyRound'

function FeedbackRow({
  label,
  option,
  showShanten,
  showUkeire,
}: {
  label: string
  option: DiscardOption
  showShanten: boolean
  showUkeire: boolean
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="text-neutral-500">{label}</span>
        <Tile id={option.discard} />
        {showShanten && (
          <span className="text-neutral-500">
            {t('discardFeedback.shantenLine', { count: option.shanten })}
          </span>
        )}
        <span className="text-neutral-500">
          {t('discardFeedback.tilesSuffix', { count: option.ukeireCount })}
        </span>
      </div>
      {showUkeire && <UkeireTiles tiles={option.ukeireTiles} />}
    </div>
  )
}

export function DiscardFeedback({
  result,
  showShanten,
  showUkeire,
  sanma,
}: {
  result: TurnResult
  showShanten: boolean
  showUkeire: boolean
  /** Whether "best" pointing at north should read as "Kita" rather than a plain discard —
   *  north is just an ordinary honor tile outside sanma, where kita doesn't exist. */
  sanma: boolean
}) {
  const { t } = useTranslation()
  const isBest = isBestDiscard(result.yours, result.best)
  const shantenGap = result.yours.shanten - result.best.shanten
  const yoursLabel = t(
    result.kind === 'kita' ? 'discardFeedback.yourKita' : 'discardFeedback.yourDiscard',
  )
  // when best turns out to be the kita entry (sanma only), the recommended move was pulling
  // it, not discarding it plainly — a real discard of north is strictly worse for the same cost
  const bestLabel = t(
    sanma && result.best.discard === NORTH
      ? 'discardFeedback.bestKita'
      : 'discardFeedback.bestDiscard',
  )
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <FeedbackRow
        label={yoursLabel}
        option={result.yours}
        showShanten={showShanten}
        showUkeire={showUkeire}
      />
      {isBest ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-4" /> {bestLabel}
        </p>
      ) : (
        <>
          <FeedbackRow
            label={bestLabel}
            option={result.best}
            showShanten={showShanten}
            showUkeire={showUkeire}
          />
          <p className="text-sm text-amber-700 dark:text-amber-400">
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
