# ADR-0007 — Every seat is a player; a player has an algorithm

**Status:** Accepted · **Date:** 2026-08-15
**Source:** commit `2307eff`; `core/match.ts#isManual`, `core/algorithm.ts`

## Context

The engine carried two parallel per-seat concepts. `MatchOptions.humans: readonly number[]` was a
static list decided at `createMatch` and baked into `useTableRound`'s rebuild deps, so changing
who played a seat **redealt the hand**. Its sibling, `PlayerState.policy`, was a live per-seat
field the folding trainer already flipped mid-hand. Same idea, two shapes, one of them frozen —
and two call sites (`tryWin`, the call gate) existed *only* because the two fields could disagree.

The vocabulary was wrong too: "human vs opponents" implies the board knows which seat is yours.

## Decision

One live field: `PlayerState.algorithm: SeatAlgorithm`, where
`SeatAlgorithm = 'efficiency' | 'defense' | 'tsumogiri' | 'manual'`.

- Every seat is a **player**. A player has an **algorithm**.
- `'manual'` is not "a human" — it is the algorithm **"ask, don't decide"**. A manual seat is one
  the engine draws for but never decides for: no auto-kita, no auto-riichi (riichi locks every
  later discard to tsumogiri, so it must stay the player's own choice), no auto-pon/chi (a call
  opens a hand its player never chose to open).
- `isManual(state, seat)` is the one predicate. **The word "human" has left the codebase.**
- `MatchOptions.algorithms?: readonly SeatAlgorithm[]` **seeds only**; absent ⇒ `'efficiency'`.
  The live value lives on the player and moves without touching options.
- More than one seat may be manual. Four manual seats is one person playing the whole table.

## Consequences

- The two `&& !isHuman(...)` disagreement guards are deleted outright — a class of bug, not an
  instance.
- "Your seat" becomes a trainer-level idea, not an engine one
  ([ADR-0014](0014-table-is-a-pure-view.md)).
- Made [ADR-0008](0008-algorithms-are-live.md) possible; `MatchOptions.humans` and
  `MatchOptions.policies` are both deleted.

## Rejected

Keeping both fields and reconciling them. That is what the two guards already were.
