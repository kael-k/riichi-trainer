# ADR-0006 — One match engine; trainers differ only by their stop condition

**Status:** Accepted · **Date:** 2026-08-11
**Source:** `core/match.ts`

## Context

Four table trainers want four different things from a hand of mahjong: efficiency wants every one
of your turns, folding wants the turns after a riichi, scoring wants only the win at the end, the
lab wants all of it and grades nothing. The obvious shape — one engine per trainer — is four
engines to keep honest against each other.

## Decision

One deterministic hand drives everything. `createMatch` deals; `beginTurn` (draw) and `finishTurn`
(discard, then everyone else's ron and calls) step it; `playMatch` loops both with a `stop`
predicate. **The stop predicate is the only thing trainers differ by.**
`findMatch`/`findMatchAsync` are rejection samplers over that: replay candidate boards until an
`accept` callback takes one — which is how scoring asks for "first win by any seat" and how
folding searches for a board worth drilling.

Win legality is free from what already exists: `decompose()` non-empty is the shape, `scoreHand()`
returning `null` is "no yaku". Both are guarded behind a single `shanten()` call, because that
gate fails for almost every seat on almost every discard and everything past it costs far more.

## Consequences

- A bug in the hand's bookkeeping is one bug, caught by one census test.
- Performance is a shared concern, not four: a match is ~17ms, and `standardShanten`'s per-suit
  decomposition (~475x the naive search) is what pays for it.
- A trainer needing turn-_granularity_ control rather than event-granularity cannot use
  `playMatch` at all — see [ADR-0012](0012-shared-table-layer.md) for how folding handles that.

## Rejected

Per-trainer engines. Rejected implicitly by never being built; the folding trainer's divergence
was solved by giving it turn-level access to the _same_ engine, not its own.
