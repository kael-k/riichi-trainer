# EV-2 — Deal-in probability: the wait-hypothesis model

## 1. In one paragraph

A player in riichi is waiting on something, and you do not know what. But you know a great deal
about what they *cannot* be waiting on: anything in their own discards, anything whose shape needs
a tile all four copies of which are already face up, anything that would make them furiten. So list
every wait they could still hold, give each one a weight — how common that kind of wait is, times
how many ways they could physically be holding it out of the tiles nobody has seen — cross out the
impossible ones, and normalise. The chance a given tile deals in is then just the sum of the
weights of the waits that contain it. That sum is the number, and its terms are the explanation:
*1p is 3.1% — 1.5% that it is a tanki, 1.5% a shanpon, 0.1% kokushi, and nothing else, because the
3p wall killed every run that could have wanted it.*

## 2. What it computes, and what it refuses to

**Computes:** `P(t ∈ their waits | everything publicly visible)`. Public information only — the
threat's actual hand is never consulted, so a correct-but-unlucky discard still grades correct, the
same discipline `core/danger.ts` already holds to.

**Refuses:** any claim about a seat that has not declared. Reading a silent tenpai is a different
and much weaker inference, and the model should return nothing rather than a number the reader
would trust. See `EV-5`.

## 3. The hypotheses

For a candidate tile `t` of rank `r` in its suit, every shape that could be waiting on it:

| Hypothesis   | The threat holds     | Waits on           | Exists when          |
| ------------ | -------------------- | ------------------ | -------------------- |
| ryanmen up   | `r+1, r+2`           | `r`, `r+3`         | `r ≤ 6`              |
| ryanmen down | `r−2, r−1`           | `r−3`, `r`         | `r ≥ 4`              |
| sanmenchan   | `r+1,r+2,r+4,r+5`    | `r`, `r+3`, `r+6`  | `r ≤ 3`              |
| kanchan      | `r−1, r+1`           | `r`                | `2 ≤ r ≤ 8`          |
| penchan      | `1,2` or `8,9`       | `3` or `7`         | `r ∈ {3, 7}`         |
| tanki        | `r`                  | `r`                | always               |
| shanpon      | `r, r`               | `r`                | always               |
| kokushi      | `t`                  | `t`                | `t` terminal/honour  |

Two things worth not re-deriving wrong, both of which `core/danger.ts` already states in prose and
this model states in arithmetic:

- A shape `(a, a+1)` waits on `a−1` and `a+2`. So the ryanmen that wait on `n` are `(n+1, n+2)` and
  `(n−2, n−1)` — each also waits on its **far end**, three ranks away. That far end is the entire
  content of suji.
- A two-tile run shape whose far end runs off the suit is a **penchan**, not a ryanmen. `12p` waits
  on `3p` only. This is why 3p is suji off 6p but never off 1p.

## 4. The weight

```
weight(w)  =  prior(shape, index rank)  ×  A(w)
```

`A(w)` counts the ways the threat could physically be holding that shape out of the unseen tiles,
where `u(x) = 4 − visible[x]`:

| Shape                        | `A`                          |
| ---------------------------- | ---------------------------- |
| two-tile run (ryanmen etc.)  | `u(a) · u(b)`                |
| sanmenchan (four tiles)      | `u(a)·u(b)·u(c)·u(d)`        |
| tanki                        | `u(t)`                       |
| shanpon                      | `C(u(t), 2)`                 |

**`A` is where the wall enters quantitatively.** `u(a) = 0` makes a shape impossible — that is
`noChance`. `u(a) = 1` makes it merely rare — that is `oneChance`, and the difference between a
zero and a small number is the difference between "cannot" and "probably not", which the tier model
cannot express and this one can.

### One furiten rule, two familiar names

```
w is dead  if  waits(w) ∩ (threat.discards ∪ threat.passed) ≠ ∅
```

That single line produces both tiers people learn separately:

- **genbutsu** — `t` itself is in the set, so *every* hypothesis containing `t` dies. `P(t) = 0`.
- **suji** — the far end of one ryanmen is in the set, so *that one hypothesis* dies and the rest do
  not. This is exactly why a suji tile is around 3% rather than 0%: kanchan, tanki and shanpon are
  untouched by a suji argument, which is the reason **no tier below genbutsu may ever read as
  "safe"**.

`ThreatView` in `core/danger.ts` already carries both sets — `discards` (their own river, taken from
`RoundState.discards` so a called tile is not lost) and `passed` (anything thrown since they
declared, which they did not ron). No new plumbing.

## 5. Normalisation, and why it is over hypotheses rather than tiles

Their wait is one hypothesis `W`, drawn with

```
P(W = w)  =  weight(w) / Σ_w' weight(w')
```

summed over **every** hypothesis on the whole board, all suits and honours — not per suit, or the
scale would be wrong. Then

```
P(deal in with t)  =  P(t ∈ waits(W))  =  Σ_{w : t ∈ waits(w)}  P(W = w)
```

A ryanmen contributes to two tiles and a sanmenchan to three, so these events overlap and
`Σ_t P(deal in with t)` is **not** 1 — it is the expected number of wait *kinds*, and that gives a
free and very strong validation check (§8).

Several threats take the union, not the worst:

```
P = 1 − Π_j ( 1 − p_j )
```

which is where this model differs materially from `assessDiscards`, which takes the worst tier
across threats and says so in its own comment ("slightly optimistic — the real risk is the union").
The product assumes independence, and it is not exact: two threats hold shapes out of one shared
tile pool, so their waits are correlated (they cannot hold the same copies). The honest form
enumerates hypotheses **jointly** — and it is affordable: the hypothesis space is roughly 140 per
threat, so two threats are ~15k compatible-pair checks (sub-millisecond, interactive), three
threats are ~2M (on-demand only, ~10–50 ms). Plan: `combineThreats` takes the joint path for up to
two threats and falls back to the product for three, the cost measured at build. The product stays
as the fallback, read as the approximation it is.

## 6. Worked example

**Board.** One seat in riichi. Their discards include **2p** and **8p**. All four **3p** are
visible. You hold one 1p, so `u(1p) = 3`; everything else in pin is `u = 4`.

**1p — the case from the original question.**

| Hypothesis        | Holds      | Waits    | `A`  | Verdict            |
| ----------------- | ---------- | -------- | ---- | ------------------ |
| ryanmen up        | `2p 3p`    | 1p, 4p   | 0    | **dead** — 3p wall |
| sanmenchan        | `2p3p5p6p` | 1p,4p,7p | 0    | **dead** — 3p wall |
| ryanmen down      | —          | —        | —    | off the suit       |
| kanchan           | —          | —        | —    | rank 1 has none    |
| penchan           | —          | —        | —    | only ranks 3, 7    |
| tanki             | `1p`       | 1p       | 3    | live               |
| shanpon           | `1p 1p`    | 1p       | `C(3,2)=3` | live         |
| kokushi           | `1p`       | 1p       | 3    | live, tiny prior   |

Exactly the decomposition the question asked for: with every run shape walled off, 1p is a tanki, a
shanpon or a kokushi and nothing else.

**5p — double suji.** Both ryanmen that could want 5p (`3p4p` waiting 2p/5p, and `6p7p` waiting
5p/8p) are furiten-dead on 2p and 8p. What survives is the kanchan `4p6p`, the 5p tanki and the 5p
shanpon. A real number, not a zero.

**6p — non-suji.** Nothing is dead. `7p8p` (waits 6p/9p), `4p5p` (waits 3p/6p), the sanmenchan
`4p5p7p8p`, the kanchan `5p7p`, tanki and shanpon all live. This is the tile the model should rank
worst, and it does.

**4p.** The `5p6p` ryanmen lives; the `2p3p` ryanmen and the `3p5p` kanchan are both wall-dead on
3p. A tile that is neither suji nor safe, sitting where the tier model has to round it to one or the
other.

## 7. The two priors, side by side

### Pure — `UNIFORM_PRIOR`

Every shape class weight 1. The number is then **availability alone**: pure combinatorics, no
empirical input, fully self-contained, and derivable from first principles by the reader. It is not
merely a test fixture — half the point of the statistical lab is showing the two numbers next to
each other and letting the difference be the lesson.

### Empirical — `HOUOU_PRIOR`

`chienshyong/houou-statistics`, `results/WaitDistribution.csv`, from 893,440 Tenhou houou four-player
hanchan logs. Closed-riichi block, computed this session:

| Shape       | Hands    | Share of enumerated waits |
| ----------- | -------- | ------------------------- |
| ryanmen     | 76 208   | 55.4 %                    |
| kanchan     | 23 168   | 16.8 %                    |
| shanpon     | 15 067   | 11.0 %                    |
| tanki       | 8 365    | 6.1 %                     |
| sanmenchan  | 8 173    | 5.9 %                     |
| penchan     | 6 586    | 4.8 %                     |
| **total**   | **137 567** | ryanmen + sanmenchan = **61.3 %** |

137 567 enumerated + 4 894 complex waits = **142 461**, which is the file's own `Total riichi`
exactly. The enumeration is complete and each hand is counted once.

**The indexing convention — confirmed against the analyzer source 2026-08-27.** Rows are ranks, and
each shape is indexed by the **lowest tile it waits on** (`wait_distribution.py` writes
`loc[wait[0]%10, shape]`): ryanmen is nonzero only at ranks 1–6, sanmenchan only at 1–3, penchan
only at 3 and 7, kanchan at 2–8. Three extraction caveats the confirmation surfaced:

- The ryanmen/shanpon split is an **ukeire threshold** (`uke >= 5` counts as ryanmen), not a shape
  test — a true ryanmen with four or more of its copies already visible lands in the shanpon
  matrix. The prior misclassifies a little at high visibility.
- Honour tanki is bucketed `honor / honor 1 / honor 2` by copies visible **across all four rivers**,
  not the threat's — the per-rank table already integrates a visibility signal.
- Shanpon is a 10×10 wait-pair matrix; the per-rank column below is its marginal — extraction must
  sum the matrix, not read a column.

Expanding by the convention gives what the model actually wants, hands whose wait set *contains*
each rank (all three numbered suits aggregated):

| Rank | sanmenchan | ryanmen | penchan | kanchan | tanki | shanpon | total  |
| ---- | ---------- | ------- | ------- | ------- | ----- | ------- | ------ |
| 1    | 2 735      | 11 177  | 0       | 0       | 734   | 2 654   | 17 300 |
| 2    | 2 756      | 12 740  | 0       | 3 604   | 595   | 2 709   | 22 404 |
| 3    | 2 682      | 14 199  | 3 237   | 3 646   | 620   | 2 217   | 26 601 |
| 4    | 2 735      | 25 189  | 0       | 3 004   | 232   | 2 148   | 33 308 |
| 5    | 2 756      | 25 428  | 0       | 2 489   | 639   | 2 634   | 33 946 |
| 6    | 2 682      | 25 591  | 0       | 2 968   | 225   | 2 151   | 33 617 |
| 7    | 2 735      | 14 012  | 3 349   | 3 737   | 650   | 2 269   | 26 752 |
| 8    | 2 756      | 12 688  | 0       | 3 720   | 647   | 2 777   | 22 588 |
| 9    | 2 682      | 11 392  | 0       | 0       | 712   | 2 736   | 17 522 |
| honour | 0        | 0       | 0       | 0       | 3 311 | 6 612   | 9 923  |

The middle ranks carry roughly twice the ryanmen exposure of the ends, which is the quantitative
version of `NON_SUJI_DISTANCE` in `danger.ts` — and it is measured rather than chosen.

Unconditionally (nothing visible, no river known), a specific middle tile such as 6p is in a
riichi's waits about `33 617 / 3 / 137 567 ≈ 8.1 %` of the time. That is the **ceiling** for a tile
about which nothing is known; the threat's own river then knocks hypotheses out and brings a real
non-suji down toward the published 5–6%.

### The river is evidence — the v2 seam

The prior is static: it does not change with what the threat discarded. But the river *is* evidence
about the hand — a riichi declared on 8p makes near-8p waits likelier (`RiichiTile.csv`), a tile
outside an early discard is measurably safer (`Sotogawa.csv`), an honour tedashi narrows the shape
(`TedashiReading.csv`). The weight formula admits this as a likelihood factor without changing
shape: `weight(w) = prior(shape, rank) × L(w | river) × A(w)/A_neutral(w)`, with `L ≡ 1` in v1.
The published tables give `L` per hypothesis class; the Bayes form is recorded now so v2 is a
table drop-in, not a redesign.

## 8. The correction the prototype exposed — read this before implementing

A first prototype multiplied the empirical prior by the raw `A` and normalised. It is wrong, and
wrong in an instructive way. Two symptoms:

- Implied expected wait width came out at **2.25 kinds** against the file's own **1.773**.
- A non-suji 6p came out at **11.95 %**, above even the 8.1 % unconditional ceiling.
- A single sanmenchan hypothesis alone took 5.9 %, because `A = 4⁴ = 256` dwarfed every two-tile
  shape's `16`.

**Cause: the prior and the availability term are not independent.** The empirical counts were
measured over real boards, so they *already* integrate over typical availability. Multiplying by an
absolute `A` counts it twice, and it counts it hardest for the shapes with the most tiles in them.

**Fix: availability enters as a ratio to its own neutral value.**

```
weight(w) = prior(shape, rank) × A(w) / A_neutral(w)

A_neutral:  two-tile run 16 · sanmenchan 256 · tanki 4 · shanpon C(4,2)=6
```

With nothing visible the ratio is 1 and the model reproduces the empirical marginals *exactly*; as
tiles become visible it deviates, and only then. This is the right shape for the whole design: the
empirical layer sets the level, the combinatorial layer supplies the deviation from it.

The `UNIFORM_PRIOR` path takes the raw `A`, unnormalised — there is no empirical level for it to
preserve, and its whole point is to show what pure availability says on its own.

## 9. Validation targets

- **Wait width.** `Σ_t P(deal in with t)` must land near **1.773 kinds** with nothing visible, and
  the file's `Riichi width avg = 6.409887618` *tiles* is the same fact at ~3.6 unseen copies per
  kind. This one check catches the §8 error immediately and should be the first test written.
- Genbutsu is exactly `0`, every term marked dead.
- A full kabe kills every run term and leaves tanki/shanpon alive — the model must not call it safe.
- Suji drops the tile but leaves it well above zero.
- Against a realistic 8–10 tile riichi river: non-suji **5–6 %**, suji **3–4 %**, a full betaori
  hand **3–5 %** per turn. Base ryanmen `1/18 ≈ 5.6 %` is the sanity anchor.
- Ordering agrees with `assessDiscards`' tiers on unambiguous cases
  (genbutsu < noChance < suji < nonSuji), which is the cross-check that the two models are
  describing the same game.

## 10. Sketch of the module this specifies

```ts
export type WaitShape = 'ryanmen' | 'sanmenchan' | 'kanchan' | 'penchan'
                      | 'tanki' | 'shanpon' | 'kokushi'

export interface DealInTerm {
  shape: WaitShape
  /** Tiles the threat would be holding — what the explanation draws. */
  holds: TileId[]
  /** Every tile this hypothesis waits on, not just the one being asked about. */
  waits: TileId[]
  ways: number
  weight: number
  probability: number
  dead?: 'genbutsu' | 'suji' | 'kabe'
}

export interface DealInRisk { tile: TileId; probability: number; terms: DealInTerm[] }

export function dealInRisk(threat: ThreatView, visible: Uint8Array,
                           sanma: boolean, prior?: ShapePrior): DealInRisk[]
export function combineThreats(risks: DealInRisk[][]): DealInRisk[]
export const UNIFORM_PRIOR: ShapePrior
export const HOUOU_PRIOR: ShapePrior     // provenance in the comment above it
```

- Takes `ThreatView` unchanged; `threatViews(state)` in `round.ts` already builds them.
- Sanma reuses `inTileSet` the way `assessDiscards` does — a tile outside the set counts as four
  visible, so every shape needing it is dead.
- Pure and total, every ranking with an explicit tie-break. Cost is a few hundred integer operations
  per threat — microseconds, nothing like the offense model.
- `HOUOU_PRIOR` carries the source URL, the pinned commit and the retrieval date in a header
  comment. `TIER_SCORE` in `danger.ts` is the precedent for keeping a calibration table in one
  visible place.

## 11. Sources

- `chienshyong/houou-statistics` — `results/WaitDistribution.csv` (the prior),
  `results/RiichiTile.csv` (deal-in tile distribution per declaration tile),
  `results/Sotogawa.csv` (outside-tile danger), `results/WallReading.csv`. 893,440 logs, five-year
  Tenhou houou database. Retrieved 2026-08-26.
  **The repository ships no LICENSE file** — see `EV-5`.
- `core/danger.ts` — the tier model this one derives rather than replaces.
- Published rules of thumb for the validation bands: see `EV-4`.
