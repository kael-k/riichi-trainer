# ADR-0012 — Shared `core/table.ts` and `useTableRound`; folding keeps its own thin hook

**Status:** Accepted · **TO REVIEW** · **Date:** 2026-08-12
**Source:** `core/table.ts`, `features/table/useTableRound.ts`, `features/folding/useFoldingRound.ts`

## Context

An audit found **ten distinct duplications** between `useEfficiencyRound.ts` and
`useFoldingRound.ts`: identical drawn-tile extraction, snapshot bodies, three separate `seenBy`
implementations, opponent go-round loops, replay fast-forward, `logReplay`, render-time reset
blocks. The obvious fix — one React hook for both — runs into the reason folding was written
separately in the first place.

## Decision

**Pure `core/table.ts`** holds the shared mass: `actingSeat`, `goRound`, one canonical `seenBy`,
`snapshotTable`, `seatRead`, replay fast-forward, and per-turn analysis exposed as **memoized
getters** rather than eagerly computed — solo never reads danger, folding never reads ukeire, and
`evaluateDiscards` costs ~476 shanten probes per turn. Nobody pays for what they do not read.

**`useTableRound`** is the React owner for efficiency (both routes), scoring and the lab. Its
callback contract is exactly three, and stays exactly three:

- `onUserDraw(ctx)` — fires once you hold 14 tiles, **before** the discard decision
- `onUserDiscard(tile, stats)` — fires after the throw, carrying stats computed from the ranking
  captured at draw time, not recomputed post-throw
- `onAgariCall(win)` — fires when any seat wins; scoring's entry point

**Callbacks are suppressed during replay fast-forward** (a shared link, a log-row rewind) —
restored turns must not grade or log as if they were live.

**Folding gets its own thin hook on the same pure stepper**, not `useTableRound`. Its mid-hand
algorithm flip runs at *turn* granularity between `beginTurn` and `finishTurn`, which is exactly
why it never used `playMatch`: `playMatch`'s `stop` fires per event only *after* a whole turn has
run, too late for the flip — stopping on the riichi event would leave `match.discards` missing
that turn's own discard while the rest of the state already reflected it.

**Scoring is not restructured.** It generates a result, never re-touches the match, and keeps
rendering `<Table>` presentationally; it simply subscribes to `onAgariCall`.

## Consequences

- The duplication is gone without forcing folding's genuinely different control flow through a
  contract built for someone else.
- The cost: folding re-derives a small number of guards it would otherwise get free — notably that
  `advanceAfterDiscard`'s tail must not `beginTurn` into a turn a pending claim has suspended.
- Grading gets pre-throw state by construction, rather than by every trainer remembering to
  snapshot first — which was exactly the bug class being removed.

## Rejected

Growing `useTableRound`'s contract with a generic event escape hatch for folding. One consumer
shaping a shared contract is how the contract stops meaning anything.
