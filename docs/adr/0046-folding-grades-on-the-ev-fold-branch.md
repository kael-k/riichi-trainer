# ADR-0046 — Folding can grade on the EV model's fold branch, behind Advanced

**Status:** Accepted · **Date:** 2026-08-28
**Amends:** [ADR-0004](0004-ordinal-danger.md) — lifts its "grading the push/fold decision itself"
line for this one case; the ordinal tier model stays the permanent default and is otherwise
unchanged.
**Builds on:** [ADR-0037](0037-the-ev-seat-decides.md) (the model that may not borrow),
[ADR-0044](0044-every-decision-is-priced.md) (every decision priced through one identity),
[ADR-0036](0036-probability-beside-the-tiers.md) (the coexistence this settles the timing of)
**Source:** `core/ev.ts#foldRanking`, `core/table.ts#foldRankingOf`, `features/folding/evGrade.ts`,
`plans/EV-5` §2.5 and §2.8

## Context

`plans/EV-5` §2.5 specified a two-threshold grading band for a probability-graded trainer, and §2.8
resolved that folding keeps grading on tiers by default, permanently, with a future wave adding an
Advanced option to grade on the EV model instead. Both were left open because nothing consumed
`core/ev.ts` from a trainer yet.

Two questions had to be settled before that wave could ship: which of the identity's numbers a
fold-only drill should read, and whether the trainer may compute anything of its own.

## Decision

**The grade is `core/ev.ts#foldRanking`, and the trainer computes no arithmetic of its own.**
`foldRanking(view, opts)` prices every held tile under the fold branch alone — no win term, no
`'tenpai'` term, since a fold is noten by construction — and returns the same `DiscardEv[]` shape
`rankDiscards` does. `foldingUseRound.ts` calls it directly (through `core/table.ts#foldRankingOf`,
mirroring `evOf`'s own on-demand shape) and reads the number back; if the EV model's arithmetic
moves, the trainer's grades move with it, because there is nothing else to move.

This is also what keeps `houou` gradeable at all. It is an empirical model with no closed form —
its `dealInCost`/`giveUpCost` are table lookups — so a formula written in the trainer could not
reproduce it without becoming a second, unchosen model (the borrowing rule ADR-0037 states).
Reading the identity's own output sidesteps the question rather than answering it awkwardly.

**Only the fold branch, never the push branch.** The drill's board is generated to be a fold — someone
is in riichi, the graded seat is not tenpai — so "should I even be folding" is a question this board
was never built to ask. `rankDiscards` (the push branch, exhaustive) would also run the win DP per
candidate, at roughly 200ms a turn against `foldRanking`'s milliseconds, for a term that is
irrelevant to a hand that has already lost the race.

**Two-threshold band, per-model, Advanced-only, provisional.** `EvBands { near, wrong }` — `Δ ≤
near` grades correct, `near < Δ ≤ wrong` grades partial, beyond `wrong` grades wrong — stored per
`EvModelName` in `Settings['folding'].evBands` so switching models keeps each one's own calibration.
Defaults (`EV_GRADE_BANDS`) are sized off `evGrade.bench.test.ts`'s measured spread of real fold
turns rather than guessed at the keyboard, and are explicitly provisional: `plans/EV-5` §2.13's
backtest is what would turn them into a measured number, and re-fixing them needs no further ADR.
The whole mode is read through `useAdvancedSettings` (`evGrading: advanced && settings.evGrading`),
so a hidden settings row cannot leave a live mode running unseen.

**Tiers stay the evidence underneath EV's verdict.** When EV grading is on, `correct`/`quality`
come from `gradeEv`, but the log row keeps the existing "Your tile — Suji" / "Safest tile —
Genbutsu" lines below the EV band line and its bars — the vocabulary the trainer otherwise teaches
is not deleted, only outranked for the verdict itself.

**The band line and bars are the "show the band it graded against" requirement**, not a
convenience: one `LogDetail.bars` field (a tile, its value, and a fraction normalized on the
ranking's own best entry) renders every candidate as a small bar chart, so a reader can see not
just whether they were right but by how much, and against what.

## Consequences

- A model change (a recalibrated `houou` extraction, a fixed `statistical` derivation) moves what
  folding grades, with no code in the trainer to also update.
- `foldEv` (the branch price the push/fold comparison already reads) is untouched — `foldRanking`
  is a new function beside it, not a rewrite, so `EV_GOLDEN` does not move and no algorithm's
  decisions changed.
- The whole feature, plus `/match` and the two `'ev'` algorithm entries, is marked **alpha** in the
  UI: none of the three has been calibrated against real play, and `plans/EV-5` §2.13's backtest is
  still open.
- `Settings['folding']` gained three keys (`evGrading`, `evModel`, `evBands`); the section-wise
  persist merge already covers them, so no version bump was needed.

## Rejected

- **Reading the push branch instead.** Answers a question ("should you be folding") the drill's own
  generation never asked, at DP cost the fold-only context does not need.
- **A formula in the trainer approximating both models.** Would be the third, unchosen model
  ADR-0037 already rejected once; `houou`'s tables have no formula to approximate in the first
  place.
- **A single ε pair for both models.** `houou`'s measured deal-in costs run at roughly double
  `statistical`'s derived ones (`core/evModel.ts#TYPICAL_CLOSED_YAKU_HAN`'s own note), so one band
  would be permanently miscalibrated for one of the two.
