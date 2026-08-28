# EV-1 — Win probability and expected score: the one-player mahjong DP

## 1. In one paragraph

Pretend for a moment that nobody else is at the table. You hold thirteen tiles, there are some
number of tiles you have not seen, and you will draw a certain number more times before the wall
runs out. Two questions follow, and **this one model answers both**: _how often does this hand
complete_, and _what is it worth when it does?_ Both have exact answers — not estimates, not
simulations — because the whole thing is a finite probability tree and every branch is a tile you
can count. The answer is computed by working backwards from the end of the hand: on the last draw
the chance is just "how many of my winning tiles are left, out of how many I cannot see"; on the
draw before that it is that, plus the chance I draw something that improves me into a better
position and then win from there. Swap "chance of winning" for "points if I win" in that same
recursion and it returns the hand's value instead, priced by the real scorer — which is what makes
it able to say _this discard wins less often but pays enough more to be worth it_, and what makes
"EV" mean expected **points** rather than expected wins. That recursion is the whole model.
Everything hard about it is that the tree is large; everything useful about it is that each step is
a fraction you can read out loud.

## 2. The questions it answers, stated exactly

> Starting from this 13-tile hand, drawing uniformly at random and without replacement from the
> tiles I cannot see, discarding optimally each turn, and with no other player ever winning or
> ending the hand:
>
> 1. what is the probability I complete the hand by self-draw within my remaining `d` draws?
> 2. what score does it pay when it completes, averaged over every way it could get there?
> 3. what is the product — the expected points from holding this hand?

The first is **`P_solo`** and the second is **`S_solo`** (§4). They come out of the same traversal;
computing one without the other is not cheaper, which is why an implementation should return both
and why `Outlook` in §9 carries both. Three things are true of `P_solo` at once and all three must
be kept in view:

- It is **exact**, given the assumptions. There is no fitted constant in it.
- It is **not the riichi win rate you read in a table.** Two corrections stand between them (§8),
  and only one of them is small.
- It is nonetheless **the right ordering signal for a discard choice**, because both corrections
  depend almost entirely on the turn and the board, not on which of your fourteen tiles you throw.

### The sampling assumption

Draws come from the _unseen_ pool, not from the live wall. From your seat, a tile in an opponent's
hand and a tile in the wall are indistinguishable — you have no information that separates them, so
treating them as one pool is the maximum-entropy choice given what you know. It is what
`tomohxx`/`nekobean` do, and it is why the model never needs to know how the wall was shuffled.

The pool shrinks by one per _your own_ draw. Opponents' draws and discards also reveal tiles, but
which ones is unknown when the model runs, and in expectation drawing from the unseen pool is
already correct.

## 3. The state space

A node is a pair **(hand, draws remaining)**.

- 13-tile hands are _decision-free_: nothing to do but draw.
- 14-tile hands are _decision nodes_: choose a discard.
- Edges out of a 13-tile node are draws, one per tile kind with unseen copies left.
- Edges out of a 14-tile node are discards.

Draws remaining strictly decreases along every path, so the graph is acyclic and "draws remaining"
is a valid topological order — which is why the whole thing is a dynamic program and not a search.
Different draw orders reach the same hand, so the graph merges heavily; memoising on the 34-count
vector is what turns an exponential tree into a manageable DAG.

## 4. The recurrences

Let `u(t)` be the unseen copies of tile kind `t`, `U = Σ_t u(t)` the unseen pool size, `h ⊕ t` the
hand with `t` added and `g ⊖ x` the hand with `x` removed.

### Win probability

```
V(h, 0) = 0

V(h, k) = Σ      [ u(t) / U ] · B(h ⊕ t, k)
        t : u(t)>0

B(g, k) = 1                                  if g is a winning hand
B(g, k) = max  V(g ⊖ x, k−1)                 otherwise
          x∈g
```

with `u(t)` decremented and `U` decremented by one inside the recursive call — the copy you just
drew is no longer unseen. A discard does _not_ change `u`: the tile was already in your hand, so it
was never in the unseen pool.

### Tenpai probability

The same recurrence with a different terminal:

```
B_tenpai(g, k) = 1     if some discard leaves g at shanten 0
```

Note this maximises a **different objective**, so it can name a different discard. See §7.

### Expected score

Replace the probability with points:

```
S(h, 0) = 0
S(h, k) = Σ [ u(t) / U ] · BS(h ⊕ t, k)
BS(g, k) = max(  score(g)  if g wins ,  max_x S(g ⊖ x, k−1)  )
```

The `max` at a winning node is what makes the model able to _decline_ a cheap win in favour of a
better one — which is the correct behaviour, and which `Algorithm.win` in this codebase already has
a seam for.

**This is the hand-value half of EV, and it is not a separate estimator.** `score(g)` is the real
scorer — `scoreHand` in `core/score.ts` — run on the actual completed hand at each winning leaf, so
yaku, fu, dora off the live indicators and the dealer/non-dealer split are all priced by the same
code the trainer already grades scoring questions with. Nothing is approximated at the leaf; the
approximation is entirely in _which leaves the model can reach_ (§6) and in the assumption that it
reaches them alone (§8). Two known gaps, both recorded in `EV-5` §1.10: `score(g)` is a **tsumo**
value, since the one-player model has no ron in it at all, and the DP draws at _kind_ level so it
never sees red fives, which makes expected score systematically slightly low.

Three quantities therefore come out of one traversal, and it is worth naming them separately
because trainers will want different ones:

| Quantity          | Recurrence | Reads as                                             |
| ----------------- | ---------- | ---------------------------------------------------- |
| `P_solo`          | `V`        | how often this hand finishes                         |
| `S_solo / P_solo` | `S` ÷ `V`  | what it pays **when** it finishes — the hand's value |
| `S_solo`          | `S`        | expected points from holding it — the EV itself      |

## 5. Worked example — tenpai, one wait, closed form

This is the case where the recursion collapses to something checkable by hand, and it is the test
that should pin the implementation.

Tenpai on a single kind. Let `k` = unseen copies of the winning kind, `U` = unseen pool, `d` = draws
left. Missing on every draw is sampling without replacement:

```
P_solo = 1 − Π_{j=0}^{d−1}  (U − k − j) / (U − j)
```

**Concrete.** Turn 9, four players. Unseen from your seat = 136 − 13 in hand − 1 dora indicator −
~32 tiles on the table ≈ **90**. A ryanmen with nothing visible is 8 tiles, so treat it as `k = 8`
across two kinds (the formula generalises: it is the count of winning _tiles_, not kinds). Draws
left ≈ **9**.

```
Π = 82/90 · 81/89 · 80/88 · 79/87 · 78/86 · 77/85 · 76/84 · 75/83 · 74/82
  = 0.9111 · 0.9101 · 0.9091 · 0.9081 · 0.9070 · 0.9059 · 0.9048 · 0.9036 · 0.9024
  = 0.4149

P_solo = 58.5 %
```

The same arithmetic at three turns:

| Turn | Unseen `U` | Draws left `d` | `P_solo` | Published riichi win rate, ryanmen | Ratio |
| ---- | ---------- | -------------- | -------- | ---------------------------------- | ----- |
| 3    | 114        | 15             | 68.9 %   | 77 %                               | 0.89  |
| 9    | 90         | 9              | 58.5 %   | 53 %                               | 1.10  |
| 12   | 78         | 6              | 49.0 %   | 41 %                               | 1.20  |

(Published figures from the `53 + (9 − turn) × 4` rule of thumb; see `EV-4`.)

Read that table carefully, because it is the whole story of §8: the pure number is **too low early**
and **too high late**, crossing the real one around turn 8. Early, you are missing all the chances
an opponent hands you the tile; late, you are missing all the ways the hand ends before your draws
run out.

## 6. The edge restriction — the finding that shapes the design

Which draws deserve an edge?

**Advance-only.** Follow a draw only when it strictly reduces shanten. This is the model implicit in
ukeire theory: the hand only ever moves forward.

**Advance-or-widen.** Also follow draws that leave shanten unchanged but increase the wait — the
`4577p` → draw `6p` → throw `4p` kind of move. This is what real play does and what a full model
must include.

Measured this session, on a verbatim port of `src/core/shanten.ts`, Node 26.7:

| Root      | Advance-only, per root | Advance-or-widen, per root, depth 3 |
| --------- | ---------------------- | ----------------------------------- |
| 1-shanten | 0.8 ms · 6 nodes       | **1 407 ms** · 2 394 nodes          |
| 2-shanten | 3.8 ms · 65 nodes      | **8 823 ms** · 17 897 nodes         |
| 3-shanten | 47.7 ms · 387 nodes    | **17 878 ms** · 43 948 nodes        |

The widening branch costs three orders of magnitude, and the reason is mechanical rather than
combinatorial: deciding whether a discard _widens_ the hand requires an `ukeire` call — 34 shanten
probes — for every candidate discard at every node, so a node expansion goes from ~34 probes to
~1 150.

**Conclusion: the implementable exact model is advance-only.** It is exact about a slightly smaller
game than mahjong — one where hands never improve sideways — and it therefore **understates** win
probability, uniformly and in the same direction for every candidate discard. That last clause is
what makes it usable for ranking even though it is biased as an absolute.

A middle path exists between the two extremes and is recorded for a later measurement: **bounded
widening** — follow a shanten-preserving draw only when the new hand's ukeire exceeds the old by a
stated margin, and cap the sideways moves per path (one covers the common `4577p` case). Cost sits
somewhere between the two rows above; where exactly is a build-time measurement.

Full 14-way ranking, advance-only, one memo shared across all fourteen candidates:

| Root hand | Nodes  | Whole ranking |
| --------- | ------ | ------------- |
| tenpai    | 53     | 0.7 ms        |
| 1-shanten | 394    | 12 ms         |
| 2-shanten | 1 890  | 84 ms         |
| 3-shanten | 29 902 | 1.77 s        |

Supporting throughput, same machine: ~1.7 M shanten probes/s; one `ukeire` call ≈ 19 µs; one
`evaluateDiscards` (≈476 probes) ≈ 270 µs.

## 7. Three objectives, three answers

The `max` at the 14-tile node is doing all the work, and swapping the objective swaps the answer:

- **maximise `V`** — win probability. Prefers cheap fast shapes.
- **maximise `B_tenpai`** — tenpai probability. Prefers width, and cares about the noten penalty
  rather than the win.
- **maximise `S`** — expected score. Will hold a dora pair through a narrower wait.
- **maximise immediate ukeire** — what `core/efficiency.ts` does today. A one-step greedy proxy for
  tenpai probability, and a good one, but a proxy.

`nekobean/mahjong-cpp` outputs all three tables side by side for exactly this reason. **Whatever
consumes this model must name which objective it optimises**, and a trainer that grades a discard
must say so on screen — "this was the highest-EV discard, not the widest" is a real and frequent
distinction, and hiding it would make the trainer feel arbitrary.

## 8. From `P_solo` to a number a reader recognises

Two corrections, neither of which is a fudge factor and both of which are opponent models.

### Correction 1 — hazard (pushes the number down)

The hand can end before your draws run out: someone else wins, or the wall exhausts. `P_solo`
assumes neither happens. Model it as a survival curve `s(u)` = P(the hand is still live at turn
`u`), and truncate the DP against it. Exhaustive draws are roughly 17% of hands; the rest end on
somebody's win, distributed over the turns.

The curve is per-model. The houou model reads it off measurement: `RiichiWinrate.csv`'s outcome
blocks (ron, tsumo, ryuukyoku, opponent tsumo, lateral movement, deal-in — row axis resolved in
`EV-5` §2.3) decompose how hands end per turn, and `s(u)` falls out directly. The statistical
model may not look it up; its pure derivation runs the same DP for the other three seats as
independent one-player hands and takes P(someone completes first) — expensive (one DP per
opponent), approximate (independence), but fully combinatorial.

### Correction 2 — ron uplift (pushes the number up)

`P_solo` counts only tsumo. In real play a large share of wins are ron. For a tenpai hand this is
**not a constant** — it is exactly the `EV-2` machinery pointed the other way: the probability that
an opponent discards one of _your_ waits, with you as the threat and them as the thrower. The same
enumeration, the same tables, run from the other side.

### Why they nearly cancel, and why that is a trap

The turn-9 row of §5 shows `P_solo` = 58.5% against a published 53%: a 10% overshoot, where the two
corrections are individually far larger than 10% and mostly cancel. **That cancellation is a
coincidence of magnitudes at mid-game, not an identity.** The turn-3 and turn-12 rows show it
failing in both directions. Any implementation must carry both the raw and the corrected number and
must never quietly ship the raw one with a percent sign on it.

**The design rule that follows:** the corrections live _outside_ the recurrence, applied to its
output, and `Outlook` carries both figures. Folding them into the DP would put a fitted number
inside an exact computation, which is precisely the failure mode ADR-0004 was written against.

## 9. Sketch of the module this specifies

```ts
export interface Outlook {
  /** Per remaining draw, index 0 = the next one. Exact under the model's own assumptions. */
  soloTenpai: number[]
  soloWin: number[]
  /** The same, after the hazard and ron corrections. Reportable; never used for ranking. */
  win: number[]
  /** Expected points conditional on winning. */
  score: number
  /** Coarse outcome distribution: P(win paying at least t) per threshold in `opts.thresholds`.
   *  The high-value tail (yakuman routes included — `scoreHand` prices them at the leaf) is what
   *  lets the decider re-weight under placement utility without the DP knowing table status. */
  winAtLeast: number[]
  /** false when the collapsed chain ran instead of the DP. */
  exact: boolean
}

export function handOutlook(hand, seen, sanma, draws, opts?): Outlook
export function discardOutlooks(hand, seen, sanma, draws, opts?): Map<TileId, Outlook>
```

- `opts.objective`: `'win' | 'tenpai' | 'score'` — §7 says this cannot be implicit.
- The unseen pool is a seam, not a constant: `u(t)` may be fractional **weights** rather than
  counts. Two recorded uses — wall reading (an opponent showing no souzu by turn 6 is information
  about what is left; `WallReading.csv` measures it) and red fives (a small mass on "this unseen 5
  is red", from the ruleset's aka count minus visible reds, fixing the `EV-5` §1.10 score bias at
  the leaf). v1 uses plain counts; the type must not forbid weights.
- `opts.maxShanten` defaults to **2**. Above it, the state collapses to `(shanten, ukeire, draws)`
  and the same recurrence runs over that reduced chain with `exact: false`.
- `discardOutlooks` shares **one** memo across all fourteen candidates — measured at 25–30% off both
  node count and wall time.
- Reuse `shanten()`, `improvingTiles`/`ukeire` (`core/ukeire.ts`), `bestDiscards`
  (`core/efficiency.ts`) and `scoreHand` (`core/score.ts`). Nothing here needs a new shanten
  implementation, and the group cache in `shanten.ts` is most of why the numbers in §6 are as good
  as they are.
- Purity: same inputs ⇒ same output, no Monte Carlo. [ADR-0009](../docs/adr/0009-decision-seam.md)
  makes that a hard rule, and it is also what makes the model explainable.

### The tests that would pin it

1. **Closed form.** §5's hypergeometric expression, exactly, to floating tolerance. This pins the
   recurrence rather than a snapshot of it.
2. **Monotonicity.** In draws left, in ukeire, and in shanten.
3. **Collapsed vs exact** agree to a stated tolerance at 2-shanten, where both run.
4. **Calibration band.** After the §8 corrections, a mid-game good-wait riichi lands near
   `53 + (9 − turn) × 4` and a bad wait near `40 + (8 − turn) × 3`. A band, never an equality.

## 10. Sources

- tomohxx, _麻雀アルゴリズム_ ch. 6 「和了確率」 — <https://tomohxx.github.io/mahjong-algorithm-book/probability/>.
  The recurrences in §4 are this, restated in "draws remaining" form rather than turn-index form.
- `tomohxx/mahjong-win-prob` — reference implementation, exact to 6-shanten in C++ with heavy
  caching.
- `nekobean/mahjong-cpp` — tenpai / win / expected-score tables per discard per turn; the
  three-objective split in §7 is its output shape.
- `pystyle.info` 何切るシミュレーター — the same model as a tool; documents its own limits ("no
  other players exist, drawing and discarding repeat to turn 18") and reports that 4-shanten and
  beyond becomes too expensive to answer in seconds, which matches §6.

Retrieved 2026-08-26.
