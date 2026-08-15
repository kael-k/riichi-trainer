# Architecture decisions

One decision per file. Short, dated, and never edited once accepted — a decision that moves gets
a **new** ADR that supersedes the old one, and the old one gains a `Superseded by` line and
nothing else. The trail is the point.

Write an ADR when a question is *closed*: when the answer is not derivable from the code, when a
plausible alternative was rejected for a reason worth not re-deriving, or when someone is likely
to propose the opposite next month. Do not write one for what the code plainly says.

## Status legend

- **Accepted** — in force; the code implements it.
- **Superseded** — replaced; kept for the trail. Names its replacement.
- **Deferred** — deliberately not done; recorded so it stops being re-proposed.
- **TO REVIEW** — in force, but flagged: the decision has not been read back and agreed by the
  project owner, or the reasoning is suspected of having drifted. Carries no less weight in the
  code than Accepted; it is a reading queue, not a warning label.

## Index

### Engine and domain

| ADR                                                         | Title                                                        | Status    |
| ----------------------------------------------------------- | ------------------------------------------------------------ | --------- |
| [0001](0001-three-layers.md)                                | Three layers: pure engine, URL codec, React trainers         | Accepted  |
| [0002](0002-determinism-and-tenhou-notation.md)             | Determinism, and tenhou notation as the interchange format   | Accepted  |
| [0003](0003-hand-counts-only.md)                            | `Hand` stores counts; redness travels beside it              | **TO REVIEW** |
| [0004](0004-ordinal-danger.md)                              | Danger is ordinal — no EV, deal-in rates, or push/fold grading | **TO REVIEW** |
| [0005](0005-walls-not-seeds.md)                             | Boards are shared as explicit validated walls, not seeds     | Accepted  |
| [0006](0006-one-match-engine.md)                            | One match engine; trainers differ only by stop condition     | Accepted  |

### Seats and algorithms

| ADR                                                         | Title                                                        | Status    |
| ----------------------------------------------------------- | ------------------------------------------------------------ | --------- |
| [0007](0007-every-seat-is-a-player.md)                      | Every seat is a player; a player has an algorithm            | Accepted  |
| [0008](0008-algorithms-are-live.md)                         | Algorithm changes are live and never change the hand         | Accepted  |
| [0009](0009-decision-seam.md)                               | The decision seam: `ALGORITHMS` over a curated `SeatView`    | Accepted  |
| [0010](0010-match-wide-permissions.md)                      | Permissions are match-wide flags on `MatchOptions`           | Accepted  |
| [0011](0011-at-least-one-manual-seat.md)                    | At least one seat stays manual                               | Accepted  |

### App layer

| ADR                                                         | Title                                                        | Status     |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ---------- |
| [0012](0012-shared-table-layer.md)                          | Shared `core/table.ts` + `useTableRound`; folding keeps its own hook | **TO REVIEW** |
| [0013](0013-efficiency-split.md)                            | Efficiency splits into two routes; solo is one seat, no board | **TO REVIEW** |
| [0014](0014-table-is-a-pure-view.md)                        | `<Table>` is a pure view with no player concept              | Accepted   |
| [0015](0015-what-persists.md)                               | Reader preferences persist; board state does not             | Accepted   |
| [0017](0017-imperative-log-rows.md)                         | Log rows are written imperatively, never from effects        | Accepted   |

### Process and product

| ADR                                                         | Title                                                        | Status    |
| ----------------------------------------------------------- | ------------------------------------------------------------ | --------- |
| [0016](0016-testing-strategy.md)                            | Testing: a reference implementation, a census, a golden hash | Accepted  |
| [0018](0018-beginner-defaults-advanced-depth.md)            | Beginner-safe defaults, advanced depth behind settings       | Accepted  |
| [0019](0019-mobile-first-board.md)                          | Mobile-first: a square board and fullscreen as a place       | Accepted  |
| [0020](0020-no-back-compat-pre-release.md)                  | No backward compatibility while pre-release                  | Accepted  |

Numbering runs 0001–0020 with no gaps. Next new ADR is 0021 — take the next free number and do not
reuse one, even if an ADR is later withdrawn.

## Template

```md
# ADR-NNNN — Title in the imperative

**Status:** Accepted · **Date:** YYYY-MM-DD
**Source:** where the decision was settled

## Context
The forces. What made this a question at all.

## Decision
What was decided, in one or two sentences, plus the code that carries it.

## Consequences
What this buys, and what it costs.

## Rejected
The alternative, and why it lost. This is the half that stops re-litigation.
```
