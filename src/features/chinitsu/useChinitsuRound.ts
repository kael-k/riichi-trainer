import { useEffect, useRef, useState } from 'react'
import { dealFlushHand, type FlushOptions } from '../../core/flush'
import { createHand } from '../../core/hand'
import { shanten } from '../../core/shanten'
import {
  HONOR,
  NUM_TILE_TYPES,
  serializeTenhou,
  suitOf,
  tileCode,
  type ParsedTile,
  type TileId,
} from '../../core/tiles'
import { readWaits, type HandWait } from '../../core/waits'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog, type LogDetail } from '../../store/log'
import { useLinkedHand } from '../situation/useLinkedHand'
import { encodeChinitsuLink, type ChinitsuLink } from './chinitsuUrl'

export interface ChinitsuOptions extends FlushOptions {
  noten: boolean
}

export interface RoundResult {
  /** Every tile that completes the hand, ascending. */
  waits: TileId[]
  /** What the reader confirmed, ascending. */
  picked: TileId[]
  correct: boolean
  /** The hand that was graded — the next one is already on screen by then. */
  hand: ParsedTile[]
}

interface State {
  hand: ParsedTile[]
  /** Has this hand been shown yet — distinct from whether the clock is ticking, since pausing must
   *  not re-conceal a hand already peeked at. */
  revealed: boolean
  /** The tiles toggled on so far, ascending. Cleared with every new hand. */
  selected: TileId[]
  /** Feedback for the previous answer; never blocks the current hand. */
  lastResult: RoundResult | null
}

function countsOf(tiles: ParsedTile[]): Uint8Array {
  const counts = new Uint8Array(NUM_TILE_TYPES)
  for (const t of tiles) counts[t.id]++
  return counts
}

const plain = (ids: TileId[]): ParsedTile[] => ids.map((id) => ({ id, red: false }))

/** The tiles offered as answers: all nine of every suit the hand holds, then each honour it holds.
 *  For a dealt flush that is one suit plus its honours, as the issue asks; deriving it from the
 *  hand rather than the suit setting is what keeps a linked hand (any suit, or several) honest. A
 *  honour the hand does not hold can never be a wait, so it is never offered. */
export function candidateTiles(hand: ParsedTile[]): TileId[] {
  const counts = countsOf(hand)
  const result: TileId[] = []
  for (const base of [0, 9, 18]) {
    let held = false
    for (let rank = 0; rank < 9; rank++) held ||= counts[base + rank] > 0
    if (held) for (let rank = 0; rank < 9; rank++) result.push(base + rank)
  }
  for (let id = HONOR; id < NUM_TILE_TYPES; id++) if (counts[id] > 0) result.push(id)
  return result
}

/** The expanded log row: what was missed, what was wrong, then every reading of every wait — the
 *  mentsu, toitsu and waiting part each one splits the thirteen into. A hand with no waits says how
 *  far off tenpai it is instead, `shantenCount` (passed as 0 for a tenpai hand, and never read). */
export function waitDetail(waits: HandWait[], picked: TileId[], shantenCount: number): LogDetail[] {
  const waitIds = waits.map((w) => w.tile)
  const missed = waitIds.filter((id) => !picked.includes(id))
  const wrong = picked.filter((id) => !waitIds.includes(id))
  const lines: LogDetail[] = []
  if (missed.length > 0)
    lines.push({ key: 'log.chinitsu.missed', tiles: plain(missed), tone: 'error' })
  if (wrong.length > 0) {
    lines.push({ key: 'log.chinitsu.notWaits', tiles: plain(wrong), tone: 'error' })
  }
  if (waits.length === 0) {
    lines.push({ key: 'log.chinitsu.noten', params: { shanten: shantenCount } })
    return lines
  }
  lines.push({ key: 'log.chinitsu.readings', header: true })
  for (const wait of waits) {
    for (const reading of wait.readings) {
      lines.push({
        key: `chinitsu.shape.${reading.shape}`,
        tiles: plain([wait.tile]),
        blocks: reading.blocks.map((block) => ({ role: block.role, tiles: plain(block.tiles) })),
      })
    }
  }
  return lines
}

/** Drives a continuous stream of one-suit hands, the shanten trainer's shape: reveal once, then
 *  answer after answer, the feedback for the last one alongside the hand already dealt. An answer
 *  is a set of tiles toggled on, confirmed as one — right only when it is exactly the hand's
 *  waits. A hand that is not tenpai (`options.noten`, or any link) has none, so its answer is the
 *  empty set: `submitNotTenpai`, or confirming with nothing picked. */
export function useChinitsuRound(link: ChinitsuLink, options: ChinitsuOptions) {
  const { handIndex, fromLink, next: advance } = useLinkedHand(link)
  // keyed on the link object as well as the index, for the reason `useShantenRound` gives: the
  // index restarts at 0 for every link, and a fresh link's own hand 0 must still be logged. The
  // hand itself is in the key too: changing the suit or hand setting re-deals the same index, and
  // that new hand is owed its own row — while a pinned hand re-posed by the same change is not
  const loggedDeal = useRef<{ link: ChinitsuLink; handIndex: number; hand: string } | undefined>(
    undefined,
  )
  const stats = useSessionStats()
  const [state, setState] = useState<State>(() => nextHand())
  const log = useLog((s) => s.log)

  /** The deal's own boundary row — no tiles, the graded row after it carries the hand. */
  function logDealt(hand: ParsedTile[]) {
    const key = { link, handIndex, hand: serializeTenhou(hand) }
    const last = loggedDeal.current
    if (last?.link === key.link && last.handIndex === key.handIndex && last.hand === key.hand) {
      return
    }
    loggedDeal.current = key
    log({
      key: 'log.dealtHand',
      params: { hand: stats.totalCount + 1 },
      copyText: serializeTenhou(hand),
      situation: encodeChinitsuLink({ seed: link.seed, hand }),
    })
  }

  /** Deals the hand for the current `handIndex`, carrying over whether the stream is revealed and
   *  the pending feedback. A link's hand is posed once, as it was written (red fives and all), and
   *  the stream deals on from the seed under the reader's own suit and hand settings. */
  function nextHand(prev?: State): State {
    stats.startClock()
    const carry = {
      revealed: prev?.revealed ?? true,
      lastResult: prev?.lastResult ?? null,
      selected: [],
    }
    if (fromLink && link.hand) {
      return { hand: [...link.hand].sort((a, b) => a.id - b.id), ...carry }
    }
    const seed = `${link.seed || stats.randomSeed}:${handIndex}`
    return { hand: dealFlushHand(seed, options), ...carry }
  }

  useEffect(() => {
    const next = nextHand(state)
    setState(next)
    logDealt(next.hand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, handIndex, options.suit, options.hands, options.noten])

  function submit(picked: TileId[]) {
    if (!state.revealed) return
    const counts = countsOf(state.hand)
    const waits = readWaits(counts)
    const waitIds = waits.map((w) => w.tile)
    const correct = waitIds.length === picked.length && waitIds.every((id, i) => id === picked[i])
    const hand = createHand()
    hand.counts.set(counts)
    const elapsed = stats.elapsedNow()
    // logged here, from the action itself rather than an effect watching state, so rows stay in
    // play order. Codes, not text, so a language switch re-reads the line (`formatLogEntry`)
    log({
      key: 'log.chinitsu.result',
      params: {
        hand: stats.totalCount + 1,
        waits: waitIds.map((id) => tileCode(id)),
        picked: picked.map((id) => tileCode(id)),
        correct,
        elapsedMs: elapsed,
      },
      tiles: state.hand,
      copyText: serializeTenhou(state.hand),
      severity: correct ? 'ok' : 'error',
      situation: encodeChinitsuLink({ seed: link.seed, hand: state.hand }),
      detail: waitDetail(waits, picked, waits.length > 0 ? 0 : shanten(hand)),
    })
    stats.record(correct, elapsed)
    setState((s) => ({
      ...s,
      lastResult: { waits: waitIds, picked, correct, hand: s.hand },
    }))
    advance()
  }

  return {
    ...state,
    candidates: candidateTiles(state.hand),
    elapsedNow: stats.elapsedNow,
    running: state.revealed && !stats.paused,
    concealed: !state.revealed,
    paused: stats.paused,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    reveal: () =>
      setState((s) => {
        if (s.revealed) return s
        stats.startClock()
        return { ...s, revealed: true }
      }),
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    /** Abandons the current hand: re-conceals, drops the timer, deals a fresh one. */
    stop: () => {
      stats.startClock()
      setState((s) => ({ ...s, revealed: false }))
      advance()
    },
    /** Turns one answer tile on or off. A no-op while the hand is face down. */
    toggle: (tile: TileId) =>
      setState((s) => {
        if (!s.revealed) return s
        const selected = s.selected.includes(tile)
          ? s.selected.filter((id) => id !== tile)
          : [...s.selected, tile].sort((a, b) => a - b)
        return { ...s, selected }
      }),
    /** Confirms the tiles toggled on as the answer. */
    submit: () => submit(state.selected),
    /** Answers "this hand has no waits", whatever is toggled on. */
    submitNotTenpai: () => submit([]),
  }
}

/** Whether every candidate shares one suit — what lets a digit key name a tile on its own. */
export function singleSuit(candidates: TileId[]): 'm' | 'p' | 's' | undefined {
  const suits = new Set(candidates.filter((id) => id < HONOR).map(suitOf))
  return suits.size === 1 ? ([...suits][0] as 'm' | 'p' | 's') : undefined
}
