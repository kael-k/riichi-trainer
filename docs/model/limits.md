# What the models get wrong

Every model here is wrong in ways that are known, and the useful thing about a model built from
terms rather than from one number is that its errors can be named, signed, and often sized. This page
is that list.

Nothing below is a bug report. These are the stated boundaries of what shipped.

## Where the offensive model is wrong

**It is exact about a smaller game than mahjong.** The win-probability DP follows only draws that
strictly lower shanten, so it never sees a hand improve sideways — the widening move real hands make
constantly. The error is one-directional: it **understates** win probability, uniformly enough across
candidate discards that the ranking survives.

**It has no opponents in it, and the two missing corrections do not cancel.** Raw win probability
runs about 11% below the published rate at turn 3 and 20% above it at turn 12. The mid-game
agreement is a coincidence of magnitudes. It is why no corrected figure ships at all and why the raw
one is never shown as a percentage.

**Deep hands are a floor, not an estimate.** Above 2-shanten a collapsed chain replaces the DP and
the result is flagged inexact. Measured against the exact answer, the median ratio is 1.00 at
3-shanten, 0.88 at 4 and 0.63 at 5.

### Coverage gaps

**Red fives are invisible to the DP.** The scorer prices them, but the traversal draws at tile-_kind_
level and never sees redness, so expected score is systematically slightly low.

**A win at the DP's leaf is priced as a tsumo**, because the one-player model has no ron in it.

**Chiitoitsu tanki is folded into plain tanki** in the deal-in model, which understates honour and
terminal danger against a seven-pairs hand. Kokushi has its own hypothesis; the single-wait kokushi
— twelve kinds plus a pair — is not modelled at all.

## Where the defensive model is wrong

**No wall reading, no dora-soba, no sotogawa.** A tile next to a dora is measurably more dangerous
and a tile outside an early discard measurably safer. Both are real effects, both are published in
the same dataset, and both are currently priced at zero.

**The prior has no turn dependence.** A turn-4 riichi and a turn-14 riichi do not hold the same
distribution of wait shapes — the late one has been narrowed by everything that passed. The extracted
table is a marginal over all turns.

**The priors are marginals over table status.** Real opponents change behaviour with the score, and
no published wait data is stratified by score situation, so this one cannot be fixed by extracting
more.

**The prior describes a population these tables do not seat.** It measures Tenhou houou humans, while
the seats here are this app's own algorithms — including, once EV seats are in play, the model itself.
A prior is really a claim about the population a seat faces.

### The joint enumeration

Several threats are combined as a product, which assumes their waits are independent. They are not:
two threats draw shapes from one shared pool.

The exact joint enumeration is **built, and off by default**. Measured across both models against an
eight-tile river:

|                         | full pool      | depleted pool    |
| ----------------------- | -------------- | ---------------- |
| largest disagreement    | 0.09pp         | 0.83pp           |
| joint above the product | 26 of 34 tiles | 26 of 34 tiles   |
| cost                    | 46 ms          | (against 2.5 ms) |

Both the cost and the **sign** were predicted wrong beforehand: the product was expected to overstate
and to be nearly free. Negative correlation between two threats' waits raises the survivors, so the
joint answer runs _above_ the product on most tiles. The product decides; the joint path is there for
a reader who asks.

## Not modelled

Deliberate omissions, recorded so they stop being re-proposed.

**Reading a silent tenpai.** The deal-in model returns nothing about a seat that has not declared.
That is honest — damaten and open-tenpai reading are much weaker inferences — but it means the model
is silent about a real and common source of deal-ins. It is also why the extracted open-hand prior
can never be reached: a threat view is only ever built for a declared seat, and riichi needs a closed
hand.

**Chankan.** A real added kan briefly exposes the tile to every other seat's ron. The engine
completes the kan directly instead.

**Rinshan kaihou, the yaku.** The win itself is taken and scored, as an ordinary tsumo.

**A dedicated EV trainer** — a drill built around the push/fold identity itself, rather than the
Advanced grading option that exists on the folding and efficiency trainers. It wants the models
calibrated first.

## The cheap path

Pricing every discard exactly is affordable once, on demand. It is not affordable for three or four
seats every turn: a 2-shanten ranking is roughly 89 ms where a whole round is about 17 ms.

So an EV seat prices a **candidate union** — the fastest few tiles by ukeire, plus the safest few
against the board — rather than every tile in hand. It plays a roughly 460 ms hand against a plain
efficiency seat's 40 ms.

Two things about that union are load-bearing. The safe half is skipped entirely when nobody has
declared, because otherwise every safety figure is zero, the sort falls through to its tie-break, and
the "safest" tiles are simply the lowest tile ids in the hand. And ties are broken on the dora before
the id: at the end of a hand that cannot reach tenpai every term is identical across candidates, so
about 1.7% of priced turns tie exactly — which is how an EV seat came to hand a dora to a tenpai
opponent on its last discard. Keeping the dora on a tie costs nothing when the model has run out of
things to say, and it moved the EV seat's dora-throw rate from 3.83% of turns to 1.39%, against a
plain efficiency seat's 2.09%.

Changing either candidate count changes which discards an EV seat makes.

## Sanma

Every EV model declares which rulesets it may speak about. The measured model is **four-player only**
— its logs are four-player Tenhou hanchan, and no three-player equivalent exists. It returns the
reason it cannot answer rather than silently handing back a number measured on a different game.

The derived model is compatible with every ruleset by construction.

Neither measured table can follow kiriage mangan or kan dora, for the same reason: the games behind
them played neither.

## The grading band

Both the folding and efficiency trainers can grade against the EV model instead of their default,
behind Advanced, marked alpha.

The tier model grades on rank with dense ranks, so genuinely equivalent choices tie and both count as
right. A probability grader has no ties at all — two tiles will differ in the fourth decimal, and
marking the second one wrong would be arbitrary.

So grading uses **two thresholds rather than one**, matching the three-way verdict the trainers
already show:

| Δ from the best discard | Verdict                 |
| ----------------------- | ----------------------- |
| `Δ ≤ ε₁`                | correct                 |
| `ε₁ < Δ ≤ ε₂`           | nearly — partial credit |
| `Δ > ε₂`                | wrong                   |

Both thresholds are Advanced-configurable and stored **per EV model**, because the two models answer
on different scales and one pair cannot serve both. Switching models keeps each one's own calibration.

**The grading interface must show the band it graded against.** A verdict from a threshold the reader
cannot see is not feedback.

### Calibration

The shipped defaults are **provisional**, and deliberately so:

|                             | ε₁ (correct) | ε₂ (partial) |
| --------------------------- | -----------: | -----------: |
| fold branch, derived model  |          150 |          550 |
| fold branch, measured model |          200 |          800 |
| push branch, both models    |          250 |         1000 |

They were measured off real fold and push turns rather than guessed, but measuring the _spread of the
model's own answers_ is not the same as knowing what a reader should be marked wrong for. They are
one visible table, tuned in one place, and they are meant to be re-fixed after the backtest below.

Kita and kan are never graded this way. They are themselves the decision being evaluated, which is
the model's own job rather than the trainer's.

## Still owed

Two measurements, both deliberately outside the scope of what shipped.

**The backtest.** Replay the real houou logs, compute the model's stated probabilities at real
decision points, and score them — reliability curves and Brier scores per model. It is the only thing
that turns "is this model any good" from an opinion into a number, and it is what sets the floor
below which a grading threshold is just marking noise.

**Memo lifetime.** The DP keeps a notebook of hands already valued. Every note was computed against a
particular set of unseen tiles, and that set shrinks every turn, so a notebook kept across turns is
slightly wrong throughout. Three options — bin it per ranking, stamp each note with the pool it
assumed, or split it so that pool-independent leaf values persist and only draw-dependent nodes are
binned. Fresh per ranking is the shipped default and the lean; the measurement has not run.

### Placement odds

The measured model reads its swing moments from data. The derived model builds them from its own
combinatorics, treating the rest of the match as a random walk whose steps it scores itself.

That derivation exists and works, and it is _approximate in a known way_: the measured spread decays
**faster** than the square root of the rounds remaining, so a real South 4 carries less variance than
a walk predicts, and only the measured side sees a leader regress toward the field.

### Posture

Aggressive and defensive flavours are designed and not built. What is settled is that a posture is
an EV model of its own derived from the balanced one — not a dial on top of it — that it binds to the
push/fold decision alone, and that its margin must come from the decision's own outcome spread rather
than a typed-in adjustment table.

What is open is what each flavour should actually optimise, and whether a posture layer on top of the
placement objective double-counts risk aversion that placement already prices.
