import { CheckCircle2 } from 'lucide-react'
import { isBestDiscard, type DiscardOption } from '../../core/efficiency'
import { Tile, UkeireTiles } from '../../components/tiles/Tile'
import type { TurnResult } from './useEfficiencyRound'

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
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="text-neutral-500">{label}</span>
        <Tile id={option.discard} />
        {showShanten && <span className="text-neutral-500">shanten {option.shanten}</span>}
        <span className="text-neutral-500">· {option.ukeireCount} tiles</span>
      </div>
      {showUkeire && <UkeireTiles tiles={option.ukeireTiles} />}
    </div>
  )
}

export function DiscardFeedback({
  result,
  showShanten,
  showUkeire,
}: {
  result: TurnResult
  showShanten: boolean
  showUkeire: boolean
}) {
  const isBest = isBestDiscard(result.yours, result.best)
  const shantenGap = result.yours.shanten - result.best.shanten
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <FeedbackRow
        label="Your discard"
        option={result.yours}
        showShanten={showShanten}
        showUkeire={showUkeire}
      />
      {isBest ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-4" /> Best discard
        </p>
      ) : (
        <>
          <FeedbackRow
            label="Best discard"
            option={result.best}
            showShanten={showShanten}
            showUkeire={showUkeire}
          />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {shantenGap > 0
              ? `This discard is ${shantenGap} shanten worse.`
              : `${result.best.ukeireCount - result.yours.ukeireCount} fewer tiles improve your hand this way.`}
          </p>
        </>
      )}
    </div>
  )
}
