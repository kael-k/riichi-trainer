import { useTranslation } from 'react-i18next'
import { useSettings } from '../settings/settingsStore'

/** Term groups that come in both a Japanese and a translated flavour. */
type TermGroup = 'yaku' | 'yakuman' | 'flags'

/**
 * Names a yaku or win condition for display: either the Japanese term the scoring tables use
 * ("Ittsuu") or the reader's own language ("Pure straight"), per the `translatedTerms` setting.
 * The translated block is only worth writing for locales whose own words differ from the
 * Japanese ones, so the lookup falls back to the Japanese key when a locale (ja/zh) has none.
 *
 * That fallback is an `exists` check with **no fallback language**, never `t([translated,
 * japanese])`: i18next tries every fallback language for the first key before it moves on to the
 * second, so a ja/zh reader got en's "Full flush" instead of their own 清一色 — with the setting
 * that would turn it off hidden for exactly those two locales.
 */
export function useTermName(): (group: TermGroup, name: string) => string {
  const { t, i18n } = useTranslation()
  const translated = useSettings((s) => s.translatedTerms)
  return (group, name) => {
    const translatedKey = `scoring.${group}Translated.${name}`
    return translated && i18n.exists(translatedKey, { fallbackLng: false })
      ? t(translatedKey)
      : t(`scoring.${group}.${name}`)
  }
}
