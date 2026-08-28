# ADR-0021 — Shared links replay a full action log, not your own river

**Status:** Accepted · **Date:** 2026-08-15
**Source:** `PLAN-action-log.md` (uncommitted), `core/match.ts#replayLog`, `core/actionLog.ts`

## Context

Every wall-based trainer's link carried `wall` + **your own** past discards
(`Situation.river` / `FoldingUrl.discards`). On replay, every _other_ seat was re-simulated fresh
by whatever algorithm it happens to be running today. Since seat algorithms are live and flippable
mid-hand ([ADR-0008](0008-algorithms-are-live.md)), that re-simulation stopped being guaranteed to
reproduce the original board — a flip after the link was generated silently changed what the link
played back. It also had no carrier for `fromDrawn`/riichi intent, so replay reconstructed
tedashi/tsumogiri by comparing tile identity to the drawn tile — a heuristic, not the ground truth
Phase 1 ([`Hand.drawn`](0002-determinism-and-tenhou-notation.md)) already made available.

## Decision

`MatchState.log: LogEntry[]` records every seat's decision — discard (`fromDrawn`/`riichi`
straight off `RiverTile`), pon/chi (`Call` from `policy.ts`, reused verbatim), kita, closed kan, and
win (tsumo when `from` is absent) — appended at the same sites `MatchState.discards` already is.
Additive, not a replacement: `discards`/`river` still feed genbutsu (`threatViews`); collapsing the
two was considered and rejected as real risk for no benefit this phase. No `kakan` (nothing in this
engine models one) and no `pass`/decline (a claim nobody answered, or a tsumo the log doesn't show
accepted at this exact draw, is already derivable from absence — see below).

Closed kan and kita moved into `match.ts` as first-class engine actions, `callKita`/`callAnkan` —
mutation and log entry in one place — replacing hand-mutation `useTableRound.ts` used to do with no
engine awareness at all.

`replayLog(state, options, log)` replays from wherever `state` stands, consulting **no algorithm at
all**: every seat's `algorithm` is forced to `'manual'` for the duration (restored after), which
routes every decision through `finishTurn`'s `discard`/`declareRiichi` args, `answerClaim`, and a
new `beginTurn` 4th argument, `declineTsumo` (needed because a manual seat's own tsumo is otherwise
unconditional — see [ADR-0008](0008-algorithms-are-live.md) — so replaying an original `defense`/
`tsumogiri` decline needs an explicit way to say so; the driver decides it by peeking whether the
next log entry is that seat's own win).

`options.claims` is _also_ forced on for the duration: `resolveReactions`' ask-loop only ever
suspends for a manual seat when `claims` is set, which is the machinery a log-driven answer needs.
Without it, a live match played entirely by algorithms (`claims` off, the ordinary case) would
replay with every claim silently auto-passed. The one place this needed a second look: once a real,
log-matched answer has settled a discard's claim, every seat still to be asked is provably
irrelevant (seat-order priority) and safe to auto-pass even past the log's own end — and when the
_caller's real_ `options.claims` was off, an unresolved claim at the log's end can never represent a
genuinely pending human decision (that flag gates whether asking ever happens at all), so it always
auto-passes regardless of the wall. Only when the real `claims` was on can the log legitimately end
exactly mid-decision, for the live UI to resume — replay must never invent a pass there (it sets
`missedWin`, poisoning the hand with furiten over a decision nobody made).

Resumable by construction: every entry `replayLog` consumes corresponds to exactly one push onto
`state.log`, so `state.log.length` is always the correct cursor — no separate position has to be
threaded back in, whether resuming a prior call or picking up after real live play.

**Encoding**: `core/actionLog.ts`, one uppercase-kind-letter token per entry, concatenated with no
separator — built on the existing `tileCode`/`parseTenhou`, not a second tile parser.
`Situation.river` → `Situation.log`; `FoldingUrl.discards` → `FoldingUrl.log`. Scoring's wall link is
untouched (no manual seats, nothing decision-shaped to log); its constructed-hand branch likewise.
Shanten stays on seed+hand. mjai export is deferred — a small, separate follow-up once this has
shipped and been exercised.

## Consequences

- A link reproduces the exact hand that was played, forever, regardless of what any seat's
  algorithm is set to today.
- `fromDrawn`/riichi intent finally has a real carrier through replay; the old identity-comparison
  heuristic is gone from `useTableRound.ts` and `useFoldingRound.ts`.
- Old `river=`/`discards=` links stop decoding to anything useful — accepted per
  [ADR-0020](0020-no-back-compat-pre-release.md).
- `useTableRound.ts#buildRound` and `useFoldingRound.ts#buildRound` both need a tail
  (`goRound`+`beginTurn`, guarded on `hand.drawn === undefined`) to reach the next live decision
  point once replay is exhausted — `replayLog` only ever reconstructs what's _in_ the log.
  `useTableRound.ts` additionally has to recognise a log that ends exactly where `stopAtTenpai`
  would have stopped a live round, or its own tail would silently keep playing a round a real
  session never reached.

## Amended by ADR-0012

`replayLog` takes an optional event sink and reports what each restored turn really emitted —
the same `MatchEvent` shapes a live turn produces, since it drives `beginTurn`/`finishTurn`/
`answerClaim` to do the replaying. Synthesizing those from `LogEntry` was never possible anyway: a
logged call carries a `Call`, not the `Meld` it becomes, and a logged win carries no `WinRecord` at
all. `useMatch` passes them to its consumers tagged `replaying: true` rather than suppressing them,
so a trainer rebuilds state from one event stream and only grading and logging skip them
([ADR-0012](0012-shared-table-layer.md)).

## Rejected

- Collapsing `MatchState.discards` into `MatchState.log` — real simplification, real risk (touches
  `danger.ts`, the tile census, `threatViews`), not needed for this phase's goal.
- Inventing a `kakan` log kind for symmetry with mjai's vocabulary — nothing in this engine models
  one; a vocabulary word for an action that can never fire is the same placeholder mistake
  [ADR-0009](0009-decision-seam.md) already rejects elsewhere.
- A version marker on the new link format — no back-compat while pre-release
  ([ADR-0020](0020-no-back-compat-pre-release.md)).
