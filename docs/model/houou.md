# Where the measured numbers come from

One of the two EV models derives every price from combinatorics. The other measures them, over real
games. This page is what "measured" means here, exactly — the source, the sample, what was taken,
what was not, and where it is thin enough that a reader should not lean on it.

## The source

Five CSV files from [`chienshyong/houou-statistics`](https://github.com/chienshyong/houou-statistics),
pinned at commit `80dc535dc7eab1a0faf18a2fbcfe72db2067976a` (2023-11-25), itself forked from
[`Euophrys/houou-analysis`](https://github.com/Euophrys/houou-analysis) (MIT).

The underlying games are Tenhou **houou** four-player hanchan — the top public lobby — from 2016 to 2020.

| File                   | Becomes                           | Carries                                                   |
| ---------------------- | --------------------------------- | --------------------------------------------------------- |
| `WaitDistribution.csv` | `HOUOU_PRIOR`, `HOUOU_OPEN_PRIOR` | which wait shape a tenpai hand ended on                   |
| `DorasobaDanger.csv`   | the per-rank wait check           | how often a riichi waits on some tile of each rank        |
| `BetaoirCost.csv`      | `HOUOU_FOLD_COST`                 | what giving up on a hand costs, by turn and matchup       |
| `HandScore.csv`        | `HOUOU_HAND_SCORE`                | what a riichi hand pays when it wins, by declaration turn |
| `Variance.csv`         | `HOUOU_SWING`                     | how much a seat's score still has left to move            |

`npm run build-ev-models` fetches those five at the pinned commit and writes `src/core/hououPrior.ts`.
That output is **committed**, so the script only runs when the pin moves, and the generated file
carries its own source URLs, commit, retrieval date and sample counts in its header.

### Why the CSVs and not the logs

Upstream's own pipeline is a merged log database (`es4p.db`, roughly 8 GB across five yearly files)
which its Python analyzers read to print the aggregates in `results/*.csv`. The CSVs are therefore
the _finished measurement_; re-running the analyzers over the database would reproduce numbers that
are already published.

The database is worth fetching for exactly one kind of work — backtesting this project's own model
against real decision points — and that is a session of its own, not a build step.

### Licence

The CSVs are aggregate measured facts rather than copyrightable expression, and no upstream code is
copied into this repository. Upstream states it is forked from a project carrying an MIT licence.
The generated file records both repositories, the pinned commit and the retrieval date.

## The sample, and what is missing from it

**142,461 riichi tenpai hands** (and 182,490 open ones). That is not the whole 893,440-game database
— upstream's analyzers cap how many logs they read.

Of those, **137,567 hands had a wait the analyzer could enumerate** and **4,894 did not**. That gap
is not noise, it is a category: the analyzer buckets anything complicated as a complex wait and never
breaks it down. Kokushi is one of them.

Which is why kokushi's share is the **one stated constant** in the whole deal-in model. It cannot be
read off this data, so it is chosen and labelled as chosen rather than being quietly derived from
something that does not contain it.

## The indexing convention, and three caveats it carries

Rows are ranks, and each shape is indexed by the **lowest tile it waits on**. So ryanmen entries are
nonzero only at ranks 1–6, sanmenchan only at 1–3, penchan only at 3 and 7, kanchan at 2–8. Index 0
is honours; counts are aggregated across the three numbered suits, so a bucket is divided by the
number of hypotheses sharing it.

Confirmed against the analyzer source, along with three things that convention drags in:

- **The ryanmen/shanpon split is an ukeire threshold, not a shape test.** A true ryanmen with four or
  more of its copies already visible lands in the shanpon matrix, so the prior misclassifies a little
  at high visibility.
- **Honour tanki is bucketed by copies visible across all four rivers**, not the threat's own — so
  that per-rank table already integrates a visibility signal.
- **Shanpon is a 10×10 wait-pair matrix.** It has to be summed, not read as a column — and it is kept
  as a matrix rather than marginalised, because
  [collapsing it loses the wait width](./danger.md#ceilings).

## What the numbers are checked against

The strongest check is free, and it caught a real modelling error before anything shipped.

Because a ryanmen waits on two kinds and a sanmenchan on three, summing the deal-in probability over
every tile does not give 1 — it gives the **expected number of wait kinds**. The source file states
its own answer for that: **1.7823**. The model has to reproduce it with nothing visible.

An early build came out at 2.25, which is what exposed
[the availability double-count](./danger.md#availability-enters-as-a-ratio-never-as-an-absolute). A
later question — whether shanpon could be flattened to one wait per rank — was settled the same way:
flattening gives 1.61 against a true 1.78, so the matrix stays.

The same fact appears in the file in a second unit, a mean ukeire of 6.41 **tiles**, which is the
same 1.78 kinds at about 3.6 unseen copies each.

## Reading the tables honestly

**Check the sample counts.** They are shipped alongside every measured cell precisely so they can be
checked. Some cells are tiny — one turn-4 dealer-versus-three-threats cell rests on **two hands** —
and a thin cell steps to the nearest turn that is not thin rather than being believed.

**The fold cost is not the whole fold price.** The measurement excludes every seat that dealt in, so
what the table holds is opponents' tsumo payments plus the noten penalty and nothing else. The
deal-in term is added on top, per turn, against the tile actually being thrown. Adding it twice is
the easiest mistake the interface invites.

**The hand-score table excludes riichi and honba sticks and excludes yakuman**, upstream, and
_includes_ ura and dora — because these are real wins off real logs rather than shapes priced by a
scorer. Its `ron` figure is what the discarder pays; its `tsumo` figure is the winner's whole take
before the three-way split.

**The swing table is the placement input.** Mean and standard deviation of "final score minus score
right now", indexed by current rank and by which round it is. Read a row as: a second-place seat in
East 2 finishes within about this much of where it stands.

## Two stated ceilings

**The tables cannot follow this app's ruleset switches.** They were measured over Tenhou, which plays
neither kiriage mangan nor conditions on kan dora. Threading those flags into the measured model
would change nothing, so they are stated as limits rather than plumbed.

**The open-hand prior is extracted but unreachable.** The deal-in model only ever describes a seat
that has declared, and riichi needs a closed hand — so no board can select the open table. It is
blocked on reading a silent tenpai, which is
[deliberately not modelled](./limits.md#not-modelled), not on wiring.
