import { describe, expect, it } from 'vitest'
import { decodeLog, encodeLog } from './actionLog'
import { createMatch } from './match'
import { playRound, type LogEntry, type RoundOptions } from './round'
import { MAN, PIN, SOU } from './tiles'

const YONMA: RoundOptions = {
  sanma: false,
  aka: true,
  match: createMatch(false),
  calls: true,
  riichi: true,
  wins: true,
}

const SANMA: RoundOptions = { ...YONMA, sanma: true, match: createMatch(true) }

describe('encodeLog / decodeLog', () => {
  it('round-trips an empty log', () => {
    expect(encodeLog([])).toBe('')
    expect(decodeLog('')).toEqual([])
  })

  it('round-trips one entry of every kind', () => {
    const log: LogEntry[] = [
      { kind: 'discard', seat: 0, tile: { id: MAN, red: false }, fromDrawn: false, riichi: false },
      {
        kind: 'discard',
        seat: 1,
        tile: { id: PIN + 4, red: true },
        fromDrawn: true,
        riichi: false,
      },
      {
        kind: 'discard',
        seat: 2,
        tile: { id: SOU + 8, red: false },
        fromDrawn: true,
        riichi: true,
      },
      { kind: 'call', seat: 3, from: 2, call: { kind: 'pon', from: [SOU + 8, SOU + 8] } },
      { kind: 'call', seat: 0, from: 3, call: { kind: 'chi', from: [MAN + 1, MAN + 2] } },
      { kind: 'kita', seat: 1 },
      { kind: 'ankan', seat: 2, tile: MAN },
      { kind: 'win', seat: 0, from: undefined },
      { kind: 'win', seat: 1, from: 0 },
      { kind: 'abort', seat: 3 },
    ]
    expect(decodeLog(encodeLog(log))).toEqual(log)
  })

  it('round-trips a red five with no other flags, and one with both', () => {
    const log: LogEntry[] = [
      {
        kind: 'discard',
        seat: 0,
        tile: { id: PIN + 4, red: true },
        fromDrawn: false,
        riichi: false,
      },
      { kind: 'discard', seat: 1, tile: { id: PIN + 4, red: true }, fromDrawn: true, riichi: true },
    ]
    expect(decodeLog(encodeLog(log))).toEqual(log)
  })

  it('round-trips a real match log end to end, yonma and sanma', () => {
    for (let i = 0; i < 15; i++) {
      const { state } = playRound(`actionlog-${i}`, 4, YONMA)
      expect(decodeLog(encodeLog(state.log)), `seed actionlog-${i}`).toEqual(state.log)
    }
    for (let i = 0; i < 15; i++) {
      const { state } = playRound(`actionlog-sanma-${i}`, 3, SANMA)
      expect(decodeLog(encodeLog(state.log)), `seed actionlog-sanma-${i}`).toEqual(state.log)
    }
  })

  it('degrades a malformed string by stopping at the first token it cannot read, not throwing', () => {
    const good = encodeLog([
      { kind: 'discard', seat: 0, tile: { id: MAN, red: false }, fromDrawn: false, riichi: false },
    ])
    expect(decodeLog(good + 'Q')).toEqual(decodeLog(good)) // an unknown kind letter
    expect(decodeLog(good.slice(0, -1))).toEqual([]) // a discard cut off mid-tile
    expect(decodeLog('Dx5p')).toEqual([]) // seat isn't a digit at all
    expect(decodeLog('C0')).toEqual([]) // a call cut off before its own fields
  })
})
