import { useSettings } from './settingsStore'

/** The six settings every board-rendering trainer shares. One schema instead of each app
 *  growing its own copy of the same six questions (REQ-04, D-13). */
export interface TableSettings {
  /** Let the threats ron and tsumo. Off makes the drill a rehearsal — the same ranking and the
   *  same grading, but the hand plays to the wall instead of ending on a deal-in. On by
   *  default: a fold you can't lose teaches the tiles but not the stakes. */
  opponentWins: boolean
  /** Reserve a dead wall and show its dora indicator. */
  deadWall: boolean
  /** Seats that must already be in riichi when the drill starts. Capped at one fewer than the
   *  player count; generation falls back to fewer rather than failing when a seed search cannot
   *  find that many. */
  threats: number
  /** Reveal every opponent's (and, in the folding trainer, every threat's) concealed hand on the
   *  shared table, as real tile faces. Off by default: it turns a "read the board" drill into
   *  "read the answer key" — useful for demos and debugging, not for the drill itself. A global,
   *  non-advanced setting: unlike the advanced-gated rows, opponents' hands being *present* (see
   *  `hideConcealedHands`) is basic table reading, not a jargon-gated extra. */
  showOpponentHands: boolean
  /** Hide opponents' hands from the table entirely, instead of the default face-down tile backs
   *  (which show the shape — tile count, melds — without revealing faces). Off by default: showing
   *  the concealed backs is what makes the table read as a real board. Moot when
   *  `showOpponentHands` is on. */
  hideConcealedHands: boolean
  /** Reveal the live (and, where applicable, dead) wall in draw order. */
  showWall: boolean
}

/** One id per board-rendering app. `lab` is the statistical lab (plan 01-07); it has no page yet
 *  but gets a default row here so it inherits sane behavior without adding its own settings
 *  surface the day it ships. */
export type TableApp = 'efficiency' | 'efficiencySolo' | 'folding' | 'scoring' | 'lab'

/** Shipped defaults per app. `opponentWins` is unread by the efficiency apps — those hardcode
 *  `wins: false` in their `MatchOptions` because ending the hand on someone else's tsumo would
 *  cut a per-turn drill short — so its default there is documentation, not behaviour. */
export const TABLE_DEFAULTS: Record<TableApp, TableSettings> = {
  efficiency: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    hideConcealedHands: false,
    showWall: false,
  },
  efficiencySolo: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    hideConcealedHands: false,
    showWall: false,
  },
  folding: {
    opponentWins: true,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    hideConcealedHands: false,
    showWall: false,
  },
  scoring: {
    opponentWins: true,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    hideConcealedHands: false,
    showWall: false,
  },
  lab: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    hideConcealedHands: false,
    showWall: false,
  },
}

/** Resolves one app's table settings: app default, then the global override layer, then that
 *  app's own override layer (D-13). Both override layers are `Partial` — absent-key-means-inherit
 *  is exactly plain object-spread semantics, which is what makes a three-state inherit/on/off
 *  control unnecessary: a key a reader never touched simply isn't in the object. */
export function resolveTableSettings(
  app: TableApp,
  table: {
    global: Partial<TableSettings>
    apps: Partial<Record<TableApp, Partial<TableSettings>>>
  },
): TableSettings {
  return { ...TABLE_DEFAULTS[app], ...table.global, ...(table.apps[app] ?? {}) }
}

/** The resolver, read live off the settings store, with one adjustment: `showWall` stays behind
 *  the existing Advanced gate (`useAdvancedSettings.ts`) — a hidden row must not mean a live
 *  value, and the stored choice comes straight back when Advanced is re-enabled.
 *  `showOpponentHands` and `hideConcealedHands` are explicitly *not* advanced-gated, same as
 *  today. */
export function useTableSettings(app: TableApp): TableSettings {
  const table = useSettings((s) => s.table)
  const advanced = useSettings((s) => s.advanced)
  const resolved = resolveTableSettings(app, table)
  return { ...resolved, showWall: advanced && resolved.showWall }
}
