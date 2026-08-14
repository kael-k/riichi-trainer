import type { SeatPolicy } from '../../core/policy'
import { useSettings } from './settingsStore'

/** How one seat is played. The two AI values are `PlayerState.policy`'s own (`core/policy.ts`);
 *  `'manual'` is not a policy at all but the absence of one — the seat goes into
 *  `MatchOptions.humans` and the engine stops deciding for it. */
export type SeatMode = SeatPolicy | 'manual'

/** Who plays which seat. Advanced-only, and `null` everywhere until someone opens the panel: the
 *  shipped behaviour is exactly "you sit where the trainer seats you, every other seat is the
 *  efficiency AI", which `resolveSeatConfig` below reproduces from `null`.
 *
 *  Perspective (which seat the board is drawn from) is not part of this: it is ephemeral page
 *  state, reset on every new hand, never persisted — "watch from here" stops meaning "play here",
 *  which comes only from a seat's `modes` entry being `'manual'`. */
export interface SeatConfig {
  /** Indexed by seat; a seat past the end falls back to the default for its position. */
  modes: SeatMode[]
  /** Ask the manual seats about pon/chi/ron on other seats' discards (`MatchOptions.claims`).
   *  Off in the graded drills, which ask one question per turn; on in the free-play lab. */
  claims: boolean
}

/** `SeatConfig` filled in for a real table: every seat named, and at least one manual seat
 *  guaranteed — with none, nothing would ever stop the go-round loop to let a person act. The
 *  guarantee anchors on `defaultSeat` (a link's `?seat=`, or the seat the trainer generated), not
 *  on perspective — perspective doesn't reach this function at all.
 *
 *  `fallbackModes` overrides the `'efficiency'` default for an unconfigured seat — the folding
 *  trainer flips non-declarers to `'defense'` at handover, and the panel must show what the
 *  board is actually doing rather than a generic guess (see `useFoldingRound`'s `policies`). */
export function resolveSeatConfig(
  config: SeatConfig | null,
  players: number,
  defaultSeat: number,
  fallbackModes?: readonly SeatMode[],
): SeatConfig {
  const modes = Array.from(
    { length: players },
    (_, seat): SeatMode =>
      config?.modes[seat] ??
      fallbackModes?.[seat] ??
      (seat === defaultSeat ? 'manual' : 'efficiency'),
  )
  if (!modes.includes('manual')) modes[defaultSeat] = 'manual'
  return { modes, claims: config?.claims ?? false }
}

/** `modes` with `seat` set to `mode`, built off the *raw* array rather than a resolved one — a
 *  patch that writes back the resolved fallback modes is what silently re-searches the folding
 *  drill for a new hand (its `seatKey` reacts to any `modes` change), so every edit must send only
 *  what the reader actually changed. */
export function withSeatMode(modes: readonly SeatMode[], seat: number, mode: SeatMode): SeatMode[] {
  const next = [...modes]
  next[seat] = mode
  return next
}

/** The `MatchOptions` fields a seat configuration decides, plus the seat the engine grades —
 *  the one place `SeatMode` is translated into what the engine actually reads, so no trainer has
 *  to know that "manual" means `humans` and "defend" means `policies`. `seatIndex` keeps
 *  `defaultSeat` when it is itself manual, so a second manual seat never silently moves which
 *  seat a graded trainer scores (`useTableRound` anchors grading on `core.seatIndex`). */
export function seatMatchOptions(
  config: SeatConfig | null,
  players: number,
  defaultSeat: number,
): {
  seatIndex: number
  humans: number[]
  policies: SeatPolicy[]
  claims: boolean
} {
  const { modes, claims } = resolveSeatConfig(config, players, defaultSeat)
  const humans = modes.flatMap((mode, seat) => (mode === 'manual' ? [seat] : []))
  return {
    seatIndex: humans.includes(defaultSeat) ? defaultSeat : (humans[0] ?? defaultSeat),
    humans,
    policies: modes.map((mode) => (mode === 'manual' ? 'efficiency' : mode)),
    claims,
  }
}

/** The settings every board-rendering trainer shares. One schema instead of each app growing its
 *  own copy of the same questions (REQ-04, D-13). */
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
  /** Reveal the live (and, where applicable, dead) wall in draw order. */
  showWall: boolean
  /** Who plays which seat (`SeatConfig`). `null` — the default everywhere — is the shipped
   *  behaviour, spelled out by `resolveSeatConfig`. Advanced-only outside the lab: it is a
   *  sandbox control, not something a first-time player should have to find. */
  seats: SeatConfig | null
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
    showWall: false,
    seats: null,
  },
  efficiencySolo: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showWall: false,
    seats: null,
  },
  folding: {
    opponentWins: true,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showWall: false,
    seats: null,
  },
  scoring: {
    opponentWins: true,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showWall: false,
    seats: null,
  },
  lab: {
    opponentWins: false,
    deadWall: true,
    threats: 1,
    showOpponentHands: false,
    showWall: false,
    // the lab is the free-play board: manual seats are the point there, so it ships with the
    // claim prompts on. No `orientation`/`modes` — those still come from the link and the
    // shipped default until someone opens the panel
    seats: { modes: [], claims: true },
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
    /** Whether the seat panel is offered at all. Distinct from `seats` being `null`, which means
     *  "offered, nobody has configured it yet" — a hidden panel must not leave a live per-seat
     *  configuration running underneath, so the value is dropped as well as the control. */
    seatsEnabled,
    seats: seatsEnabled ? resolved.seats : null,
  }
}
