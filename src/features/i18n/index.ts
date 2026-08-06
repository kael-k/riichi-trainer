import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LOCALES, type Locale } from '../settings/settingsStore'
import en from './locales/en.json'
import it from './locales/it.json'
import ja from './locales/ja.json'
import zh from './locales/zh.json'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
    zh: { translation: zh },
    it: { translation: it },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

/** 'auto' resolves from the browser's language, filtered to what we have a translation for. */
export function resolveLocale(locale: Locale): (typeof LOCALES)[number] {
  if (locale !== 'auto') return locale
  const browser = navigator.language.slice(0, 2)
  return (LOCALES as readonly string[]).includes(browser)
    ? (browser as (typeof LOCALES)[number])
    : 'en'
}

export default i18n
