# ADR-0046 — Folding and efficiency can grade on the EV model, behind Advanced

**Status:** Accepted · **Date:** 2026-08-28
**Amends:** [ADR-0004](0004-ordinal-danger.md) — lifts its "grading the push/fold decision itself"
line for folding's own case; the ordinal tier model stays the permanent default and is otherwise
unchanged. Efficiency's own ukeire grading (`ADR-0013`) is likewise unaffected — it stays the
permanent default there too.
**Builds on:** [ADR-0037](0037-the-ev-seat-decides.md) (the model that may not borrow),
[ADR-0044](0044-every-decision-is-priced.md) (every decision priced through one identity),
[ADR-0036](0036-probability-beside-the-tiers.md) (the coexistence this settles the timing of)
**Source:** `core/ev.ts#foldRanking`, `core/table.ts#foldRankingOf`/`pushRankingOf`,
`features/table/evGrade.ts`, `features/folding/grade.ts`/`useFoldingRound.ts`,
`features/efficiency/grade.ts`/`useEfficiencyDrill.ts`, `plans/EV-5` §2.5 and §2.8

## Context

`plans/EV-5` §2.5 specified a two-threshold grading band for a probability-graded trainer, and §2.8
resolved that folding keeps grading on tiers by default, permanently, with a future wave adding an
Advanced option to grade on the EV model instead. Both were left open because nothing consumed
`core/ev.ts` from a trainer yet. Efficiency asked the analogous question of its own ukeire model
once folding's wave landed: the same identity, read from the push side instead of the fold side,
since efficiency's board is never a fold in the first place.

Three questions had to be settled: which of the identity's numbers each drill should read, whether
either trainer may compute anything of its own, and how much of the answer the two trainers could
share rather than each inventing their own.

## Decision

**Each trainer reads its own branch of `core/ev.ts`, and computes no arithmetic of its own.**
Folding reads `foldRanking(view, opts)` — every held tile priced under the fold branch alone, no
win term and no `'tenpai'` term since a fold is noten by construction. Efficiency reads
`rankDiscards(view, { ...opts, exhaustive: true })` — the push branch, forced exhaustive rather than
the candidate union an `'ev'` seat plays with, because efficiency's own request is "rate every
possible discard" rather than "decide cheaply". Both return the same `DiscardEv[]` shape and are
read through a matching on-demand accessor in `core/table.ts` (`foldRankingOf`/`pushRankingOf`,
`evOf`'s own shape) rather than a formula either feature writes: if the EV model's arithmetic moves,
both trainers' grades move with it, because there is nothing else to move.

This is also what keeps `houou` gradeable at all. It is an empirical model with no closed form —
its `dealInCost`/`giveUpCost`/`winValue` are table lookups — so a formula written in a trainer could
not reproduce it without becoming a second, unchosen model (the borrowing rule ADR-0037 states).
Reading the identity's own output sidesteps the question rather than answering it awkwardly.

**Only one branch each, never both.** Folding's board is generated to be a fold — someone is in
riichi, the graded seat is not tenpai — so "should I even be folding" is a question that board was
never built to ask. Efficiency's ruleset runs `riichi: false` and grades exactly the discard/kita/
kan a hand needs to reach tenpai, so a fold branch would answer a question this drill's rules make
unreachable. Each trainer prices only the branch its own premise is about.

**The grading band, and the code that draws it, are one shared module** (`features/table/evGrade.ts`
— not either trainer's own folder, since neither owns the concept). `EvBands { near, wrong }` — `Δ
≤ near` grades correct, `near < Δ ≤ wrong` grades partial, beyond `wrong` grades wrong — and
`gradeEv`/`evBandDetail` are generic over any `DiscardEv[]` ranking, so the exact same functions
grade a fold turn and a push turn. What differs is the **table**: `FOLD_EV_BANDS` and
`PUSH_EV_BANDS`, both per-`EvModelName`, both sized off the same `evGrade.bench.test.ts` measuring
each branch's own real spread rather than guessed at the keyboard — a push ranking carries the win
term the fold branch never does, so its spread runs noticeably wider (`statistical`
763/1102/1408/1840 at p25/median/p75/p90, against the fold branch's 323/410/586/1036), and a shared
table would be permanently miscalibrated for one of the two. Both are explicitly provisional:
`plans/EV-5` §2.13's backtest is what would turn them into measured numbers, and re-fixing either
needs no further ADR. Each is stored per-trainer (`Settings['folding'].evBands`,
`Settings['efficiency'].evBands`) so a reader's own recalibration of one never moves the other, and
each is read through `useAdvancedSettings` (`evGrading: advanced && settings.<trainer>.evGrading`),
so a hidden settings row cannot leave a live mode running unseen.

**Efficiency's push branch prices only a plain discard, never kita or kan.** Those are themselves
the call being evaluated — pricing a kita pull or an ankan through the identity is
`core/ev.ts#kitaWorthIt`/`bestKan`'s job, already built for an `'ev'` seat, not this trainer's own
grading pass. A stated ceiling: a kita/kan is still graded on ukeire exactly as before, EV grading
or not.

**Efficiency's EV grade collapses to a binary ok/error, never reusing `'warning'`.** Ukeire grading's
`'warning'` already means one specific thing — a discard that tied ukeire's best while passing up a
free kan/kita — and reusing it for "close in EV but not quite" would conflate two different
questions on one field. `missed` (the free-call detection) still rides on the ukeire pass
underneath, unaffected by which grading mode picked the verdict; the finer partial credit an EV
near-miss deserves lives in `TurnResult.ev.quality` instead, which both `useSessionStats.record`'s
partial-credit argument and the compact verdict's severity read (`efficiencyVerdictSeverity` bands
on it exactly where `foldingVerdictSeverity` bands on its own `quality`).

**Tiers/ukeire stay the evidence underneath EV's verdict, in both trainers.** When EV grading is on,
the verdict comes from `gradeEv`, but the log row keeps the existing tier lines (folding) or ukeire
totals (efficiency) below the EV band line and its bars — the vocabulary each trainer otherwise
teaches is not deleted, only outranked for the verdict itself. This is also what "include the
ukeire in the detailed logs" meant in practice: efficiency's ukeire lines were never removed, EV
grading only adds to what the row already showed.

**The band line and bars are the "show the band it graded against" requirement**, not a
convenience: one shared `evBandDetail`, one `LogDetail.bars` field (a tile, its value, and a
fraction normalized on the ranking's own best entry), one locale key (`log.evBand`) — so the
wording and the bar chart read as one convention across both trainers rather than two.

## Consequences

- A model change (a recalibrated `houou` extraction, a fixed `statistical` derivation) moves what
  both trainers grade, with no code in either trainer to also update.
- `foldEv` (the branch price folding's own push/fold comparison already reads) and `chooseAction`'s
  ukeire path are both untouched — `foldRanking` and the EV override are new code beside them, not
  rewrites, so `EV_GOLDEN`/`GOLDEN` do not move and no algorithm's decisions changed.
- The whole feature — both trainers' EV grading options, `/match`, and the two `'ev'` algorithm
  entries — is marked **alpha** in the UI: none of the four has been calibrated against real play,
  and `plans/EV-5` §2.13's backtest is still open.
- `Settings['folding']` and the reintroduced `Settings['efficiency']` each gained three keys
  (`evGrading`, `evModel`, `evBands`); the section-wise persist merge covers both, so no version
  bump was needed. `Settings['efficiency']` existed once with an unrelated shape and was removed
  when nothing read it (`docs/STATUS.md`) — this is not a revival of that shape, only of the name,
  for a genuinely new reason to have a section there.
- Efficiency's EV grading is **table-only by construction**, not by a flag solo also carries:
  `EfficiencyDrillInput.ev`/`EfficiencyOptions.ev` exist only on the table hook's own types, and
  solo's hook never builds one — there is no setting to accidentally leave on for solo.

## Rejected

- **Reading the other branch in either trainer.** Folding reading the push branch answers "should
  you be folding", a question its generated board never asked; efficiency reading the fold branch
  answers a question its `riichi: false` ruleset makes unreachable. Each trainer's board is built
  around exactly one branch's question.
- **A formula in either trainer approximating both models.** Would be the third, unchosen model
  ADR-0037 already rejected once; `houou`'s tables have no formula to approximate in the first
  place.
- **One shared ε-band table for both branches.** The push branch's spread runs measurably wider
  than the fold branch's (the win term), so a shared table would be permanently miscalibrated for
  one of the two — the grading *code* is shared, the *numbers* are not.
- **Reusing `'warning'` for an EV near-miss in efficiency.** Already means "missed a free call" on
  the ukeire pass; overloading it would make one field answer two unrelated questions.
