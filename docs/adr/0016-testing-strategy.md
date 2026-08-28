# ADR-0016 — Test against a reference implementation, a census, and a frozen hash

**Status:** Accepted · **Date:** 2026-08-15
**Source:** `core/shanten.test.ts`, `core/match.test.ts`, `core/match.golden.test.ts`

## Context

The engine's failure modes are not the kind unit tests catch by example. A shanten optimisation
can be right for every hand you thought to write down and wrong for one you did not. A tile can go
missing from bookkeeping without any single assertion noticing. A tie-break can silently reorder
and change every board in the app while every test still passes.

## Decision

Three invariant-shaped tests carry the engine, each aimed at one of those:

1. **A reference implementation as the specification.** `referenceStandardShanten` is the old
   whole-hand search, kept _solely_ as the thing the fast per-suit decomposition is proved against
   over thousands of random hands. **Change one, re-run that.** It is not dead code.
2. **A census.** `match.test.ts` asserts every tile kind is accounted for exactly four times
   (zero for 2m-8m under sanma) across hands, melds, rivers, wall and dead wall. This is what
   catches bookkeeping slips no feature test would.
3. **A golden hash.** `match.golden.test.ts` plays N seeded matches through `playMatch`, serialises
   each event stream (seat + kind + tile ids, in order) and asserts a frozen hash per seed. It is
   the only thing that catches a silently reordered tie-break. Written and frozen **before** a
   refactor, then regenerated deliberately — in the commit that changes behaviour, saying so in
   the message.

Around them: `danger.test.ts` runs 150 seeded matches under a 15s timeout, which is the
performance ceiling to watch.

## Consequences

- A refactor's proof is "the hashes are unchanged", not "the tests still pass".
- Regenerating a golden hash is a deliberate, reviewable act. If a commit regenerates them without
  saying why, that is the finding.
- The determinism these depend on ([ADR-0002](0002-determinism-and-tenhou-notation.md)) is a
  constraint on the engine, not a convenience.

## Rejected

Snapshot-testing rendered output as the primary net. It moves whenever the UI moves, which is
constantly, and says nothing about the arithmetic. **UI regressions are a real and currently
untested gap** — tracked in `docs/STATUS.md`, and the right answer there is a browser-driver
suite in CI, not more snapshots.
