import { useEffect, useRef, useState } from 'react'
import { addTile, createHand, handToTiles, type Hand } from '../../core/hand'
import { chiitoiShanten, kokushiShanten, standardShanten } from '../../core/shanten'
import { serializeTenhou, type ParsedTile } from '../../core/tiles'
import { deal, INITIAL_HAND_SIZE } from '../../core/wall'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog } from '../../store/log'
import { encodeSituation, type Situation } from '../situation/urlCodec'

export type ShantenPath = 'standard' | 'chiitoitsu' | 'kokushi'

export interface ShantenBreakdown {
  value: number
  /** Every formula that reaches the minimum; usually just `standard`. */
  paths: ShantenPath[]
}

export interface RoundResult {
  guess: number
  actual: ShantenBreakdown
  correct: boolean
  /** The hand that was graded — the next one is already on screen by then. */
  hand: ParsedTile[]
}

interface State {
  hand: ParsedTile[]
  /** Has this hand been shown yet — distinct from whether the clock is currently ticking, since
   *  pausing must not re-conceal a hand already peeked at. */
  revealed: boolean
  /** Feedback for the previous guess; never blocks the current hand. */
  lastResult: RoundResult | null
}

function computeBreakdown(hand: Hand): ShantenBreakdown {
  const standard = standardShanten(hand)
  const chiitoitsu = chiitoiShanten(hand)
  const kokushi = kokushiShanten(hand)
  const value = Math.min(standard, chiitoitsu, kokushi)
  const paths: ShantenPath[] = []
  if (standard === value) paths.push('standard')
  if (chiitoitsu === value) paths.push('chiitoitsu')
  if (kokushi === value) paths.push('kokushi')
  return { value, paths }
}

/** Drives a continuous stream of hands: reveal once, then guess after guess with
 *  the feedback for the last one alongside the hand already dealt. */
export function useShantenRound(situation: Situation, sanma: boolean) {
  const [handIndex, setHandIndex] = useState(0)
  // handIndex counts hands dealt this mount, but a link (or a rewind out of the log) names one
  // exact hand, which only the index-0 deal below shows. Reset it whenever the situation changes
  // identity — the "adjust state while rendering" pattern the other trainers use
  const [lastSituation, setLastSituation] = useState(situation)
  // the dedupe ref below only tells hands apart by handIndex, which restarts at 0 for every new
  // situation — reset it alongside the index so a fresh link's own hand 0 isn't skipped as "already
  // logged" just because the previous situation's hand 0 was
  const loggedDealIndex = useRef<number | undefined>(undefined)
  if (situation !== lastSituation) {
    setLastSituation(situation)
    setHandIndex(0)
    loggedDealIndex.current = undefined
  }
  const stats = useSessionStats()
  const handRef = useRef<Hand>(undefined)
  const [state, setState] = useState<State>(() => nextHand())
  const log = useLog((s) => s.log)

  /** The deal, as its own log row — see the table hook's own `logReplay` for why every deal needs
   *  one now that the page's own share pill is gone (T3). Keyed on `handIndex` rather than
   *  `situation` (which does not move per hand in this stream) — see the reset above.
   *
   *  It draws no tiles: this is a boundary, and the graded row that follows already carries the
   *  hand. Two copies of one hand in a list read newest-first put the incoming hand's tiles
   *  directly above the *previous* hand's verdict, which reads as the deal having replaced it.
   *  What it keeps is what only it can offer — the copy, rewind and share of a hand nobody has
   *  answered yet — plus the number, so a boundary in a reversed list says which hand it opens. */
  function logDealt(hand: ParsedTile[]) {
    if (loggedDealIndex.current === handIndex) return
    loggedDealIndex.current = handIndex
    log({
      key: 'log.dealtHand',
      params: { hand: stats.totalCount + 1 },
      copyText: serializeTenhou(hand),
      situation: encodeSituation({ ...situation, hand, wall: [], log: [] }),
    })
  }

  /** Deals the hand for the current `handIndex`, carrying over whether the stream is
   *  revealed and the pending feedback so an answered hand rolls straight into the next. */
  function nextHand(prev?: State): State {
    stats.startClock()
    const carry = {
      // the stream starts running: every other trainer puts a board up the moment it loads, and a
      // concealed first hand behind a button reads as "not loaded yet" rather than as a gate
      revealed: prev?.revealed ?? true,
      lastResult: prev?.lastResult ?? null,
    }
    const seed = `${situation.seed || stats.randomSeed}:${handIndex}`
    // a pinned hand is the hand the link names, not every hand from here on: it is shown once and
    // the stream carries on dealing from the seed, so a rewind doesn't freeze the trainer
    if (handIndex === 0 && situation.hand?.length === INITIAL_HAND_SIZE) {
      const hand = createHand()
      for (const t of situation.hand) addTile(hand, t.id)
      handRef.current = hand
      // keep the situation's tiles (not counts) so red-five flags survive to display
      return { hand: [...situation.hand].sort((a, b) => a.id - b.id), ...carry }
    }
    const hand = deal(seed, INITIAL_HAND_SIZE, sanma)
    handRef.current = hand
    return { hand: handToTiles(hand), ...carry }
  }

  useEffect(() => {
    const next = nextHand(state)
    setState(next)
    logDealt(next.hand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, handIndex, sanma])

  return {
    ...state,
    elapsedNow: stats.elapsedNow,
    /** Whether the clock is actively ticking right now — false both before the first reveal and
     *  while paused, true only once revealed and running. */
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
    /** Pauses/resumes the clock without re-conceal — the hand stays exactly as shown, since it
     *  was already peeked at either way; only the clock freezes. */
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    /** Abandons the current hand: re-conceals, drops the timer, deals a fresh one — distinct from
     *  a pause, which keeps the same hand and clock and can resume. */
    stop: () => {
      // reset the clock here rather than leaving it to the deal below, so the displayed timer is
      // already back at zero by the render that conceals the hand
      stats.startClock()
      setState((s) => ({ ...s, revealed: false }))
      setHandIndex((n) => n + 1)
    },
    submit: (guess: number) => {
      if (!state.revealed || !handRef.current) return
      const actual = computeBreakdown(handRef.current)
      const correct = guess === actual.value
      const elapsed = stats.elapsedNow()
      // logged here rather than from a page effect, so entries stay in play order. Raw paths/
      // correct/elapsed go through as params (not formatted text) so a later language switch
      // re-translates the line instead of leaving stale fragments — see formatLogEntry's
      // special case for this key.
      log({
        key: 'log.shanten.result',
        params: {
          hand: stats.totalCount + 1,
          guess,
          actual: actual.value,
          paths: actual.paths,
          correct,
          elapsedMs: elapsed,
        },
        tiles: state.hand,
        copyText: serializeTenhou(state.hand),
        severity: correct ? 'ok' : 'error',
        // the hand as it was asked, so the row rewinds (and shares) back to this exact deal —
        // the tiles pin it outright, which is why no seed replay is involved
        situation: encodeSituation({ ...situation, hand: state.hand, wall: [], log: [] }),
      })
      stats.record(correct, elapsed)
      // keep running: the feedback rides along with the hand dealt by the index bump
      setState((s) => ({ ...s, lastResult: { guess, actual, correct, hand: s.hand } }))
      setHandIndex((n) => n + 1)
    },
  }
}
