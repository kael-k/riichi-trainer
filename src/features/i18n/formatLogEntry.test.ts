import { describe, expect, it } from 'vitest'
import { HONOR, PIN, SOU } from '../../core/tiles'
import type { LogEntry as RoundLogEntry } from '../../core/round'
import type { LogEntry } from '../../store/log'
import { formatLogEntry, formatStatsLines, splitTileCodes } from './formatLogEntry'
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

  it('says a hand with no waits is not tenpai', () => {
    const t = i18n.getFixedT('en')
    const noten = entry('log.chinitsu.result', {
      hand: 3,
      waits: [],
      picked: [],
      correct: true,
      elapsedMs: 1000,
    })
    expect(formatLogEntry(noten, t)).toBe('Hand 3: waits none (not tenpai) — correct in 0:01.000')
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

describe('formatStatsLines', () => {
  const t = i18n.getFixedT('en')
  const discard: RoundLogEntry = {
    kind: 'discard',
    seat: 0,
    tile: { id: PIN + 6, red: false },
    fromDrawn: false,
    riichi: false,
  }
  const priced = (tile: number, ev: number, dealIn = 0) => ({ tile, ev, dealIn })

  it('names the model and the objective, and "best" only when it is not what was thrown', () => {
    const lines = formatStatsLines(
      {
        kind: 'discard',
        models: [
          {
            model: 'statistical',
            objective: 'points',
            unsupported: false,
            chosen: priced(PIN + 6, -120, 0.054),
            best: priced(PIN + 5, 180, 0.02),
          },
          {
            model: 'houou',
            objective: 'points',
            unsupported: false,
            chosen: priced(PIN + 6, 90, 0.071),
            best: priced(PIN + 6, 90, 0.071),
          },
        ],
        danger: { tier: 'suji', safest: 'genbutsu' },
      },
      discard,
      t,
      'en',
    )
    expect(lines).toEqual([
      'Statistic (Points): EV -120 · best 6p +180 · deal-in 5.4%',
      'Houou (Points): EV +90 · deal-in 7.1%',
      'Heuristic: Suji · safest Genbutsu',
    ])
  })

  it('leaves out deal-in and the tier with nobody in riichi, and never borrows a model', () => {
    const lines = formatStatsLines(
      {
        kind: 'discard',
        models: [
          {
            model: 'statistical',
            objective: 'points',
            unsupported: false,
            chosen: priced(PIN + 6, 40),
            best: priced(PIN + 6, 40),
          },
          { model: 'houou', objective: 'points', unsupported: true },
        ],
      },
      discard,
      t,
      'en',
    )
    expect(lines).toEqual(['Statistic (Points): EV +40', 'Houou (Points): no three-player data'])
  })

  it('prices a call against the pass, and says so when the call was not priced', () => {
    const call: RoundLogEntry = {
      kind: 'call',
      seat: 1,
      from: 0,
      call: { kind: 'chi', from: [SOU + 2, SOU + 3] },
    }
    const lines = formatStatsLines(
      {
        kind: 'call',
        models: [
          {
            model: 'statistical',
            objective: 'points',
            unsupported: false,
            call: 350,
            pass: 120,
            best: { call: { kind: 'chi', from: [SOU + 2, SOU + 3] }, ev: 350 },
          },
          {
            model: 'houou',
            objective: 'points',
            unsupported: false,
            call: null,
            pass: 120,
            best: { call: { kind: 'chi', from: [SOU + 5, SOU + 6] }, ev: 200 },
          },
        ],
      },
      call,
      t,
      'en',
    )
    expect(lines).toEqual([
      'Statistic (Points): call +350 · pass +120',
      'Houou (Points): call not priced · pass +120 · best Chi 6s 7s',
    ])
  })
})
