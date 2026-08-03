import { Moon, Sun, SunMoon } from 'lucide-react'
import { useSettings, type Theme } from '../features/settings/settingsStore'

const CYCLE: Theme[] = ['system', 'light', 'dark']
const ICON: Record<Theme, typeof SunMoon> = { system: SunMoon, light: Sun, dark: Moon }

/** Cycles system → light → dark; persisted, applied globally in AppShell. */
export function ThemeToggle() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length]
  const Icon = ICON[theme]
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${theme}. Tap for ${next}.`}
      className="flex size-11 items-center justify-center"
    >
      <Icon className="size-5" />
    </button>
  )
}
