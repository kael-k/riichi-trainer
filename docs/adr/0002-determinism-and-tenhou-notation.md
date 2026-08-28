# ADR-0002 — Deterministic RNG, and tenhou notation as the one interchange format

**Status:** Accepted · **Date:** 2026-08-11
**Source:** repo founding shape; `core/rng.ts`, `core/tiles.ts`

## Context

The product promise is that a specific decision point can be sent to another player as a URL and
arrive identical. That requires the whole engine to be reproducible from data. Separately, tiles
have to be written down in a dozen places — URL params, log rows, test fixtures, copy buttons —
and every format invented for one of them is a format someone has to learn twice.

## Decision

- **RNG is `mulberry32` seeded by a string hash**, with a Fisher-Yates `shuffle` over it. Same
  seed string ⇒ same wall. No `Math.random()` inside the engine; randomness enters only as a seed
  a caller supplies.
- **Tenhou notation is the interchange format everywhere**: `123m406p11z`, `0` = red five.
  `serializeTenhou` sorts (hands); `serializeTenhouOrdered` preserves order (walls, rivers, where
  draw and discard order carry meaning).

## Consequences

- Tests can pin thousands of hands to a seed and stay fast.
- A log row's copy button, a URL param and a test fixture are the same string, so a bug report is
  a paste.
- Seeds are no longer the _shared_ record for wall-based trainers — that is
  [ADR-0005](0005-walls-not-seeds.md) — but they still back random generation and every seeded
  test, and that is deliberate: dropping `buildWall(seed)` would cost the fuzz suites nothing but
  determinism.

## Rejected

A JSON tile format for URLs. Shorter isn't the point — tenhou strings are the notation the
player community already reads, so a link is legible before it is decoded.
