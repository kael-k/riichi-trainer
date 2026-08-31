# What a hand is worth

Pretend for a moment that nobody else is at the table.

You hold thirteen tiles, there are some number of tiles you have not seen, and you will draw a
certain number more times before the wall runs out. Two questions follow, and one model answers
both: **how often does this hand complete**, and **what is it worth when it does?**

Both have exact answers — not estimates, not simulations — because the whole thing is a finite
probability tree and every branch is a tile you can count. You work backwards from the end of the
hand. On the last draw the chance is just "how many of my winning tiles are left, out of how many I
cannot see". On the draw before that it is that, plus the chance I draw something that improves me
into a better position and then win from there.

Swap "chance of winning" for "points if I win" in the same recursion and it returns the hand's value
instead. That is what lets the model say _this discard wins less often but pays enough more to be
worth it_, and it is why EV here means expected **points** rather than expected wins.

## The recursion

A node is a pair — a hand, and the number of draws left. Thirteen-tile hands have no decision in
them: there is nothing to do but draw. Fourteen-tile hands are the decision nodes, where a discard
is chosen.

Writing `u(t)` for the unseen copies of tile kind `t` and `U` for the whole unseen pool:

```
V(h, 0) = 0

V(h, k) = Σ  [ u(t) / U ] · B(h ⊕ t, k)
        t : u(t) > 0

B(g, k) = 1                    if g is a winning hand
B(g, k) = max V(g ⊖ x, k−1)    otherwise
          x ∈ g
```

The copy you just drew stops being unseen inside the recursive call. A discard does not change the
pool at all — that tile was in your hand, so it was never unseen to begin with.

Tenpai probability is the same recursion with a different terminal: a node counts when some discard
leaves the hand at shanten 0. Expected score is the same recursion again with points in place of
the indicator, and a `max` at a winning node rather than a flat 1 — which is what lets the model
decline a cheap win in favour of a better one.

**Nothing is approximated at the leaf.** `score(g)` is the real scorer, `core/score.ts`, run on the
actual completed hand — so yaku, fu, dora off the live indicators and the dealer split are all
priced by the same code the scoring trainer grades against. The approximation is entirely in _which
leaves the model can reach_, and in the assumption that it reaches them alone.

Three quantities come out of one traversal:

| Quantity          | Reads as                                             |
| ----------------- | ---------------------------------------------------- |
| `soloWin`         | how often this hand finishes                         |
| `score / soloWin` | what it pays **when** it finishes — the hand's value |
| `score`           | expected points from holding it                      |

That middle row matters more than it looks. A term in the push/fold identity is a probability times
a **value**, so the win term takes the conditional figure, never `score` — pairing `soloWin` with
`score` multiplies the win probability in twice. See
[the identity](./push-fold.md#a-value-is-not-an-expectation).

### The sampling assumption

Draws come from the **unseen** pool, not from the live wall. From your seat a tile in an opponent's
hand and a tile still in the wall are indistinguishable — you have no information separating them,
so treating them as one pool is the maximum-entropy choice given what you know. It also means the
model never needs to know how the wall was shuffled.

## Advance-only, and why

Which draws deserve an edge in the tree?

Following only draws that **strictly reduce shanten** is the model implicit in ukeire theory: the
hand only ever moves forward. Real play also moves sideways — draw `6p` into `4577p`, throw the
`4p`, same shanten but a better wait. Including those is what a full model would do.

Measured, on a verbatim port of the engine's own shanten code:

| Root      | Advance-only        | Advance-or-widen (depth 3)   |
| --------- | ------------------- | ---------------------------- |
| 1-shanten | 0.8 ms · 6 nodes    | **1 407 ms** · 2 394 nodes   |
| 2-shanten | 3.8 ms · 65 nodes   | **8 823 ms** · 17 897 nodes  |
| 3-shanten | 47.7 ms · 387 nodes | **17 878 ms** · 43 948 nodes |

Three orders of magnitude, and the reason is mechanical rather than combinatorial: deciding whether
a discard _widens_ a hand needs an ukeire call — 34 shanten probes — for every candidate discard at
every node, so expanding one node goes from about 34 probes to about 1 150.

**So the implementable exact model is advance-only.** It is exact about a slightly smaller game than
mahjong, one where hands never improve sideways, and it therefore **understates** win probability —
uniformly, and in the same direction for every candidate discard. That last clause is what makes it
usable for ranking even though it is biased as an absolute.

## The max is where the model lives

At a fourteen-tile node the `max` runs over **every shanten-minimal discard**. Following one discard
instead would make this a greedy chain rather than a model, and the difference is not small: an
early measurement of "65 nodes at 2-shanten" turned out to describe the one-discard traversal. The
real figure for the model as specified is **835 memo entries and about 21 ms**.

Swapping what the `max` maximises swaps the answer, and the three objectives name **different
discards**:

- maximise win probability — prefers cheap, fast shapes.
- maximise tenpai probability — prefers width, and cares about the noten penalty rather than the win.
- maximise expected score — will hold a dora pair through a narrower wait.

Immediate ukeire, which the efficiency trainer grades on by default, is a one-step greedy proxy for
the second of those. A good proxy, but a proxy.

**Whatever displays these figures has to say which objective produced them.** "This was the
highest-EV discard, not the widest" is a real and frequent distinction, and hiding it makes a
trainer feel arbitrary.

## What is memoised, and what may not be

Node values are **never shared across the candidates of a ranking**. Two candidate discards reach
the same hand having drawn different things, so their unseen pools differ and their values are not
the same number. Sharing one memo across all fourteen candidates is unsound.

What _is_ shared is everything depending on the hand alone — improving tiles, best discards, leaf
scores — which is where the shanten probes actually are. That is worth **5.4×**, rather more than
the unsound sharing would have been.

One approximation lives inside the exact path and is worth naming. The memo is keyed on the hand and
the draws remaining, while the unseen pool is mutated along the traversal. Under advance-only those
agree except when a tile drawn earlier is discarded later — draw 3p, keep it, draw 4p, throw the 3p
— where the first visit's pool is baked in for that node. Rare, deterministic and therefore still
pure. Removing it means keying the memo on the drawn multiset too, which defeats the memo.

## Beyond 2-shanten, a collapsed chain

The exact DP runs to `maxShanten`, which is **2** by default. Above that a collapsed chain runs
instead and the result is flagged inexact.

The chain walks an **availability-weighted average** of where each improving draw lands — not the
best one. Reading ukeire off the best draw overstates a 2-shanten win probability by **190%**. The
average is unbiased at the boundary it actually runs at, and scattered rather than skewed beyond it:
measured against the exact DP, the median ratio of collapsed to exact is **1.00 at 3-shanten**
(quartiles 0.83–1.08), falling to 0.88 at 4-shanten and 0.63 at 5. So a deep hand's figure is a
floor. It is exact at tenpai.

The collapsed chain never reaches a leaf, so it prices no win: `score` comes back undefined rather
than zero. That hole is filled at the decision layer by
[`EvModel.winValue`](./push-fold.md#what-the-dp-cannot-reach), because a hand priced at zero is a
hand the model would throw away.

## `soloWin` is not a win rate

This is the single most misreadable number in the model, and it must never be shown with a percent
sign.

Two corrections stand between it and the figure a player would recognise, and neither exists in the
code:

**Hazard pushes it down.** The hand can end before your draws run out — someone else wins, or the
wall exhausts. `soloWin` assumes neither happens. Exhaustive draws are roughly 17% of hands; the
rest end on somebody's win.

**Ron uplift pushes it up.** `soloWin` counts only self-draw. In real play a large share of wins are
ron, and for a tenpai hand that is not a constant — it is exactly the
[deal-in machinery](./danger.md#the-deal-in-model) pointed the other way, with you as the threat.

At mid-game they very nearly cancel, and **that cancellation is a coincidence of magnitudes, not an
identity** — it fails in both directions early and late. So no corrected field ships at all. Emitting
one would mean inventing a number, which is the failure this whole model was built to avoid; and
folding either correction into the recurrence would put a fitted constant inside an exact
computation.

What survives is that `soloWin` is still the right **ordering** signal for a discard choice, because
both corrections depend almost entirely on the turn and the board rather than on which of your
fourteen tiles you throw.

## Cost

The cheap path an EV seat plays with prices only a candidate union — the fastest few by ukeire and
the safest few against the board — rather than every tile in hand. Even so, a 2-shanten ranking is
about **89 ms** against about **10 ms** at tenpai, and an `'ev'` seat plays a roughly 460 ms hand
against `efficiency`'s 40 ms.

That is why these figures are computed **on demand** and never as a getter beside the cheap ones:
a board that priced every turn on the chance somebody might look is a board nobody wants to play on.
