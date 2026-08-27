# EV-3 — Push, fold, riichi: the decision model

**Specification only.** Nothing in the current wave implements this, and it should not be built
until `EV-1` and `EV-2` exist and are calibrated. It is written down now because it is the reason
the other two exist, and because writing it down is what reveals which of their outputs actually
get used.

## 1. In one paragraph

Once you can say how often a hand wins and how much it pays, and how often a tile deals in and how
much that costs, the push-or-fold question stops being a judgement call and becomes subtraction.
Pushing is worth what you win times how often, minus what you lose times how often. Folding is not
worth zero — betaori still deals in sometimes, and it forfeits the hand and usually the tenpai
payment. So the decision is the difference between two numbers, both of which have the same shape,
and the tile you should throw is the one that maximises that difference. Everything difficult is in
the inputs; the decision itself is a subtraction.

## 2. The identity

For a candidate discard `t`, in points:

```
EV(push t) =   P_win                    ×  ( value_win + honba_in + sticks )
             − Σ_j  P_dealin(t, j)      ×  ( value_j + honba_out )
             − P_tsumo_against           ×  cost_tsumo
             + P_exhaustive              ×  tenpai_payment
```

```
EV(fold)   = − Σ_j  P_dealin_folding(j)  ×  ( value_j + honba_out )
             + P_exhaustive              ×  noten_payment      (negative for you)
```

```
decision   = max over t of EV(push t),  compared against EV(fold)
```

`EV(fold)` is itself `max over t of EV(push t)` restricted to the tiles a folding hand would throw —
which is to say **folding is not a separate branch of the model, it is the same expression evaluated
on a hand that has given up on `P_win`.** That is worth building in from the start: one expression,
not two code paths that can disagree.

## 3. Every term, and where it comes from

| Term                   | Source                                                          | Available today?                    |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------- |
| `P_win`                | `EV-1`, corrected (§8 there) — and it depends on `t`, because throwing a tile changes the hand | After `EV-1` ships |
| `value_win`            | `EV-1`'s expected-score DP, or `scoreHand` once tenpai          | `core/score.ts` exists              |
| `P_dealin(t, j)`       | `EV-2`, per threat, union across threats                        | After `EV-2` ships                  |
| `value_j`              | **Not modelled.** See §4                                        | No                                  |
| `P_tsumo_against`      | **Not modelled.** Requires an opponent hand model               | No                                  |
| `honba_in` / `honba_out` | `MatchState.honba` × 300/100                                  | `core/match.ts` has it              |
| `sticks`               | `MatchState.riichiSticks` × 1000                                | Yes                                 |
| `tenpai_payment`       | 1000/1500/3000 split by how many are tenpai                     | Rule constant                       |
| `P_exhaustive`         | ≈17% of hands, turn-dependent                                   | Empirical constant                  |

Two of those are the honest gaps, and they are the reason this document is a specification rather
than a plan.

## 4. `value_j` — what a deal-in costs

You cannot price a hand you cannot see. Three options, in increasing order of honesty and expense:

1. **A flat empirical average.** A riichi deal-in costs roughly 5–6k on average. One constant, easy
   to explain, wrong in exactly the cases that matter most (a dealer riichi with three dora showing).
2. **Conditioned on visible evidence.** Dealer or not, dora indicators, the threat's melds, whether
   they are in riichi at all. Still a table, but a table with the arguments a player actually uses.
3. **A hand model.** Out of reach and out of scope.

Option 2 is the right target and `chienshyong/houou-statistics` publishes the raw material for it
(`HandScore.csv`, `BetaoirCost.csv`). Option 1 is an acceptable v1 **provided the constant is
visible on screen as a term**, so a reader can see that the answer rests on it.

## 5. The fold side is not zero risk

The most common way to get this wrong is to price folding at zero. Measured betaori deal-in is
roughly **3–5% per turn** even when you are playing genbutsu wherever you have one, because you run
out of genbutsu. Published figures at turn 9: about 3% holding three genbutsu, 4% with two, 5% with
one.

That has a direct consequence for the trainer: **the interesting question is rarely "is this tile
dangerous" but "is this tile more dangerous than the safest tile I will still be holding in three
turns"**, and a model that prices only the current throw cannot ask it. `EV(fold)` therefore has to
be evaluated over the *rest of the hand*, not the next discard — the same multi-turn recursion
`EV-1` uses, applied to safety instead of speed.

That is the single largest piece of unbuilt work in this document, and `EV-5` records it as such.

## 6. The riichi declaration, which has a closed form

Declaring riichi is the one decision with a published shortcut, and it is a good worked example of
the identity:

```
dealer:      EV = (win rate) × (win value + 1800) − 1800
non-dealer:  EV = (win rate) × (win value + 1600) − 1600
```

The `1800` / `1600` is the 1000-point stick plus the expected value of the sticks you collect back
when you win, plus the average uplift riichi gives the hand (ippatsu, ura, menzen tsumo). The
`− 1800` is the stick you pay whether or not you win. It is a one-line model, it is derived from the
same identity as §2, and it is exactly the kind of thing the lab should be able to print with its
terms showing.

The engine already deducts the 1000 and adds the stick inside `finishTurn`, and
`canDeclareRiichi(state, options, seat)` already gates legality — so the only missing half is the
*choice*, which is what an EV algorithm would supply.

## 7. Calls and kita, sketched

Not designed here; noted so the seam is known to admit them.

- **Call (pon/chi).** `EV(call) − EV(pass)`, where calling changes `P_win` (usually up, via
  shanten), `value_win` (usually down, via losing menzen and riichi) and `P_dealin` over the rest of
  the hand (up, because an open hand is committed). Today `chooseCall` in `policy.ts` calls whenever
  the meld strictly lowers shanten *and* `hasYakuRoute` still holds — a sound rule that an EV model
  would refine rather than replace.
- **Kita.** Already graded against `evaluateDiscards`' own north entry in `useEfficiencyRound.ts`,
  which is a shanten-and-ukeire comparison. The EV version prices the dora against the tempo.

## 8. Points EV now; placement EV once sequencing exists

akochan — the best-known non-neural engine — optimises **final placement point EV**: it converts
every decision into a change in expected `[90, 45, 0, −135]`-style rank points, which is why it will
take a wildly −EV-in-points line in All Last to secure a placement. That is the currency most real
riichi argument happens in, and it is a legitimate long-term target for this project, not something
to be ruled out.

**It is gated, though, and the gate is large.** [ADR-0023](../docs/adr/0023-round-inside-match.md)
models `MatchState` as carry-in context and nothing else: no `nextRound()`, no dealer rotation, no
honba increment, no payouts, no riichi-stick collection, no end-of-match detection. Placement EV is
a function of settled points across a whole hanchan, and every one of those is missing. The
dependency chain is:

```
round sequencing  →  settled points per round  →  a placement distribution
                  →  pt weights  →  placement EV
```

Only the last two steps belong to this model. The first two are a separate wave with its own ADR,
and a bigger one than everything in these five documents combined.

**Until then: points, stated as points, labelled as points.** A trainer that says "this discard is
worth +340 points" is making a claim it can support. One that says "+1.2 pt" would not be — and the
failure would be silent, which is the worst kind.

The design consequence for the model built now: keep the EV identity in §2 **linear in a per-outcome
value function**, so that swapping `points` for `pt(placement | points)` later is a substitution at
one seam rather than a rewrite. Do not bake points into the probability layers.

## 9. What this would look like on screen

The reason for all of it. A single discard, with its arithmetic open:

```
7p   push    +180
     win     34.1% × 5 800   = +1 978
     deal in  5.4% × 6 200   = −  335   (1 threat, non-suji)
     noten    16%  × −1 500  = −  240
     ...
6p   fold    +120
     deal in  3.1% × 6 200   = −  192   (genbutsu this turn, 2 left)
```

Every line is a term from `EV-1` or `EV-2`, and every term expands into *its* terms. That is what
the statistical lab is for, and it is why the two models underneath had to be built term-first
rather than number-first.
