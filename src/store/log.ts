import { create } from 'zustand'
import type { ParsedTile } from '../core/tiles'

export interface LogEntry {
  id: number
  text: string
  /** Tiles rendered inline after the text, e.g. the discard being described. */
  tiles?: ParsedTile[]
}

interface LogState {
  entries: LogEntry[]
  log: (text: string, tiles?: ParsedTile[]) => void
  clear: () => void
}

let nextId = 1

/** Per-session action log shown in the trainer log panel. Not persisted. */
export const useLog = create<LogState>((set) => ({
  entries: [],
  log: (text, tiles) => set((s) => ({ entries: [...s.entries, { id: nextId++, text, tiles }] })),
  clear: () => set({ entries: [] }),
}))
