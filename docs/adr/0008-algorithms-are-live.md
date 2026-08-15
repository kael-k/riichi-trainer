# ADR-0008 — Changing a seat's algorithm never changes the hand

**Status:** Accepted · **Date:** 2026-08-15
**Source:** commit `57d190f`; the sync effect in `features/table/useTableRound.ts`

## Context

With `humans` static and baked into rebuild deps, handing a seat to the AI mid-hand redealt the
board. That is indefensible on a graded drill: the reader loses the hand they were reading in
order to change who reads it.

## Decision

**Algorithm changes are live, everywhere, with no exceptions. No redeal, no re-search, no new
wall.** A sync effect in `useTableRound` (mirrored in `useFoldingRound`) writes straight onto the
running `PlayerState.algorithm`, then advances with `goRound` and re-snapshots.

Two details this forces, both load-bearing:

- **Generation keys exclude algorithms.** Folding's search key is only what shapes the hand —
  seed, `threats`, `sanma`, `wins`. Algorithms are board state, not search input
  ([ADR-0015](0015-what-persists.md)).
- **A pending claim on a seat that stops being manual is re-resolved**, via `reconsiderClaim`,
  through the same restartable `resolveReactions` path `answerClaim` uses. It never invents a pass
  on the reader's behalf: a pass sets `missedWin`, so touching a dropdown would poison the hand
  with furiten over a decision nobody made.

**Setting your own graded seat to an algorithm is allowed.** Grading simply freezes — score,
accuracy and clock stop where they stood and the hand plays on. This needs no special case: only a
manual seat ever reaches the interactive `discard()` path, and the existing
`actingSeat === seatIndex` guard already does it.

## Consequences

- The invariant to assert, and the one the tests assert: before and after any algorithm change —
  same wall count, same turn, same drawn tile, same rivers.
- A second manual seat can never silently move which seat a graded trainer scores.

## Rejected

Rebuilding the round on change and re-applying the recorded discards. It is a redeal wearing a
disguise, and it cannot restore a mid-hand claim.
