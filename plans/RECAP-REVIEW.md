# RECAP — reviewing the built EV model against the plans

_Written 2026-08-28. Branch `feat/ev-algorithm`, on top of the three implementation waves._

Fourth and last of the recap files, and a different kind: the first three record what a session
**built**, this one records what a session **found** reading all ten `plans/` documents against the
shipped code. Same rules as the others — a handoff record, not a plan, and where it contradicts
`PLAN-ev-model.md` or the `EV-*.md` documents, this file is what the code does. Those documents were
**not edited**.

Scope: `core/dealIn.ts`, `probability.ts`, `evModel.ts`, `ev.ts`, `placement.ts`, `hououPrior.ts`,
`algorithm.ts`, `round.ts`'s kyuushu half and `table.ts#evOf`, against `PLAN-ev-model.md`, `EV-1`
through `EV-5`, `REFINEMENTS.md` and the three implementation recaps. `/match` was out of scope.

`npm test` (649, up from 646), `npm run lint` and `npx tsc -b` are green.
`round.golden.test.ts`'s twenty frozen hashes **do not move** — nothing here touches `efficiency`,
`defense` or `tsumogiri`.

---

## 0. The finding

**Every deviation the three implementation recaps claim is real, and the numbers they quote
reproduce.** The shanpon wait-pair matrix reproduces `HOUOU_PRIOR_META.width` to the digit; the
extraction really is indexed by the lowest waited tile (rank 4's 25 189 in `EV-2` §7 is
`14012 + 11177` off the generated table); `collapsed()` really does average rather than take the
best draw; `HOUOU_OPEN_PRIOR` really is unreachable rather than unwired; kyuushu really does ship on
by default without moving a hash. The deliberate omissions are each named in code where they bite.

What the plans did not catch, and no test did either, is that **every EV test asserts a row adds up
(`points === probability × value`) or a direction, and none asserts a magnitude.** All four defects
below lived inside that blind spot.

## 1. The win term counted `P(win)` twice — fixed

`Outlook.score` is `S_solo`: the **unconditional** expectation, `P(win) × E[value | win]`
(`EV-1` §4's own table, and `probability.test.ts` pins it as `score / soloWin`). `price()` was
pairing it with `soloWin` as a term's `value`, so the win term computed `P(win)² × E[V|win]`.

Measured on `ev.test.ts`'s own tenpai hand: the hand pays **10 633** when it lands, and was being
priced at **784**. Every push was under-credited, quadratically worse the thinner the hand, which
biases the decider toward folding — hardest at 1- and 2-shanten, the middle of the hand where the
decisions are interesting.

`riichiWorthIt` had it too, and it is invisible under `houou`, whose `riichiUplift` ignores the hand
value it is handed. Under `statistical` the same tenpai hand with one draw left went from decline
(−830) to declare (+376), which is now the pinned regression.

Both now read one helper, `conditionalWin()`. It is also what `EV-3` §9's specified screen wants:
the lab panel printed `34.1% × 1978 = 674` where the spec shows `34.1% × 5 800 = +1 978`.

## 2. The push branch never collected a tenpai payment — fixed

`EV-3` §2's identity carries `+ P_exhaustive × tenpai_payment` on the push side and
`+ P_exhaustive × noten_payment` on the fold side. The build collapsed both into
`EvModel.giveUpCost`, which always ends on the noten penalty — correct for the branch it is named
after (a hand that has given up is noten by construction), wrong for a push that reaches the draw
tenpai and **collects** instead.

`price()` now adds a `'tenpai'` term: `soloTenpai − soloWin` (advance-only never loses tenpai, so
that is "tenpai at the end, having not won"), valued at **twice** `NOTEN_PENALTY` — the penalty not
paid plus the payment collected — discounted by `giveUpCost`'s own survival factor so the two agree
about reaching the draw at all. `foldEv` has no such term, by construction.

`Outlook.soloTenpai` came free off the same traversal and had **no consumer anywhere in the app**
until now. `NOTEN_PENALTY` is exported from `evModel.ts` for it: it is a rule constant neither model
measures, so sharing it breaches no borrowing rule.

## 3. The EV seat priced a ruleset the table was not playing — fixed

`ev.ts#scoringRules` hardcoded `kiriageMangan: false`. `SeatView` now carries it, set from
`RoundOptions.kiriageMangan` in `seatView`. Two of the three sites it reaches matter:

- the DP's own leaf (`probability.ts#priceWin` → `scoreHand`), which prices the seat's **own** win
  and is model-independent — a 4-han/30-fu win is 8000 under kiriage, not 7700;
- `STATISTICAL.dealInCost` and `swing`, both of which integrate `ronValue(han, fu, dealer, rules)`.

**`HOUOU` cannot follow it and should not try.** Its tables are measured over Tenhou, which plays
neither kiriage mangan nor conditions on kan dora, so the measured figure is what it is; feeding a
flag in would change nothing. Both ceilings are now stated on `HOUOU.dealInCost` rather than left to
be rediscovered.

## 4. The cheap-path constants were versioned by nothing — fixed

`EV-5` §1.9 asks that `EV_FAST_CANDIDATES`/`EV_SAFE_CANDIDATES` be versioned with the golden tests,
"never tuned casually". They were exported and referenced nowhere — no test, no hash. The three EV
golden tests pin _determinism_ and _divergence_, and every value of K and J satisfies both.

`round.golden.test.ts` gains `EV_GOLDEN`: one frozen event stream per model, on `golden-3`, the wall
where the two models part. Unlike `GOLDEN` these are expected to move when the identity changes on
purpose — a "say so in the commit" net, not an invariant. `GENERATE_GOLDEN=1` prints them alongside
the main table.

**One consequence worth not re-deriving:** the placement-vs-points divergence test's seed pair moved,
`golden-12`/`golden-19` → `golden-2`/`golden-6`, from the same twenty-seed sweep `RECAP-6-7` §4
describes. Which walls happen to divide the two currencies is a property of the arithmetic, so a
deliberate change to the identity moves them. The test pins the claim, never those walls.

## 5. Left alone deliberately

- **`UNIFORM_PRIOR` is ~86% shanpon by mass** (561 hypotheses × 36 ways against a ryanmen's 16),
  giving an implied wait width near 2.1 kinds against the measured 1.78 and a shape mix nothing like
  the game's. That is `EV-2` §7 and §8 read literally — "every shape class weight 1, the number is
  then availability alone" — and `dealIn.test.ts` already pins the visible symptom. Worth carrying
  forward as a calibration fact rather than a bug: the **default** model therefore ranks tiles on a
  shape distribution that is not the game's, stacked on `TYPICAL_CLOSED_YAKU_HAN` pricing deal-ins
  at about half the measured cost (`RECAP-4-5` §2). Both point the same way — push more than you
  should — where fix 1 pointed the other. Two large opposing biases is exactly the situation
  `EV-1` §8 warns about, and only the backtest (`EV-5` §2.13) settles it.
- **No `Algorithm` decision point for a kan.** Open kans (daiminkan/kakan, ADR-0041) landed after
  every `EV-*` document was written and nothing in `plans/` mentions them. The unseen pool and the
  dora both track them correctly — every kan path updates `state.visible` in full and pushes its
  kan-dora indicator, so `dealIn.ts` and `probability.ts` see it — but no AI seat has ever kanned
  in this engine: `chooseCall` never passes `calledKan`, and `callAnkan`/`callKakan` are reached
  from the UI and `replayLog` alone. With `/match` shipping `calledKan`, the `'ev'` seat is now the
  one seat with the machinery to price a kan and the only kind that structurally cannot take one.
  Adding it is a seventh `Algorithm` method, not an `ev.ts` change.
- **The DP still models no replacement draw.** `EV-5` §1.10 verbatim, unchanged.

## 6. Still owed, unchanged from `RECAP-6-7` §7

The push branch cannot switch to folding mid-sequence (needs the per-draw win curve `Outlook` does
not carry); the two measurement sessions (memo lifetime `EV-5` §2.7, backtest `EV-5` §2.13); the
yaku-less dama branch; posture; `AllLast.csv` and `CoinflipRatio.csv`; a trainer that grades on EV;
round sequencing.

## 7. Things that would be easy to get wrong next

- **`Outlook.score` is not a win value.** It is the EV. Anything pairing it with a probability is
  counting `P(win)` twice — the mistake §1 fixes, and the one every "does it add up" test passes.
- **`giveUpCost` is the give-up price and nothing else.** It excludes deal-ins (`RECAP-4-5` §6) and
  it is noten-only. The tenpai side lives in `price()`, and a future model interface that folds the
  exhaustive draw back in has to take both halves or neither.
- **`EV_GOLDEN` is meant to move; `GOLDEN` is not.** A commit moving the first says so in its
  message; a commit moving the second needs an ADR (ADR-0016).
- **The placement divergence seeds are a measurement, not a constant.** Re-scan, do not hunt for a
  seed that makes the test pass.
