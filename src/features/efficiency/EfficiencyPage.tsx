import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { SettingRow, TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay } from '../../components/tiles/Tile'
import { formatElapsed } from '../../lib/formatElapsed'
import { useSettings } from '../settings/settingsStore'
import { decodeSituation } from '../situation/urlCodec'
import { DiscardFeedback } from './DiscardFeedback'
import { useEfficiencyRound } from './useEfficiencyRound'

export function EfficiencyPage() {
  const [params] = useSearchParams()
  const situation = useMemo(() => decodeSituation(params), [params])
  const settings = useSettings((s) => s.efficiency)
  const update = useSettings((s) => s.update)

  const round = useEfficiencyRound(situation, settings.timerEnabled)

  return (
    <TrainerLayout
      title="Efficiency trainer"
      settings={
        <>
          <SettingRow label="Show shanten">
            <input
              type="checkbox"
              checked={settings.showShanten}
              onChange={(e) => update('efficiency', { showShanten: e.target.checked })}
              className="size-5"
            />
          </SettingRow>
          <SettingRow label="Timer">
            <input
              type="checkbox"
              checked={settings.timerEnabled}
              onChange={(e) => update('efficiency', { timerEnabled: e.target.checked })}
              className="size-5"
            />
          </SettingRow>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
          <span>Turn {round.turn}</span>
          {settings.timerEnabled && (
            <span className="font-mono tabular-nums">{formatElapsed(round.elapsed)}</span>
          )}
          <span>Wall: {round.wallRemaining} tiles</span>
          <span className="ml-auto">Ukeire lost: {round.cumulativeLost}</span>
        </div>

        <HandDisplay
          tiles={round.hand}
          onTileClick={round.finished ? undefined : (i) => round.discard(i)}
        />

        {round.lastResult && (
          <DiscardFeedback result={round.lastResult} showShanten={settings.showShanten} />
        )}

        {round.finished && (
          <div className="rounded-lg bg-neutral-100 p-4 dark:bg-neutral-900">
            <p className="font-semibold">Round complete</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Total ukeire lost across {round.turn} turns: {round.cumulativeLost}
            </p>
            <button
              type="button"
              onClick={round.restart}
              className="mt-3 min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              New round
            </button>
          </div>
        )}
      </div>
    </TrainerLayout>
  )
}
