import { resolveLocale } from '../i18n'
import { useSettings } from './settingsStore'

/**
 * Whether tile faces carry their tenhou code. The overlay is a beginner's crutch for reading
 * pips, so it defaults on everywhere except ja/zh, whose players read the faces natively —
 * but only until the checkbox is touched, after which the stored choice wins in any language.
 */
export function useShowTileNumbers(): boolean {
  const chosen = useSettings((s) => s.showTileNumbers)
  const locale = useSettings((s) => s.locale)
  if (chosen !== null) return chosen
  const resolved = resolveLocale(locale)
  return resolved !== 'ja' && resolved !== 'zh'
}
