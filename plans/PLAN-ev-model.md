# PLAN — a statistical EV model: formulas first, empirical second

Companion documents, all in `plans/`:

| File                             | What it holds                                                      |
| -------------------------------- | ------------------------------------------------------------------ |
| `EV-1-win-probability.md`        | The offense model — one-player-mahjong DP, exact and approximate   |
| `EV-2-deal-in-probability.md`    | The defense model — wait-hypothesis enumeration                    |
| `EV-3-push-fold-ev.md`           | The decision model the first two feed                              |
| `EV-4-sources-and-findings.md`   | Every source consulted, and the findings that did not fit elsewhere |
| `EV-5-shortcomings-and-open.md`  | What the models get wrong, and what is undecided                   |

---

## Context

The trainer grades efficiency on ukeire and danger on ordinal tiers. Neither answers the question a
player actually has — *what is this discard worth?* — and
[ADR-0004](../docs/adr/0004-ordinal-danger.md) put expected value, deal-in probabilities and
win-rate modelling out of scope project-wide, on the grounds that a number typed in from memory
becomes a number the reader learns.

The published AI reviewers (NAGA, Mortal, MAKA) answer it, disagree with each other, and cannot
explain themselves — a neural policy has no term to point at. This wave asks whether a *formula*
can: something less accurate than the best network, but whose every number decomposes into terms a
reader can check. That decomposition is the whole point, and it is the foundation the statistical
lab needs before it can show anything.

The answer is yes, with a boundary that is narrower than it first looked. The measurements below
were taken in this session, against a verbatim port of this repo's own `src/core/shanten.ts`, and
they **revise downward** what an exact model can do at interactive speed.

## Verdict, in one table

| Layer                | Pure formula                                          | What empirical data adds                                        |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Win probability / EV | Exact one-player-mahjong DP over the unseen tiles      | Two corrections: hazard (the hand can end first) and ron uplift |
| Deal-in probability  | Wait-hypothesis enumeration, weighted by availability  | A prior over wait shapes — players do not hold shapes uniformly |
| Push/fold            | `EV(push) − EV(fold)` over the two above               | Nothing new; arithmetic on the first two                        |

The offense layer needs **no priors** — it is exact combinatorics over what nobody has seen. The
defense layer needs exactly one prior table, and that table is published, measured over 893,440
games, and broken down per waited tile rank.

## The measured boundary

Full 14-way discard ranking, advance-only DP, one memo shared across all candidates:

| Root hand  | Distinct hand nodes | Time for the whole ranking |
| ---------- | ------------------- | -------------------------- |
| tenpai     | 53                  | **0.7 ms**                 |
| 1-shanten  | 394                 | **12 ms**                  |
| 2-shanten  | 1 890               | **84 ms**                  |
| 3-shanten  | 29 902              | **1.77 s**                 |

Sharing the memo across candidates buys ~25–30% of both nodes and time over a per-candidate memo.

The *fuller* DP — the one that also follows draws which keep shanten but widen the wait — is not
viable in JavaScript at all: **1.4 s for a single root at 1-shanten**, 8.8 s at 2-shanten, 17.9 s at
3-shanten, each at a depth of only three improvements. See `EV-1` §6.

**Therefore: exact ≤ 2-shanten for anything interactive; 3-shanten is an on-demand, off-thread
answer; 4-shanten and beyond must use the collapsed chain.** This supersedes the "exact ≤3-shanten"
figure agreed before the measurement, which was a per-root number mistaken for a per-ranking one.

## Decisions settled

| Question               | Decision                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Scope of this wave     | Documents only. No code                                                                                  |
| Priors                 | **Both**, side by side: a pure-combinatorial weighting and an empirical one, each addressable on its own  |
| Relationship to danger | `danger.ts` untouched. The new model sits beside it; folding keeps grading on `rank === 0` by default     |
| Exactness ceiling      | Exact ≤ 2-shanten interactive, 3-shanten on demand, collapsed beyond                                     |
| Efficiency algorithm   | Stays ukeire-only, by definition. EV is a *different* algorithm reading both layers                      |
| Currency               | Points EV, never placement EV — the engine models no round sequencing ([ADR-0023](../docs/adr/0023-round-inside-match.md)) |

Recorded for later, raised during planning: an advanced setting letting the folding trainer grade on
probability instead of tier, and an EV trainer as a sibling of the efficiency trainer. Both want
these models to exist and be calibrated first.

## What the next wave would build

Not part of this one. Listed so the documents have a target to be a specification *for*.

1. `src/core/probability.ts` — the offense DP (`EV-1` §9 gives the signatures).
2. `src/core/dealIn.ts` — the defense enumeration (`EV-2` §10).
3. The empirical prior table with its provenance header, extracted from
   `chienshyong/houou-statistics`.
4. A fourth `SeatAlgorithm`, `'ev'` — one object literal plus one union member, zero engine edits
   ([ADR-0009](../docs/adr/0009-decision-seam.md)).
5. A new ADR superseding ADR-0004; `CLAUDE.md`, `docs/STRUCTURE.md` and `docs/STATUS.md` updates.

## Out of scope, deliberately

- **Neural anything.** Permanent.
- **An in-repo simulation harness for priors** — the published measurement is better data than this
  engine's own naive `efficiency` seats would generate.
- **Touching `danger.ts`, `policy.ts`, `algorithm.ts` or `round.ts`** while the models are being
  built. They are additive modules until something reads them.

## Deferred, not excluded

- **Placement / pt EV.** Genuinely wanted — it is what akochan optimises and it is the currency in
  which most real riichi decisions are argued. It is **gated on round sequencing**, which
  [ADR-0023](../docs/adr/0023-round-inside-match.md) currently rules out: no `nextRound()`, no
  dealer rotation, no honba increment, no payouts, no end-of-match detection. So the ordering is
  sequencing first, placement EV second, and points EV in the meantime — see `EV-3` §8, which is
  written as a prerequisite rather than a refusal. Whether sequencing lands is a separate decision
  with its own ADR, and it is a bigger one than this whole model.

## For the next session

The state this session leaves behind, so the next one does not re-derive it:

- **Settled and measured:** the cost boundary (§ above), the two recurrences (`EV-1` §4), the
  hypothesis enumeration and its single furiten rule (`EV-2` §3–4), the extracted wait-shape prior
  and its indexing convention (`EV-2` §7), the availability-ratio correction (`EV-2` §8).
- **Decide first, before any code:** the licence question (`EV-5` §2.1) — it blocks the empirical
  layer and nothing else; and the default objective (`EV-5` §2.4), because it changes what the
  module's signature even means.
- **Biggest unbuilt piece:** pricing a fold over the *rest of the hand* rather than one turn
  (`EV-3` §5, `EV-5` §1.8). Until it exists, push and fold cannot honestly be compared.
- **Cheapest first build:** `EV-2`. It is microseconds, it needs no DP, its validation check
  (implied wait width ≈ 1.773 kinds) is one line, and it is the half that produces the sentences
  the statistical lab was asked for.
