# ADR-0039 — The currency is a switch, and an EV seat carries its model as a field

**Status:** Accepted · **Date:** 2026-08-27
**Amends:** [ADR-0037](0037-the-ev-seat-decides.md) on three points — the per-seat EV-model field it
rejected (at the trigger it wrote down), and two of the three ceilings it shipped with. Everything
else in it, the no-borrowing rule above all, is untouched and stays in force.
**Builds on:** [ADR-0036](0036-probability-beside-the-tiers.md),
[ADR-0008](0008-algorithms-are-live.md), [ADR-0023](0023-round-inside-match.md)
**Source:** `core/placement.ts`, `core/ev.ts`, `core/evModel.ts`, `core/policy.ts`,
`core/table.ts`, `features/settings/tableSettings.ts`, `plans/EV-3` §5 and §8, `plans/EV-5` §2.10

## Context

ADR-0037 shipped a decider that prices in points, with the model as a `SeatAlgorithm` key and three
stated ceilings. It also wrote down, in its own Rejected section, the condition under which two of
those choices should change: _a per-seat field earns itself when a second orthogonal switch — the
objective, or a posture — turns the union into a cross product._

`plans/EV-3` §8 is that switch. Points is stable and easy to check; **placement is the currency
real riichi argument happens in**, and it is what makes a hopeless hand in South 4 worth pushing and
a comfortable lead worth protecting. `plans/EV-5` §2.10 left one thing owed before it could ship
under both models: the statistical model may not look up measured finish rates, so it has to derive
them.

Separately, `plans/EV-3` §5 named the largest unbuilt piece in the whole design and stated the gate
plainly: **push and fold cannot honestly be compared while folding is priced one turn at a time.**

## Decision

**The currency is one substitution, not a second identity.** Every term of the push/fold identity is
a probability times a _value_, and `valuer` (`core/ev.ts`) is what a value means. Under `'points'`
it is the identity function and every figure is bit-for-bit what it was. Under `'placement'` it is
the change in expected Tenhou result the swing buys. Nothing below the decision layer knows which,
which is what keeps two models comparable on one board.

**A deal-in term names the seat the points go _to_.** Under points that makes no difference; under
placement, dealing into the seat above you and the seat below you are the same points and are not
the same decision.

**The placement value function is fixed by the ruleset, not a parameter** (`core/placement.ts`):
Tenhou dan-level scoring, 25000 start, 30000 return, uma ±10/±20, and 35000/40000 with +15/0/−15 in
sanma. No free knobs.

**The placement-odds function is a property of the EV model, and the integral is not.** Each model
supplies `swing` — the mean and spread of `final − now` for a seat sitting `n`-th with `r` rounds
behind it — and `core/placement.ts` integrates the seats against each other for rank probabilities.
An integral is not a number either model measured, so sharing it does not breach the no-borrowing
rule; the moments are, and those stay separate. `houou` reads `Variance.csv`, extracted the same
reproducible way as every other measured table. `statistical` derives it: a round of mahjong as one
point transfer, so a seat gains a hand `1/n` of the time, pays it `1/n` of the time and is untouched
otherwise — mean zero, variance `2/n × E[V²]` per round, with `E[V²]` off the same han distribution
`dealInCost` already integrates and a dora term the ruleset alone supplies. That is `plans/EV-5`
§2.10's owed derivation, and it is now paid.

**The EV model moves off `SeatAlgorithm` and onto the seat.** `'ev-statistical'` and `'ev-houou'`
become `'ev'`, and `PlayerState.ev: EvSeat` carries the model and the objective — live in exactly
the way `algorithm` is (ADR-0008), seeded by `RoundOptions.ev`, exposed on `SeatView`, selectable
per seat. This is the trigger ADR-0037 named arriving: two models times two objectives is four
names for one decider, and a cross product is a record.

**Both branches are integrated over the rest of the hand** (`turnRisks`, `laterCost`). The fold
policy throws the cheaper of the safest tile still in hand and the one just drawn, so a folding hand
is **replenished** out of the unseen pool; a held safe tile is spent only on the turns it beats the
draw. Both branches share one walk and one `dealInPrice`, because a push and a fold that disagreed
about what a deal-in costs would not be comparable at all.

## Consequences

- Two of ADR-0037's three ceilings are gone. What remains: a pushing hand may not change its mind
  mid-sequence — it is priced against "keep throwing what the shape needs" for every turn left,
  where a real hand folds the moment folding is cheaper. Letting it switch needs the win probability
  _from turn t onward_, and `Outlook` carries one scalar rather than a per-draw curve
  (`plans/RECAP-IMPLEMENTATION-1-3.md` §2.6). The third ceiling — an advance-only DP that
  understates the win value — is unchanged.
- The measured shape matches what the published betaori figures describe: against one riichi with
  three genbutsu in hand, the first three turns are charged nothing and the rest settle at ~3.7% a
  turn, where `plans/EV-3` §5 quotes 3-5%.
- **The two models agree on the shape of a match and disagree in a known direction.** Derived spread
  runs 0.72-0.87 of measured, because it omits yakuman, honba, sticks and dealer repeats. The
  derived side decays as exactly `sqrt(rounds left)` — it is a sum of independent rounds by
  construction — where the measured side decays _faster_: real late rounds carry less variance than
  a plain random walk says. And only the measured side sees a leader regress toward the field. All
  three are pinned as tests rather than smoothed over, and none of them is a tolerance.
- **The objective changes which hand gets played, and the board where it does is the finding.** A
  seat that is _behind_ plays the same hand under both currencies — points already say a hand worth
  nothing costs nothing to chase. A seat with a lead to protect diverges, because a lead is the
  thing placement can see and points cannot.
- Cost is unchanged. The walk is `34 × turns` of arithmetic, the rank integral is a 257-point
  Simpson pass, and an `'ev'` seat still plays a measured ~460ms hand.
- One thing the numbers now demand of every consumer: **say which objective produced them.** They
  are not the same quantity in different units. Eight thousand points is eight result points to a
  comfortable seat and nearly ten to a last-place seat in South 4, which is the whole reason the
  switch exists. The lab's own panel names the seat, the model and the currency above every figure.

## Rejected

**Keeping the model as a key and adding only the objective as a field.** It would have avoided the
cross product by construction — two keys times one field — and it would have made the two switches
read as different kinds of thing when they are the same kind. The model and the objective are both
"how this seat prices"; neither is more of an algorithm than the other.

**Anchoring the placement odds on `AllLast.csv` and calibrating against `CoinflipRatio.csv`, as
`plans/EV-3` §8 sketches.** `Variance.csv` is the complete `(round × rank) → moments` table and it
is what the integral needs; the other two are a narrower anchor (a third-place seat in South 4) and
a validation target. Both remain available and neither is extracted.

**Correcting for the fact that the seats' scores are not independent.** They are exactly negatively
correlated in their sum, since points move between seats, so treating them as independent lets the
total drift and slightly widens every rank. It is the same shape of approximation `combineThreats`
makes for the same reason, and correcting it needs a joint model of the rest of the match that
neither EV model has.

**Posture** (`plans/EV-5` §2.12). Still open, still deferred, and still blocking nothing —
`balanced` is what both models are.
