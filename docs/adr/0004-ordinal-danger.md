# ADR-0004 — Danger is ordinal; no EV, deal-in rates, or push/fold grading

**Status:** Accepted · **TO REVIEW** · **Date:** 2026-08-12
**Source:** `core/danger.ts` (the model's own opening comment)

## Context

Published betaori tables exist, and it is tempting to show "this tile deals in 5.2% of the time".
But a number typed in from memory becomes a number the user *learns*. The repo has no simulation
harness to derive real rates from, and inventing one is worse than showing none.

## Decision

`assessDiscards(hand, threats, visible, sanma)` ranks tiles into **ordinal tiers**, safest first:
`genbutsu`, `noChance`, `oneChance`, `doubleSuji`, `suji`, `honour`, `halfSuji`, `nonSuji`.
Grading is tier ordering — `rank === 0`, never list position, with ranks **dense** over the score
(equal score ⇒ equal rank). `TIER_SCORE` is one table, deliberately: it is the calibration knob
for the whole trainer, so it is tuned there and the numbers are never scattered.

Judged on **public information only** — what a threat actually holds is never consulted, which is
what makes a correct-but-unlucky discard still grade correct.

**Out of scope, project-wide:** expected value, deal-in probabilities, win-rate modelling, and
grading the push/fold decision itself. If real rates are ever wanted, *measure* them by simulation
over the reachable hand space; do not type them in.

## Consequences

- The folding trainer can say "this was correct, and you still dealt in" honestly.
- Partial credit exists without probabilities: `(worst - yours) / worst` over `dangerScore`.
- The trainer cannot answer "should I have folded at all", and says so on screen rather than
  guessing.

## Rejected

A push/fold control in the folding trainer. Grading it needs an EV model this codebase does not
have; adding the control without the model would grade a coin flip.
