# ADR-0013 — Efficiency splits into two routes; solo is one real seat with no board

**Status:** Accepted · **TO REVIEW** · **Date:** 2026-08-12
**Source:** `src/routes/index.tsx`; `features/efficiency/` and `features/efficiency-solo/`

## Context

The efficiency trainer had an `opponents` checkbox that silently changed which application the
route was. A setting that changes a route's identity is undiscoverable: the home page cannot name
it, a link cannot pin it, and the reader has no way to know two people are drilling different
things at the same URL.

## Decision

**Two routes, two pages, two hooks. The route is the choice.** `/efficiency-solo` and
`/efficiency`. `opponents` is removed entirely — from `Settings['efficiency']`, from the URL
codec's `FLAGS`, and from `situationQuery()`.

- **Solo is genuinely one seat** — `createMatch(wall, 1, …)` — keeping the dead wall and dora
  indicator. No new dealing path was needed: `createMatch` already deals sequentially per seat and
  slices the dead wall off the pool tail independent of player count.
- **Solo keeps its existing layout** — hand, river, nuki/kan piles, wall/dora chips — and renders
  no `<Table>`. `Table`'s slot mapping is written for 3–4 seats and would render mostly-empty
  cells for one; the user wants phone usability and does not consider solo "a table".

The home page groups accordingly: two solitaire apps (efficiency solo, shanten) and four table
apps (efficiency, folding, scoring, lab).

## Consequences

- Every route is one app. No setting silently changes which.
- The two hooks shared ~150 near-verbatim lines (`recordChoice`, `writeRows`, `logReplay`, both
  effects, the `finished`/`tenpai` derivation, the return object), accepted as this decision's
  maintenance cost until factored — done in [ADR-0032](0032-one-efficiency-drill-core.md), which
  both hooks now sit on. The route split above still stands; only the duplication did not.
- Solo's grader is ukeire-only, so a kept dora can mark a discard "wrong". Accepted, and worth one
  line in the trainer's intro.

## Rejected

Forking the hook behind a flag: 600 shared lines duplicated to avoid 25 opponent-conditional ones.
The shared mass went into `core/table.ts` instead ([ADR-0012](0012-shared-table-layer.md)).
