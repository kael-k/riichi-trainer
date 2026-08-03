import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { TrainerLayout, SettingRow } from '../../components/TrainerLayout'
import { HandDisplay, tileCode } from '../../components/tiles/Tile'
import type { ParsedTile } from '../../core/tiles'
import { deal } from '../../core/wall'
import { decodeSituation } from '../situation/urlCodec'
import { useSettings } from '../settings/settingsStore'
import { useLog } from '../../store/log'

export function EfficiencyPage() {
  const [params] = useSearchParams()
  const situation = useMemo(() => decodeSituation(params), [params])
  const settings = useSettings((s) => s.efficiency)
  const update = useSettings((s) => s.update)
  const log = useLog((s) => s.log)

  // explicit hand from the URL, otherwise a seeded 14-tile deal
  const hand = useMemo<ParsedTile[]>(() => {
    if (situation.hand.length > 0) return situation.hand
    const tiles: ParsedTile[] = []
    deal(situation.seed || 'demo', 14).hand.counts.forEach((count, id) => {
      for (let k = 0; k < count; k++) tiles.push({ id, red: false })
    })
    return tiles
  }, [situation])

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
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Discard ranking and ukeire feedback land in M3. Tap a tile to see the action log in
          action.
        </p>
        <HandDisplay
          tiles={hand}
          onTileClick={(i) => log(`You discarded ${tileCode(hand[i].id, hand[i].red)}`, [hand[i]])}
        />
      </div>
    </TrainerLayout>
  )
}
