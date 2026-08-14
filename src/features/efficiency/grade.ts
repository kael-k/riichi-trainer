import { evaluateKan, isBestDiscard, type DiscardOption } from '../../core/efficiency'
import { addTile, createHand, type Hand } from '../../core/hand'
import { NORTH } from '../../core/match'
import { tileCode, type ParsedTile, type TileId } from '../../core/tiles'
import type { VerdictSeverity } from '../table/Verdict'
import type { DiscardStats } from '../table/useTableRound'

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
}

/** The compact mobile verdict's severity — a coarser read of the same `grade`/shanten gap, no
 *  new grading concept. `grade === 'ok'` is green regardless of kind; red is reserved for an
 *  actual shanten regression, so a same-shanten ukeire loss (or the softer 'warning' grade) reads
 *  as yellow instead of red. */
export function efficiencyVerdictSeverity(result: TurnResult): VerdictSeverity {
  if (result.grade === 'ok') return 'ok'
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

/** Grades one discard/kita/kan against the draw-time `DiscardStats` a `useTableRound` consumer
 *  is handed by `onUserDiscard` — `hand` is the pre-throw 14-tile hand (see `handFromSnapshot`),
 *  needed only to look for a same-value kan a plain discard passed up. */
export function gradeAction(
  stats: DiscardStats,
  turn: number,
  hand: Hand,
  sanma: boolean,
): TurnResult {
  const { kind, yours, best } = stats
  const isBest = isBestDiscard(yours, best)

  // isBest doesn't mean nothing was left on the table: a kan/kita tied for best too, and was
  // passed up for a plain discard — no ukeire lost, so it's a warning, not an error. Only a
  // plain discard can pass up a call this way: kita/kan are themselves the call.
  let missed: TurnResult['missed']
  if (kind === 'discard' && isBest) {
    const northOption = sanma ? stats.analysis.ranked.find((o) => o.discard === NORTH) : undefined
    if (northOption && isBestDiscard(northOption, best)) {
      missed = { kind: 'kita', tile: NORTH }
    } else {
      const kanOption = evaluateKan(hand, stats.analysis.seen, sanma).find((o) =>
        isBestDiscard(o, best),
      )
      if (kanOption) missed = { kind: 'kan', tile: kanOption.discard }
    }
  }

  const grade: TurnResult['grade'] = !isBest ? 'error' : missed ? 'warning' : 'ok'
  return { turn, yours, best, kind, grade, missed }
}

/** Turns a graded `TurnResult` into the log rows both efficiency apps write — same i18n keys,
 *  same param shape and same tile order today's hook already produces. `drawn` is the tile drawn
 *  this turn for a plain discard, or the kita/kan's own replacement (rinshan) draw — callers of
 *  `gradeAction` for kita/kan grade before that replacement is known, so they call this once it
 *  is (see each app's `onUserDraw`). */
export function efficiencyLogRows(
  result: TurnResult,
  drawn: ParsedTile | undefined,
  tile: ParsedTile,
): [string, Record<string, unknown>, ParsedTile[]][] {
  const { turn, yours, best, kind, grade, missed } = result
  const rows: [string, Record<string, unknown>, ParsedTile[]][] = []

  if (kind === 'discard') {
    const drawnCode = drawn ? tileCode(drawn.id, drawn.red) : undefined
    const drawnTiles = drawn ? [drawn] : []
    if (grade !== 'error') {
      rows.push([
        drawnCode ? 'log.efficiency.discardBestDrew' : 'log.efficiency.discardBest',
        {
          turn,
          drawn: drawnCode,
          tile: tileCode(tile.id, tile.red),
          ukeire: yours.ukeireCount,
          shanten: yours.shanten,
        },
        [...drawnTiles, tile],
      ])
    } else {
      rows.push([
        drawnCode ? 'log.efficiency.discardMistakeDrew' : 'log.efficiency.discardMistake',
        {
          turn,
          drawn: drawnCode,
          tile: tileCode(tile.id, tile.red),
          yours: yours.ukeireCount,
          best: tileCode(best.discard),
          bestUkeire: best.ukeireCount,
          shanten: yours.shanten,
        },
        [...drawnTiles, tile, { id: best.discard, red: false }],
      ])
    }
    if (missed) {
      rows.push([
        missed.kind === 'kita' ? 'log.efficiency.missedKita' : 'log.efficiency.missedKan',
        { turn, tile: tileCode(missed.tile) },
        [{ id: missed.tile, red: false }],
      ])
    }
    if (yours.shanten <= 0) {
      rows.push([
        'log.efficiency.tenpai',
        { turn },
        yours.ukeireTiles.map((t) => ({ id: t.tile, red: false })),
      ])
    }
    return rows
  }

  // kita/kan: the pulled/kanned tile first, then its replacement draw (matches today's tiles order)
  const tiles = drawn ? [tile, drawn] : [tile]
  if (kind === 'kita') {
    rows.push(
      grade === 'ok'
        ? [
            'log.efficiency.kitaBest',
            { turn, ukeire: yours.ukeireCount, shanten: yours.shanten },
            tiles,
          ]
        : [
            'log.efficiency.kitaMistake',
            {
              turn,
              yours: yours.ukeireCount,
              best: tileCode(best.discard),
              bestUkeire: best.ukeireCount,
              shanten: yours.shanten,
            },
            tiles,
          ],
    )
  } else {
    rows.push(
      grade === 'ok'
        ? [
            'log.efficiency.kanBest',
            { turn, tile: tileCode(tile.id), ukeire: yours.ukeireCount, shanten: yours.shanten },
            tiles,
          ]
        : [
            'log.efficiency.kanMistake',
            {
              turn,
              tile: tileCode(tile.id),
              yours: yours.ukeireCount,
              best: tileCode(best.discard),
              bestUkeire: best.ukeireCount,
              shanten: yours.shanten,
            },
            tiles,
          ],
    )
  }
  return rows
}
