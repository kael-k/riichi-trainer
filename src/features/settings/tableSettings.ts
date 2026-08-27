import { DEFAULT_EV_SEAT, type EvSeat } from '../../core/ev'
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
  /** How each `'ev'` seat prices — model and objective. Same indexing and the same lifetime as
   *  `modes`; a seat with no entry runs `DEFAULT_EV_SEAT`, and a seat on any other algorithm
   *  carries whatever is here and ignores it, so switching to `'ev'` and back does not lose the
   *  reader's choice. */
  ev?: (EvSeat | undefined)[]
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
  const ev = Array.from({ length: players }, (_, seat) => config?.ev?.[seat] ?? DEFAULT_EV_SEAT)
  return { modes, ev }
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

/** The same patch for one seat's EV settings, and the same rule: built off the raw array, and
 *  only the keys the reader actually touched. */
export function withSeatEv(
  ev: readonly (EvSeat | undefined)[] | undefined,
  seat: number,
  patch: Partial<EvSeat>,
): (EvSeat | undefined)[] {
  const next = [...(ev ?? [])]
  next[seat] = { ...DEFAULT_EV_SEAT, ...next[seat], ...patch }
  return next
}

/** The settings every board-rendering trainer shares. One schema instead of each app growing its
 *  own copy of the same questions (ADR-0015, ADR-0015). */
export interface TableSettings {
  /** Let the threats ron and tsumo. Off makes the drill a rehearsal — the same ranking and the
   *  same grading, but the hand plays to the wall instead of ending on a deal-in. Off by
   *  default in folding: a fold you can't lose still teaches the tiles, without a deal-in
   *  cutting the drill short before every turn is graded. */
  opponentWins: boolean
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
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
  },
  efficiencySolo: {
    opponentWins: false,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
  },
  folding: {
    opponentWins: false,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
  },
  scoring: {
    opponentWins: true,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
  },
  lab: {
    opponentWins: false,
    threats: 1,
    showOpponentHands: false,
    showSeatWaits: false,
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

/** The resolver, read live off the settings store. Nothing here is advanced-gated any more: the
 *  wall reveal was the one field that was, and it is a chrome-row button now rather than a
 *  setting at all (`WallDetails`), so there is no stored value left to force off behind a hidden
 *  row. */
export function useTableSettings(app: TableApp): TableSettings & { seatsEnabled: boolean } {
  const table = useSettings((s) => s.table)
  const advanced = useSettings((s) => s.advanced)
  // the lab is the exception to the Advanced gate — free play *is* what that page is for, so its
  // seat panel is always available
  const seatsEnabled = advanced || app === 'lab'
  return {
    ...resolveTableSettings(app, table),
    /** Whether the seat panel is offered at all — the per-seat algorithms themselves are page
     *  state now (ADR-0015), not a settings value, so there is nothing here left to force off when the
     *  panel is hidden. */
    seatsEnabled,
  }
}
