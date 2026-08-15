# ADR-0010 — Permissions are match-wide flags on `MatchOptions`; legality → choice → prompt

**Status:** Accepted · **Date:** 2026-08-15
**Source:** `core/match.ts#MatchOptions`; commit `bc276b3` (the efficiency trainer's row)

## Context

"Can this seat pon?" has three different answers depending on what is being asked: is it legal in
this match at all, does this algorithm want to, and should the reader be interrupted about it.
Collapsing them into one per-seat permission set makes each of the three unanswerable.

## Decision

**Four flat flags on `MatchOptions`, each shared by every seat**, never renamed, never `Table`
props:

| Flag     | Gates                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| `wins`   | `tryWin` itself — the sole win evaluator. `false` blocks ron **and** tsumo for every seat and drops the ron entry from `claimOptions` outright |
| `calls`  | Whether an AI algorithm may pon/chi at all                                                  |
| `riichi` | `canDeclareRiichi`, for AI and manual seats alike                                            |
| `claims` | Whether a **manual** seat is *asked* about another seat's discard                            |

**The layering is the point:** **legality** (`MatchOptions`) → **choice** (the `Algorithm`) →
**prompt** (`claims`, manual seats only). With `wins: false` the engine never even asks
`Algorithm.win`.

Per-trainer rows follow from that: `wins: false` is what folding's `opponentWins: false` and the
efficiency trainer's hardcoded value reach (ending a per-turn drill on someone else's tsumo would
cut it short). The efficiency trainer also runs `riichi: false` — it reads no danger, so an
opponent's riichi there was decoration, not signal.

Daiminkan is never offered to anyone: the engine models no called kan at all, so offering it to
one manual seat alone would be the one call no algorithm could answer. A manual seat's own tsumo
is never an explicit choice either — `beginTurn` wins the instant the draw completes the hand.

## Consequences

- `Table` learns nothing about permissions and stays a pure view
  ([ADR-0014](0014-table-is-a-pure-view.md)).
- A trainer that wants no manual riichi has to turn it off for the AI too. That is a known,
  accepted coarseness; whether these four need a finer per-algorithm split is an open question,
  tracked in `docs/STATUS.md`.

## Rejected

Per-seat call permissions. An algorithm that "can't pon" expresses that in its own logic —
`defense.call` returns `null` — not in a permission set `Table` would then have to learn about.
