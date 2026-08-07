import { useTranslation } from 'react-i18next'
import { useSettings } from '../settings/settingsStore'

/** Term groups that come in both a Japanese and a translated flavour. */
type TermGroup = 'yaku' | 'yakuman' | 'flags'

/**
 * Names a yaku or win condition for display: either the Japanese term the scoring tables use
 * ("Ittsuu") or the reader's own language ("Pure straight"), per the `translatedTerms` setting.
 * The translated block is only worth writing for locales whose own words differ from the
 * Japanese ones, so the lookup falls back to the Japanese key when a locale (ja/zh) has none.
 */
export function useTermName(): (group: TermGroup, name: string) => string {
  const { t } = useTranslation()
  const translated = useSettings((s) => s.translatedTerms)
  return (group, name) =>
    translated
      ? t([`scoring.${group}Translated.${name}`, `scoring.${group}.${name}`])
      : t(`scoring.${group}.${name}`)
}
