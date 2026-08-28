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

And every comparison the decider makes follows `policy.ts` discipline: explicit tie-breaks and a
stated float epsilon, never sort stability — ADR-0009's purity rule covers the arithmetic too.

## 3. Every term, and where it comes from

| Term                     | Source                                                                                         | Available today?       |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------- |
| `P_win`                  | `EV-1`, corrected (§8 there) — and it depends on `t`, because throwing a tile changes the hand | After `EV-1` ships     |
| `value_win`              | `EV-1`'s expected-score DP, or `scoreHand` once tenpai                                         | `core/score.ts` exists |
| `P_dealin(t, j)`         | `EV-2`, per threat, union across threats                                                       | After `EV-2` ships     |
| `value_j`                | **Not modelled.** See §4                                                                       | No                     |
| `P_tsumo_against`        | **Not modelled.** Requires an opponent hand model                                              | No                     |
| `honba_in` / `honba_out` | `MatchState.honba` × 300/100                                                                   | `core/match.ts` has it |
| `sticks`                 | `MatchState.riichiSticks` × 1000                                                               | Yes                    |
| `tenpai_payment`         | 1000/1500/3000 split by how many are tenpai                                                    | Rule constant          |
| `P_exhaustive`           | ≈17% of hands, turn-dependent                                                                  | Empirical constant     |

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
be evaluated over the _rest of the hand_, not the next discard — the same multi-turn recursion
`EV-1` uses, applied to safety instead of speed.

That is the single largest piece of unbuilt work in this document, and `EV-5` records it as such.

One shortcut is already measured, and it changes the build order: `BetaoirCost.csv` is exactly this
quantity — points lost while folding, by turn, dealer and threat count. The **houou model's v1 fold
price is a table read** (units pinned at extraction), so push and fold can be compared before the
recursion exists. The recursion is still owed twice over: for the statistical model, which may not
read the table, and for the lab, which needs the number decomposed into terms. And the push side is
per-turn in the same way: a pushed hand that has not yet won must survive every later turn, so the
honest `EV(push)` integrates the rest of the hand too — the §2 identity prices one turn of it.

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
_choice_, which is what an EV algorithm would supply.

The honest version compares against the alternative branch, and both branches have measured data:
declare (the rates above) vs stay dama (`DamaWinrate.csv` by wait and turn; `OikakeWinrate.csv`
when someone else declares first). A riichi decision that prices only the declare branch is half a
decision.

## 7. Calls, kita and kyuushu kyuuhai — in scope

Settled in refinement: the `'ev'` decider prices **every** decision point through the §2 identity,
not only the push/fold discard.

- **Call (pon/chi).** `EV(call) − EV(pass)`, where calling changes `P_win` (usually up, via
  shanten), `value_win` (usually down, via losing menzen and riichi) and `P_dealin` over the rest
  of the hand (up, because an open hand is committed). Today `chooseCall` in `policy.ts` calls
  whenever the meld strictly lowers shanten _and_ `hasYakuRoute` still holds — a sound rule that
  the EV decider refines rather than replaces, for its own seat only.
- **Kita.** Already graded against `evaluateDiscards`' own north entry in `useEfficiencyRound.ts`,
  which is a shanten-and-ukeire comparison. The EV version prices the dora against the tempo.
- **Win/decline.** Declining a cheap tsumo for a better wait is the DP's internal `max` read
  externally; `Algorithm.win` already has the seam. Declining a ron also creates a furiten state
  (temporary, or permanent in riichi) — the decline branch's EV prices that state, not only the
  wait improvement.
- **Kyuushu kyuuhai.** `EV(keep the hand)` against `EV(abort)` (≈ 0 this hand, adjusted for
  dealership and honba) under the current objective — the motivating case for table status at the
  decision layer (East 3 comfortable vs South 4 desperate). Requires engine support that does not
  exist: an abortive-draw ryuukyoku and a new `Algorithm` decision point. Both are in the wave's
  scope; `round.golden.test.ts` hashes move as a deliberate act (ADR-0016). It is evaluated at the
  decision (push/fold) layer like every other decision point, never by the offense evaluator
  alone: the full identity includes the combinatorial deal-in and noten terms even under the
  statistical model, so `EV(keep)` can go negative under either model — what differs between the
  models is degree (combinatorial vs measured hazard and fold terms), not kind. Ruleset pin for
  the build: Tenhou practice — the abort is a ryuukyoku with honba +1 and the dealership rotating;
  `EV(abort)` pricing depends on that choice, so the engine pins it rather than assuming it.

## 8. Points by default; placement a switch — and the odds belong to the EV model

Settled in refinement round 2, superseding this section's original "gated on sequencing" framing.

The currency is a **switch**, orthogonal to the EV model: what a seat maximises (points, or final
placement) vs how it estimates probabilities and costs. **Points is the default** — stable,
explainable, and the currency every validation band in `EV-1` is written in. Placement is the
currency most real riichi argument happens in — it is what akochan optimises, and why it takes
wildly −EV-in-points lines in All Last — and it is a position of the switch, not a future wave.

Two fixed points and one per-model function:

- **The placement value function is fixed by the ruleset**, not a parameter: Tenhou rank points
  plus uma (`[135, 65, −5, −210]`-style). No free knobs.
- **Table status is decision-layer input only.** Points, placement, round, honba, dealer and
  sticks all arrive live through `SeatView.match`; `turn` is in `SeatView`. The probability layers
  never see them — an evaluation does not change when the score does, which is what keeps two EV
  models comparable on one board.
- **The placement-odds function — P(final rank | match state) — is a property of the EV model.**
  The houou model derives it from measurement: `Variance.csv` (final-score mean and spread by round
  and position) integrated for rank odds, anchored by `AllLast.csv` in South 4 and calibrated
  against `CoinflipRatio.csv`. A second, black-box candidate is admitted under the refined neural
  rule (PLAN "Out of scope"): porting the repo's trained placement MLP
  (`util/placement_calculator.py`, ~10k weights, trivial in-browser cost) — likely more accurate,
  never explainable, the choice deferred to build. The statistical model must compute it purely: each remaining hand as
  a point-transfer random variable whose moments come from the combinatorics (per-hand expectation
  from the `EV-1` DP, spread from the score distribution it already prices), final scores as sums,
  rank odds by integration. That derivation is owed (`EV-5` §2.10) and blocks only the placement
  switch under the statistical model.

**Posture.** The statistical model defines three flavours — `balanced`, `aggressive`, `defensive` —
which change **only the push/fold decision**, never the probability layers. `balanced` ships first;
the other two are deferred, and their mechanism is constrained in advance to a risk transform over
the identity's own terms (e.g. EV ± κ·σ of the outcome distribution), never a typed-in adjustment
table (`EV-5` §2.12).

The design rule stands, now load-bearing: keep the §2 identity **linear in a per-outcome value
function**, so swapping points for `pt(placement | points)` is a substitution at one seam. Do not
bake points into the probability layers — and do not bake table status into them either.

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

Every line is a term from `EV-1` or `EV-2`, and every term expands into _its_ terms. That is what
the statistical lab is for, and it is why the two models underneath had to be built term-first
rather than number-first.
