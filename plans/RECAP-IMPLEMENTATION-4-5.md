# RECAP — the EV decider (next-wave items 4 and 5)

_Written 2026-08-27, at the end of the session that implemented them. Branch `feat/ev-algorithm`,
five commits on top of the first wave, not pushed._

Companion to `RECAP-IMPLEMENTATION-1-3.md`, same purpose and same rules: a **handoff record, not a
plan**. Where it contradicts `PLAN-ev-model.md` or the `EV-*.md` documents, this file is what the
code does. Those documents were **not edited** — a record is superseded, not rewritten.

| Commit    | Task                  | What                                                                         |
| --------- | --------------------- | ---------------------------------------------------------------------------- |
| `b2b3646` | RECAP-1-3 §4.1        | `combinedDealInRisk` — joint two-threat enumeration, off by default          |
| `5469c4f` | groundwork for 4      | `BetaoirCost.csv` + `HandScore.csv` into the generated prior                 |
| `101c003` | next-wave item **5**  | `core/evModel.ts` — the EV model registry                                    |
| `325bc8b` | next-wave item **4a** | `core/ev.ts` — the push/fold identity                                        |
| `b3d894d` | next-wave item **4b** | `'ev-statistical'` / `'ev-houou'`, the seat panel, the golden divergence net |

Item **6** (kyuushu kyuuhai) was agreed out of scope for this wave and is **not started**.

`npm test` (582, up from 547), `npm run lint` and `npm run build` are green.
`round.golden.test.ts`'s twenty frozen hashes **do not move**: nothing defaults to an `'ev-*'` seat.

The durable record is `docs/adr/0037-the-ev-seat-decides.md`. This file is the detail behind it.

---

## 0. The four places the measurements contradicted the plan

Same table as last time, same meaning: the plan states something the arithmetic or the clock then
disagreed with, and the code follows the measurement.

| #   | The plan says                                                                               | The measurement says                                                                                                                                    | Where |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | The joint threat enumeration is sub-millisecond, and the product **overstates** (`EV-2` §5) | 46ms against 2.5ms, and the product runs **below** the joint answer on 26 of 34 tiles. Both the cost and the sign are wrong                             | §1    |
| 2   | An `'ev'` seat needs a cheap path or it cannot run at all (`EV-5` §1.9)                     | It needs the candidate union and nothing else. What made it unaffordable was a bug, not the DP                                                          | §3    |
| 3   | `HOUOU_OPEN_PRIOR` is blocked on a `ThreatView` field (RECAP-1-3 §4.2)                      | It is blocked on open-tenpai reading. A `ThreatView` is built only for a declared seat and riichi needs a closed hand, so no field could ever select it | §4    |
| 4   | `value_j` conditioned on visible evidence is "the right target", option 2 (`EV-3` §4)       | It is the right target for the **measured** model only. A pure model cannot price an opponent's hand at all, and the reason is structural               | §2    |

---

## 1. The joint enumeration is built, and it is off

`combinedDealInRisk(threats, visible, sanma, prior, joint)`. With `joint` false — the default — it
is `combineThreats`' product. With it true, and at most two threats, it enumerates compatible pairs
of hypotheses: the second threat's ways-to-hold counted against the pool the first has taken from,
an incompatible pair weighing zero, `P(t)` read off by inclusion-exclusion, and each term's
`probability` coming back as its joint marginal.

Measured, both models, an eight-tile river:

|                         | full pool      | depleted pool  |
| ----------------------- | -------------- | -------------- |
| largest disagreement    | **0.09pp**     | **0.83pp**     |
| joint above the product | 26 of 34 tiles | 26 of 34 tiles |
| cost                    | **46ms**       | —              |

`EV-2` §5 expected ~140 hypotheses per threat. There are ~650, because the shanpon prior is a
wait-pair matrix (RECAP-1-3 §2.1), so the pair loop is ~422k pairs rather than ~15k.

**The sign is the more interesting half.** Negative correlation between two threats' waits raises
`P(A ∪ B)` rather than lowering it: `P(both)` falls faster than the independent product does, so
the inclusion-exclusion total goes _up_. The product is a slight **under**statement, not the
overstatement the plan and RECAP-1-3 §4.1 both assumed.

A tenth of a point for twenty times the cost is not a trade a decider should take, so `ev.ts` uses
the product. The joint path is for a reader who asked.

**`combineThreats([])` changed contract** in the same commit: it returns 34 zero entries instead of
an empty array. Its own doc promises a caller may index it by `TileId`, and a board with nobody in
riichi is one where every tile is safe, not one with no tiles on it. `dealIn.test.ts` pins it.

## 2. The pure model cannot price an opponent's hand, and that is structural

The finding that shaped `evModel.ts`.

`statistical.dealInCost` derives what it can see: riichi's own han, the dora the unseen pool says
the threat is likely holding, and the ura an unknown indicator implies (`14/34` of a han, since the
indicator points at one kind of thirty-four with no reason to prefer any). At 30 fu that comes to
**1488 points** against the measured **5554**.

The gap is not an approximation to be tightened. **Hand value comes from choices, not from tiles.**
A player declares riichi on a hand they built, so its yaku are selected rather than sampled; a
model that prices an opponent as fourteen tiles drawn at random from the pool computes that tanyao
happens in 0.03% of hands, against the fifth or so of real ones. No amount of combinatorics
recovers a decision that was already taken.

So one constant is stated for it — `TYPICAL_CLOSED_YAKU_HAN = 1`, on the reasoning that most closed
tenpai hands carry exactly one of pinfu, tanyao or a yakuhai — and named as chosen, beside
`KOKUSHI_SHARE`, under ADR-0036's third category. The derived cost then lands **around half** the
measured one, because real riichi hands also hold more dora than random tiles for the same reason.

**The direction is known and it matters: the pure model prices opponents cheap, so it pushes where
the measured one folds.** That is a real difference between two models, not a bug in either, and it
is the kind of disagreement `EV-4` says is the product.

## 3. What actually made an `'ev'` seat unaffordable

`EV-5` §1.9 predicts that an `'ev'` seat cannot simply call the exact model and needs a cheap path.
A first build took that at face value and shipped two caps beside the candidate union — collapse at
1-shanten, look no further than eight draws. Then a round with one `'ev'` seat took **five minutes
and exhausted the heap**.

Neither cap was the problem. **`Algorithm.riichi` is asked _after_ the discard**, so its `SeatView`
holds thirteen tiles; `riichiWorthIt` was ranking discards from it, which takes another tile out
and leaves a twelve-tile hand. A twelve-tile hand can never complete, so the DP explored every
future to no end.

With `riichiWorthIt` pricing the thirteen-tile hand directly (`handOutlook`, no ranking), a whole
round with one `'ev'` seat measures:

|                             | golden-0  | golden-3 |
| --------------------------- | --------- | -------- |
| `efficiency`                | 34ms      | 15ms     |
| `'ev-*'`, union only        | **459ms** | **63ms** |
| `'ev-*'`, union + both caps | 185ms     | 28ms     |

The caps buy 2.5x for a real loss of accuracy at 2-shanten, which is the middle of the hand where
the interesting decisions are — so **they were removed**. The candidate union is the whole of the
cheap path, and the DP stays exact to 2-shanten as `EV-1` §6's boundary intends.

`rankDiscards` now **throws** on a hand that is not mid-turn, rather than hanging on one.

## 4. `HOUOU_OPEN_PRIOR` is unreachable, not unwired

RECAP-1-3 §4.2 records it as needing a `ThreatView` field saying whether a seat has melded, and
calls that "the first thing in this wave that would touch the engine". It is not so:
`canDeclareRiichi` gates on `isMenzen`, and `threatViews` builds a view only for a seat with
`riichiAt` set. **A `ThreatView` can never describe an open hand.** No field selects a prior for a
seat the model refuses to speak about at all.

Reaching that block needs open-tenpai reading — `P(tenpai | river)` — which `EV-5` §1.4 defers to a
later wave. Nothing was built for it here.

`ThreatView` did gain one field: **`riichiTurn`**, optional, always set by `threatViews`. The
measured deal-in cost is conditioned on when the threat declared, because a turn-3 riichi and a
turn-13 riichi are not worth the same. A hand-built view without it prices the threat at the turn
being asked about, which is the pessimistic reading.

## 5. The API as built

```ts
// core/evModel.ts
EV_MODELS: Record<'statistical' | 'houou', EvModel>
interface EvModel {
  name; prior
  dealInCost(threat: ThreatCost, board: BoardCost): number   // value_j
  giveUpCost(threats, board): number                          // tsumo + noten, DEAL-INS EXCLUDED
  riichiUplift(handValue, board): number
  unsupported(sanma): string | null                           // houou refuses sanma, and says why
}

// core/ev.ts
rankDiscards(view: SeatView, opts?): DiscardEv[]   // best first; needs the 14-tile hand
foldEv(view, opts?): DiscardEv                     // the give-up branch, over the rest of the hand
riichiWorthIt(view, opts?): boolean                // asked of the 13-tile hand, after the discard
tsumoChance(risks, unseen, pool): number
EV_FAST_CANDIDATES = 3, EV_SAFE_CANDIDATES = 2

// core/dealIn.ts
combinedDealInRisk(threats, visible, sanma, prior?, joint?): DealInRisk[]

// core/score.ts
ronValue(han, fu, dealer, rules): number           // a hand nobody can see, same limit brackets

// core/probability.ts
OutlookOptions.candidates?: readonly TileId[]      // price a prefiltered subset, caches still shared
```

`SeatAlgorithm` gained `'ev-statistical'` and `'ev-houou'`. `ALGORITHMS` builds both from one
`evPlayer(model)` — the only algorithm not written as its own literal, because the two differ by
nothing but the model.

## 6. Deliberate simplifications, each stated in the code

- **Only the discard and the riichi declaration go through the identity.** `call` keeps
  `chooseCall`'s rule plus one guard (a seat facing a declared threat will not open a hand that
  does not reach tenpai on the call); `win` takes every win, since declining prices a furiten
  branch nothing models; `kita` reuses `efficiency`'s comparison.
- **A pushing hand's later turns are priced at the average danger of the tiles it holds.** Pricing
  them at the tile going now was tried and is wrong in a way worth remembering: it makes a hand
  that spends one genbutsu look safe for a whole rest of the hand it has not played, and a hopeless
  4-shanten hand then out-EVs folding.
- **A folding hand's safe tiles are spent cheapest-first and never replenished**, so a long fold is
  priced pessimistically. This is the closest thing to `EV-3` §5's multi-turn recursion that ships.
- **`giveUpCost` excludes deal-ins on both sides.** For `houou` that is forced — the analyzer's
  sample excludes every seat that dealt in — and `statistical` follows it so the two mean the same
  thing. Adding the deal-in term twice is the easiest mistake the interface invites.
- **The measured tables are read with a `MIN_SAMPLES` guard.** Some cells hold two hands.

## 7. Left undone

Ordered by how likely the next session is to want it.

1. **`EV-3` §5's multi-turn safety recursion.** Still the largest single unbuilt piece. Both
   branches are now priced over the rest of the hand, but by the two approximations in §6 rather
   than by re-solving the hand each turn.
2. **Item 6, kyuushu kyuuhai.** Untouched. It is the one piece that edits `round.ts` and moves the
   golden hashes as a deliberate act (ADR-0016).
3. **The per-seat EV-model field.** Deferred, with its reasoning in ADR-0037: at two models it is
   five plumbing sites buying nothing a union member does not. Add it when the objective switch or
   a posture makes the union a cross product.
4. **The placement objective.** `ev.ts` is shaped for it — the identity stays linear in a
   per-outcome value function — and the statistical model's placement-odds derivation is still
   owed (`EV-5` §2.10).
5. **Any trainer surface.** No page reads any of this. `EV-3` §9's term-by-term screen is designed
   and unbuilt, and the lab's per-seat EV panel with it.
6. **A yaku-less dama branch.** Pinned as a failing-by-design test in `ev.test.ts`: the model
   declines a thin riichi on a hand that has no yaku without it, because nothing in `Outlook` says
   whether the hand could win at all without declaring. Real play declares there.
7. **`EV-5` §1.10's coverage gaps**, unchanged: no redness in the DP, no ippatsu, no kan or kita
   replacement draws, chiitoi tanki folded into plain tanki, and the houou prior applied under
   sanma if anyone forces it — though `houou.unsupported(true)` now at least says so.
8. **The two measurement sessions** (`EV-5` §2.7 memo lifetime, §2.13 backtest) remain out of scope
   and remain the only route from "is this any good" to a number.

## 8. Things that would be easy to get wrong next

- **`rankDiscards` wants the fourteen-tile hand.** It throws otherwise, and the reason it throws is
  §3. Anything asked after a discard wants `handOutlook` on the thirteen.
- **The no-borrowing rule is the point of `evModel.ts`.** A convenient fallback that reads one
  model's table under the other's name would quietly make a third model, and the lab's whole
  comparison would be measuring the fallback.
- **`giveUpCost` is not a fold price.** It is the fold price _minus_ the deal-in term.
- **Nothing may default to `'ev-*'`** without moving the golden hashes on purpose, and ADR-0016
  says that is an act with an ADR behind it.
- **The two EV seats share one badge colour** on the felt, because the distinction is the model and
  the badge text carries it. Do not read that as one algorithm.
