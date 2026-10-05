import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { HONOR, parseTenhou, PIN, SOU, suitOf } from '../../core/tiles'
import { useLog } from '../../store/log'
import { decodeChinitsuLink, type ChinitsuLink } from './chinitsuUrl'
import {
  candidateTiles,
  singleSuit,
  useChinitsuRound,
  type ChinitsuOptions,
} from './useChinitsuRound'

const OPTIONS: ChinitsuOptions = { suit: 'p', hands: 'both' }

/** 1112345678999p — chuuren's shape, waiting on every pin. */
const CHUUREN = (): ChinitsuLink => ({ hand: parseTenhou('1112345678999p') })

/** 111 234 567 999 + 79p — a kanchan on 8p and nothing else: 9p completes the shape too, but the
 *  hand already holds all four. */
const KANCHAN = (): ChinitsuLink => ({ hand: parseTenhou('1112345679999p') })

function graded() {
  return useLog.getState().entries.filter((e) => e.key === 'log.chinitsu.result')
}

describe('useChinitsuRound', () => {
  beforeEach(() => useLog.getState().clear())

  it('deals a 13-tile tenpai hand in the chosen suit, revealed and on the clock', () => {
    // links are hoisted out of the render callback throughout: a fresh object per render is a
    // fresh navigation to `useLinkedHand`, which resets the stream on every one of them
    const link = { seed: 'deal' }
    const options: ChinitsuOptions = { suit: 's', hands: 'chinitsu' }
    const { result } = renderHook(() => useChinitsuRound(link, options))
    expect(result.current.hand).toHaveLength(13)
    expect(result.current.hand.every((t) => suitOf(t.id) === 's')).toBe(true)
    expect(result.current.concealed).toBe(false)
    expect(result.current.running).toBe(true)
    expect(result.current.candidates).toEqual([...Array(9).keys()].map((r) => SOU + r))
  })

  it('poses a linked hand once, as written', () => {
    const link = KANCHAN()
    const { result } = renderHook(() => useChinitsuRound(link, OPTIONS))
    expect(result.current.hand).toEqual(link.hand)
  })

  it('grades exactly the waits as correct, and logs the hand with every reading', () => {
    const link = CHUUREN()
    const { result } = renderHook(() => useChinitsuRound(link, OPTIONS))
    for (let rank = 0; rank < 9; rank++) act(() => result.current.toggle(PIN + rank))
    act(() => result.current.submit())

    expect(result.current.lastResult?.correct).toBe(true)
    expect(result.current.lastResult?.waits).toHaveLength(9)
    expect(result.current.correctCount).toBe(1)
    const [row] = graded()
    expect(row.severity).toBe('ok')
    expect(row.params).toMatchObject({
      hand: 1,
      correct: true,
      waits: ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p'],
    })
    expect(row.tiles).toEqual(link.hand)
    // a correct answer misses nothing and picks nothing wrong: the detail is the readings alone
    expect(row.detail?.[0]).toMatchObject({ key: 'log.chinitsu.readings', header: true })
    const readings = row.detail!.slice(1)
    expect(readings.length).toBeGreaterThanOrEqual(9)
    for (const line of readings) {
      expect(line.key).toMatch(/^chinitsu\.shape\./)
      expect(line.blocks?.flatMap((b) => b.tiles)).toHaveLength(13)
      expect(line.blocks?.filter((b) => b.role === 'wait')).toHaveLength(1)
    }
    // the row rewinds to this exact hand
    expect(decodeChinitsuLink(new URLSearchParams(row.situation)).hand).toEqual(link.hand)
  })

  it('grades a partial answer wrong, naming what was missed and what is not a wait', () => {
    const link = KANCHAN()
    const { result } = renderHook(() => useChinitsuRound(link, OPTIONS))
    act(() => result.current.toggle(PIN + 7)) // 8p, the wait
    act(() => result.current.toggle(PIN + 5)) // 6p, not one
    act(() => result.current.toggle(PIN + 5)) // …toggled back off
    act(() => result.current.toggle(PIN + 1)) // 2p, not one
    expect(result.current.selected).toEqual([PIN + 1, PIN + 7])
    act(() => result.current.submit())

    expect(result.current.lastResult).toMatchObject({
      correct: false,
      waits: [PIN + 7],
      picked: [PIN + 1, PIN + 7],
    })
    const [row] = graded()
    expect(row.severity).toBe('error')
    expect(row.params).toMatchObject({ waits: ['8p'], picked: ['2p', '8p'], correct: false })
    expect(row.detail?.[0]).toMatchObject({
      key: 'log.chinitsu.notWaits',
      tone: 'error',
      tiles: [{ id: PIN + 1, red: false }],
    })
    expect(row.detail?.find((d) => d.key === 'chinitsu.shape.kanchan')).toBeDefined()

    const other = KANCHAN()
    const missedOnly = renderHook(() => useChinitsuRound(other, OPTIONS)).result
    act(() => missedOnly.current.submit())
    expect(graded()[1].detail?.[0]).toMatchObject({ key: 'log.chinitsu.missed', tone: 'error' })
  })

  it('rolls straight into the next hand with an empty selection, still revealed', () => {
    const link = CHUUREN()
    const { result } = renderHook(() => useChinitsuRound(link, OPTIONS))
    act(() => result.current.toggle(PIN))
    act(() => result.current.submit())
    expect(result.current.selected).toEqual([])
    expect(result.current.concealed).toBe(false)
    expect(result.current.hand.map((t) => t.id)).not.toEqual(CHUUREN().hand!.map((t) => t.id))
    expect(result.current.lastResult?.hand).toEqual(CHUUREN().hand)
  })

  it('stop re-conceals and deals afresh; a face-down hand takes no answer', () => {
    const link = { seed: 'stop' }
    const { result } = renderHook(() => useChinitsuRound(link, OPTIONS))
    const shown = result.current.hand
    act(() => result.current.stop())
    expect(result.current.concealed).toBe(true)
    expect(result.current.hand).not.toEqual(shown)
    act(() => result.current.toggle(PIN))
    expect(result.current.selected).toEqual([])
    act(() => result.current.submit())
    expect(graded()).toHaveLength(0)
  })

  it('re-deals under a new setting, and logs the new deal', () => {
    let options: ChinitsuOptions = { suit: 'p', hands: 'chinitsu' }
    const link = { seed: 'settings' }
    const { result, rerender } = renderHook(() => useChinitsuRound(link, options))
    expect(suitOf(result.current.hand[0].id)).toBe('p')
    options = { suit: 'm', hands: 'chinitsu' }
    rerender()
    expect(result.current.hand.every((t) => suitOf(t.id) === 'm')).toBe(true)
    const dealt = useLog.getState().entries.filter((e) => e.key === 'log.dealtHand')
    expect(dealt.map((e) => e.copyText)).toEqual([
      expect.stringMatching(/^\d+p$/),
      expect.stringMatching(/^\d+m$/),
    ])
  })
})

describe('candidateTiles', () => {
  it('offers the hand’s suit in full and only the honours it holds', () => {
    const candidates = candidateTiles(parseTenhou('12345678s111z22z'))
    expect(candidates).toEqual([...[...Array(9).keys()].map((r) => SOU + r), HONOR, HONOR + 1])
    expect(singleSuit(candidates)).toBe('s')
  })

  it('offers every suit a mixed linked hand holds', () => {
    const candidates = candidateTiles(parseTenhou('123m456m789m55p34s'))
    expect(candidates).toHaveLength(27)
    expect(singleSuit(candidates)).toBeUndefined()
  })
})
