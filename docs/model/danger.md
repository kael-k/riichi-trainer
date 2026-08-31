# What a tile costs

Someone has declared riichi. You are holding thirteen tiles, one of which you are about to throw,
and the only honest question is which of them is least likely to end the hand against you.

The trainer answers that twice, with two models that are deliberately not merged.

The **tier model** sorts your hand into eight named bands — genbutsu, no-chance, one-chance and so
on down to non-suji. It is ordinal: it says this tile is safer than that one and refuses to say by
how much. That is the vocabulary a player actually reasons in, and it is what the folding trainer
grades against by default.

The **deal-in model** answers the quantitative question the tiers cannot: what is the actual
probability that this tile is in their waits, and _why_ — which shapes are still alive, which the
wall has killed, and which their own river has ruled out.

Both read public information only. Neither ever looks at what the threat is really holding, so a
choice that was correct and unlucky still grades as correct.

## The tiers

Safest first: `genbutsu`, `noChance`, `oneChance`, `doubleSuji`, `suji`, `honour`, `halfSuji`,
`nonSuji`.

Two of those placements are worth explaining, because both look wrong at a glance.

**`halfSuji` sits in the outer band, next to non-suji, not with the real suji.** A 4 with only the 1
discarded is protected against exactly one of the two ryanmen that want it, and is still wide open
to the other. It plays like a non-suji 2, not like a genuinely protected tile.

**Honours rank ahead of every non-suji number.** That follows the tier order, and it is a little
optimistic for a lone unseen yakuhai — a known place where the ladder is kinder than the game.

The scores behind the ladder live in exactly one table, `TIER_SCORE` in `core/danger.ts`. That is
the calibration knob for the whole folding trainer, and it is one table on purpose: tuning it means
editing eight numbers in one place rather than hunting rules that each encode their own opinion.
Two of the eight are adjusted rather than flat — an honour gets safer as its copies appear, and a
non-suji number is scored by its distance from the middle of the suit, because fewer ryanmen reach
a terminal than reach a 5.

Ranks are **dense**: two tiles with the same score get the same rank, and the drill grades on
`rank === 0` rather than on position in a list. When two discards really are equivalent, both are
right.

### The arithmetic people get backwards

A shape `(a, a+1)` waits on `a−1` and `a+2`. So the ryanmen that wait on `n` are `(n+1, n+2)` and
`(n−2, n−1)`, and each of those also waits on its **far end**, three ranks away. That far end is the
whole content of suji: a tile is suji when the far end of a ryanmen that wants it is already in the
threat's discards, which makes that one shape furiten and kills it.

A two-tile run whose far end runs off the edge of the suit is a **penchan**, not a ryanmen. `12p`
waits on `3p` alone. That is why 3p is suji off 6p and never off 1p — an easy thing to state
backwards, and the reason the rule is written as arithmetic rather than as a mnemonic.

The wall argument (kabe) checks all three run shapes that could want the tile, the kanchan
`(n−1, n+1)` included. No shape survives and the tile is `noChance`; every surviving shape is down
to a single copy and it is `oneChance`.

Against several threats a tile takes the **worst** tier of any of them, with each threat's own
verdict kept so the reasoning can still be shown per seat.

## The deal-in model

Same board, a different question: not _which band_ but _what probability, and out of what_.

The method is to enumerate rather than to estimate. List every tenpai shape the threat could still
be holding, weight each by how common that kind of wait is and how many ways they could physically
hold it out of the tiles nobody has seen, cross out the ones their river or the wall has made
impossible, and normalise. The chance a tile deals in is the total weight of the surviving shapes
that contain it.

The terms are the point. A number on its own is not much more useful than a tier; a number that
decomposes is:

> 1p is 3.1% — 1.5% that it is a tanki, 1.5% a shanpon, 0.1% kokushi, and nothing else, because the
> 3p wall killed every run that could have wanted it.

### Enumerated by what the hand holds

Hypotheses are enumerated by what the threat would be **holding**, not by what they wait on. That is
what keeps each hypothesis produced exactly once — a ryanmen waits on two tiles and a sanmenchan on
three, so enumerating by wait would count the same hand repeatedly.

| Hypothesis   | Holds              | Waits on          | Exists when         |
| ------------ | ------------------ | ----------------- | ------------------- |
| ryanmen up   | `r+1, r+2`         | `r`, `r+3`        | `r ≤ 6`             |
| ryanmen down | `r−2, r−1`         | `r−3`, `r`        | `r ≥ 4`             |
| sanmenchan   | `r+1,r+2,r+4,r+5`  | `r`, `r+3`, `r+6` | `r ≤ 3`             |
| kanchan      | `r−1, r+1`         | `r`               | `2 ≤ r ≤ 8`         |
| penchan      | `1,2` or `8,9`     | `3` or `7`        | `r ∈ {3, 7}`        |
| tanki        | `r`                | `r`               | always              |
| shanpon      | `r, r`             | `r`               | always              |
| kokushi      | thirteen terminals | all thirteen      | `t` terminal/honour |

Because the events overlap, `Σ_t P(deal in with t)` is **not** 1. It is the expected number of wait
_kinds_, which turns out to be the model's strongest free validation check — see
[the houou model](./houou.md#what-the-numbers-are-checked-against).

**Kokushi is one thirteen-sided hypothesis, not thirteen single-wait ones.** That is what a kokushi
tenpai actually is, and it gets the furiten behaviour right for nothing: any terminal or honour in
the threat's river kills the whole thing at once.

### One furiten rule, two familiar names

A hypothesis is dead when any tile it waits on is already in the threat's discards, or was thrown
by anyone since they declared and not ronned. That single rule produces both of the tiers a player
learns separately:

- The tile itself is in that set, so **every** hypothesis containing it dies — genbutsu, probability
  exactly zero.
- The far end of one ryanmen is in that set, so **that one hypothesis** dies and the rest do not —
  which is suji.

Which is why a suji tile is a few percent rather than zero. Kanchan, tanki and shanpon are untouched
by a suji argument. **No tier below genbutsu ever means safe**: suji only ever spoke about ryanmen,
and a wall only about runs.

The field naming this is `dead: 'genbutsu' | 'furiten' | 'kabe'` — deliberately not `'suji'`. For a
ryanmen, "one of its other waits is in their discards" _is_ suji; for a shanpon or a sanmenchan it
is not, and calling it suji would have the interface assert something the model is not asserting. A
reader who wants the word derives it: `shape === 'ryanmen' && dead === 'furiten'`.

**Dead terms are returned, not filtered out.** "1p is a tanki, a shanpon or a kokushi and nothing
else, because the 3p wall killed every run" needs the crossed-out shapes in order to say so.

### Availability enters as a ratio, never as an absolute

This is the one part of the model that was built wrong first, in a way worth recording because the
mistake is inviting.

The obvious formula is `weight = prior × ways-to-hold`. It is wrong under both priors, for two
different reasons.

Under the **measured** prior it double-counts. Those counts were taken over real boards, so they
already integrate typical availability; multiplying by an absolute count of ways-to-hold applies it
twice, and hardest to the shapes holding the most tiles. A first prototype had a single sanmenchan
hypothesis taking 5.9% of the entire distribution, because its `4⁴ = 256` ways dwarfed a two-tile
shape's `16`.

Under the **uniform** prior it is worse. Raw ways scale as `copies ** (tiles in the shape)`, so
shanpon — 561 hypotheses holding four tiles between them — took about **86%** of the whole
distribution. The result was a board where a live honour priced at 81% of a live 5m and nothing was
meaningfully more dangerous than anything else. That is a prior over tile multisets, not over tenpai
hands, and it was the direct cause of the folding trainer's EV grading putting a live honour and a
genbutsu two points apart.

So availability enters as a **ratio to its own neutral value**:

```
weight(w) = prior(shape, rank) × A(w) / A_neutral(w)

A_neutral:  two-tile run 16 · sanmenchan 256 · tanki 4 · shanpon C(4,2) = 6
```

With nothing visible the ratio is 1 and the model reproduces its prior's marginals exactly; as tiles
appear it deviates, and only then. That is the right shape for the whole design — the prior sets the
level, the combinatorics supply the deviation from it.

Ways-to-hold is still where the wall enters quantitatively. A shape with zero ways is impossible,
which is the tier model's `noChance`; a shape down to one way is merely rare, which is `oneChance`.
The gap between zero and small is the difference between "cannot" and "probably not", and it is
precisely what the tier model cannot express and this one can.

## The two priors

The deal-in model takes its shape frequencies from one of two priors, and which one is in play is
always stated.

**`HOUOU_PRIOR` is measured** — extracted from Tenhou houou logs. Where those numbers come from,
what the sample is, and what it does not cover is [its own page](./houou.md).

**`UNIFORM_PRIOR` is derived, with one stated exception.** It uses no measurements: availability
does all the quantitative work, so a reader can rebuild every number from first principles. But it
cannot be _purely_ combinatorial, and the reason is the same one that limits the offensive model.

Which wait a hand ends on is a **decision, not a sample**. A player breaks the penchan and keeps the
ryanmen; nobody holds thirteen random tiles and reads off whatever shape is left. Combinatorics
cannot see a choice that was already made, and every attempt to let it decide produces a
distribution nobody plays: weight each hypothesis equally and shanpon's 561 members swamp ryanmen's
18; weight each class equally and penchan's 6 members are each worth three ryanmen, which spikes 3
and 7 above 4/5/6.

So the class split is **stated**, on ordinary riichi reasoning, in one table:

| Class      | Mass | Why                                                       |
| ---------- | ---: | --------------------------------------------------------- |
| ryanmen    |    4 | the wait a hand is steered toward, and much the commonest |
| shanpon    |    2 | where a hand with two spare pairs ends up                 |
| kanchan    |    1 | the baseline                                              |
| tanki      |    1 | the baseline                                              |
| penchan    |  0.5 | broken the moment anything better arrives                 |
| sanmenchan |  0.5 | needs four connected tiles to survive to tenpai           |

These were checked against the measured prior for **ordering only** — risk rises from the terminals
toward the middle of a suit, honours sit well below either — and never fitted to it. Fitting would
be borrowing, which [the two models may not do](../index.md#the-models-may-not-borrow-from-each-other).
The residual disagreement is known and one-directional: the derived prior prices an honour at about
1.7% against the measured 1.2%, so `statistical` is the model that folds honours slightly too
readily.

## Ceilings

**The seven honours are one bucket, in both priors.** East and a dragon price identically and differ
only by how many copies are visible. The source aggregates them, so splitting yakuhai from guest
winds needs a new extraction, not a new constant.

**Shanpon is a wait-pair matrix and stays one.** It waits on two kinds at once, so modelling it as
two independent one-wait hypotheses cannot preserve both the normalisation and the wait width — it
reproduces the source's own width as 1.61 kinds against a true 1.78. Kept whole, it reproduces it
exactly.

**Several threats are combined as a product**, `1 − Π(1 − p)`, which assumes independence they do not
have: two threats draw shapes out of one shared pool, so their waits are correlated. The exact joint
enumeration is built and switched off by default; what it costs and what it buys is on the
[limits page](./limits.md#the-joint-enumeration). The combined result always has an entry for every
tile kind — a board with nobody in riichi is one where everything is safe, not one with no tiles on
it.

**Nothing is said about a seat that has not declared.** Reading a silent tenpai is a much weaker
inference and the model returns nothing rather than a number a reader would trust. A consequence
worth knowing: since riichi needs a closed hand, the model can never describe an open one.
