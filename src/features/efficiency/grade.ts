import { evaluateKan, isBestDiscard, type DiscardOption } from '../../core/efficiency'
import type { DiscardEv } from '../../core/ev'
import type { EvModelName } from '../../core/evModel'
import { addTile, createHand, type Hand } from '../../core/hand'
import { NORTH } from '../../core/round'
import type { TableAnalysis } from '../../core/table'
import { tileCode, type ParsedTile, type TileId } from '../../core/tiles'
import type { LogDetail, LogEntry } from '../../store/log'
import { evBandDetail, gradeEv, type EvBands } from '../table/evGrade'
import type { VerdictSeverity } from '../table/Verdict'

/**
 * Pure grading shared by both efficiency apps (table and solitaire) — no React, no zustand, no
 * `log()` call. Each app's own thin hook calls `gradeAction` at discard/kita/kan time and
 * `efficiencyLogRows` to turn the result into the log rows both apps already write, so a mistake
 * grades identically whether it happened at a full table or alone.
 */

export interface TurnResult {
  turn: number
  yours: DiscardOption
  best: DiscardOption
  /** 'kita' / 'kan' when this grades a nukidora pull or an ankan rather than a discard; it only
   *  changes the DiscardFeedback labels, since both reuse the `DiscardOption` shape. */
  kind: 'discard' | 'kita' | 'kan'
  /** 'error' when the chosen action itself loses shanten/ukeire vs. the true best.
   *  'warning' only applies to a plain discard that ties the best line while passing up a
   *  same-value kan/kita call — no ukeire is lost, so it's a softer nudge than 'error'. */
  grade: 'ok' | 'warning' | 'error'
  /** Set alongside a 'warning' grade: which call was available for free and skipped. */
  missed?: { kind: 'kan' | 'kita'; tile: TileId }
  /** Set only when this turn was graded on the EV model's push branch instead of ukeire — the
   *  table app's own Advanced setting, alpha.
   *  `grade` above already reflects it (`applyEvGrade` collapses to a plain ok/error: the
   *  ukeire-specific 'warning' — a missed free kan/kita — is a different question EV does not
   *  answer, so `missed` still rides on the ukeire pass underneath, unaffected by this). */
  ev?: {
    model: EvModelName
    bands: EvBands
    ranking: DiscardEv[]
    delta: number
    quality: number
  }
}

/**
 * Overrides a ukeire-graded `TurnResult`'s verdict with the EV model's push branch — never a
 * second grading pass over different data, so `yours`/`best`/`missed` (and the ukeire numbers the
 * log sentence already names) stay exactly what `gradeAction` computed. Only `kind === 'discard'`
 * is covered: kita/kan are themselves the call being evaluated, and pricing those through the
 * identity is `core/ev.ts#kitaWorthIt`/`bestKan`'s job, not this trainer's — a stated ceiling, not
 * an oversight.
 *
 * Collapses to a binary `grade` (`'ok'`/`'error'`) rather than reusing `'warning'` for a
 * near-miss: `'warning'` already means one specific thing here (a discard that tied ukeire's best
 * while passing up a free kan/kita), and reusing it for "close in EV but not quite" would conflate
 * two different questions. The finer partial credit still exists — `ev.quality` — for whatever
 * reads it (the session average, in place of the ukeire-based one).
 */
export function applyEvGrade(
  result: TurnResult,
  ranking: DiscardEv[],
  model: EvModelName,
  bands: EvBands,
): TurnResult {
  const graded = gradeEv(ranking, result.yours.discard, bands)
  return {
    ...result,
    grade: graded.correct ? 'ok' : 'error',
    ev: { model, bands, ranking, delta: graded.delta, quality: graded.quality },
  }
}

/** The compact mobile verdict's severity — a coarser read of the same `grade`/shanten gap, no
 *  new grading concept. `grade === 'ok'` is green regardless of kind; red is reserved for an
 *  actual shanten regression, so a same-shanten ukeire loss (or the softer 'warning' grade) reads
 *  as yellow instead of red.
 *
 *  Under EV grading, `applyEvGrade` already collapsed `grade` to a binary ok/error, so the shanten
 *  check above would band every EV mistake as an "actual regression" (a same-shanten shape choice
 *  most often is not) or every non-regression as the soft yellow (however far off best it ran).
 *  `ev.quality` is the finer signal `gradeEv` already computed for exactly this, so it takes over
 *  the red/yellow split — the same banding folding's own `foldingVerdictSeverity` uses. */
export function efficiencyVerdictSeverity(result: TurnResult): VerdictSeverity {
  if (result.grade === 'ok') return 'ok'
  if (result.ev) return result.ev.quality < 0.5 ? 'error' : 'warning'
  return result.yours.shanten > result.best.shanten ? 'error' : 'warning'
}

/** The i18n key for each severity's compact verdict text. */
export const EFFICIENCY_VERDICT_TEXT_KEY: Record<VerdictSeverity, string> = {
  ok: 'discardFeedback.verdictOk',
  warning: 'discardFeedback.verdictWarning',
  error: 'discardFeedback.verdictError',
}

/** Ukeire given up by playing `yours` instead of `best`. Counts only compare directly at the
 *  same shanten (options are sorted shanten-first), so a worse shanten forfeits the whole gap. */
export function lostVs(yours: DiscardOption, best: DiscardOption): number {
  return yours.shanten > best.shanten ? best.ukeireCount : best.ukeireCount - yours.ukeireCount
}

/** Rebuilds a working `Hand` from a table snapshot's concealed tiles, its separated drawn tile,
 *  and its fixed meld count — what `gradeAction`'s same-value-kan check needs, since a snapshot
 *  only mirrors tiles for display, never the `Hand` object itself. */
export function handFromSnapshot(
  hand: ParsedTile[],
  drawn: ParsedTile | undefined,
  melds: number,
): Hand {
  const h = createHand()
  for (const t of hand) addTile(h, t.id)
  if (drawn) addTile(h, drawn.id)
  h.melds = melds
  return h
}

/** What an efficiency drill needs to know about one action to grade it: the ranking as it stood
 *  before the tile left the hand, plus that action's own entry in it and the best available. Both
 *  efficiency routes build this from a `discard`/`kita`/`ankan` event's `analysis` (`useRound`) —
 *  it is this trainer's grading vocabulary, not something the match layer knows about. */
export interface ActionStats {
  kind: TurnResult['kind']
  analysis: TableAnalysis
  yours: DiscardOption
  best: DiscardOption
}

/** Locates `tile`'s own entry in the pre-action ranking. A kita is priced by north's own
 *  `evaluateDiscards` entry ("what pulling it costs") and a kan by `evaluateKan`, both against the
 *  same `ranked[0]` a plain discard is compared to — `ranked[0]` is already the global optimum, so
 *  no special tie-break is needed. */
export function actionStats(
  analysis: TableAnalysis,
  kind: TurnResult['kind'],
  tile: TileId,
  sanma: boolean,
): ActionStats {
  const yours =
    kind === 'kita'
      ? analysis.ranked.find((o) => o.discard === NORTH)!
      : kind === 'kan'
        ? evaluateKan(analysis.hand, analysis.seen, sanma).find((o) => o.discard === tile)!
        : analysis.ranked.find((o) => o.discard === tile)!
  return { kind, analysis, yours, best: analysis.ranked[0] }
}

/** Grades one discard/kita/kan against the pre-action ranking. */
export function gradeAction(stats: ActionStats, turn: number, sanma: boolean): TurnResult {
  const { kind, yours, best, analysis } = stats
  const isBest = isBestDiscard(yours, best)

  // isBest doesn't mean nothing was left on the table: a kan/kita tied for best too, and was
  // passed up for a plain discard — no ukeire lost, so it's a warning, not an error. Only a
  // plain discard can pass up a call this way: kita/kan are themselves the call.
  let missed: TurnResult['missed']
  if (kind === 'discard' && isBest) {
    const northOption = sanma ? analysis.ranked.find((o) => o.discard === NORTH) : undefined
    if (northOption && isBestDiscard(northOption, best)) {
      missed = { kind: 'kita', tile: NORTH }
    } else {
      const kanOption = evaluateKan(analysis.hand, analysis.seen, sanma).find((o) =>
        isBestDiscard(o, best),
      )
      if (kanOption) missed = { kind: 'kan', tile: kanOption.discard }
    }
  }

  const grade: TurnResult['grade'] = !isBest ? 'error' : missed ? 'warning' : 'ok'
  return { turn, yours, best, kind, grade, missed }
}

type LogRow = Omit<LogEntry, 'id' | 'situation'>

/** The detail lines a graded main row expands to — your own line always, the best line too once
 *  the choice was an actual mistake (a tie's "best" carries no ukeire list in `DiscardFeedback`
 *  either, since there's nothing lost to show). Generic "your discard"/"best discard" labels
 *  regardless of kind: the row's own text already says "Kita"/kanned, and the tiles say the rest.
 *
 *  Each label carries its own total, so the list below it has a size before the reader counts it,
 *  and the block closes on one legend saying what the number under each tile is — a footnote line
 *  rather than a `title`, since a hover is not available to the phone this trainer is built for. */
export function discardDetail(result: TurnResult): LogDetail[] {
  const { yours, best, grade, ev } = result
  const detail: LogDetail[] = []
  // EV decides the verdict in this mode, and the band it graded against is shown;
  // the ukeire lines below still carry the vocabulary the trainer otherwise teaches, unconditionally
  if (ev)
    detail.push(evBandDetail(ev.ranking, ev.model, ev.bands, yours.discard), {
      key: 'log.detail.evLegend',
    })
  detail.push({
    key: 'log.efficiency.yourDiscardTotal',
    params: { count: yours.ukeireCount },
    ukeire: yours.ukeireTiles,
  })
  if (grade === 'error') {
    detail.push({
      key: 'log.efficiency.bestDiscardTotal',
      params: { count: best.ukeireCount },
      tiles: [{ id: best.discard, red: false }],
      ukeire: best.ukeireTiles,
    })
  }
  if (detail.some((line) => line.ukeire && line.ukeire.length > 0)) {
    detail.push({ key: 'log.detail.ukeireLegend' })
  }
  return detail
}

/** Turns a graded `TurnResult` into the log rows both efficiency apps write — same i18n keys,
 *  same param shape and same tile order today's hook already produces. `drawn` is the tile drawn
 *  this turn for a plain discard, or the kita/kan's own replacement (rinshan) draw — callers of
 *  `gradeAction` for kita/kan grade before that replacement is known, so they call this once it
 *  is (see each app's `onUserDraw`).
 *
 *  Only the rows whose sentence cannot name its own tiles carry `tiles`: the tenpai row's waits,
 *  and the kita/kan pair, where the strip is the only place the rinshan replacement is drawn. A
 *  discard's own sentence draws every tile it names (`splitTileCodes`), so a strip above it would
 *  be the same two or three tiles a second time, one line apart. */
export function efficiencyLogRows(
  result: TurnResult,
  drawn: ParsedTile | undefined,
  tile: ParsedTile,
): LogRow[] {
  const { turn, yours, best, kind, grade, missed } = result
  const rows: LogRow[] = []
  const severity = efficiencyVerdictSeverity(result)
  const detail = discardDetail(result)

  if (kind === 'discard') {
    const drawnCode = drawn ? tileCode(drawn.id, drawn.red) : undefined
    if (grade !== 'error') {
      rows.push({
        key: drawnCode ? 'log.efficiency.discardBestDrew' : 'log.efficiency.discardBest',
        params: {
          turn,
          drawn: drawnCode,
          tile: tileCode(tile.id, tile.red),
          ukeire: yours.ukeireCount,
          shanten: yours.shanten,
        },
        severity,
        detail,
      })
    } else {
      rows.push({
        key: drawnCode ? 'log.efficiency.discardMistakeDrew' : 'log.efficiency.discardMistake',
        params: {
          turn,
          drawn: drawnCode,
          tile: tileCode(tile.id, tile.red),
          yours: yours.ukeireCount,
          best: tileCode(best.discard),
          bestUkeire: best.ukeireCount,
          shanten: yours.shanten,
        },
        severity,
        detail,
      })
    }
    if (missed) {
      rows.push({
        key: missed.kind === 'kita' ? 'log.efficiency.missedKita' : 'log.efficiency.missedKan',
        params: { turn, tile: tileCode(missed.tile) },
        severity: 'warning',
      })
    }
    if (yours.shanten <= 0) {
      rows.push({
        key: 'log.efficiency.tenpai',
        params: { turn },
        tiles: yours.ukeireTiles.map((t) => ({ id: t.tile, red: false })),
      })
    }
    return rows
  }

  // kita/kan: the pulled/kanned tile first, then its replacement draw (matches today's tiles order)
  const tiles = drawn ? [tile, drawn] : [tile]
  if (kind === 'kita') {
    rows.push(
      grade === 'ok'
        ? {
            key: 'log.efficiency.kitaBest',
            params: { turn, ukeire: yours.ukeireCount, shanten: yours.shanten },
            tiles,
            severity,
            detail,
          }
        : {
            key: 'log.efficiency.kitaMistake',
            params: {
              turn,
              yours: yours.ukeireCount,
              best: tileCode(best.discard),
              bestUkeire: best.ukeireCount,
              shanten: yours.shanten,
            },
            tiles,
            severity,
            detail,
          },
    )
  } else {
    rows.push(
      grade === 'ok'
        ? {
            key: 'log.efficiency.kanBest',
            params: {
              turn,
              tile: tileCode(tile.id),
              ukeire: yours.ukeireCount,
              shanten: yours.shanten,
            },
            tiles,
            severity,
            detail,
          }
        : {
            key: 'log.efficiency.kanMistake',
            params: {
              turn,
              tile: tileCode(tile.id),
              yours: yours.ukeireCount,
              best: tileCode(best.discard),
              bestUkeire: best.ukeireCount,
              shanten: yours.shanten,
            },
            tiles,
            severity,
            detail,
          },
    )
  }
  return rows
}
