import { create } from 'zustand'
import type { TileId, ParsedTile } from '../core/tiles'
import type { UkeireTile } from '../core/ukeire'

/** One tile's EV score, drawn as a bar normalized on the ranking's own best entry (`fraction`) —
 *  never on an absolute scale, since a fold's expected value is negative and "percent of best"
 *  would be meaningless. `value` is the raw expected points, rounded where the row is written, for
 *  the number printed beside the bar. Values, never text: the language switch has to re-render
 *  them, same reason `LogDetail.ukeire` is numbers rather than a formatted string. */
export interface LogBar {
  tile: TileId
  value: number
  /** 0-1, `(ev - worst) / (best - worst)` — a full bar is the best discard, an empty one the
   *  worst. */
  fraction: number
  /** The tile the reader actually threw. */
  chosen?: boolean
  /** The ranking's own top entry. */
  best?: boolean
}

export type LogSeverity = 'ok' | 'warning' | 'error'

/** One indented line under an expanded row — what the deleted feedback panels drew. Stored as an
 *  i18n key plus params, never as text, for the same reason the entry itself is: a language switch
 *  must re-translate it (see `formatLogEntry`). */
export interface LogDetail {
  key: string
  params?: Record<string, unknown>
  tiles?: ParsedTile[]
  /** Rendered through the existing `UkeireTiles` (per-tile remaining counts). */
  ukeire?: UkeireTile[]
  /** Per-discard EV scores, drawn as bars normalized on the best one — the folding trainer's EV
   *  grading mode (alpha). */
  bars?: LogBar[]
  /** Index in `tiles` where the *evidence* for the line begins — the subject tile leads, what
   *  explains it follows past a hairline seam; absent means the line's tiles are all one
   *  thing. */
  seam?: number
  /** Draws the line as a muted section header ("Yaku", "Fu") rather than a detail line. Headers
   *  carry no tiles — they are the grouping, not a fact about the hand. */
  header?: boolean
  /** Text tone. `'error'` is the wrong-answer colour, matching the verdict palette; absent is the
   *  neutral one every other line draws in. */
  tone?: 'error'
}

export interface LogEntry {
  id: number
  /** i18next key; translated at render time so a language switch re-renders correctly. */
  key: string
  params?: Record<string, unknown>
  /** Tiles drawn in a strip above the row, for **what the sentence cannot name**: the waits
   *  behind "waiting on", the hand a shanten guess was made against, the rinshan tile a kan
   *  drew. A tile the sentence already names is drawn by the sentence itself (`splitTileCodes`),
   *  so putting it here as well draws it twice, one line apart. */
  tiles?: ParsedTile[]
  /** When set, the log row gets a copy button that copies this text (e.g. tenhou notation). */
  copyText?: string
  /** Situation query string for the drill as it stood *before* the logged action — when set,
   *  the log row gets a rewind button that restores it and a share button for the same link.
   *  Every trainer passes one; the shanten stream pins its hand by tiles rather than by a
   *  decision point, since there is no board to rewind. */
  situation?: string
  /** Colours the row's verdict spine. Absent (or `'ok'`) draws no colour at all — only mistakes
   *  are marked, since the log's job is review and the floating verdict already said "well done"
   *  at the time. */
  severity?: LogSeverity
  /** What the deleted feedback panels drew, collapsed behind the row's own chevron. */
  detail?: LogDetail[]
}

interface LogState {
  entries: LogEntry[]
  log: (entry: Omit<LogEntry, 'id'>) => void
  clear: () => void
}

let nextId = 1

/** Per-session action log shown in the trainer log panel. Not persisted. */
export const useLog = create<LogState>((set) => ({
  entries: [],
  log: (entry) => set((s) => ({ entries: [...s.entries, { id: nextId++, ...entry }] })),
  clear: () => set({ entries: [] }),
}))
