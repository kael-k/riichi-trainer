# ADR-0032 — One drill core behind both efficiency hooks

**Status:** Accepted · **Date:** 2026-08-24
**Source:** `features/efficiency/useEfficiencyDrill.ts`; `features/efficiency/useEfficiencyRound.ts`;
`features/efficiency-solo/useEfficiencySoloRound.ts`

## Context

ADR-0013 split efficiency into two routes — `/efficiency` (full table) and `/efficiency-solo`
(boardless, one seat) — because a checkbox that changes a route's identity is undiscoverable. It
accepted, as the cost of that split, ~150 near-verbatim duplicate lines between the two hooks:
session state, `recordChoice`/`writeRows`/`settle`, the `onEvent` grading dispatch, `logReplay`, the
reset effect, the `finished`/`tenpai` derivation, and most of the return object — differing only in
`players`, `calls`, `riichi`, `claims`/`algorithms`, and the board-only fields a full table needs on
top. `docs/STATUS.md` tracked it as a known risk: nothing asserted the two hooks stayed in
lockstep, so a fix applied to one and not the other would go unnoticed. ADR-0013 said to factor it
if a third near-identical consumer appeared; this factors it without one, since the drift risk was
real regardless of a third consumer's existence.

## Decision

**The route split stays. The implementation behind it does not duplicate.** A new
`useEfficiencyDrill(input)` in `features/efficiency/` holds everything that does not depend on how
many seats are dealt or who else is at the table:

- `restartCount`/`cumulativeLost`/`cumulativeTotal`/`lastResult` state and their refs
  (`lastChoiceElapsed`, `pending`, `loggedReplay`, `roundActionCount`).
- `recordChoice`, `writeRows`, `settle` — unchanged from `features/efficiency/grade.ts`'s callers.
- `onEvent`, gating on `event.seat !== input.seatIndex` exactly as both hooks already did (for solo
  that filter is always true, since `seatIndex` is the only seat there is) and stopping the drill at
  its own seat's tenpai.
- The `useRound` call, `logReplay`, the `[situation, restartCount]` reset effect, and the
  `finished`/`tenpai` derivation off the graded seat's own hand.

`EfficiencyDrillInput` takes a fully-resolved `RoundOptions` and a `seatIndex` — the caller decides
`calls`/`riichi`/`claims`/`algorithms` and which seat is graded; the drill has no opinion about
either. `useEfficiencyRound` builds the 3-4-seat table's options (opponents call, never win, no
danger to read, claims live) and the graded seat off the link (ADR-0008); `useEfficiencySoloRound`
builds the 1-seat, no-calls, always-manual options. Each then adds only what its own board needs on
top of the drill's return: the table hook adds every seat's `hands`/`melds`/`nuki`, `manualSeats`,
`drawnSeat`, `claim`, `seatReads`, `match`, `answer`, `riichiTiles`, `riichiArmed`, `armRiichi`,
`kita`, `kan`; solo adds its own `nuki` (one seat's pile, not an array of them) and `kita`/`kan`
straight off `table`.

**`nuki` is not in the shared return.** It has a different shape per app (`ParsedTile[][]` indexed
by seat for the table, `ParsedTile[]` for solo's own seat), so each hook reads it off
`drill.snapshot`/`table` itself rather than the drill guessing which shape to hand back.

`kita`/`kan` are read straight off `drill.table` by both hooks rather than added to the drill's own
return — they touch no grading or session state the drill owns, and gating them (sanma-only,
seat-must-be-manual, tile-count) already lives in `useRound#kita`/`useRound#kan` where it always
did.

## Consequences

- Two routes, two pages, two hooks — still true, unchanged from ADR-0013. One grading/session-state
  implementation underneath them, so a bugfix to `onEvent`'s tenpai stop, or to `logReplay`'s
  restart dedup, reaches both routes by construction rather than by remembering to port it twice.
- `useEfficiencyRound.ts` and `useEfficiencySoloRound.ts` both shrink to "build my own
  `RoundOptions`, call the drill, add my own extras" — under 100 lines each. Their own tests
  (`useEfficiencyRound.test.ts`, `useEfficiencySoloRound.test.ts`) needed no changes: the drill is
  an internal seam, not a public one.
- The STATUS.md risk this closes: "nothing asserts the two hooks stay in lockstep" no longer
  applies to the ~150 lines that moved into the drill, since there is now exactly one copy of them.

## Rejected

Extracting only the repeated logic as standalone functions (`gradeEvent`, `replayRows`) called from
each hook's own `useState`/`useRef`/`useEffect` wiring. Smaller diff, but the two effects, the four
ref declarations and the shared half of the return object would still exist twice — the actual
lockstep risk STATUS.md flagged was never in the logic bodies alone, it was in the wiring around
them staying in sync by hand.
