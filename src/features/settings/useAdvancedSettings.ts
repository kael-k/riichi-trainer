import { useSettings } from './settingsStore'

/**
 * The values gated behind the `advanced` setting — tsumogiri marks, red fives, exact fu —
 * resolved to their default whenever `advanced` is off. The dialog already hides these rows when
 * `advanced` is false (`SettingsDialog.tsx`), but a hidden row must not mean a live value: every
 * read of one of these goes through here instead of the raw store, so turning Advanced off
 * actually reverts behavior to what the hidden row would show, without touching what's persisted
 * — re-enabling Advanced brings the stored choice straight back. The wall-reveal gate moved to
 * `useTableSettings` (`tableSettings.ts`) alongside the rest of the table settings;
 * `showOpponentHands` is a plain global setting, not advanced-gated, so it's resolved there too,
 * not through here.
 */
export function useAdvancedSettings() {
  const advanced = useSettings((s) => s.advanced)
  const showTsumogiri = useSettings((s) => s.showTsumogiri)
  const aka = useSettings((s) => s.aka)
  const exactFu = useSettings((s) => s.scoring.exactFu)
  const evGrading = useSettings((s) => s.folding.evGrading)
  const efficiencyEvGrading = useSettings((s) => s.efficiency.evGrading)
  return {
    showTsumogiri: advanced && showTsumogiri,
    // aka's default is true, unlike the other two — off means "use the default", not "off"
    aka: !advanced || aka,
    exactFu: advanced && exactFu,
    // alpha (`plans/EV-5` §2.5/§2.8): a hidden row must not mean a live value, same rule as above
    evGrading: advanced && evGrading,
    // alpha, ADR-0046's efficiency half, table-only: `useEfficiencyRound.ts` is the only reader
    efficiencyEvGrading: advanced && efficiencyEvGrading,
  }
}
