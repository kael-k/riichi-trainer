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
`TedashiReading.csv` for exactly this, and none of them are used. Endorsed as a **later-wave
extension (nice to have)**: dama reading is `P(tenpai | river) × P(wait | tenpai, river)` — the
second factor is the existing hypothesis machinery, the first is the new and noisier inference
those files measure. v1 keeps the refusal; the seam is recorded.

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
trick `bestDiscards` already plays against `evaluateDiscards`. Concretely: the candidate set is a
**union** — the top-K tiles by the shanten/ukeire prefilter *plus* the top-J safest tiles (a
push/fold decision that never prices the fold option is not a decision) — with the DP run on the
union only. K and J are algorithm constants: changing them changes which discards an `'ev'` seat
makes, so they are versioned with the ADR and the golden tests, never tuned casually.

### 1.10 Coverage gaps in both models

- **Kokushi and chiitoitsu.** The offense DP must handle both terminals (`shanten.ts` already
  computes them); the defense model gives kokushi a hypothesis but chiitoi tanki is folded into
  plain tanki, which understates honour and terminal danger against a chiitoi hand.
- **Red fives.** `scoreHand` prices them, but the DP draws at *kind* level and never sees redness,
  so expected score is systematically slightly low. The same seam `Algorithm.discard` already
  documents. A cheap first-order fix is recorded in `EV-1` §9: treat the unseen pool as weights
  and put a small mass on redness at draw time.
- **Sanma.** `inTileSet` handles the mechanics, but the houou prior is four-player data. There is no
  three-player wait distribution here, so the empirical layer would be running outside its domain.
- **Open hands.** `WaitDistribution.csv` has a separate block for open tenpai with a materially
  different shape mix. Using the closed-riichi block against a melded threat is wrong.
- **Ura and ippatsu.** The leaf prices live dora indicators only — ura indicators are hidden until
  the win, and ippatsu depends on timing the DP does not track, so a riichi hand's expected score
  is understated by both expectations. Pure combinatorial corrections exist for each (expected ura
  per win off the unseen pool; ippatsu as a first-turn term); the riichi closed form already
  covers them empirically in its uplift constants.
- **Kan and kita replacement draws.** The DP's draw model is wall draws only — an ankan's rinshan
  draw (plus its kan dora) and a sanma kita pull are unmodelled: a small effect on `P_win`, a real
  one on expected score.
- **Sanma validation anchors.** The `EV-1` §9 calibration bands are yonma rules of thumb; under
  sanma the test suite needs its own anchors or a yonma-only guard.

### 1.11 The priors are marginals over table status

Real opponents change behaviour with the score — the same dataset shows it (`Variance.csv`: players
behind take measurably more variance) — so a threat's true wait-shape and riichi distributions are
conditioned on *their* table status, and the model's priors are the marginal over all of them. No
published wait data is stratified by score situation, so this is not fixable by extraction; the
refinement session settled the architecture instead: table status enters at the decision layer
(`EV-3` §8), never in the probability layers, which keeps the two EV models comparable on one
board. Behaviour-level data stratified by position exists (`Variance.csv`, the hand-outcome
analysis) and is the raw material for the future `ippan` EV model.

### 1.12 The priors describe a population; our tables seat several

The houou prior measures Tenhou houou players. At our own tables the opponents are `efficiency`
and `defense` algorithms — and, once the EV models ship, `'ev'` seats themselves: the **houou bot
is just "pick what the EV model says"**, which is the point of the design (the models are both lab
instruments and new bots). So a prior is really a *claim about the population a seat faces*: a
houou-vs-houou table is a coherent world, an `'ev'` seat facing `efficiency` bots believes in a
population that is not there, and a mixed table mixes populations. v1 keeps one prior for all
threats; a later seam could annotate each threat with its algorithm (the engine knows it;
`ThreatView` does not) and pick per-threat priors accordingly. The `ippan` model and any future
self-derived tables widen the population library further.

---

## Part 2 — Open points

### 2.1 The licence gap — blocks the empirical layer — RESOLVED 2026-08-27

**Resolved: extract the data tables, with attribution.** Three independent grounds: the CSVs are
measured facts, not copyrightable expression; the repository's own README states it is forked from
`Euophrys/houou-analysis`, which carries an MIT LICENSE (verified on the raw path); and no code is
copied — only aggregate numbers. The provenance header cites both repositories, the pinned commit
and the retrieval date, `TIER_SCORE`-style. (The repository is dormant — last push 2023-11 — so
asking the owner was not the blocking path.)

### 2.2 The indexing convention is inferred, not confirmed — RESOLVED 2026-08-27

Confirmed against `wait_distribution.py`: every shape is indexed by the **lowest tile it waits
on**, penchan/kanchan/tanki by the wait tile itself. The confirmation surfaced three extraction
caveats — the `uke >= 5` ryanmen/shanpon threshold, honour tanki bucketed by copies visible across
all four rivers, and shanpon being a 10×10 wait-pair matrix whose per-rank column is a marginal —
all recorded where the table is specified, `EV-2` §7.

### 2.3 `RiichiWinrate.csv`'s row axis is not self-evident — RESOLVED 2026-08-27

Resolved against `riichi_winrate.py`. **Rows are the declaration turn, 0–18** (`index=range(19)`).
The values (0.91 at turn 0 falling toward 0.6) are win rates of the **first riichi, non-furiten,
non-dora-wait** — higher than an average riichi because later declarers face it. Columns are wait
classes: sanmenchan `147/258/369`, ryanmen `14`–`69` (both wait tiles), single waits `19/28/37/46/5`
plus suji-trap `S` variants, honour tanki `Zt0/Zt1/Zt2` by copies out, shanpon `ZZ/Z1/Z5/11/15/55`
plus suji-trap variants, `complex`. The file's later blocks give the full outcome decomposition
(ron, tsumo, ryuukyoku, opponent tsumo, lateral movement, deal-in) and stratify by **dealer**, by
**South-round placement (1st vs 4th)** — a partial, win-rate-level answer to §1.11 — and by
**number of open opponents**. This is the source for turn-stratified priors (§1.5) and for the
hazard curve (`EV-1` §8 correction 1).

### 2.4 Which objective is the default — RESOLVED 2026-08-27

Points EV is the default currency (placement a switch, `EV-3` §8), which makes **expected score**
the DP's default internal objective — with win and tenpai probability still computed and shown
beside it. The rule from this note stands unchanged: whatever ships says on screen which objective
a grade was given in, or a grader feels arbitrary at exactly the moments it is most right.

### 2.5 How a probability-graded trainer decides "correct" — RESOLVED 2026-08-27

`danger.ts` grades on `rank === 0` with dense ranks, so genuinely equivalent choices tie. A
probability grader has no ties — two tiles will differ in the fourth decimal, and marking the
second wrong would be arbitrary. Resolved: **two thresholds, not one**, matching the
green/yellow/red verdict scale — |ΔEV| ≤ ε₁ grades correct, ε₁ < |ΔEV| ≤ ε₂ grades nearly
(partial credit), beyond ε₂ grades wrong. Both are **Advanced-settings configurable** with
**per-EV-model defaults** — the statistical and houou models answer on different scales, so one
ε pair cannot serve both. The shipped values are provisional constants in one visible table
(`TIER_SCORE` precedent), re-fixed after calibration against real data: an imperfect start is
accepted, adjustability is the requirement. The grading UI must show the band it graded against.

### 2.6 Where the computation runs — RESOLVED 2026-08-27

Main thread first: exact ≤ 2-shanten, the collapsed chain beyond, computed **on demand** (a reader
asking), never speculatively per turn for every seat. A Web Worker is added only if measurements on
a real phone prove the need — nothing in the repo uses a worker today and the pattern's cost must
be earned. Revisit alongside the `'ev'` algorithm's cheap path (§1.9).

### 2.7 Memo lifetime — OPEN, deferred to a dedicated benchmark session

The offense model answers "how often does this hand win" by walking a tree of every possible
future draw. Different paths reach the *same* hand (draw 3p-then-5p equals draw 5p-then-3p), so
the model keeps a notebook of hands already valued — the *memo* — and sharing one notebook across
a whole discard ranking is worth 25–30%. The catch: every note was computed against "these tiles
are still unseen", and that set shrinks every turn, so a notebook kept from last turn is slightly
wrong throughout. Options: bin the notebook after each ranking (always correct, costs the reuse
saving); stamp each note with the exact unseen set it was computed against (faster across turns,
must be designed so a stale note can never be read); or **split the notebook** — winning-hand leaf
values (`score(g)`) do not depend on the unseen pool at all and persist for free, only the
draw-dependent nodes are binned. The benchmark session should test all three.

**The decision rests on two measured variables, and neither is measured yet:** (1) the compute
cost of rebuilding the notebook fresh every time, and (2) the statistical error a stale (or
staleness-guarded) notebook introduces. Settling it is a **dedicated analysis session, outside
this session's scope, with two deliverables: a benchmark script measuring both variables, and a
markdown report**. Lean recorded: fresh and correct as far as feasibility allows — but it boils
down to that feasibility. Default at EV-1 build until the session runs: fresh per ranking.

### 2.8 What happens to `danger.ts` — RESOLVED 2026-08-27

Coexistence confirmed, long-term. The folding trainer grades on **tiers by default, permanently**;
a future wave adds an Advanced option to train against EV-model grading instead (using the §2.5
band). The cross-check test in `EV-2` §9 stays as the disagreement guard between the two
descriptions of the same game.

### 2.9 Whether the golden tests move

They must not, for this wave — nothing is wired in. But if `'ev'` ever becomes any seat's default
algorithm, `round.golden.test.ts` hashes move, and that is a deliberate act requiring the ADR to say
so ([ADR-0016](../docs/adr/0016-testing-strategy.md)).

### 2.10 Placement EV — un-gated; the statistical model owes a pure odds derivation

No longer gated on sequencing (`EV-3` §8, settled in refinement): the placement-odds function is a
property of the EV model, and the houou side is measured data (`Variance.csv` integrated for rank
odds, `AllLast.csv` for South 4, `CoinflipRatio.csv` for calibration). What remains open is the
**statistical model's** placement odds, which must be computed purely: each remaining hand as a
point-transfer random variable with moments from the combinatorics (per-hand expectation from the
`EV-1` DP, spread from the score distribution it prices), final scores as sums, rank odds by
integration. In plain terms: the pure model may not look up measured finish rates, so it derives
them — the rest of the match as a random walk whose steps are scored by its own combinatorics.
That derivation is owed before the placement switch works under the statistical model, and blocks
nothing else. **No decision is pending here** — it is owed mathematics, to be carried out when the
placement switch is built under the statistical model, not an open design question. Round
sequencing itself stays deferred — full-match trainers and self-derived placement tables are the
only things that need it — and remains its own ADR.

### 2.11 Sanma — RESOLVED 2026-08-27

Every EV model declares a **ruleset compatibility matrix** — player count today, any future ruleset
axis a model's data cannot cover tomorrow. An incompatible configuration falls back to the
`statistical` model, and the UI must say so **and why** ("this model was measured on 4-player
Tenhou houou games; no three-player data exists") — never a silent swap. The `houou` model ships
compatible with yonma only; the statistical model is compatible with every ruleset by
construction.

### 2.12 The posture mechanism — OPEN, needs further investigation

Each flavour is an **EV model of its own, derived from the `balanced` statistical model** — the
same relationship the future `ippan` model has to the others — not a dial on top of it. What is
settled: posture binds to the **push/fold decision** and lives in the decision layer alone; a
candidate formulation is the push/fold margin (`D = EV(push) − EV(fold)`; `balanced` pushes iff
`D > 0`; `defensive` needs `D > margin`; `aggressive` accepts `D > −margin`), with `margin`
derived from the decision's own outcome spread, never a typed-in adjustment table.

What is **open**, and needs its own investigation before any flavour ships:

- **What exactly each flavour optimises.** A model that maximises EV-minus-variance is optimal
  *under that modified objective* — "less correct than balanced" is not a well-formed claim, since
  correctness only compares within one objective. Whether the modified objective is the right
  model of the intended playstyle (does a defensive player minimise variance, or maximise
  P(no deal-in), or maximise P(keep current placement)?) is the real question, and it is
  empirical as much as mathematical.
- **Interaction with the placement objective.** Under placement EV, position is already priced —
  "1st with 33k in East 3 folds to preserve the lead" is placement maths, not style. Whether a
  posture layer on top double-counts risk aversion, or captures something placement utility
  genuinely misses, is unresolved.

Deferred with no risk: `balanced` ships first and blocks nothing.

### 2.13 Validation by backtest — proposed dedicated session

The calibration bands (`EV-1` §9 test 4) check the model against rules of thumb; the strongest
check available is against reality itself. Proposal: a dedicated session that replays the houou
logs (`es4p.db`), computes the model's stated probabilities at real decision points, and scores
them — reliability curves and Brier scores per EV model, delivered as a markdown report. Three
payoffs: "is the model any good" becomes a measurement rather than an opinion; the two EV models
gain *measured* quality the lab can display; and the measured calibration error sets the floor
below which a §2.5 ε is noise-grading. Same out-of-scope-here status as the §2.7 benchmark.
