# PLAN — a statistical EV model: formulas first, empirical second

Companion documents, all in `plans/`:

| File                            | What it holds                                                       |
| ------------------------------- | ------------------------------------------------------------------- |
| `EV-1-win-probability.md`       | The offense model — one-player-mahjong DP, exact and approximate    |
| `EV-2-deal-in-probability.md`   | The defense model — wait-hypothesis enumeration                     |
| `EV-3-push-fold-ev.md`          | The decision model the first two feed                               |
| `EV-4-sources-and-findings.md`  | Every source consulted, and the findings that did not fit elsewhere |
| `EV-5-shortcomings-and-open.md` | What the models get wrong, and what is undecided                    |

---

## Context

The trainer grades efficiency on ukeire and danger on ordinal tiers. Neither answers the question a
player actually has — _what is this discard worth?_ — and
[ADR-0004](../docs/adr/0004-ordinal-danger.md) put expected value, deal-in probabilities and
win-rate modelling out of scope project-wide, on the grounds that a number typed in from memory
becomes a number the reader learns.

The published AI reviewers (NAGA, Mortal, MAKA) answer it, disagree with each other, and cannot
explain themselves — a neural policy has no term to point at. This wave asks whether a _formula_
can: something less accurate than the best network, but whose every number decomposes into terms a
reader can check. That decomposition is the whole point, and it is the foundation the statistical
lab needs before it can show anything.

The answer is yes, with a boundary that is narrower than it first looked. The measurements below
were taken in this session, against a verbatim port of this repo's own `src/core/shanten.ts`, and
they **revise downward** what an exact model can do at interactive speed.

## Verdict, in one table

| Layer                | Pure formula                                          | What empirical data adds                                        |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Win probability / EV | Exact one-player-mahjong DP over the unseen tiles     | Two corrections: hazard (the hand can end first) and ron uplift |
| Deal-in probability  | Wait-hypothesis enumeration, weighted by availability | A prior over wait shapes — players do not hold shapes uniformly |
| Push/fold            | `EV(push) − EV(fold)` over the two above              | Nothing new; arithmetic on the first two                        |

The offense layer needs **no priors** — it is exact combinatorics over what nobody has seen. The
defense layer needs exactly one prior table, and that table is published, measured over 893,440
games, and broken down per waited tile rank.

## The measured boundary

Full 14-way discard ranking, advance-only DP, one memo shared across all candidates:

| Root hand | Distinct hand nodes | Time for the whole ranking |
| --------- | ------------------- | -------------------------- |
| tenpai    | 53                  | **0.7 ms**                 |
| 1-shanten | 394                 | **12 ms**                  |
| 2-shanten | 1 890               | **84 ms**                  |
| 3-shanten | 29 902              | **1.77 s**                 |

Sharing the memo across candidates buys ~25–30% of both nodes and time over a per-candidate memo.

The _fuller_ DP — the one that also follows draws which keep shanten but widen the wait — is not
viable in JavaScript at all: **1.4 s for a single root at 1-shanten**, 8.8 s at 2-shanten, 17.9 s at
3-shanten, each at a depth of only three improvements. See `EV-1` §6.

**Therefore: exact ≤ 2-shanten for anything interactive; 3-shanten is an on-demand, off-thread
answer; 4-shanten and beyond must use the collapsed chain.** This supersedes the "exact ≤3-shanten"
figure agreed before the measurement, which was a per-root number mistaken for a per-ranking one.

## Decisions settled

| Question               | Decision                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope of this wave     | Documents only. No code                                                                                                                                                                                                                                                                                                                                                                      |
| Priors                 | **Both**, side by side: a pure-combinatorial weighting and an empirical one, each addressable on its own                                                                                                                                                                                                                                                                                     |
| Relationship to danger | `danger.ts` untouched. The new model sits beside it; folding keeps grading on `rank === 0` by default                                                                                                                                                                                                                                                                                        |
| Exactness ceiling      | Exact ≤ 2-shanten interactive, 3-shanten on demand, collapsed beyond                                                                                                                                                                                                                                                                                                                         |
| Efficiency algorithm   | Stays ukeire-only, by definition. EV is a _different_ algorithm reading both layers                                                                                                                                                                                                                                                                                                          |
| Currency               | Points EV by default; placement EV is a **switchable objective**, no longer deferred — the placement-odds function is a property of the EV model, not of engine sequencing                                                                                                                                                                                                                   |
| EV model               | The named unit of swappable weights: `statistical` (pure combinatorics) and `houou` (empirical) at build, `ippan` (average-room player) future. **Per-seat and live**, mirroring `PlayerState.algorithm` (ADR-0008); a registry of pure data modules with provenance headers                                                                                                                 |
| Objective × model      | Two orthogonal switches, **both per-seat**: what a seat maximises (points / placement) vs how it estimates probabilities and costs (the EV model). A lab table may mix a points-optimising seat with a placement-optimising one; a drill grades against the graded seat's objective. Under placement, the value function is fixed by the ruleset (Tenhou rank points + uma), not a parameter |
| Decision scope         | The `'ev'` decider prices **every** decision point through the EV identity: discard (push/fold), calls, kita, riichi, win/decline, and kyuushu kyuuhai                                                                                                                                                                                                                                       |
| Evaluator output       | A distribution, not a scalar: `P(win)`, `E[score\|win]`, and a high-value tail, so the decider can re-weight under placement utility without the evaluator knowing table status                                                                                                                                                                                                              |
| Licence (houou data)   | Extract data tables with attribution: the CSVs are measured facts, the analyzer code descends from MIT-licensed `Euophrys/houou-analysis`, and no code is copied. Both repos cited, commit pinned                                                                                                                                                                                            |
| Wait-prior indexing    | Confirmed against `wait_distribution.py` (lowest waited tile); three extraction caveats recorded in `EV-2` §7                                                                                                                                                                                                                                                                                |

Recorded for later, raised during planning: an advanced setting letting the folding trainer grade on
probability instead of tier, and an EV trainer as a sibling of the efficiency trainer. Both want
these models to exist and be calibrated first. The EV trainer grades against the model the
learner's seat runs — `statistical` by default (explainable from first principles, ADR-0018),
switchable under Advanced. Recorded in refinement: the statistical model's three
posture flavours — `balanced` (shipped first), `aggressive`, `defensive` — which change only the
push/fold decision and are deferred (`EV-3` §8); and the lab requirement — the full statistics of
all three EV functions (offense, defense, push/fold) shown per seat under that seat's selected EV
model. Two more recorded ideas: a lab generator that searches for boards where the two EV models'
top discards _disagree_ (the disagreement is the product — `EV-4`), and the backtest validation
session (`EV-5` §2.13).

## What the next wave would build

Not part of this one. Listed so the documents have a target to be a specification _for_.

1. `src/core/probability.ts` — the offense DP (`EV-1` §9 gives the signatures).
2. `src/core/dealIn.ts` — the defense enumeration (`EV-2` §10).
3. The empirical prior table with its provenance header, extracted from
   `chienshyong/houou-statistics` — by a **committed extraction script** that reads the CSVs and
   emits the TS tables (shanpon matrix marginalisation, the `EV-2` §7 caveats, the provenance
   header), so the tables are reproducible build artifacts, not hand-copied numbers.
4. A fourth `SeatAlgorithm`, `'ev'` — one object literal plus one union member, zero engine edits
   ([ADR-0009](../docs/adr/0009-decision-seam.md)). It is the **decider**: it calls the two
   evaluators and applies the objective and the table status (`SeatView.match`, already live).
5. The **EV model registry** (`statistical`, `houou`) and its per-seat plumbing: a `PlayerState`
   field beside `algorithm`, `RoundOptions` seeding, `SeatView` exposure, a `SeatConfig` selector —
   the same path `algorithm` already walks, live flips included.
6. **Kyuushu kyuuhai engine support** — abortive draw (first turn, no calls, 9+ distinct
   terminals/honours) plus a new `Algorithm` decision point. This one _does_ touch `round.ts`, and
   `round.golden.test.ts` hashes move as a deliberate act ([ADR-0016](../docs/adr/0016-testing-strategy.md)).
7. A new ADR superseding ADR-0004; `CLAUDE.md`, `docs/STRUCTURE.md` and `docs/STATUS.md` updates.

## Out of scope, deliberately

- **Neural in the statistical model, or as any number's explanation.** The lab always keeps at
  least one fully decomposable EV model — that is the project's point. Within those limits a
  black-box EV model is admissible: same code interface, browser-feasible, provenance header, and
  a _comparison_ surface, never the explanation. Recorded candidate: the houou placement MLP
  (`util/placement_calculator.py`, ~10k weights, trivial in-browser cost) as the houou model's
  placement-odds function, beside the closed-form integration — choice deferred to build.
- **An in-repo simulation harness for priors** — the published measurement is better data than this
  engine's own naive `efficiency` seats would generate.
- **Touching `danger.ts`, `policy.ts`, `algorithm.ts` or `round.ts`** while the models are being
  built. They are additive modules until something reads them.

## Deferred, not excluded

- **Round sequencing.** Placement EV is **not** gated on it — the placement-odds function belongs
  to the EV model (`EV-3` §8): the houou model derives it from measured final-score distributions
  (`Variance.csv`, `AllLast.csv`), the statistical model computes it as a pure random walk over the
  remaining rounds (derivation owed, `EV-5` §2.10). Sequencing stays deferred because only two
  things need it — full-match trainers and self-derived placement data — and no in-round decision
  needs either. ADR-0023 untouched; that decision is unchanged in size and remains its own ADR.

## For the next session

The state this session leaves behind, so the next one does not re-derive it:

- **Settled and measured:** the cost boundary (§ above), the two recurrences (`EV-1` §4), the
  hypothesis enumeration and its single furiten rule (`EV-2` §3–4), the extracted wait-shape prior
  and its indexing convention — **confirmed against the analyzer source**, caveats included
  (`EV-2` §7) — and the availability-ratio correction (`EV-2` §8).
- **Settled in refinement:** the licence question (`EV-5` §2.1 — extract with attribution), the
  default objective (points; placement a switch), table status as decision-layer input only
  (`SeatView.match`, already plumbed), the EV model as a per-seat live field, every decision point
  priced by EV (kyuushu kyuuhai included, engine support in scope), the evaluator's
  distribution-shaped output, the ruleset compatibility matrix with a UI-explained fallback
  (`EV-5` §2.11), main-thread-first computation (`EV-5` §2.6), tier-by-default folding with a
  future EV-grading option (`EV-5` §2.8), and a settings-configurable grading band (`EV-5` §2.5).
- **Still open:** the pure-statistical placement-odds derivation (`EV-5` §2.10 — owed maths, no
  decision pending, blocks only the placement switch under the statistical model); memo lifetime
  (`EV-5` §2.7 — deferred to a **dedicated benchmark session** producing a measurement script and
  a markdown report; fresh-per-ranking is the build default and the lean); and the posture
  mechanism (`EV-5` §2.12 — each flavour an EV model derived from `balanced`; what each optimises
  is an open investigation, deferred with no risk since `balanced` ships first).
- **Biggest unbuilt piece:** pricing a fold over the _rest of the hand_ rather than one turn
  (`EV-3` §5, `EV-5` §1.8). Until it exists, push and fold cannot honestly be compared.
- **Cheapest first build:** `EV-2`. It is microseconds, it needs no DP, its validation check
  (implied wait width ≈ 1.773 kinds) is one line, and it is the half that produces the sentences
  the statistical lab was asked for.
