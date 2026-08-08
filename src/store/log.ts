import { create } from 'zustand'
import type { ParsedTile } from '../core/tiles'

export interface LogEntry {
  id: number
  /** i18next key; translated at render time so a language switch re-renders correctly. */
  key: string
  params?: Record<string, unknown>
  /** Tiles rendered inline after the text, e.g. the discard being described. */
  tiles?: ParsedTile[]
  /** When set, the log row gets a copy button that copies this text (e.g. tenhou notation). */
  copyText?: string
  /** Situation query string for the drill as it stood *before* the logged action — when set,
   *  the log row gets a rewind button that restores it and a share button for the same link.
   *  Every trainer passes one; the shanten stream pins its hand by tiles rather than by a
   *  decision point, since there is no board to rewind. */
  situation?: string
}

interface LogState {
  entries: LogEntry[]
  log: (
    key: string,
    params?: Record<string, unknown>,
    tiles?: ParsedTile[],
    copyText?: string,
    situation?: string,
  ) => void
  clear: () => void
}

let nextId = 1

/** Per-session action log shown in the trainer log panel. Not persisted. */
export const useLog = create<LogState>((set) => ({
  entries: [],
  log: (key, params, tiles, copyText, situation) =>
    set((s) => ({
      entries: [...s.entries, { id: nextId++, key, params, tiles, copyText, situation }],
    })),
  clear: () => set({ entries: [] }),
}))
