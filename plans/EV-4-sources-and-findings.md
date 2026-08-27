# EV-4 — Sources, and findings that did not fit anywhere else

All URLs retrieved 2026-08-26 unless noted.

## 1. Algorithms and reference implementations

| Source | What it is | Why it matters here |
| ------ | ---------- | ------------------- |
| [tomohxx, *麻雀アルゴリズム* ch. 6 「和了確率」](https://tomohxx.github.io/mahjong-algorithm-book/probability/) | A written-out derivation of win probability and expected score for one-player mahjong | **The primary source for `EV-1`.** Gives the DAG formulation, the two recurrences, the boundary conditions and the reverse-topological traversal |
| [`tomohxx/mahjong-win-prob`](https://github.com/tomohxx/mahjong-win-prob) | Reference implementation of the above | Claims exactness to 6-shanten in C++, via simultaneous shanten/useful-tile computation and caching of intermediate results |
| [`nekobean/mahjong-cpp`](https://github.com/nekobean/mahjong-cpp) | Shanten, scoring, and expected-value analysis | Emits **three** tables per discard per turn — tenpai probability, win probability, expected score. The three-objective split in `EV-1` §7 is this library's output shape |
| [pystyle.info 何切るシミュレーター](https://pystyle.info/mahjong-nanikiru-simulator/) | The same model as a public tool | Documents its own limits candidly: "no other players exist, drawing and discarding repeat to turn 18", and that 4-shanten and beyond becomes too expensive to answer within seconds |
| [`critter-mj/akochan`](https://github.com/critter-mj/akochan) | The best-known **non-neural** riichi engine | Proof that a formula-driven engine can be competitive. Optimises *final placement point EV*, not hand EV |
| [`Equim-chan/mjai-reviewer` FAQ](https://github.com/Equim-chan/mjai-reviewer/blob/master/faq.md) | Compares Mortal and akochan | The clearest short statement of the neural / non-neural divide, and the source for akochan's known weaknesses |
| [`gimite/mjai-manue`](https://github.com/gimite/mjai-manue) | An older rule-based bot | Computes win probability and expected points by **Monte Carlo** (1000 sampled futures) and estimates danger with a decision tree over features like honours and suji, trained on Tenhou records |
| [`Euophrys/Riichi-Trainer`](https://github.com/Euophrys/Riichi-Trainer) | The best-known open-source efficiency trainer | Explicitly ukeire-only, "no look-ahead for future efficiency" — the same position this repo's `efficiency` algorithm holds |
| [`gameraccoon/riichi-efficiency-trainer-bot`](https://github.com/gameraccoon/riichi-efficiency-trainer-bot) | Takes Euophrys' shanten and computes **Ukeire2** (two moves ahead) | The cheapest intermediate rung between ukeire and a full DP |
| [`riichi-tools-rs`](https://crates.io/crates/riichi-tools-rs) | Rust/WASM riichi utilities | Precedent for shipping this kind of maths into a browser |

## 2. Statistics

| Source | Contents |
| ------ | -------- |
| [`chienshyong/houou-statistics`](https://github.com/chienshyong/houou-statistics) | 30+ analyses over **893,440** logs from a five-year Tenhou houou four-player database. `results/` holds `WaitDistribution.csv`, `RiichiWinrate.csv`, `RiichiTile.csv`, `Sotogawa.csv`, `SotogawaCombo.csv`, `WallReading.csv`, `WallReadingDora.csv`, `DorasobaDanger.csv`, `BetaoirCost.csv`, `HandScore.csv`, `ShantenWidth.csv`, `SpeedReading.csv`, `TedashiReading.csv`, `OpenTenpai.csv`, `Variance.csv`, `AllLast.csv` and more. Also a compiled `.xlsx` and a `Cheat Sheet.pdf` |
| [Path of Houou](https://pathofhouou.blogspot.com/) | Readable analyses of the same data class — wait win rates by row, counting suji |
| [Riichi Notes — push/fold fundamentals](https://riichinotes.blogspot.com/2023/11/push-fold-fundamentals-winratedealinrate.html) | The win-rate-to-deal-in-rate framing, and the fold deal-in figures quoted in `EV-3` §5 |
| [repo.riichi.moe push/fold chart](https://repo.riichi.moe/guides/EV-Push-Fold.html) | Breakpoint hand values for zero-EV pushing. Chart only; the derivation is elsewhere |
| [note.com — riichi win rate quick formula](https://note.com/rapid_clover2945/n/n185ee42844b2) | `53 + (9 − turn) × 4` for a good wait, `40 + (8 − turn) × 3` for a bad one, with per-wait adjustments, and the riichi EV closed form `(win rate) × (win value + 1800) − 1800` |
| Daina Chiba, *Riichi Book 1* | The standard English treatment of push/fold as expected value |
| とつげき東北, *科学する麻雀* / *新 科学する麻雀* | The origin of the statistical school; [Wikipedia](https://ja.wikipedia.org/wiki/とつげき東北) |
| みーにん, *Statistical Mahjong Strategy* (2017) | Cited by the push/fold literature for its EV estimates |

## 3. Numbers worth keeping in one place

- Ryanmen is ~50% of all tenpai and ~58% of riichi waits by the common quotation; the houou file
  computes **61.3%** counting sanmenchan with it, **55.4%** for plain ryanmen alone.
- Base deal-in probability for a ryanmen is **1/18 ≈ 5.6%**, rising as other suji lines are
  eliminated (1/18 → 1/17 → 1/16 …).
- Non-suji ≈ **5–6%**, suji ≈ **3–4%**, betaori ≈ **3–5%** per turn (three genbutsu in hand ≈ 3%,
  two ≈ 4%, one ≈ 5%, at turn 9).
- Riichi win rate, first to declare, good wait: **53%** at turn 9, moving 4 points per turn.
- Exhaustive draws are roughly **17%** of hands.
- Balanced strong play sits near a **22–23% win rate against a 12–13% deal-in rate**.

## 4. Findings

**The codebase already anticipated this.** `SeatView.match` in `core/algorithm.ts` carries a comment
saying the field exists "so a future algorithm (EV) has somewhere real to" read points, honba and
sticks from, and nothing reads it today. [ADR-0004](../docs/adr/0004-ordinal-danger.md) is marked
**TO REVIEW** and its own text names the condition under which this work becomes admissible —
*measure* the rates rather than typing them in.

**The existing tier model is a special case, not a rival.** Genbutsu, noChance, oneChance and suji
all fall out of the single furiten rule and the availability term in `EV-2` §4. That means the two
models can be shown side by side without contradiction, and it means the probability model can be
validated against `danger.ts`'s own 348 lines of tests rather than starting from nothing.

**The wait-distribution file is exactly complete.** 137,567 enumerated simple waits + 4,894 complex
waits = 142,461, which is the file's own `Total riichi` to the tile. That is unusually good
provenance for a public statistics dump and it is what makes the prior trustworthy enough to build
on. Its `Riichi width avg = 6.409887618` tiles reconciles with the computed **1.773 wait kinds per
hand** at roughly 3.6 unseen copies per kind.

**The shanten group cache is why any of this is feasible.** `src/core/shanten.ts` decomposes each
suit separately and memoises per suit alphabet, so a draw probe perturbs one group and the other
three come out of the cache: **~1.7 M probes/s**, `ukeire` at ~19 µs, `evaluateDiscards` at ~270 µs.
A whole-hand search would be ~500 µs per probe and every measurement in `EV-1` §6 would be three
orders worse.

**The expensive branch is expensive for a mechanical reason, not a combinatorial one.** Following
shanten-preserving improvements requires an `ukeire` call per candidate discard per node — ~1,150
probes instead of ~34. That is the whole of the 1,000× gap in `EV-1` §6, and it means the cost is
attackable by a better width test rather than by pruning the search.

**Monte Carlo is available to everyone else and not to us.** `mjai-manue` samples 1,000 futures per
decision; `akochan` runs simulations too. [ADR-0009](../docs/adr/0009-decision-seam.md) makes purity
a hard rule — same view ⇒ same choice, so that a match reproduces from its seed — which rules the
technique out. This is a constraint that turns out to be a feature: the DP is the explainable one
anyway, and a sampled number has no terms to show.

**There is a validation route through `mjai`.** `docs/STATUS.md` records mjai export as a deferred
follow-up to the action-log wave. If it ever lands, this repo's own logs could be fed to
`mjai-reviewer` and reviewed by Mortal or akochan — which would turn "is our model any good" from
an opinion into a measurement, without this project ever having to train anything.

**Nobody agrees, and the disagreement is the product.** Mortal and akochan differ because one
optimises learned placement value end-to-end and the other optimises an explicit placement-point EV;
NAGA differs again. A model that shows its terms does not have to win that argument — it has to let
a reader see *why* two answers differ, which is a thing none of the three can do.
