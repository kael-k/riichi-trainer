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
}

interface LogState {
  entries: LogEntry[]
  log: (
    key: string,
    params?: Record<string, unknown>,
    tiles?: ParsedTile[],
    copyText?: string,
  ) => void
  clear: () => void
}

let nextId = 1

/** Per-session action log shown in the trainer log panel. Not persisted. */
export const useLog = create<LogState>((set) => ({
  entries: [],
  log: (key, params, tiles, copyText) =>
    set((s) => ({ entries: [...s.entries, { id: nextId++, key, params, tiles, copyText }] })),
  clear: () => set({ entries: [] }),
}))
