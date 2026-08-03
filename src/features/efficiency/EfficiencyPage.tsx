import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { SettingRow, TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, tileCode } from '../../components/tiles/Tile'
import { useLog } from '../../store/log'
import { useSettings } from '../settings/settingsStore'
import { decodeSituation } from '../situation/urlCodec'
import { DiscardFeedback } from './DiscardFeedback'
import { useEfficiencyRound } from './useEfficiencyRound'

export function EfficiencyPage() {
  const [params] = useSearchParams()
  const situation = useMemo(() => decodeSituation(params), [params])
  const settings = useSettings((s) => s.efficiency)
  const update = useSettings((s) => s.update)
  const log = useLog((s) => s.log)

  const round = useEfficiencyRound(situation, settings.turns)

  useEffect(() => {
    if (!round.lastResult) return
    const { turn, yours, best } = round.lastResult
    if (yours.discard === best.discard) {
      log(
        `Turn ${turn}: discarded ${tileCode(yours.discard)} — best choice (ukeire ${yours.ukeireCount})`,
        [{ id: yours.discard, red: false }],
      )
    } else {
      log(
        `Turn ${turn}: discarded ${tileCode(yours.discard)} (ukeire ${yours.ukeireCount}); best was ${tileCode(best.discard)} (ukeire ${best.ukeireCount})`,
        [
          { id: yours.discard, red: false },
          { id: best.discard, red: false },
        ],
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.lastResult])

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
          <SettingRow label="Turns per round">
            <input
              type="number"
              min={1}
              max={18}
              value={settings.turns}
              onChange={(e) => update('efficiency', { turns: Number(e.target.value) || 1 })}
              className="min-h-11 w-20 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </SettingRow>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>
            Turn {round.turn} / {settings.turns}
          </span>
          <span>Ukeire lost so far: {round.cumulativeLost}</span>
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
              Total ukeire lost across {settings.turns} turns: {round.cumulativeLost}
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
