# ADR-0017 — Log rows are written imperatively, never from effects

**Status:** Accepted · **Date:** 2026-08-11
**Source:** `store/log.ts`, `useEfficiencyRound.ts`, `useFoldingRound.ts`

## Context

The action log looks like derived state: watch the round, write a row when it changes. It is not.
An effect watching round state **inverts entry order and duplicates rows under StrictMode**, and
both symptoms look like log bugs rather than architecture bugs.

## Decision

**Log rows are written imperatively from the user-triggered action** — inside `discard()`,
`submit()`, `kita()` — never from a `useEffect` watching round state.

**One exception**, and it is documented as such: `logReplay`, which puts a shared link's replayed
discards on the log under the shared `log.replay` key. It deduplicates on the **decoded
situation/link object's identity**, because that effect runs twice per mount and four times under
StrictMode for one and the same round. That is also why those objects come from `useUrlData`
(memoised per navigation) rather than being rebuilt per render — the same identity the trainers'
"reset `handIndex` while rendering" pattern keys on.

That row is likewise why `BoardStage` (`TrainerLayout` until [ADR-0025](0025-one-interface.md))
clears the log **during its first render** rather than
from a mount effect: effects run children-first, so a page that logs as its round mounts would
have those rows wiped by its own layout a moment later.

## Consequences

- Order is the order things happened, and StrictMode is a non-event.
- Adding a new logged action means finding the user action, not adding a watcher — which is the
  cheaper thing to find anyway.

## Rejected

An effect-based log with a dedupe key per row. That is the bug with a workaround attached; the
identity dedupe is tolerated for `logReplay` only because replay genuinely has no user action to
hang off.
