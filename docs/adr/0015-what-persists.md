# ADR-0015 — Reader preferences persist; board state does not

**Status:** Accepted · **Date:** 2026-08-15
**Source:** `features/settings/tableSettings.ts`, `features/settings/settingsStore.ts`

## Context

Everything configurable looks like a setting, so everything drifts into the persisted store. Then
a board opened three days later comes up with opponents nobody remembers choosing, drawn from a
seat nobody remembers picking — and neither is reproducible from the link that was shared.

## Decision

The test is **what the value is about**, not where its control lives.

**Persisted (a question about the reader):**

- Global settings: theme, tile size, language, tile numbers, `sanma`, `aka`, advanced mode,
  per-trainer timer/display preferences. (`mobileFullscreen` was one of these until
  [ADR-0025](0025-one-interface.md) removed the mode it switched.)
- `TableSettings` — `opponentWins`, `deadWall`, `threats`, `showOpponentHands`, `showSeatWaits`,
  `showWall`, `claims` — resolved per app as `{ ...TABLE_DEFAULTS[app], ...global, ...appOverride }`.
  Both override layers are `Partial`: absent-key-means-inherit is plain object-spread semantics,
  which is exactly why no three-state inherit/on/off control is needed.
- `claims` specifically stays here and stays match-wide: it answers "do I want to be offered
  pon/chi/ron", which is about the reader.

**Not persisted (a question about the board):**

- **Seat algorithms.** Page state (`useState` in `EfficiencyPage`, `FoldingPage`, `LabPage`),
  seeded from the link, reset on every new hand. The settings store holds no `modes` field.
- **Perspective** (`viewSeat`). Same lifetime, same reasoning, view-only in every trainer.

Share links carry algorithms as **seed** values only. A mid-hand flip is not reproducible in a
link, and that is accepted — a replayable-match format is separate work.

## Consequences

- Two shapes with the same lifetime: seeded from the link, reset on a new hand, gone on reload.
- Old persisted blobs keep a stale `seats` key nothing reads. The store `version` was deliberately
  **not** bumped to purge it, because that would drop every setting for everyone.
- `settingsStore.ts`'s hand-written section-wise `merge` must be extended when a section is added,
  or old persisted state silently wipes it on load. This is a real trap, not a formality.
- Every patch a caller sends `onChange` is built off the **raw** `SeatConfig`, never the resolved
  one — writing resolved fallback modes back on every edit is what once made moving perspective
  look like a real `modes` edit and re-search folding for a new hand.

## Rejected

Persisting seat algorithms "so the reader doesn't have to set them again". They are the board, and
a board that half-restores is worse than one that starts clean.
