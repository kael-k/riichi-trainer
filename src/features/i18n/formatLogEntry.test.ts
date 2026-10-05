import { describe, expect, it } from 'vitest'
import { HONOR, PIN, SOU } from '../../core/tiles'
import type { LogEntry } from '../../store/log'
import { formatLogEntry, splitTileCodes } from './formatLogEntry'
import en from './locales/en.json'
import it_ from './locales/it.json'
import ja from './locales/ja.json'
import zh from './locales/zh.json'
import i18n from '.'

/** Only the tiles, in the order the sentence names them. */
function tiles(text: string) {
  return splitTileCodes(text).filter((part) => typeof part !== 'string')
}

const entry = (key: string, params: LogEntry['params']): LogEntry => ({ id: 1, key, params })

describe('splitTileCodes', () => {
  it('reads a red five as the five it is, marked red', () => {
    expect(tiles('Turn 4: discarded 0p (ukeire 57)')).toEqual([{ id: PIN + 4, red: true }])
  })

  it('reads the honours, which run 1z to 7z', () => {
    expect(tiles('drew 1z, discarded 7z')).toEqual([
      { id: HONOR, red: false },
      { id: HONOR + 6, red: false },
    ])
  })

  it('keeps the prose either side of every code, in order', () => {
    expect(splitTileCodes('Turn 4: drew 4z, discarded 3s; best was 0s')).toEqual([
      'Turn 4: drew ',
      { id: HONOR + 3, red: false },
      ', discarded ',
      { id: SOU + 2, red: false },
      '; best was ',
      { id: SOU + 4, red: true },
    ])
  })

  it('leaves a sentence with no tiles in it alone', () => {
    const text = 'Rewound to entry 12'
    expect(splitTileCodes(text)).toEqual([text])
  })

  it('does not mistake the other numbers in the prose for tiles', () => {
    // ukeire counts, points, turn numbers and the clock all sit beside a digit at some point;
    // none of them is a digit followed straight by a suit letter
    expect(tiles('Hand 3: answered 2, actually 4 (via chiitoitsu) in 0:02.345')).toEqual([])
    expect(tiles('Dealt in: to East — 8000 points')).toEqual([])
  })

  it('finds the same tiles in every language', () => {
    // the codes reach all four translations through the same params, which is what lets one
    // tokenizer over the finished sentence fix the lot without touching the JSON
    const row = entry('log.efficiency.discardMistakeDrew', {
      turn: 4,
      drawn: '4z',
      tile: '0p',
      yours: 57,
      best: '3z',
      bestUkeire: 68,
      shanten: 2,
    })
    const expected = [
      { id: HONOR + 3, red: false },
      { id: PIN + 4, red: true },
      { id: HONOR + 2, red: false },
    ]
    for (const lng of ['en', 'ja', 'zh', 'it']) {
      expect(tiles(formatLogEntry(row, i18n.getFixedT(lng))), lng).toEqual(expected)
    }
  })
})

describe('the chinitsu result row', () => {
  const row = (correct: boolean, picked: string[]) =>
    entry('log.chinitsu.result', {
      hand: 2,
      waits: ['1p', '4p', '7p'],
      picked,
      correct,
      elapsedMs: 2345,
    })

  it('draws the waits as tiles, and the picks too when they were wrong, in every language', () => {
    const waits = [PIN, PIN + 3, PIN + 6].map((id) => ({ id, red: false }))
    for (const lng of ['en', 'ja', 'zh', 'it']) {
      const t = i18n.getFixedT(lng)
      expect(tiles(formatLogEntry(row(true, ['1p', '4p', '7p']), t)), lng).toEqual(waits)
      expect(tiles(formatLogEntry(row(false, ['4p']), t)), lng).toEqual([
        ...waits,
        { id: PIN + 3, red: false },
      ])
    }
  })

  it('names an empty pick rather than leaving a gap', () => {
    const t = i18n.getFixedT('en')
    expect(formatLogEntry(row(false, []), t)).toBe(
      'Hand 2: waits 1p 4p 7p, you picked none — wrong in 0:02.345',
    )
  })
})

describe('the locales the tokenizer runs over', () => {
  /** Every string in a translation file, with the path that reaches it. */
  function* strings(node: unknown, path: string): Generator<[string, string]> {
    if (typeof node === 'string') yield [path, node]
    else if (node && typeof node === 'object')
      for (const [key, value] of Object.entries(node)) yield* strings(value, `${path}.${key}`)
  }

  it('contains no bare tile code of its own', () => {
    // `splitTileCodes` runs over the *finished* sentence, so a translation carrying a token
    // shaped like a tile code has it silently drawn as a tile. Nothing does today; this is what
    // says so the day someone writes "1z" into a string rather than passing it as a param.
    for (const [name, locale] of Object.entries({ en, it: it_, ja, zh })) {
      for (const [path, text] of strings(locale, name)) {
        expect(text, path).not.toMatch(/\b(0[mps]|[1-9][mps]|[1-7]z)\b/)
      }
    }
  })
})
