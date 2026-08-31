# Push, fold, and everything in between

Someone has declared. Your hand is worth something and the tile that advances it is dangerous. That
is the decision, and it is one expression.

## The identity

For a candidate discard `t`, in points:

```
EV(push t) =   P_win               × ( value_win + honba + sticks )
             − Σ_j P_dealin(t, j)  × ( value_j + honba )
             − P_tsumo_against     × cost_tsumo
             + P_exhaustive        × tenpai_payment
```

```
EV(fold)   = − Σ_j P_dealin_folding(j) × ( value_j + honba )
             + P_exhaustive            × noten_payment
```

**Folding is not a second code path.** `EV(fold)` is `EV(push)` with the win probability at zero and
the tiles taken from the safe end of the hand instead of the useful end. One expression, evaluated
two ways — not two implementations that can quietly disagree with each other.

The probabilities come from the two model layers: `P_win` and `value_win` from
[the win-probability DP](./win-probability.md), `P_dealin` from
[the deal-in enumeration](./danger.md#the-deal-in-model). The prices — what a deal-in costs, what
giving up costs, what riichi is worth — come from the EV model, of which there are two.

## The terms are the output

The whole reason to prefer a formula over a number is that a formula decomposes. Every priced
discard carries its own terms — probability, value, and the product — so the answer can be read
rather than trusted:

```
7p   push    +180
     win     34.1% × 5 800   = +1 978
     deal in  5.4% × 6 200   = −  335   (1 threat, non-suji)
     noten    16%  × −1 500  = −  240

6p   fold    +120
     deal in  3.1% × 6 200   = −  192   (genbutsu this turn, 2 left)
```

Each line expands into its own terms, down to the individual wait hypotheses the deal-in figure was
summed from. That is what the lab's EV panel shows, and it is why both layers underneath were built
term-first rather than number-first.

### A value is not an expectation

The single easiest way to get this wrong, and it survived every test in the suite for a while.

A term is a probability times a **value** — what the outcome is worth, never an expectation that
already carries its own probability. The DP's `score` is the _unconditional_ expectation,
`P(win) × E[value | win]`. Pairing it with `soloWin` as the term's value computes `P(win)²`.

Measured on one tenpai hand: it pays **10 633** when it lands, and was being priced at **784**. Every
push was under-credited, quadratically worse the thinner the hand — hardest at 1- and 2-shanten,
which is the middle of the hand where the decisions are actually interesting, and it biased the whole
decider toward folding.

So the win term takes `score / soloWin`, the conditional value. The riichi decision reads the same
helper for the same reason; the bug was invisible under the measured model, whose riichi uplift
ignores the hand value it is handed, and showed only under the derived one.

The reason it survived: **every test asserted that a row adds up, or that a direction is right. None
asserted a magnitude.**

### The exhaustive draw belongs to the push branch alone

A hand that has given up is noten by construction, so the give-up cost ends on the noten penalty and
that is correct for the branch it is named after. But a push that does not win may still be **tenpai**
when the wall runs out, and then it collects rather than pays.

So the push branch carries a `tenpai` term the fold branch does not have: the probability of ending
tenpai without having won, valued at **twice** the noten penalty — the payment not made plus the
payment received — and discounted by the same survival factor the give-up cost uses, so the two
agree about whether the hand reaches the draw at all.

## What a deal-in costs

You cannot price a hand you cannot see. Three options, in increasing order of honesty and expense: a
flat empirical average; a figure conditioned on what is visible — dealer or not, the turn, how many
threats; or a real hand model, which is out of reach.

The second is what ships, and how it is obtained is exactly where the two EV models differ. The
measured one reads it from houou logs conditioned on turn and matchup. The derived one integrates
its own score distribution — and lands at about **half** the measured figure.

That direction is known and stated: **the derived model prices opponents cheap, so it pushes where
the measured one folds.**

The reason is structural rather than a missing measurement. Hand value comes from _choices_, not from
tiles: pricing an opponent as fourteen random tiles says tanyao happens in 0.03% of hands. So the
derived model has exactly one place it cannot be pure, a stated constant for the han a typical closed
hand carries — the same argument as the
[uniform prior's stated class masses](./danger.md#the-two-priors), applied to the offensive half.

A deal-in term also names **the seat the points go to**. Under points that changes nothing. Under
placement, dealing into the seat above you and the seat below you are not the same decision at all.

Per-threat probabilities are scaled to the union rather than summed raw: a discard deals into one
seat, and a raw sum double-counts the boards where two seats wait on the same tile — up to 0.88pp on
one tile against two threats, with the honba riding on it.

## Folding is not free

The most common way to get this wrong is to price folding at zero.

Real betaori deals in at roughly **3–5% per turn** even when you play a genbutsu wherever you have
one, because you run out of genbutsu. So the interesting question is almost never "is this tile
dangerous" — it is **"is this tile more dangerous than the safest tile I will still be holding in
three turns"**, and a model that prices only the current throw cannot ask it.

Both branches are therefore integrated over the rest of the hand, turn by turn, discounted by the
chance the hand is still going.

- The **push** policy throws what the shape needs, priced at the average danger of the tiles held —
  never at the tile going out now, which would let one genbutsu buy safety for a hand not yet played.
- The **safe** policy throws the cheaper of the safest tile in hand and the one just drawn, so a
  folding hand is replenished out of the unseen pool and a held safe tile is spent only on the turns
  where it beats the draw.

Measured against one riichi with three genbutsu: the first three turns cost nothing and the rest
settle at about **3.7% a turn** — inside the 3–5% band, and roughly **flat** rather than rising, which
is not what the specification predicted.

Two ceilings stand here and are stated in the code. A pushing hand may not change its mind
mid-sequence, because switching needs the win probability from turn `t` onward and the outlook
carries one scalar rather than a curve. And the win value comes from an advance-only DP that
understates.

## Every decision is priced

An EV seat does not use this identity for the discard and heuristics for everything else. Every
decision point goes through it.

**The kan** needs no constant at all. One more dora indicator multiplies every hand at the table by
the same expected han — yours and every threat's alike — so the difference between kanning and not
is a positive multiple of the terms whose value is a hand's worth, and a binary decision needs only
the sign. One ceiling: with nobody declared the cost side is zero, so an EV seat kans every legal kan
on a quiet board.

**Calls** are priced as hands. Passing is the thirteen-tile hand as it stands; a pon or chi leaves a
fourteen-equivalent hand ranked like any other; a daiminkan leaves a thirteen-equivalent one. A cheap
screen — never raise shanten, never open into a hand with no yaku route — runs first and **decides
nothing**, it only spares the DP a wasted run. A called kan's extra dora is a multiplier here rather
than cancelling, because it is being ranked against a pon, a chi and a pass rather than against
itself.

**Riichi** has a closed form, and it is a good worked example of the identity: the win rate times the
win value plus the sticks you collect back, less the stick you pay whether or not you win.

**The abortive draw** is `EV(keep) < 0`, since `EV(abort)` is zero under the pinned ruleset. It is
the motivating case for letting table status into the decision layer at all — a comfortable East 3
and a desperate South 4 are not the same hand.

**A win** is the one figure in the model that is exact, because by the time the question is asked the
hand is real and the scorer has already priced it.

## The currency switch

Points is the default. Placement is what most real riichi argument is actually about — it is why a
strong player takes wildly negative-in-points lines in the last hand.

These are not one quantity in two units. Eight thousand points is eight result points to a
comfortable seat and nearly ten to a last-place seat in South 4. **Whatever displays these numbers
has to say which objective produced them.**

The switch is one substitution rather than a second identity. Every term is already a probability
times a value, so the objective is just what a value _means_: points is the identity function, and
every figure comes out bit-for-bit what it was. Placement replaces it with the change in expected
final result the swing buys.

The value function is **fixed by the ruleset, not a parameter** — 25000/30000 with uma ±10/±20 in
four-player, 35000/40000 and +15/0/−15 in three. No free knobs.

Rank odds are four independent normals integrated against each other. **Independence is the stated
approximation**: points move between seats, so the four are exactly negatively correlated in their
sum. Same shape, and the same reason, as combining threats by a product.

The mean and spread of "final minus now" belong to each EV model, not to the integral. The measured
model reads them; the derived one treats a round as a point transfer and accumulates a random walk.
They land within 0.72–0.87 of each other, the derived side narrower and decaying as exactly
`sqrt(rounds left)` where the measured side decays faster — and only the measured side sees a leader
regress toward the field.

The measured result is not the one the specification expected: a seat that is **behind** plays the
same hand under both currencies, because points already price a hand worth nothing at nothing. It is
a seat with a **lead to protect** that diverges.

## The models may not borrow from each other

There are two EV models — one where every price is derived from combinatorics, one where every price
is measured over houou logs — and each supplies the whole set: a prior, a deal-in cost, a give-up
cost, a riichi uplift, a win value, and a declaration of which ruleset it can speak about.

A measured fold price against a derived deal-in cost would be a third model that nobody chose and
whose terms do not decompose. So the rule is absolute, and a model that cannot speak about a board
says so rather than silently substituting the other one's number.

### What the DP cannot reach

Above 2-shanten the DP does not reach a leaf, so it prices no win and the conditional value used to
come back as zero — which made a deep hand look worthless and dominated by its give-up term. A
4-shanten kyuushu hand was abandoned for exactly that reason.

`EvModel.winValue` fills the hole. It takes a hand _shape_ — dora held, closed or open, declared,
which yaku route — and never tiles, so the price layer still never sees a hand. The derived model
derives it; the measured model reads its own score table. It fires **only** where the DP produced
nothing, so the exact path is untouched wherever it ran.

## Table status enters here and nowhere below

Honba, riichi sticks and dealership are read at this layer, and under the placement objective so is
every seat's score.

The probability layers never see any of it. That is what keeps two EV models comparable on one board:
an evaluation does not change when the score does.

Two consequences worth stating. Honba is already inside the DP's own win figure, so the identity must
not add it to the win term a second time; riichi sticks are the opposite, since nothing in the scorer
knows about them. And an EV seat prices **the ruleset the table is actually playing** — a 4-han
30-fu win is 8000 under kiriage mangan, not 7700 — except that the measured model cannot follow that
flag, because its tables were measured over a ruleset that plays neither kiriage nor kan dora. A
stated ceiling, not a flag to thread through.
