# ADR-0036 — Probability sits beside the tiers, and every number is measured or derived

**Status:** Accepted · **Date:** 2026-08-27
**Amends:** [ADR-0004](0004-ordinal-danger.md) (lifts its project-wide ban on deal-in rates and
win-rate modelling; its ordinal tier model and its grading rule are untouched and stay in force)
**Source:** `core/dealIn.ts`, `core/probability.ts`, `core/hououPrior.ts`,
`scripts/build-ev-models.mjs`, `plans/PLAN-ev-model.md`

## Context

ADR-0004 put expected value, deal-in probabilities, win-rate modelling and push/fold grading out
of scope **project-wide**, on one argument: _a number typed in from memory becomes a number the
reader learns_. That argument was right and it has not weakened. But the ADR also named the
condition under which the work becomes admissible — _measure_ the rates rather than writing them
down — and it has carried a **TO REVIEW** flag since it was written.

Two things have since changed. A five-year Tenhou houou database has a public analysis
(`chienshyong/houou-statistics`, forked from the MIT-licensed `Euophrys/houou-analysis`) whose
`results/` CSVs are exactly those measurements. And `src/core/shanten.ts`'s per-suit group cache
makes ~1.7M shanten probes a second, which is what puts an exact dynamic program over the unseen
tiles inside a browser's budget at all.

So the question is no longer "may we show a probability" but "on what terms". The terms are what
this ADR fixes.

## Decision

**Two new pure engine modules, additive, read by nothing.** `core/dealIn.ts` answers how likely a
tile is to deal into a declared seat; `core/probability.ts` answers how often a hand finishes and
what it pays. `danger.ts`, `policy.ts`, `algorithm.ts` and `round.ts` are untouched, and
`round.golden.test.ts` does not move.

**No number is written down.** Every figure is one of three kinds, and which kind it is has to be
visible at the place it lives:

1. **Derived** — combinatorics over what nobody has seen. The whole of `probability.ts`, and the
   availability half of `dealIn.ts`.
2. **Measured** — extracted from published data by a committed script, with the source, the pinned
   commit and the retrieval date in the file's own header. `npm run build-ev-models` fetches
   `results/WaitDistribution.csv` at commit `80dc535` and emits `core/hououPrior.ts`, so the
   tables are a reproducible build artifact rather than hand-copied numbers.
3. **Stated** — a chosen constant, in hand-written code, named as chosen. There is exactly one:
   `KOKUSHI_SHARE` in `dealIn.ts`, because the source analyzer folds kokushi into a `complex waits`
   bucket it does not break down. It follows the `TIER_SCORE` precedent: one visible place, tuned
   there, never scattered.

**The tier model is not replaced.** `assessDiscards` and its `rank === 0` grading stay exactly as
ADR-0004 specifies, and the folding trainer grades on tiers by default, permanently. The two
describe the same game at different resolutions, and `dealIn.test.ts` pins that they agree on the
cases where a tier is unambiguous — genbutsu below kabe below double suji below non-suji. That
cross-check is the guard that they have not drifted into describing different games.

**Calibration is against data, not against rules of thumb.** `DorasobaDanger.csv` measures how
often a riichi waits on each rank directly, by a different analyzer over the same database from
the wait-_shape_ counts the prior is built from, so the model's unconditional answers are checked
against it: agreement is within 10% for ranks 1-8 and 20% at rank 9, where the source is itself
asymmetric. A model that only agreed with itself would have proved nothing.

**A number with a correction missing does not get a percent sign.** `Outlook.soloWin` is the
probability a hand completes _with nobody else at the table_. Two corrections stand between it and
a riichi win rate — a hazard curve, because the hand can end before your draws run out, and a ron
uplift, because this model counts only self-draws. They are individually far larger than their
difference and they happen to nearly cancel around turn 9, which is a coincidence of magnitudes:
the raw figure runs ~11% below the published rate at turn 3 and ~20% above it at turn 12. Neither
correction exists yet, so `Outlook` ships **no** corrected field at all, rather than a plausible
one with nothing behind it.

**Two priors ship, side by side.** `UNIFORM_PRIOR` is availability alone — pure combinatorics a
reader can re-derive from first principles with no data. `HOUOU_PRIOR` is the measurement. Each is
addressable on its own, and the difference between the two answers is the lesson, not an
embarrassment to be hidden behind whichever is better.

## Consequences

- A trainer can eventually say _this discard deals in 5.4% of the time, and here is each shape
  that could be waiting on it_ — with the crossed-out shapes shown, which is the sentence the tier
  model structurally cannot produce.
- The exactness ceiling is real and stated: a fourteen-way ranking is ~10ms at tenpai and ~89ms at
  2-shanten, and past that `Outlook.exact` is `false` and a collapsed chain runs instead.
- Anything consuming `probability.ts` must name which objective it optimised. Win probability,
  tenpai probability and expected score pick different discards, and a grader that hides which one
  it used feels arbitrary at exactly the moments it is most right.
- ADR-0004's **TO REVIEW** flag is discharged by this ADR rather than by editing it.

## Rejected

**Folding the corrections into the recurrence.** Fitting a hazard constant inside an exact
computation is precisely the failure mode ADR-0004 was written against. The corrections belong
outside it, applied to its output, where they can be seen.

**One memo shared across all fourteen candidates of a ranking.** `plans/EV-1` §9 asked for it at a
measured 25-30% saving. It is unsound: two candidates that discarded different tiles reach the
same hand having drawn different things to get there, so their unseen pools differ, and sharing
would let whichever ran first answer for the rest. What is shared instead is everything depending
on the hand alone — improving tiles, best discards, leaf scores — which is where the shanten
probes actually are, and which is worth 5.4x rather than 30%.

**Marginalising the shanpon prior to a per-rank column.** A shanpon waits on two kinds at once,
and one-wait hypotheses carrying the same mass reproduce the source's own wait width as 1.61 kinds
against its true 1.78. The wait-pair matrix is kept whole and reproduces it exactly.

**Monte Carlo.** Available to every comparable engine and not to us: ADR-0009 makes purity a hard
rule so that a match reproduces from its seed. It turns out to be a feature — a sampled number has
no terms to show, and showing the terms is the entire point of preferring a formula to a network
that would be more accurate.

**Fetching the log database.** The CSVs are the output of upstream's Python analyzers over ~8 GB
of raw Tenhou logs. Re-running them would reproduce numbers already committed upstream. The
database is only worth fetching for work over the raw logs — backtesting our own model against
real decision points — which is a session of its own, not a build step.
