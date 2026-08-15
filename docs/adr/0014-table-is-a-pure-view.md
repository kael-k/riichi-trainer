# ADR-0014 — `<Table>` is a pure view with no concept of a player

**Status:** Accepted · **Date:** 2026-08-15
**Source:** `components/tiles/Table.tsx`; commit `19c7b40`

## Context

A board component is where game logic goes to hide. Once it knows which seat is "yours", it starts
deciding what that seat may do, what it may see, and what to badge — and every one of those
decisions is then invisible to the engine's tests.

## Decision

`components/tiles/Table.tsx` holds **zero game logic and no player concept**. Its `SeatView` has
no player field, only `hand` / `drawn` / `concealed` — a seat somebody plays and a seat nobody
does are drawn through the exact same props. There is no on-board "(you)" label.

`seatIndex` is purely **which seat the board is drawn from**: a viewing perspective, not "the
user's seat". Permissions never reach it ([ADR-0010](0010-match-wide-permissions.md)); the caller
decides everything and passes tiles or does not.

"Your seat" is a trainer-level idea — the generated seat `resolveSeatConfig` anchors its manual
guarantee to — not something `Table` reads or needs.

## Consequences

- Three semantically different things stay independent and were only ever confused when one
  component knew all three: **perspective** (which seat is at the bottom), **the graded seat**
  (`RoundCore.seatIndex`, decided by the trainer), and **who decides** (a seat's algorithm).
- The scoring trainer can render the same component for a hand it never steps.
- A "watch from here" control is view-only by construction — it cannot accidentally mean "play
  here", because `Table` has no idea what playing is.

## Rejected

Passing call/win permissions to `Table` so it could render its own action buttons. Those buttons
live in `ManualControls`, which is a sibling of the board, not part of it.
