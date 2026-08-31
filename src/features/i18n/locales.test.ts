import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import it_ from './locales/it.json'
import ja from './locales/ja.json'
import zh from './locales/zh.json'
import { LOCALE_SPECIFIC_KEYS } from './localeSpecificKeys'

/** Every leaf key in a translation file, dotted. */
function leafKeys(node: unknown, path: string): string[] {
  if (typeof node === 'string') return [path]
  if (node && typeof node === 'object')
    return Object.entries(node).flatMap(([key, value]) =>
      leafKeys(value, path ? `${path}.${key}` : key),
    )
  return []
}

describe('locale key parity', () => {
  it('has the same keys in en and it — nothing is locale-specific between those two', () => {
    const enKeys = new Set(leafKeys(en, ''))
    const itKeys = new Set(leafKeys(it_, ''))
    expect([...itKeys].filter((k) => !enKeys.has(k)).sort()).toEqual([])
    expect([...enKeys].filter((k) => !itKeys.has(k)).sort()).toEqual([])
  })

  it.each([
    ['ja', ja],
    ['zh', zh],
  ])('ja/zh missing keys are exactly the allowlisted locale-specific ones (%s)', (_name, locale) => {
    const enKeys = new Set(leafKeys(en, ''))
    const localeKeys = new Set(leafKeys(locale, ''))

    // Present in en, absent here: must be exactly the allowlist — a new shared key that lands
    // in en/it without a ja/zh translation shows up here as an unexpected miss, and a stale
    // allowlist entry that got translated shows up as one that's no longer missing.
    const missing = [...enKeys].filter((k) => !localeKeys.has(k)).sort()
    expect(missing).toEqual([...LOCALE_SPECIFIC_KEYS].sort())

    // Nothing in ja/zh names a key en doesn't have.
    const extra = [...localeKeys].filter((k) => !enKeys.has(k)).sort()
    expect(extra).toEqual([])
  })
})
