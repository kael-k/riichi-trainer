# EV-5 — Shortcomings, and what is still open

Two lists. The first is what the models in `EV-1`–`EV-3` get *wrong* — known, quantified where
possible, and none of it discovered later by a user. The second is what has not been decided.

---

## Part 1 — Shortcomings

### 1.1 The offense model is exact about a smaller game than mahjong

**Advance-only is an approximation, and it is one-directional.** Following only shanten-reducing
draws means the model never sees a hand improve sideways — the `4577p`-draw-`6p`-throw-`4p` move
that widens a wait without advancing it. Real hands do this constantly, so `P_solo`
**understates** win probability.

The bias is at least uniform across candidate discards, which is why the ranking survives it. But
"uniform" is an assumption, not a proof, and it is most likely to fail exactly where hands differ in
*shape quality* rather than in speed — which is the interesting case. Measured cost of removing the
approximation: 1.4 s per single root at 1-shanten, so it is not being removed.

### 1.2 The offense model has no opponents, and the two corrections do not cancel

`EV-1` §8 lays this out with numbers: `P_solo` runs 11% below the published rate at turn 3 and 20%
above it at turn 12. The mid-game near-agreement is a coincidence of magnitudes. **The raw number
must never be shown with a percent sign on it.**

The ron-uplift correction is not a constant — it is `EV-2` run backwards, with you as the threat.
That is a real second model, not a scalar, and it does not exist yet.

### 1.3 The defense model's prior and its combinatorics are not independent

Discovered by prototyping this session. Multiplying an empirically-measured shape prior by an
absolute count of ways-to-hold double-counts availability, worst for the shapes with the most tiles.
Symptoms from the prototype: implied wait width **2.25 kinds against a true 1.773**, a non-suji 6p at
**11.95%** against an unconditional ceiling of 8.1%, and a single sanmenchan hypothesis taking 5.9%
on its own because `4⁴ = 256` dwarfs a ryanmen's `16`.

The fix (`EV-2` §8) is to feed availability in as a **ratio to its neutral value**, so the model
reproduces the empirical marginals exactly when nothing is visible. **The fix is itself an
approximation** — it assumes the empirical prior was measured under roughly neutral visibility,
which is not quite true, since a shape's frequency and how visible its tiles tend to be are
correlated. It is the right first move and it is not the last word.

### 1.4 The models refuse to read a silent tenpai, and real danger does not

`EV-2` returns nothing for a seat that has not declared riichi. That is honest — damaten and open
tenpai reading are much weaker inferences — but it means the model is silent about a genuine and
common source of deal-ins. `houou-statistics` publishes `OpenTenpai.csv`, `SpeedReading.csv` and
`TedashiReading.csv` for exactly this, and none of them are used.

### 1.5 The prior has no turn dependence

A turn-4 riichi and a turn-14 riichi do not have the same distribution of wait shapes — the late one
has been narrowed by everything that passed. The extracted table is a marginal over all turns, so
the model gives the same shape mix at every point in the hand. `RiichiWinrate.csv` is stratified in
a way that would fix this, if its row axis can be established (§2.3).

### 1.6 No wall reading, no dora-soba, no sotogawa

The published data covers all three (`WallReading.csv`, `DorasobaDanger.csv`, `Sotogawa.csv`,
`SotogawaCombo.csv`) and the model uses none of them. A tile adjacent to a dora is measurably more
dangerous; a tile outside an early discard is measurably safer. Both are real effects the model
currently prices at zero.

### 1.7 The deal-in cost is not modelled at all

`EV-3` §4. Without `value_j`, the push/fold identity cannot be evaluated — only its probability half
can. A flat average is a defensible v1 **only if it is visible on screen as a term**.

### 1.8 Folding is priced one turn at a time

`EV-3` §5, and the largest single piece of unbuilt work in the whole design. The question a player
actually faces is not "is this tile safe" but "can I stay safe for the rest of the hand", and
answering it needs the same multi-turn recursion the offense model uses, applied to safety. Until
that exists, the model can compare two discards but cannot honestly compare push against fold.

### 1.9 Performance rules out the obvious integration

84 ms for a 2-shanten ranking is fine once, on demand. It is **not** fine for three or four AI seats
on every turn: `core/table.ts` already notes that `evaluateDiscards` at ~476 shanten probes is
expensive enough to justify lazy getters, and this is two orders of magnitude past that. A round is
~17 ms today.

So an `'ev'` `SeatAlgorithm` cannot simply call the exact model. It needs a cheap path — the
collapsed chain, or a shanten-and-ukeire prefilter with the DP run only on the survivors, the same
trick `bestDiscards` already plays against `evaluateDiscards`.

### 1.10 Coverage gaps in both models

- **Kokushi and chiitoitsu.** The offense DP must handle both terminals (`shanten.ts` already
  computes them); the defense model gives kokushi a hypothesis but chiitoi tanki is folded into
  plain tanki, which understates honour and terminal danger against a chiitoi hand.
- **Red fives.** `scoreHand` prices them, but the DP draws at *kind* level and never sees redness,
  so expected score is systematically slightly low. The same seam `Algorithm.discard` already
  documents.
- **Sanma.** `inTileSet` handles the mechanics, but the houou prior is four-player data. There is no
  three-player wait distribution here, so the empirical layer would be running outside its domain.
- **Open hands.** `WaitDistribution.csv` has a separate block for open tenpai with a materially
  different shape mix. Using the closed-riichi block against a melded threat is wrong.

---

## Part 2 — Open points

### 2.1 The licence gap — blocks the empirical layer

`chienshyong/houou-statistics` **ships no LICENSE file** (404 on the raw path). Extracting a small
aggregate table with clear attribution is ordinary practice, but it is a call for the repository
owner, not for an agent.

- If yes: extract, pin the commit, record the URL and retrieval date in a header comment.
- If no: fit the prior to independently published summary figures instead — a smaller table, a
  weaker citation, and a real loss of the per-rank detail that makes the model good.

**Decide before writing the table, not during.**

### 2.2 The indexing convention is inferred, not confirmed

`EV-2` §7 concludes that each shape is indexed by the **lowest tile it waits on**, from the zero
pattern (ryanmen nonzero only at ranks 1–6, sanmenchan only 1–3, penchan only 3 and 7). That is
strong evidence, and it is still an inference. **Confirm against the repository's own `analyzers/`
before shipping any number that depends on it** — and every number in the empirical layer depends on
it.

### 2.3 `RiichiWinrate.csv`'s row axis is not self-evident

Its columns are wait notations (`147`, `258`, `36`, `Z1`, `55`, `complex`, …) and its rows run 0
upward with values near 0.91 falling to 0.59. Those are too high to be raw win rates and the axis
cannot be read off the file. It is the natural source for turn-stratified priors (§1.5) and for
calibrating the survival factor, so it is worth resolving — from `analyzers/`, not by guessing.

### 2.4 Which objective is the default

`EV-1` §7: win probability, tenpai probability and expected score are three different maximisations
that name different discards, and today's `efficiency` algorithm optimises a fourth thing (immediate
ukeire) as a proxy for the second. Whatever ships has to pick one as the default and **say so on
screen**, or a grader will feel arbitrary at exactly the moments it is most right.

### 2.5 How a probability-graded trainer decides "correct"

`danger.ts` grades on `rank === 0` with dense ranks, so genuinely equivalent choices tie. A
probability grader has no ties — two tiles will differ in the fourth decimal. It needs a tolerance
band, and the band is a new calibration knob with the same "a number the reader learns" hazard
ADR-0004 was written about. Unresolved.

### 2.6 Where the computation runs

84 ms blocks a frame; 1.77 s blocks the tab. Options: a Web Worker, an incremental/deadline-bounded
DP, or restricting exactness by what the reader asked for. Nothing in the repo uses a worker today,
so this would be a new pattern and deserves its own decision.

### 2.7 Memo lifetime

Sharing one memo across a ranking is worth 25–30%. Sharing it across *turns* would be worth more,
since consecutive hands overlap heavily — but the memo keys on the 34-count vector and the unseen
pool changes every turn, so entries silently go stale. `shanten.ts`'s group cache dodges this by
caching a function of the hand alone. Needs a design, not a guess.

### 2.8 What happens to `danger.ts`

Settled for this wave: nothing. But once both models exist, keeping two descriptions of the same
game in two modules is a maintenance cost with a real failure mode — they can disagree, and the
folding trainer would grade on the older one. The cross-check test in `EV-2` §9 is the guard; whether
that is enough long-term is open.

### 2.9 Whether the golden tests move

They must not, for this wave — nothing is wired in. But if `'ev'` ever becomes any seat's default
algorithm, `round.golden.test.ts` hashes move, and that is a deliberate act requiring the ADR to say
so ([ADR-0016](../docs/adr/0016-testing-strategy.md)).

### 2.10 Placement EV, and the sequencing decision behind it

Deferred, **not excluded** — see `PLAN-ev-model.md` "Deferred, not excluded" and `EV-3` §8. The model
built now must keep the EV identity linear in a per-outcome value function so that swapping points
for placement points is a substitution at one seam. The prerequisite — round sequencing, currently
ruled out by [ADR-0023](../docs/adr/0023-round-inside-match.md) — is a larger decision than this
whole model and needs its own ADR. Nothing here should be designed as though it will never happen.

### 2.11 Sanma

`EV-2`'s empirical layer has no three-player data behind it, and this app supports sanma throughout.
Either the empirical layer refuses to run under sanma and falls back to `UNIFORM_PRIOR`, or it runs
outside its domain and says nothing about it. The first is honest; the second is what will happen by
accident if nobody decides.
