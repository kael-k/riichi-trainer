import { create } from 'zustand'
import type { ParsedTile } from '../core/tiles'
import type { UkeireTile } from '../core/ukeire'

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
}

export interface LogEntry {
  id: number
  /** i18next key; translated at render time so a language switch re-renders correctly. */
  key: string
  params?: Record<string, unknown>
  /** Tiles rendered inline after the text, e.g. the discard being described. */
  tiles?: ParsedTile[]
  /** Index in `tiles` where the *better* tile the entry names begins — the row draws a hairline
   *  seam there, so your own choice and the one that beat it read as the two halves of a diff.
   *  Absent means the row's tiles are all one thing. Set by whoever built `tiles`, since only it
   *  knows which end is which. */
  seam?: number
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
