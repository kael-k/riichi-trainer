import { TrainerLayout, SettingRow } from '../../components/TrainerLayout'
import { Tile } from '../../components/tiles/Tile'
import { useSettings } from '../settings/settingsStore'

export function ShantenPage() {
  const settings = useSettings((s) => s.shanten)
  const update = useSettings((s) => s.update)

  return (
    <TrainerLayout
      title="Shanten trainer"
      settings={
        <SettingRow label="Timer">
          <input
            type="checkbox"
            checked={settings.timerEnabled}
            onChange={(e) => update('shanten', { timerEnabled: e.target.checked })}
            className="size-5"
          />
        </SettingRow>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Reveal overlay, timer and answer form land in M4.
        </p>
        <div className="flex flex-wrap">
          {Array.from({ length: 13 }, (_, i) => (
            <Tile key={i} />
          ))}
        </div>
      </div>
    </TrainerLayout>
  )
}
