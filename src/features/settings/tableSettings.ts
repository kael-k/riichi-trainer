import type { SeatAlgorithm } from '../../core/policy'
import { useSettings } from './settingsStore'

/** Who plays which seat. Board state, not a preference (ADR-0015): it is never persisted, living
 *  instead as page state with the same lifetime as `viewSeat` — seeded from the link, reset on
 *  every new hand — and `null` until the reader opens the panel: the shipped behaviour is exactly
 *  "you sit where the trainer seats you, every other seat is the efficiency AI", which
 *  `resolveSeatConfig` below reproduces from `null`. Unlike `modes`, `claims` answers a question
 *  about the *reader* rather than the board (ADR-0015), so it stays match-wide and persisted —
 *  `TableSettings.claims` below, not a field here.
 *
 *  Perspective (which seat the board is drawn from) is not part of this either: it is its own
 *  ephemeral page state, reset on every new hand, never persisted — "watch from here" stops
 *  meaning "play here", which comes only from a seat's `modes` entry being `'manual'`. */
export interface SeatConfig {
  /** Indexed by seat; a seat past the end falls back to the default for its position. */
  modes: SeatAlgorithm[]
}

/** `SeatConfig` filled in for a real table: every seat named, and at least one manual seat
 *  guaranteed — with none, nothing would ever stop the go-round loop to let a person act. The
 *  guarantee anchors on `defaultSeat` (a link's `?seat=`, or the seat the trainer generated), not
 *  on perspective — perspective doesn't reach this function at all.
 *
 *  `fallbackModes` overrides the `'efficiency'` default for an unconfigured seat — the folding
 *  trainer flips non-declarers to `'defense'` at handover, and the panel must show what the
 *  board is actually doing rather than a generic guess (see `useFoldingRound`'s live algorithms). */
export function resolveSeatConfig(
  config: SeatConfig | null,
  players: number,
  defaultSeat: number,
  fallbackModes?: readonly SeatAlgorithm[],
): SeatConfig {
  const modes = Array.from(
    { length: players },
    (_, seat): SeatAlgorithm =>
      config?.modes[seat] ??
      fallbackModes?.[seat] ??
      (seat === defaultSeat ? 'manual' : 'efficiency'),
  )
  if (!modes.includes('manual')) modes[defaultSeat] = 'manual'
  return { modes }
}

/** `modes` with `seat` set to `mode`, built off the *raw* array rather than a resolved one — a
 *  patch that writes back the resolved fallback modes would bake a mode the reader never actually
 *  touched into page state that is meant to reflect only their own edits, so every edit must send
 *  only what changed. */
export function withSeatMode(
  modes: readonly SeatAlgorithm[],
  seat: number,
  mode: SeatAlgorithm,
): SeatAlgorithm[] {
  const next = [...modes]
  next[seat] = mode
  return next
}

/** The settings every board-rendering trainer shares. One schema instead of each app growing its
 *  own copy of the same questions (ADR-0015, ADR-0015). */
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
   *  non-advanced setting: unlike the advanced-gated rows, opponents' hands being *present* is
   *  basic table reading, not a jargon-gated extra. */
  showOpponentHands: boolean
  /** Reveal every seat's tenpai/waits on its own strip (`core/table.ts#seatRead`). Same reasoning
   *  as `showOpponentHands` — board-wide, non-advanced, reveals riichi threats live — and not
   *  carved out for the folding drill's own answer key either: one "show me everything" switch
   *  per concept beats a narrower one with a special case, and switching it on is the reader
   *  choosing to spoil their own drill. */
  showSeatWaits: boolean
  /** Reveal the live (and, where applicable, dead) wall in draw order. */
  showWall: boolean
  /** Ask manual seats about pon/chi/ron on other seats' discards (`RoundOptions.claims`). Stays
   *  match-wide and persisted (ADR-0015, unlike the per-seat algorithms themselves — see `SeatConfig`)
   *  since it answers a question about the reader, not about the board. Off in the graded drills,
   *  which ask one question per turn; on in the free-play lab. */
  claims: boolean
}

/** One id per board-rendering app. `lab` is the statistical lab (plan 01-07); it has no page yet
 *  but gets a default row here so it inherits sane behavior without adding its own settings
 *  surface the day it ships. */
export type TableApp = 'efficiency' | 'efficiencySolo' | 'folding' | 'scoring' | 'lab'

/** Shipped defaults per app. `opponentWins` is unread by the efficiency apps — those hardcode
 *  `wins: false` in their `RoundOptions` because ending the hand on someone else's tsumo would
 *  cut a per-turn drill short — so its default there is documentation, not behaviour. */
export const TABLE_DEFAULTS: Record<TableApp, TableSettings> = {
  efficiency: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
    showWall: false,
    claims: false,
  },
  efficiencySolo: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
    showWall: false,
    claims: false,
  },
  folding: {
    opponentWins: true,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
    showWall: false,
    claims: false,
  },
  scoring: {
    opponentWins: true,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
    showWall: false,
    claims: false,
  },
  lab: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
    showWall: false,
    // the lab is the free-play board: manual seats are the point there, so it ships with the
    // claim prompts on. Per-seat `modes` themselves are never a settings default — they are page
    // state seeded from the link (ADR-0015), same as every other app
    claims: true,
  },
}

/** Resolves one app's table settings: app default, then the global override layer, then that
 *  app's own override layer (ADR-0015). Both override layers are `Partial` — absent-key-means-inherit
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
 *  `showOpponentHands` is explicitly *not* advanced-gated, same as today. */
export function useTableSettings(app: TableApp): TableSettings & { seatsEnabled: boolean } {
  const table = useSettings((s) => s.table)
  const advanced = useSettings((s) => s.advanced)
  const resolved = resolveTableSettings(app, table)
  // the lab is the exception to the Advanced gate — free play *is* what that page is for, so its
  // seat panel is always available
  const seatsEnabled = advanced || app === 'lab'
  return {
    ...resolved,
    showWall: advanced && resolved.showWall,
    /** Whether the seat panel is offered at all — the per-seat algorithms themselves are page
     *  state now (ADR-0015), not a settings value, so there is nothing here left to force off when the
     *  panel is hidden. */
    seatsEnabled,
  }
}
