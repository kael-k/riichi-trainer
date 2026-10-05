import { describe, expect, it } from 'vitest'
import { handFromTenhou } from './hand'
import { waits } from './policy'
import { mulberry32, shuffle } from './rng'
import { HONOR, NUM_TILE_TYPES, parseTenhou, PIN, SOU } from './tiles'
import { karatenTiles, readWaits, type HandWait } from './waits'
import { buildWall } from './wall'

function read(tenhou: string): HandWait[] {
  return readWaits(handFromTenhou(tenhou).counts)
}

function ids(tenhou: string) {
  return parseTenhou(tenhou).map((t) => t.id)
}

describe('readWaits', () => {
  it('names the shape of each single-reading wait', () => {
    expect(read('123m456m789m55p34s').map((w) => [w.tile, w.readings[0].shape])).toEqual([
      [SOU + 1, 'ryanmen'],
      [SOU + 4, 'ryanmen'],
    ])
    expect(read('123m456m789m55p35s').map((w) => [w.tile, w.readings[0].shape])).toEqual([
      [SOU + 3, 'kanchan'],
    ])
    expect(read('123m456m789m55p12s').map((w) => [w.tile, w.readings[0].shape])).toEqual([
      [SOU + 2, 'penchan'],
    ])
    expect(read('123m456m789m55p89s').map((w) => [w.tile, w.readings[0].shape])).toEqual([
      [SOU + 6, 'penchan'],
    ])
    expect(read('123m456m789m55p33s').map((w) => [w.tile, w.readings[0].shape])).toEqual([
      [PIN + 4, 'shanpon'],
      [SOU + 2, 'shanpon'],
    ])
    expect(read('123m456m789m555p3s').map((w) => [w.tile, w.readings[0].shape])).toEqual([
      [SOU + 2, 'tanki'],
    ])
  })

  it('splits the thirteen into mentsu, toitsu and the waiting part, every tile exactly once', () => {
    const [wait] = read('123m456m789m55p35s')
    expect(wait.readings).toEqual([
      {
        shape: 'kanchan',
        blocks: [
          { role: 'mentsu', tiles: ids('123m') },
          { role: 'mentsu', tiles: ids('456m') },
          { role: 'mentsu', tiles: ids('789m') },
          { role: 'toitsu', tiles: ids('55p') },
          { role: 'wait', tiles: ids('35s') },
        ],
      },
    ])
  })

  it('gives every reading of a wait, not just one', () => {
    // 1112345678999p — the nine-sided chuuren shape: every rank is a wait, and 2p reads both as a
    // tanki on 2 (111 234 567 8 99 9…) and as a run partial
    const waits = read('1112345678999p')
    expect(waits.map((w) => w.tile)).toEqual(ids('123456789p'))
    for (const wait of waits) expect(wait.readings.length).toBeGreaterThan(0)
    expect(waits.some((w) => w.readings.length > 1)).toBe(true)
  })

  it('reads a seven-pairs tenpai as a chiitoitsu tanki', () => {
    const waits = read('113355779p1122s')
    expect(waits.map((w) => w.tile)).toEqual([PIN + 8])
    expect(waits[0].readings).toEqual([
      {
        shape: 'chiitoitsu',
        blocks: [
          ...['11p', '33p', '55p', '77p', '11s', '22s'].map((p) => ({
            role: 'toitsu',
            tiles: ids(p),
          })),
          { role: 'wait', tiles: [PIN + 8] },
        ],
      },
    ])
  })

  it('keeps a honour wait beside the suit', () => {
    // 12345678p + 11z pair + 222z — waiting on 3p (12 penchan) and 6p/9p (78 ryanmen), nothing on
    // the honours
    expect(read('12345678p11z222z').map((w) => w.tile)).toEqual(ids('369p'))
    // two honour pairs beside three runs: a shanpon on either
    expect(read('123456789p11z22z').map((w) => w.tile)).toEqual([HONOR, HONOR + 1])
    // a lone honour is a tanki on it
    expect(read('123456789p111p5z').map((w) => w.tile)).toContain(HONOR + 4)
  })

  it('drops a tile the hand already holds all four of', () => {
    // 1111p beside three complete sets completes only on a fifth 1p
    expect(read('123m456m789m1111p')).toEqual([])
    expect(karatenTiles(handFromTenhou('123m456m789m1111p').counts)).toEqual([PIN])
    expect(karatenTiles(handFromTenhou('1112345678999p').counts)).toEqual([])
  })

  it('is empty for a hand that is not tenpai', () => {
    expect(read('1359m2468p1357s1z')).toEqual([])
  })

  it('agrees with policy.waits on random hands — the wait set, before any reading', () => {
    // `policy.waits` is shanten + ukeire: a different algorithm reaching the same set, so the two
    // checking each other is the specification `readWaits` is held to
    const rng = mulberry32('waits-cross-check')
    let tenpai = 0
    for (let i = 0; i < 3000; i++) {
      // a one-suit hand half the time, so tenpai shapes actually turn up; a full wall otherwise
      const pool =
        i % 2 === 0
          ? shuffle(
              Array.from({ length: 36 }, (_, k) => [0, 9, 18][i % 3] + (k % 9)),
              rng,
            )
          : buildWall(`waits-${i}`)
      const hand = handFromTenhou('')
      for (const id of pool.slice(0, 13)) hand.counts[id]++
      const expected = waits(hand, false)
      expect(
        readWaits(hand.counts).map((w) => w.tile),
        Array.from(hand.counts).join(''),
      ).toEqual(expected)
      if (expected.length > 0) tenpai++
    }
    expect(tenpai).toBeGreaterThan(100)
  })

  it('every reading accounts for each of the thirteen tiles exactly once', () => {
    const counts = handFromTenhou('2223456777888s').counts
    counts[SOU + 7]-- // 13 tiles
    for (const wait of readWaits(counts)) {
      for (const reading of wait.readings) {
        const seen = new Uint8Array(NUM_TILE_TYPES)
        for (const block of reading.blocks) for (const id of block.tiles) seen[id]++
        expect(Array.from(seen)).toEqual(Array.from(counts))
      }
    }
  })
})
