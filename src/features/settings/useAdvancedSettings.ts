import { useSettings } from './settingsStore'

/**
 * The values gated behind the `advanced` setting — tsumogiri marks, red fives, wall reveal,
 * opponent hands, exact fu — resolved to their default whenever `advanced` is off. The dialog
 * already hides these rows when `advanced` is false (`SettingsDialog.tsx`), but a hidden row must
 * not mean a live value: every read of one of these five goes through here instead of the raw
 * store, so turning Advanced off actually reverts behavior to what the hidden row would show,
 * without touching what's persisted — re-enabling Advanced brings the stored choice straight back.
 */
export function useAdvancedSettings() {
  const advanced = useSettings((s) => s.advanced)
  const showTsumogiri = useSettings((s) => s.showTsumogiri)
  const aka = useSettings((s) => s.aka)
  const showWall = useSettings((s) => s.showWall)
  const showOpponentHands = useSettings((s) => s.showOpponentHands)
  const exactFu = useSettings((s) => s.scoring.exactFu)
  return {
    showTsumogiri: advanced && showTsumogiri,
    // aka's default is true, unlike the other four — off means "use the default", not "off"
    aka: !advanced || aka,
    showWall: advanced && showWall,
    showOpponentHands: advanced && showOpponentHands,
    exactFu: advanced && exactFu,
  }
}
