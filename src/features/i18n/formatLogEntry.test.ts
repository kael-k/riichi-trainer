import { describe, expect, it } from 'vitest'
import { HONOR, PIN, SOU } from '../../core/tiles'
import type { LogEntry } from '../../store/log'
import { formatLogEntry, splitTileCodes } from './formatLogEntry'
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
