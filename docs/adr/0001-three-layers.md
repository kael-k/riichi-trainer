# ADR-0001 — Keep the engine pure, in three layers

**Status:** Accepted · **Date:** 2026-08-12
**Source:** the repo's founding shape; enforced by `src/core/`'s import rules

## Context

A mahjong trainer is mostly arithmetic — shanten, ukeire, danger, scoring — wrapped in a small
amount of React. If that arithmetic lives inside hooks it can only be exercised through a
renderer, and every question about correctness turns into a question about render timing.

## Decision

Three layers, and the imports only ever point one way:

1. **`src/core/`** — pure TypeScript. Zero dependencies, no React, no imports from `features/` or
   `components/`. Plain functions over a mutable state object (`match.ts` is the house style).
2. **`src/features/situation/urlCodec.ts`** — the situation codec, sitting between the two.
3. **React trainers** — a page plus a `use*Round` hook, built on both.

## Consequences

- The engine is testable as arithmetic: 31 test files, and every file in `core/` has one.
- A hand can be replayed, hashed and diffed without a DOM ([ADR-0016](0016-testing-strategy.md)).
- The cost is real: anything the UI needs to *show* about a decision has to be handed out of the
  engine explicitly, which is why `core/table.ts` grew a snapshot builder
  ([ADR-0012](0012-shared-table-layer.md)) rather than letting pages read `MatchState`.

## Rejected

Putting the stepper inside `useTableRound` and letting pages read `MatchState` directly. It works
until a second consumer needs the same derivation at a different granularity — which is exactly
what happened between the efficiency and folding hooks, and cost ten distinct duplications before
the shared layer existed.
