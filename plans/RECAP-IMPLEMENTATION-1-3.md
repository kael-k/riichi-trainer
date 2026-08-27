# RECAP — the first EV-model build (next-wave items 1–3)

_Written 2026-08-27, at the end of the session that implemented them. Branch `feat/ev-algorithm`,
three commits, not pushed._

This file exists so the next session does not re-derive what this one measured, and does not
re-propose what it deliberately left out. It is a **handoff record, not a plan**: the plan is still
`PLAN-ev-model.md`, and where this file contradicts it, this file is what the code does.

| Commit    | Task                        | What                                                                  |
| --------- | --------------------------- | --------------------------------------------------------------------- |
| `a1f3f22` | next-wave items **2 and 3** | `core/dealIn.ts`, `scripts/build-ev-models.mjs`, `core/hououPrior.ts` |
| `a8c1711` | next-wave item **1**        | `core/probability.ts`                                                 |
| `9cc2947` | next-wave item **7**        | `docs/adr/0036`, `CLAUDE.md`, `docs/STRUCTURE.md`, `docs/STATUS.md`   |

Items **4, 5 and 6** — the `'ev'` `SeatAlgorithm`, the per-seat EV-model registry, and kyuushu
kyuuhai engine support — were agreed out of scope for this wave and are **not started**.

`npm test` (541), `npm run lint` and `npm run build` are all green. Nothing imports either new
module: `danger.ts`, `policy.ts`, `algorithm.ts` and `round.ts` are untouched and
`round.golden.test.ts` does not move.

---

## 0. The five places the measurements contradicted the plan

Read this first. These are not preferences — in each case the plan states something the arithmetic
or the clock then disagreed with, and the code follows the measurement. **The `EV-*.md` documents
were not edited**, per the repo's rule that a record is superseded rather than rewritten, so where
they still say the old thing this table is what is true.

| #   | The plan says                                                                       | The measurement says                                                                                                                                                     | Where |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| 1   | Marginalise the shanpon matrix to a per-rank column (`EV-2` §7)                     | That reproduces the source's own wait width as **1.61 kinds against its true 1.78**. Keeping the pair matrix reproduces it exactly                                       | §2.1  |
| 2   | A 2-shanten root is **65 nodes / 3.8 ms** advance-only (`EV-1` §6)                  | **835 nodes / ~21 ms.** The plan measured a DP that follows one discard; taking the `max` over every shanten-minimal discard is the model (`EV-1` §7 says so itself)     | §2.2  |
| 3   | Share one memo across a ranking's fourteen candidates, worth **25–30%** (`EV-1` §9) | Unsound — two candidates reach the same hand having drawn different things. Sharing only what is pool-independent is worth **5.4×**                                      | §2.3  |
| 4   | Collapse to `(shanten, ukeire, draws)` beyond the ceiling (`EV-1` §9)               | Reading ukeire off the **best** draw overstates a 2-shanten win probability by **190%**. An availability-weighted mean is 9–31% high, and exact at tenpai                | §2.4  |
| 5   | The river brings a non-suji **down** toward the published 5–6% (`EV-2` §7)          | Backwards. Killing hypotheses can only **raise** the survivors: a live non-suji middle tile against a realistic river is **9–12%**, and that is consistent with the data | §2.5  |

Number 5 is the one with consequences beyond its own line: it invalidates `EV-2` §9's validation
bands, which is why calibration was rebuilt against an independent measurement instead — see
§3.

Numbers 1 and 2 also mean two tables printed in the plan are wrong in detail: `EV-2` §7's expanded
per-rank table under-counts diagonal shanpon hands, and `EV-1` §6's node-count columns describe a
weaker traversal than the one specified two sections later.

The remaining differences in §2 are **judgement calls**, not contradictions: the plan left them open
or its sketch was provisional.

---

## 1. The API as built

```ts
// core/dealIn.ts
dealInRisk(threat: ThreatView, visible: Uint8Array, sanma: boolean, prior?: ShapePrior): DealInRisk[]
combineThreats(risks: DealInRisk[][]): DealInRisk[]
impliedWaitWidth(risks: DealInRisk[]): number
UNIFORM_PRIOR, KOKUSHI_SHARE
type WaitShape, ShapePrior, DealInTerm, DealInRisk

// core/probability.ts
handOutlook(hand, seen, sanma, draws, opts?): Outlook
discardOutlooks(hand, seen, sanma, draws, opts?): Map<TileId, Outlook>
type Outlook, ScoringContext, OutlookOptions

// core/hououPrior.ts — GENERATED, do not edit
HOUOU_PRIOR, HOUOU_OPEN_PRIOR, HOUOU_PRIOR_META
```

`dealInRisk` returns **34 entries in tile order**, so a caller indexes by `TileId` directly. Each
carries every hypothesis that waits on that tile, **live and dead**, live first by weight.

Regenerate the prior with `npm run build-ev-models`. It fetches
`chienshyong/houou-statistics@80dc535` over the network; `--dir <path>` reads local CSVs instead.

---

## 2. Deviations from the specification in `EV-1`–`EV-3`

§2.1–2.5 are the five corrections §0 lists, in full. §2.6–2.10 are judgement calls the plan left
open or sketched provisionally, and §2.11 is an approximation accepted knowingly. The durable
record of all of it is `docs/adr/0036-probability-beside-the-tiers.md`; this section is the detail
behind it.

### 2.1 Shanpon stays a wait-pair matrix (`EV-2` §7 said marginalise it) — forced

`EV-2` §7 says "shanpon is a 10×10 wait-pair matrix; the per-rank column below is its marginal —
extraction must sum the matrix, not read a column". Summing the matrix is right; **collapsing the
result to one-wait-per-rank hypotheses is not.** A shanpon waits on two kinds at once. Modelling it
as two independent single-wait hypotheses cannot preserve both the hypothesis-count normalisation
and the wait width: it reproduces the source's own width as **1.61 kinds against its true 1.78**.

The matrix is therefore kept whole and enumerated as pairs (561 hypotheses, still microseconds),
which reproduces 1.7823 exactly. `HOUOU_PRIOR.shanpon` is `shanpon[low][high]`, index 0 = honours,
upper triangle only. Its diagonal is **not** a self-pair — `(5, 5)` means both waits fell in rank
bucket 5, e.g. 5m and 5p — so the bucket division for it is `C(3,2)` and not `3 × 3`.

**Consequence for `EV-2`'s own tables:** the expanded per-rank table printed in `EV-2` §7 counts a
diagonal shanpon hand once where it should count twice. Its ryanmen/sanmenchan/penchan/kanchan/tanki
rows are correct and were verified against the CSV.

### 2.2 The plan's DP node counts were of a weaker DP — forced

`EV-1` §6 reports 65 nodes / 3.8 ms for a single advance-only 2-shanten root. The implementation
here measures **835 memo entries / ~21 ms**. The difference is not an inefficiency: `choose` takes
the `max` over **every** shanten-minimal discard, which `EV-1` §7 states is where the whole model
lives. A DP that follows one discard is a greedy chain, and it is what the plan's numbers describe.

The plan's _ranking_ figures survive anyway, for a different reason — see 2.3.

### 2.3 The shared memo is unsound; the sound sharing is worth more — forced

`EV-1` §9 asks `discardOutlooks` to share **one memo across all fourteen candidates**, measured at
25–30% off both node count and wall time. It cannot: a node's value depends on which tiles have
left the unseen pool, and two candidates that discarded different tiles reach the same hand having
drawn different things to get there. Sharing would let whichever candidate ran first answer for the
rest — a real error, not a rounding one.

What **is** pool-independent is shared instead, via `HandCaches`: `improvingTiles`, `bestDiscards`,
and the leaf `scoreHand` results. That is where the shanten probes actually are, and it measured
**5.4×**, not 30%.

Measured on the machine this was written on, 12 draws:

| Hand      | Single root | 14-way ranking | Plan's claim |
| --------- | ----------- | -------------- | ------------ |
| tenpai    | 0.2–0.5 ms  | **8–10 ms**    | 0.7 ms       |
| 2-shanten | ~21 ms      | **~89 ms**     | 84 ms        |

So `EV-1`'s **cost boundary is confirmed** (exact ≤ 2-shanten interactive) even though the node
counts behind it were not.

### 2.4 The collapsed chain averages, it does not take the best draw — forced

`EV-1` §9 specifies only that the state "collapses to `(shanten, ukeire, draws)`". The obvious
implementation — walk the hand forward along its best improving draw and read the ukeire off that
path — **overstates a 2-shanten win probability by 190%**, because the width it reports for the
last step is the widest tenpai the hand could reach rather than the one it typically reaches.

`advance()` therefore takes the **availability-weighted mean** of where each improving draw would
leave the hand (a draw with three copies left is three times as likely to arrive), and walks to
whichever draw lands nearest that mean. Measured against the exact DP: **9–31% high** at 2-shanten
across 8, 12 and 18 draws, and **exact at tenpai**, where it reduces to the same hypergeometric.

No leaf is ever reached in collapsed mode, so `score` and `winAtLeast` come back **undefined**
rather than 0. `maxShanten` defaults to 2.

### 2.5 `EV-2` §7's claim about the river is backwards — forced

`EV-2` §7 says the unconditional 8.1% "is the **ceiling** for a tile about which nothing is known;
the threat's own river then knocks hypotheses out and brings a real non-suji down toward the
published 5–6%". That is mathematically wrong under this model, and under any model of the same
shape: killing hypotheses can only **raise** the surviving ones after normalisation. Measured, a
live non-suji middle tile against a realistic 8–10 tile river comes out at **9–12%**, not 5–6%.

This is not a bug and it is consistent with the data. `Σ_t P(t ∈ waits) ≈ 1.78` is a hard fact from
the source file; with ~9 kinds genbutsu, the survivors must average ~7%. The "5–6% non-suji" figure
quoted in `EV-4` §3 is a different quantity, measured per-discard over real play, and it is not a
band this model can be validated against.

**So the `EV-2` §9 validation bands were replaced**, not merely loosened — see §3 below.

### 2.6 `Outlook` ships no corrected `win` field — judgement

`EV-1` §9's sketch has `win: number[]` beside `soloWin`, "after the hazard and ron corrections".
Neither correction exists — the hazard curve needs a survival model and the ron uplift is `EV-2`
run backwards with you as the threat, a second real model — so emitting the field would mean
inventing a number, which is the exact failure ADR-0004 was written against.

`Outlook` therefore carries `soloWin`, `soloTenpai`, `score?`, `winAtLeast?` and `exact`, and the
module's own doc comment says the raw figure must never be shown with a percent sign on it.

**Also scalar, not per-draw arrays.** The sketch has `soloTenpai: number[]` / `soloWin: number[]`
indexed by remaining draw. Computing the curve costs roughly `draws ×` the scalar, because
`V(root, k)` for each smaller `k` is a genuinely new set of states. A caller wanting the curve loops
over `draws`. A vectorised memo (one `Value` array per hand rather than per hand-and-draw) would get
it for ~1.5–3× instead, and is the right move **if** something ever needs the curve.

### 2.7 `DealInTerm.dead` is `'furiten'`, not `'suji'` — judgement

`EV-2` §10 has `dead?: 'genbutsu' | 'suji' | 'kabe'`. For a ryanmen, "one of its other waits is in
their discards" **is** suji. For a shanpon or a sanmenchan it is not, and labelling it suji would
have the UI make a claim the model is not making. The field is `'genbutsu' | 'furiten' | 'kabe'`; a
consumer that wants the word "suji" derives it as `shape === 'ryanmen' && dead === 'furiten'`.

### 2.8 `DealInTerm` gained a `seat` field — judgement

Not in the `EV-2` §10 sketch. `combineThreats` concatenates terms across threats, and without it an
explanation could not say which seat a hypothesis belongs to.

### 2.9 `ShapePrior` collapses two switches into one — judgement

`EV-2` describes the pure prior as "weight 1 per shape class, raw `A`" and the empirical one as
"measured counts, `A / A_neutral`". Those always co-vary, so `ShapePrior.kind` is a single
`'measured' | 'uniform'` rather than separate prior-source and availability-mode fields. `'measured'`
additionally divides a bucket by the number of hypotheses sharing it (3 suits, or 7 honour kinds);
`'uniform'` does not, since its weights are already per-hypothesis.

### 2.10 Kokushi is one thirteen-sided hypothesis, not thirteen — judgement

`EV-2` §3 lists kokushi as "holds `t`, waits `t`" per terminal — thirteen single-wait hypotheses,
each carrying a thirteenth of the mass. Modelled instead as **one** hypothesis waiting on all
thirteen, which is what a kokushi tenpai actually is, and which gives the right furiten behaviour
for free: any terminal or honour in the threat's river kills it outright. `A` is held flat at 1
rather than a thirteen-way product, which would swing wildly on one walled terminal.

Its weight is `KOKUSHI_SHARE` (**0.001**) × the total weight of every other hypothesis, so the one
stated constant means the same thing under either prior. The single-wait kokushi — twelve kinds plus
a pair — is not modelled at all.

### 2.11 Memo path-dependence inside the exact DP — known, accepted

The memo is keyed on `(hand, draws remaining)`, and `unseen` is mutated along the DFS. Under
advance-only these agree **except** when a tile drawn earlier is discarded later (draw 3p, keep it,
draw 4p, throw the 3p). Then the first visit's pool is baked in for that node. Rare, deterministic,
and therefore pure; it is the one approximation inside the path that reports `exact: true`, where
`exact` means "the DP ran rather than the collapsed chain" — which is what `EV-1` §9 defines it as.

Removing it means keying the memo on the drawn multiset too, which defeats the memo.

---

## 3. Validation, as actually built

`EV-2` §9's bands ("non-suji 5–6%, suji 3–4% against a realistic river") were **not used**, for the
reason in 2.5. They were replaced with something stronger and data-derived.

**`results/DorasobaDanger.csv` is an independent measurement.** A different analyzer over the same
database counts, per rank, how often a riichi waits on some tile of that rank — measured directly
per tile, where the prior is built from wait _shape_ counts. The extraction script emits it as
`HOUOU_PRIOR_META.waitByRank` and `dealIn.test.ts` checks the model's unconditional answers against
it. Nothing about the model forces the agreement:

| Rank        | 1    | 2    | 3    | 4    | 5    | 6    | 7    | 8    | 9    |
| ----------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| model       | 4.31 | 5.45 | 6.45 | 8.07 | 8.23 | 8.14 | 6.49 | 5.49 | 4.37 |
| measured ÷3 | 4.10 | 5.88 | 7.15 | 7.89 | 8.64 | 8.09 | 7.11 | 5.51 | 3.65 |
| ratio       | 1.05 | 0.93 | 0.90 | 1.02 | 0.95 | 1.01 | 0.91 | 1.00 | 1.20 |

Rank 9 is the outlier because the source itself is asymmetric (rank 1 at 12.30% against rank 9 at
10.94%) in a way a symmetric shape model cannot reproduce. The test asserts within 25%.

The other checks that matter: implied wait width reproduces `HOUOU_PRIOR_META.width` to 9 decimal
places (the check that catches an availability term counted twice); genbutsu is exactly 0; the
tier-model cross-check pins genbutsu < kabe < double suji < non-suji; and `probability.ts` pins the
hypergeometric closed form to 12 decimal places at five draw counts.

**Provenance caveat worth carrying forward:** `WaitDistribution.csv` covers **142,461 riichi tenpai
hands**, not the full 893,440-game database — upstream's `rowcount` caps how many logs an analyzer
reads. It is in the generated file's header. The four blocks are internally exact (137,567
enumerated + 4,894 complex = 142,461), which is how the extraction script guards that it read them
in the right order.

---

## 4. Left undone, and what it would cost

Ordered by how likely the next session is to want it.

### 4.1 `combineThreats` uses the product, not the joint enumeration

`EV-2` §5 plans the joint path for up to two threats (~15k compatible-pair checks, sub-millisecond)
falling back to the product for three. Only the product is built. It assumes independence, which is
wrong in a known direction: two threats draw shapes out of one shared pool, so their waits are
negatively correlated and the union **overstates**. The function's own doc comment says so.

Small, self-contained, no API change.

### 4.2 `HOUOU_OPEN_PRIOR` is extracted but unreachable

The generated file carries it; `dealIn.ts` does not export or use it. `ThreatView` has no field
saying whether a seat has melded, and the model refuses to speak about undeclared seats at all
(`EV-2` §2), so there is nothing to select it with yet. Using the closed-riichi block against a
melded threat is `EV-5` §1.10's known wrongness and remains one.

Wiring it needs a `ThreatView` field, which is a `round.ts#threatViews` change — the first thing in
this wave that would touch the engine.

### 4.3 The bounded-widening middle path is not built

`EV-1` §6 records it: follow a shanten-preserving draw when the new hand's ukeire exceeds the old by
a stated margin, capped at one sideways move per path. Advance-only is what ships, and it
understates win probability uniformly. Cost is a build-time measurement nobody has taken.

### 4.4 Everything `EV-3` needs is still missing

Nothing decides with these two layers. `EV-3` §5 states the gate plainly and it has not moved:
**folding is priced one turn at a time, so push and fold cannot honestly be compared.** That
multi-turn safety recursion is the largest single piece of unbuilt work in the whole design. The
`BetaoirCost.csv` table read is the shortcut `EV-3` §5 records for the houou model's v1, and it is
not extracted either.

`value_j` (what a deal-in costs) and `P_tsumo_against` are likewise unmodelled — `EV-3` §3 already
lists them as the two honest gaps.

### 4.5 Not started at all, by agreement

Next-wave items **4–7**: the `'ev'` `SeatAlgorithm` and its cheap path (`EV-5` §1.9's candidate
union, with `K`/`J` as versioned algorithm constants), the per-seat EV-model registry and its live
plumbing, kyuushu kyuuhai engine support (the one piece that _does_ touch `round.ts` and moves
`round.golden.test.ts` hashes deliberately), and any trainer surface.

### 4.6 The two measurement sessions the work owes

Both were already out of scope in the plan and remain so:

- **Memo lifetime** (`EV-5` §2.7). Fresh-per-ranking is what shipped and remains the lean. Note that
  the split-notebook option that section describes is **partly built already** — `HandCaches` is
  exactly "the values that do not depend on the unseen pool", and it is where the 5.4× came from.
  What is unmeasured is whether keeping anything _pool-dependent_ across turns is worth its error.
- **Backtest against real logs** (`EV-5` §2.13). This is the only thing that turns "is the model any
  good" into a number, and it is the only work that justifies fetching the ~8 GB database (five
  per-year files on Google Drive behind a virus-scan interstitial, 1.6 GB for 2016 alone). The
  build script's header records why it is not a build input.

### 4.7 Coverage gaps carried forward unchanged

All of `EV-5` §1.10 still stands: no redness in the DP (draws are at kind level, so expected score
is systematically slightly low), no ura or ippatsu, no kan or kita replacement draws, chiitoi tanki
folded into plain tanki on the defence side, and the houou prior is four-player data being applied
under sanma if anyone asks it to. `EV-5` §2.11's ruleset compatibility matrix is not built — nothing
selects a model yet, so there is nothing to fall back from.

---

## 5. Things that would be easy to get wrong next

- **`hououPrior.ts` is generated.** Edit `scripts/build-ev-models.mjs` and re-run, never the output.
  It `import type { ShapePrior } from './dealIn'` — type-only, so there is no runtime cycle, but a
  change to `ShapePrior` means regenerating.
- **The bucket divisor is part of the model, not the data.** The generated tables are the CSV's own
  aggregated counts; `dealIn.ts` divides by 3 (numbered ranks) or 7 (honours), and by
  `shanponBucketSize` for pairs. Moving that division into the generator would make the tables stop
  matching the source.
- **`objective` changes every number, not just the ranking.** All of `Outlook` is reported under the
  policy that was optimised. Whatever consumes it must say which on screen — `EV-1` §7 is emphatic
  and it is a real, frequent distinction.
- **`priceWin` returning `null` is "no yaku", and it gates the win.** Same two-part test `round.ts`
  uses. Without a `ScoringContext` the model can only see the shape and says so by leaving `score`
  undefined; the default objective silently becomes `'win'` in that case, because a score objective
  with nothing to score by would rank every discard 0 and pick whichever came first.
- **Dead terms are returned on purpose.** Anything filtering `terms` to the live ones throws away
  the explanation the module exists to produce.
