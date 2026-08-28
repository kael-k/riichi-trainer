import { useEffect, useRef, useState } from 'react'
import { generateHand, type ScoringSituation } from '../../core/generateHand'
import { createMatch } from '../../core/match'
import {
  playWall,
  type RoundOptions,
  type RoundOutcome,
  type RoundState,
  type WinRecord,
} from '../../core/round'
import { mulberry32 } from '../../core/rng'
import { scoreHand, type ScoreResult } from '../../core/score'
import { HONOR, serializeTenhou, serializeTenhouOrdered, type ParsedTile } from '../../core/tiles'
import { useSessionStats } from '../../lib/useSessionStats'
import { useLog, type LogDetail } from '../../store/log'
import type { Settings } from '../settings/settingsStore'
import { completeWall } from '../../core/wall'
import { useLinkedHand } from '../situation/useLinkedHand'
import { encodeScoringUrl, encodeScoringWallUrl, type ScoringUrl } from './scoringUrl'

/** The whole scoring settings section, plus the ruleset the round runs under (which a shared
 *  link can pin, so it isn't a plain setting), the global red-fives toggle, and kiriage mangan —
 *  a match-wide rule now (`settingsStore.ts`), not a scoring-trainer field, so it rides in beside
 *  `sanma`/`aka` rather than inside the `scoring` section. */
export type ScoringOptions = Settings['scoring'] & {
  sanma: boolean
  aka: boolean
  kiriageMangan: boolean
}

export interface Answer {
  han?: number
  fu?: number
  /** Single points field: the ron total, or what each payer owes on a dealer tsumo. */
  points?: number
  /** Non-dealer tsumo only: the two payments differ, so they're graded separately. */
  pointsMain?: number
  pointsFromDealer?: number
}

export interface RoundResult {
  answer: Answer
  actual: ScoreResult
  correctHan: boolean
  correctFu: boolean
  correctPoints: boolean
  correct: boolean
  situation: ScoringSituation
}

interface State {
  situation: ScoringSituation
  /** The hand that was actually played out, for the table. Null for a link-pinned hand and for
   *  the constructive fallback — neither has a round behind it. */
  round: RoundState | null
  /** Seat that won; the table seats the player there. */
  seat: number
  /** Wall that reproduces this exact round, for the share link (ADR-0005) — replaces the old
   *  seed-based record, which searched seed suffixes rather than random walls. */
  roundWall: ParsedTile[] | null
  actual: ScoreResult
  checked: boolean
  lastResult: RoundResult | null
  /** Searching for a round. The board is not up yet, and the clock has not started. */
  loading: boolean
  /** The URL pinned a hand (or wall) with no legal win — a generated hand is shown instead, and
   *  the page says so rather than silently swapping it. */
  invalidLink: boolean
}

const MAX_ATTEMPTS = 40

function scoreSituation(situation: ScoringSituation, options: ScoringOptions): ScoreResult | null {
  return scoreHand({
    ...situation,
    rules: { kiriageMangan: options.kiriageMangan, honba: situation.honba, sanma: options.sanma },
  })
}

/** The board's own draw-order content, standing in for the seed a wall-based round no longer
 *  carries (ADR-0005) — the same wall always hashes to the same key, which is what lets `roundOptions`
 *  and `situationFromWin` reproduce the same round wind and honba roll from the wall alone. */
function wallKey(wall: ParsedTile[]): string {
  return serializeTenhouOrdered(wall)
}

function roundOptions(wall: ParsedTile[], options: ScoringOptions): RoundOptions {
  const rng = mulberry32(`${wallKey(wall)}:round`)
  return {
    sanma: options.sanma,
    aka: options.aka,
    // the round wind is part of the drill (it decides which wind pairs are yakuhai), so it
    // varies per hand — derived from the wall itself, like everything else about the round
    match: createMatch(options.sanma, { prevalentWind: HONOR + Math.floor(rng() * 4) }),
    calls: true,
    riichi: true,
    wins: true,
  }
}

function situationFromWin(win: WinRecord, wall: ParsedTile[]): ScoringSituation {
  // matches play a single hand, so there is no honba to inherit — it stays a wall-seeded extra
  // on top, exactly as the constructive generator did
  const rng = mulberry32(`${wallKey(wall)}:honba`)
  const honba = rng() < 0.3 ? Math.floor(rng() * 3) + 1 : 0
  return {
    concealed: win.concealed,
    melds: win.melds,
    ctx: win.ctx,
    doraIndicators: win.doraIndicators,
    uraIndicators: win.uraIndicators,
    kita: win.kita,
    honba,
  }
}

/** One graded field's line — your answer only when it was wrong, which is what picks the
 *  "you answered" phrasing at render (`formatLogEntry.ts`) *and* the error tone: the two say the
 *  same thing, so they are decided in the same place rather than derived twice. */
function fieldDetail(labelKey: string, expected: number, given: number | undefined): LogDetail {
  const answer = given === expected ? undefined : given
  return {
    key: 'log.scoring.field',
    params: { labelKey, expected, answer },
    tone: answer === undefined ? undefined : 'error',
  }
}

/** The detail lines a graded scoring row expands to: each field under test, the limit name, the
 *  full yaku list (or yakuman) with bonus han, and the fu itemization — everything the old
 *  reveal card (`ScoreBreakdown`) drew, now on the row rather than gating the board.
 *
 *  Grouped rather than flat: the graded fields lead (a wrong one in the error tone), then the han
 *  under a `Yaku` header, then the fu items under a `Fu` header ending in the subtotal — so the
 *  reader never has to work out which of three kinds of line they are looking at, nor do the
 *  rounding maths that turns 26 fu into 30. A yakuman carries no header: it is not a list of yaku
 *  adding to a han count, it is the hand's name. */
export function scoringDetail(
  actual: ScoreResult,
  answer: Answer,
  options: ScoringOptions,
  tsumo: boolean,
): LogDetail[] {
  const detail: LogDetail[] = []
  if (options.testHan) detail.push(fieldDetail('scoring.hanLabel', actual.han, answer.han))

  const skipFu = options.ignoreFuOnLimit && actual.han >= 5
  if (options.testFu && !skipFu) {
    const expectedFu = options.exactFu ? actual.fuExact : actual.fu
    detail.push(fieldDetail('scoring.fuLabel', expectedFu, answer.fu))
  }

  const split = actual.payments.fromDealer !== undefined
  if (options.testPoints) {
    if (split) {
      detail.push(fieldDetail('scoring.pointsMainLabel', actual.payments.main, answer.pointsMain))
      detail.push(
        fieldDetail(
          'scoring.pointsFromDealerLabel',
          actual.payments.fromDealer!,
          answer.pointsFromDealer,
        ),
      )
    } else {
      detail.push(
        fieldDetail(
          tsumo ? 'scoring.pointsMainLabel' : 'scoring.pointsLabel',
          actual.payments.main,
          answer.points,
        ),
      )
    }
  }

  detail.push(...scoreDetail(actual))

  return detail
}

/** The ungraded half of the breakdown above — the limit name, the yaku (or yakuman) with their
 *  bonus han, and the fu itemization ending in the rounding. Pure `ScoreResult` → `LogDetail[]`,
 *  so anything holding a scored hand can draw it: `scoringDetail` puts the graded fields in front
 *  of it, and `/match`'s round-end report (`WinReport`) draws it straight off `WinRecord.score`
 *  with no grading to lead with. Split out rather than duplicated so the two can never disagree
 *  about what a hand is made of. */
export function scoreDetail(actual: ScoreResult): LogDetail[] {
  const detail: LogDetail[] = []
  if (actual.limit) detail.push({ key: 'log.scoring.limit', params: { limit: actual.limit } })

  if (actual.yakuman.length > 0) {
    for (const name of actual.yakuman) {
      detail.push({
        key: 'log.scoring.detailLine',
        params: { group: 'yakuman', name, valueKey: 'scoring.yakumanLabel' },
      })
    }
  } else {
    const han: LogDetail[] = actual.yaku.map((y) => ({
      key: 'log.scoring.detailLine',
      params: { group: 'yaku', name: y.name, valueKey: 'scoring.hanCount', count: y.han },
    }))
    const bonusHan = [
      { labelKey: 'scoring.doraLabel', count: actual.dora.dora },
      { labelKey: 'scoring.akaLabel', count: actual.dora.aka },
      { labelKey: 'scoring.uraLabel', count: actual.dora.ura },
      { labelKey: 'scoring.kitaLabel', count: actual.dora.kita },
    ]
    for (const b of bonusHan) {
      if (b.count > 0) {
        han.push({
          key: 'log.scoring.detailLine',
          params: { labelKey: b.labelKey, valueKey: 'scoring.hanCount', count: b.count },
        })
      }
    }
    // the header is a claim that a list follows, so it is only written when one does
    if (han.length > 0) detail.push({ key: 'log.detail.yaku', header: true })
    detail.push(...han)
  }

  // a limit hand's fu are never itemized (and never quizzed), so the section skips itself
  if (actual.fuItems.length > 0) {
    detail.push({ key: 'log.detail.fu', header: true })
    for (const item of actual.fuItems) {
      detail.push({
        key: 'log.scoring.detailLine',
        params: {
          labelKey: `scoring.fu.${item.reason}`,
          valueKey: 'scoring.fuCount',
          count: item.fu,
        },
        tiles: item.tile !== undefined ? [{ id: item.tile, red: false }] : undefined,
      })
    }
    // the rounding, stated rather than left to the reader — one line when there is none to do
    detail.push(
      actual.fuExact === actual.fu
        ? { key: 'log.detail.fuTotalExact', params: { fu: actual.fu } }
        : { key: 'log.detail.fuTotal', params: { exact: actual.fuExact, fu: actual.fu } },
    )
  }

  return detail
}

/** Deals a fresh random wall (ADR-0005: generation via random walls, not seed suffixes) and plays it
 *  out, until `accept` takes one — `findRoundAsync`'s shape (capped attempts, yielding between
 *  them), but each attempt is an independently random wall rather than a seed suffix, since walls
 *  are no longer named by a seed. */
async function findWall(
  players: number,
  options: ScoringOptions,
  accept: (outcome: RoundOutcome) => WinRecord | null,
  maxAttempts = MAX_ATTEMPTS,
): Promise<{ win: WinRecord; wall: ParsedTile[]; round: RoundState } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const wall = completeWall([], options.sanma, options.aka)
    const outcome = playWall(wall, players, roundOptions(wall, options))
    const win = accept(outcome)
    if (win) return { win, wall, round: outcome.state }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return null
}

/** Drives one hand of the scoring trainer: deal a round, answer, check, repeat. Unlike the
 *  shanten trainer's auto-advancing stream, `check` deliberately stops and waits for `next` —
 *  the feedback here (yaku list, fu breakdown) needs to be read, not just glanced at. */
export function useScoringRound(urlData: ScoringUrl, options: ScoringOptions) {
  const { handIndex, fromLink, next } = useLinkedHand(urlData)
  const stats = useSessionStats()
  const [state, setState] = useState<State | null>(null)
  const log = useLog((s) => s.log)
  // a resolution that arrives after the seed moved on belongs to a hand nobody is looking at
  const request = useRef(0)
  // the wall/round/invalidLink a pending win came from — stashed immediately before invoking
  // `onAgariCall` below, whose signature carries only the WinRecord itself
  const pending = useRef<{ wall: ParsedTile[]; round: RoundState | null; invalidLink: boolean }>({
    wall: [],
    round: null,
    invalidLink: false,
  })
  // the (urlData, handIndex) pair whose deal is already on the log — a plain `request.current`
  // check only catches a *stale* async resolution (see below), not the synchronous branches,
  // which both StrictMode invocations of this effect reach trivially; keying on the pair that
  // actually names "this hand" (handIndex resets to 0 whenever urlData changes, above) is what
  // survives the double-invoke the same way `loggedReplay` does elsewhere
  const loggedDeal = useRef<{ urlData: ScoringUrl; handIndex: number } | undefined>(undefined)

  function logDealt(query: string) {
    if (loggedDeal.current?.urlData === urlData && loggedDeal.current?.handIndex === handIndex) {
      return
    }
    loggedDeal.current = { urlData, handIndex }
    log({ key: 'log.dealt', situation: query })
  }

  function fallbackHand(seed: string, invalidLink: boolean): State {
    // `GenOptions` keeps `openHands`/`honba` as engine knobs (their own tests exercise both off);
    // the trainer just pins them on now that neither is a setting any more
    const situation = generateHand(seed, { ...options, openHands: true, honba: true })
    return {
      situation,
      round: null,
      seat: situation.ctx.seat - HONOR,
      roundWall: null,
      // generateHand only ever returns a scoreable situation, so this is non-null
      actual: scoreSituation(situation, options)!,
      checked: false,
      lastResult: null,
      loading: false,
      invalidLink,
    }
  }

  // scoring never re-touches its round after generation (ADR-0012): it plays a wall out with
  // `playWall`, keeps the win, and never steps that round again — so it is the one board-rendering
  // trainer that does not drive `useRound` at all, and `<Table>` here is purely presentational.
  // This is its single entry point; nothing else in this hook reads `outcome.state.win` directly.
  const onAgariCall = (win: WinRecord) => {
    const { wall, round, invalidLink } = pending.current
    const situation = situationFromWin(win, wall)
    setState((prev) => ({
      situation,
      round,
      seat: win.seat,
      roundWall: wall,
      actual: scoreSituation(situation, options)!,
      checked: false,
      lastResult: prev?.lastResult ?? null,
      loading: false,
      invalidLink,
    }))
    logDealt(encodeScoringWallUrl(wall, options))
  }

  useEffect(() => {
    const id = ++request.current
    // a link (or a rewind) names one exact hand, not every hand from here on — honoured only while
    // `fromLink` (`useLinkedHand`), or `next()` would re-deal the same pinned hand forever
    const pinned = fromLink ? urlData.situation : null
    const pinnedScore = pinned ? scoreSituation(pinned, options) : null
    if (pinned && pinnedScore) {
      stats.startClock()
      setState((prev) => ({
        situation: pinned,
        round: null,
        seat: pinned.ctx.seat - HONOR,
        roundWall: null,
        actual: pinnedScore,
        checked: false,
        lastResult: prev?.lastResult ?? null,
        loading: false,
        invalidLink: false,
      }))
      logDealt(encodeScoringUrl(pinned, options.sanma))
      return
    }

    const players = options.sanma ? 3 : 4
    const fallbackSeed = `${stats.randomSeed}:${handIndex}`

    if (fromLink && urlData.wall.length > 0) {
      const outcome = playWall(urlData.wall, players, roundOptions(urlData.wall, options))
      if (outcome.state.win) {
        stats.startClock()
        pending.current = { wall: urlData.wall, round: outcome.state, invalidLink: pinned !== null }
        onAgariCall(outcome.state.win)
        return
      }
      // this specific wall has no legal win: fall through to the random search below, exactly as
      // a pinned situation with no legal score does today
    }

    setState((prev) => (prev ? { ...prev, loading: true } : prev))
    void findWall(players, options, (outcome) => outcome.state.win ?? null).then((found) => {
      if (id !== request.current) return
      stats.startClock()
      if (!found) {
        // no attempt in the budget produced a legal win: fall back to a constructed hand, which
        // is also the only way rare shapes (kokushi, yakuman) ever come up
        const fallback = fallbackHand(fallbackSeed, false)
        setState((prev) => ({ ...fallback, lastResult: prev?.lastResult ?? null }))
        logDealt(encodeScoringUrl(fallback.situation, options.sanma))
        return
      }
      pending.current = {
        wall: found.wall,
        round: found.round,
        invalidLink: fromLink && (urlData.wall.length > 0 || pinned !== null),
      }
      onAgariCall(found.win)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlData, handIndex, options.sanma, options.aka, options.kiriageMangan])

  /** Current hand as a shareable query string. A round reproduces from its wall, rivers and all,
   *  so that is the better link; a pinned or constructed hand has no round behind it and ships
   *  its tiles instead. */
  function situationQuery(): string {
    return state?.roundWall
      ? encodeScoringWallUrl(state.roundWall, options)
      : state
        ? encodeScoringUrl(state.situation, options.sanma)
        : ''
  }

  function check(answer: Answer) {
    if (!state || state.checked) return
    const { actual } = state
    // captured before the state update below moves the round on to "checked"
    const situationBefore = situationQuery()

    const correctHan = !options.testHan || answer.han === actual.han
    const skipFu = options.ignoreFuOnLimit && actual.han >= 5
    const expectedFu = options.exactFu ? actual.fuExact : actual.fu
    const correctFu = !options.testFu || skipFu || answer.fu === expectedFu

    const split = actual.payments.fromDealer !== undefined
    const correctPoints =
      !options.testPoints ||
      (split
        ? answer.pointsMain === actual.payments.main &&
          answer.pointsFromDealer === actual.payments.fromDealer
        : answer.points === actual.payments.main)

    const correct = correctHan && correctFu && correctPoints
    const elapsed = stats.elapsedNow()

    // logged here (not from a page effect) so entries stay in play order; raw fields go
    // through as params rather than formatted text, so a later language switch re-translates
    log({
      key: 'log.scoring.result',
      params: {
        hand: stats.totalCount + 1,
        correct,
        han: actual.han,
        elapsedMs: elapsed,
      },
      tiles: state.situation.concealed,
      copyText: serializeTenhou(state.situation.concealed),
      severity: correct ? 'ok' : 'error',
      situation: situationBefore,
      detail: scoringDetail(actual, answer, options, state.situation.ctx.tsumo),
    })
    stats.record(correct, elapsed)

    const result: RoundResult = {
      answer,
      actual,
      correctHan,
      correctFu,
      correctPoints,
      correct,
      situation: state.situation,
    }
    setState((s) => (s ? { ...s, checked: true, lastResult: result } : s))
  }

  return {
    // undefined only while the search is running; the page shows a dealing state instead
    situation: state?.situation,
    actual: state?.actual,
    round: state?.round ?? null,
    seat: state?.seat ?? 0,
    elapsedNow: stats.elapsedNow,
    /** Whether the clock is ticking: a board is up, unanswered and unpaused. */
    running: !!state && !state.checked && !state.loading && !stats.paused,
    checked: state?.checked ?? false,
    lastResult: state?.lastResult ?? null,
    invalidLink: state?.invalidLink ?? false,
    loading: state === null || state.loading,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    averageTime: stats.averageTime,
    paused: stats.paused,
    togglePause: () => (stats.paused ? stats.resume() : stats.pause()),
    check,
    next,
    situationQuery,
  }
}
