# ADR-0037 — An EV seat decides through one identity, and its model may not borrow

**Status:** Accepted · **Date:** 2026-08-27
**Builds on:** [ADR-0036](0036-probability-beside-the-tiers.md) (the two probability modules this
one decides with), [ADR-0009](0009-decision-seam.md) (the seam it adds two members to),
[ADR-0008](0008-algorithms-are-live.md) (which is why the model is a key rather than a field)
**Source:** `core/ev.ts`, `core/evModel.ts`, `core/algorithm.ts`, `core/policy.ts`,
`plans/PLAN-ev-model.md`

## Context

ADR-0036 built two modules that measure and nothing that decides. `dealIn.ts` says how likely a
tile is to deal in; `probability.ts` says how often a hand finishes and what it pays. Neither
answers the question a player actually has — _throw this one, or that one_ — because the two halves
are in different units until something prices them against each other.

`plans/EV-3` writes that pricing down as an identity, and the identity needs two numbers neither
module has: what a deal-in costs (`value_j`) and what giving up on the hand costs. Both are
properties of the opponents, not of the tiles, and the plan's own `EV-3` §3 lists them as the two
honest gaps.

## Decision

**An EV model is the unit of swappable prices, and it is a data module with a name**
(`core/evModel.ts`). Two ship: `statistical`, which derives every price from combinatorics, and
`houou`, which reads every price off measurements taken over the Tenhou houou logs by the same
extraction script ADR-0036 introduced. Each supplies four things — the wait-shape prior, the
deal-in cost, the give-up cost, the riichi uplift — plus a ruleset declaration saying what it may
not speak about.

**Neither model may take a number from the other.** A measured fold price against a derived
deal-in cost is a third model nobody chose, and its terms would not decompose into anything a lab
could show side by side. This is the rule that makes the two comparable on one board: they answer
the same questions from different sources, so a disagreement between them is evidence about the
sources rather than an artefact of how they were assembled.

**The identity is one expression, and folding is not a second code path** (`core/ev.ts`). Fold is
push with `P(win)` set to zero and the tiles taken from the safe end of the hand instead of the
useful end. Two branches that shared no code would eventually disagree about a term they share.
Every priced discard carries its own terms — a probability, a value, their product — because the
decomposition is the whole reason to prefer a formula to a network that would be more accurate.

**Table status enters at this layer and nowhere below it.** Honba, riichi sticks and dealership are
read here, off `SeatView.match`; the probability layers never see them. An evaluation must not
change when the score does, or the two models stop being comparable on one board
(`plans/EV-3` §8).

**Two `SeatAlgorithm` keys, not one style with a model field beside it.** `'ev-statistical'` and
`'ev-houou'` are members of the same union `'efficiency'` and `'defense'` belong to, so a seat runs
one or the other exactly the way it runs any algorithm — flip it mid-hand and the next turn obeys
(ADR-0008), and the seat panel picks both up for free. `plans/PLAN-ev-model.md` specifies a
`PlayerState` field seeded from `RoundOptions` and exposed on `SeatView`; at two models that field
is five plumbing sites buying nothing a union member does not already buy. It earns itself when a
second orthogonal switch — the objective, or a posture — turns the union into a cross product, and
that is when to add it.

**The pure model has exactly one place it cannot be pure, and it is stated as a constant.** Hand
value comes from choices, not from tiles: a player declares riichi on a hand they built, so its
yaku are selected rather than sampled. Pricing an opponent's hand as fourteen tiles drawn at random
from the unseen pool says tanyao happens in 0.03% of hands against the fifth or so of real ones —
combinatorics cannot see a decision already taken. `TYPICAL_CLOSED_YAKU_HAN` states one han for it,
named as chosen, beside `KOKUSHI_SHARE` under ADR-0036's third category. The derived deal-in cost
still lands at roughly half the measured one, because real riichi hands also hold more dora than
random tiles do, and no constant this model is allowed to state can recover that. **That gap is a
real difference between the two models, and its direction is known:** the pure model prices
opponents cheap, so it pushes where the measured one folds.

**Only two of the five decision points are priced through the identity.** The discard and the
riichi declaration are. `call`, `win` and `kita` are stand-ins, and each says in the code what it
stands in for — a call would need the melded hand re-solved through the DP on a gate that runs for
every seat on every discard, and declining a win prices a furiten branch nothing models yet. A
decider that cannot price the cost of declining should not decline.

## Consequences

- An `'ev'` seat plays a measured **~460ms hand** against `efficiency`'s ~40ms, with the DP left
  exact to 2-shanten. The cheap path `plans/EV-5` §1.9 asks for is the candidate union — the
  fastest tiles by ukeire plus the safest against the board — and it is enough on its own.
- `round.golden.test.ts` gains the other half of its guarantee. The frozen hashes say a new
  algorithm changed nothing for the seats not running it; three new cases say the new algorithm
  genuinely decides — an ev seat diverges from the same seeded wall, reproduces itself, and the two
  models do not play the same hand as each other.
- Nothing defaults to `'ev-*'`. A seat runs it only when asked, so the hashes stay frozen
  (`plans/EV-5` §2.9).
- The push and fold branches are both priced over the rest of the hand, roughly. `plans/EV-3` §5's
  multi-turn safety recursion is still unbuilt, and the module names the three ceilings it ships
  with rather than hiding them.

## Rejected

**A per-seat EV-model field, as the plan specifies.** See the decision above: five plumbing sites
for a distinction a union member already carries, at two models. Deferred, not refused — the
cross-product argument is written down so the next wave does not re-derive it.

**Capping the seat's look-ahead and collapsing 2-shanten while it plays.** Built, measured, taken
back out: 2.5x for a real loss of accuracy in the middle of the hand, which is where the
interesting decisions are. The thing that actually made an ev seat unaffordable was a bug — asking
`rankDiscards` for a hand that had already discarded, so the DP explored a twelve-tile hand that
can never complete. `rankDiscards` now refuses a hand that is not mid-turn rather than hanging on
one.

**Pricing a push's later turns at the tile being thrown now.** It makes a hand that spends one
genbutsu look safe for the whole rest of a hand it has not played, and a hopeless hand then out-EVs
folding. A pushing hand's later turns are priced at the average danger of the tiles it holds, which
is what it will actually be throwing.

**Wiring `HOUOU_OPEN_PRIOR`.** `plans/RECAP-IMPLEMENTATION-1-3.md` §4.2 records it as blocked on a
`ThreatView` field saying whether a seat has melded. It is not: `canDeclareRiichi` gates on
`isMenzen` and `threatViews` builds a view only for a declared seat, so a `ThreatView` can never be
an open hand. Reaching that prior needs open-tenpai reading, which `plans/EV-5` §1.4 defers to a
later wave.

**The joint two-threat enumeration on the deciding path.** It is built and off by default. Measured
at 46ms against the product's 2.5ms, and it moves the answer by at most 0.09pp with a full pool and
0.83pp against a depleted one — in the opposite direction from the one `plans/EV-2` §5 predicted.
The product is the right default for anything deciding; the joint path is for a reader who asked.
