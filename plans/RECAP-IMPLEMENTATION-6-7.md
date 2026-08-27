# RECAP — finishing the list (next-wave items 6 and 7, and everything RECAP-4-5 left undone)

_Written 2026-08-27, at the end of the session that finished them. Branch `feat/ev-algorithm`, five
commits on top of the second wave, not pushed._

Third and last of the recap files, same purpose and same rules: a **handoff record, not a plan**.
Where it contradicts `PLAN-ev-model.md` or the `EV-*.md` documents, this file is what the code does.
Those documents were **not edited** — a record is superseded, not rewritten.

| Commit    | Task                         | What                                                                       |
| --------- | ---------------------------- | -------------------------------------------------------------------------- |
| `6534047` | next-wave item **6**         | kyuushu kyuuhai — the sixth decision point, the one that edits `round.ts`  |
| `4d56af2` | `EV-3` §5                    | both branches integrated over the rest of the hand, turn by turn           |
| `62368ad` | `EV-3` §8, `EV-5` §2.10      | `core/placement.ts`, the placement objective, and the odds each model owes |
| `c5f2ed7` | RECAP-4-5 §7.3               | one `'ev'` seat, model and objective as a per-seat field                   |
| `6a1d95d` | `EV-3` §9 (item 7's surface) | the lab's EV panel                                                         |

**`plans/PLAN-ev-model.md`'s next-wave list is complete.** `npm test` (612, up from 582),
`npm run lint`, `npm run build` and `npx playwright test` are green. `round.golden.test.ts`'s twenty
frozen hashes **do not move**, which for item 6 took a design decision rather than luck (§1).

The durable record is `docs/adr/0038-kyuushu-is-a-rule-not-a-permission.md` and
`docs/adr/0039-the-currency-is-a-switch.md`, the second amending ADR-0037. This file is the detail.

---

## 0. The four places the measurements contradicted the plan

Same table as the last two, same meaning: the plan states something the arithmetic or the clock then
disagreed with, and the code follows the measurement.

| #   | The plan or an earlier recap says                                                     | The measurement says                                                                                                                                        | Where |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Kyuushu support moves the golden hashes as a deliberate act (`EV-3` §7, `EV-5` §2.9)  | It does not have to. The three hand-written algorithms have nothing to price the branches with, so they decline, and the rule ships on by default unmoved   | §1    |
| 2   | Folding is priced per turn and a real fold needs the multi-turn recursion (`EV-3` §5) | Built. The rate it produces is ~3.7% a turn after the genbutsu run out, inside the 3-5% band the same section quotes — and roughly **flat**, not rising     | §2    |
| 3   | The match's remaining variance is a random walk (`EV-5` §2.10's implied shape)        | Only approximately. The measured spread decays **faster** than `sqrt(rounds left)`; a real South 4 carries less variance than a walk predicts               | §3    |
| 4   | Placement is the currency that changes what a desperate seat does (`REFINEMENTS`)     | It changes what a seat with a **lead** does. A seat that is behind plays the same hand under both, because points already price a worthless hand at nothing | §4    |

---

## 1. Kyuushu shipped on by default and the hashes did not move

`EV-3` §7 and `EV-5` §2.9 both expect this item to move `round.golden.test.ts` deliberately. It did
not need to, and the reason is a real property of the seam rather than a trick:
**`efficiency`, `defense` and `tsumogiri` have nothing to decide this with.** Ukeire ranks the
discards of whatever hand it is handed; it has no opinion on whether the hand is worth playing at
all. Declining is each of them staying inside its own definition.

So `RoundOptions.abortiveDraws` defaults **on** — it is a rule of the game, not one of ADR-0010's
four permissions — and the twenty hashes are untouched. The three graded drills set it false for the
reason they set `wins` false.

Shapes worth not re-deriving:

- **`canDeclareKyuushu` uses `river.length === 0` plus no melds anywhere, not `state.turn === 1`.**
  Seats are served in index order while the turn counter increments on the _dealer's_ seat, so with
  a dealer other than seat 0 the counter moves in the middle of the opening go-around. A kita is not
  a call and does not disqualify.
- **The offer is raised after the tsumo check.** A dealt thirteen-orphan kokushi is nine distinct
  terminals _and_ a completed hand.
- **`PendingClaim` is now a union**, `PendingDiscardClaim | PendingAbort`. They share the
  suspension, `answerClaim` and the prompt surface; nothing else. An abort claim is one seat, one
  question, and no `answers` map, so `resolveReactions` never sees one — `replayLog`'s
  `resolveClaims` loop skips it and the turn body answers it instead.
- **Declining leaves no furiten behind** and returns the turn exactly where `beginTurn` suspended
  it. That is the one thing a discard claim does that this one must not.
- `RoundState.ended` gained `'abort'`. Reusing `'exhaustive'` would have been smaller and would
  have told a future settlement that everybody was noten.

**The ceiling worth knowing**: an `'ev'` seat aborts nearly every legal kyuushu hand. Not a
judgement — a kyuushu hand is four or more shanten, above `probability.ts`' exact ceiling, so the
collapsed chain prices no win value at all and `EV(keep)` is dominated by the give-up term. It is
close to how the hand is really played, and it stops being arithmetic only when the win side can
price a 4-shanten hand.

## 2. The fold price is flat, not rising

`EV-3` §5 quotes "about 3% holding three genbutsu, 4% with two, 5% with one", which reads as a rate
that climbs as the safe tiles go. What the built recursion produces against one riichi, with three
genbutsu in hand and a full-ish pool:

| Turn         | 1-3 | 4     | 5     | 6     | …     | 12    |
| ------------ | --- | ----- | ----- | ----- | ----- | ----- |
| deal-in rate | 0   | 3.76% | 3.71% | 3.74% | ~3.7% | 3.54% |

The genbutsu turns are **free** — against one threat they really are — and everything after is
essentially flat at the rate the unseen pool can keep supplying. The level matches the published
band; the shape does not match the quoted trend, because the quoted trend is conditioned on how many
genbutsu you _hold_ and this sequence spends them first and then draws replacements.

`turnRisks('safe')` is what does it: each turn the hand throws the cheaper of the safest tile still
in hand and the one just drawn, so a held safe tile is spent only on the turns it beats the draw —
fractionally, not one per turn. That replenishment is the half the old price ignored, and a test
pins that a fatter unseen pool is a cheaper fold.

The push side keeps the average-over-held-tiles rate and the whole sequence is walked by the same
`laterCost`, so the two branches cannot disagree about a term they share.

**What remains unbuilt here, and it is now the largest piece:** a pushing hand may not change its
mind. It is priced against "keep throwing what the shape needs" for every turn left, where a real
hand folds the moment folding is cheaper. Letting it switch needs `P(win)` _from turn t onward_, and
`Outlook` carries one scalar for the whole hand rather than a per-draw curve (RECAP-1-3 §2.6). The
vectorised memo that section costs at 1.5-3x is the enabling piece.

## 3. The two placement models agree on shape and disagree in a known direction

`EV-5` §2.10 left the pure derivation owed. It is paid: a round of mahjong as one point transfer, so
a seat gains a hand `1/n` of the time, pays it `1/n` of the time and is untouched otherwise — mean
zero, variance `2/n × E[V²]` per round, `E[V²]` off the same han distribution `dealInCost`
integrates, dora from the ruleset alone (one indicator, one ura, `2/34` per tile) so it needs no
board.

Measured against `Variance.csv`, which it may not read:

| Round (0 = East 1) | 0      | 3      | 7     |
| ------------------ | ------ | ------ | ----- |
| derived sd         | 10 036 | 7 934  | 3 548 |
| measured sd        | 13 982 | 10 671 | 4 087 |
| ratio              | 0.72   | 0.74   | 0.87  |

Three findings, all pinned as tests and none of them a tolerance:

1. **The derived side is narrower, and the direction is known** — it omits yakuman, honba, riichi
   sticks, the noten penalty and dealer repeats.
2. **The derived side decays as exactly `sqrt(rounds left)`**, being a sum of independent rounds by
   construction. **The measured side decays faster** (3.42x across the hanchan against `sqrt(8)` =
   2.83x): real late rounds carry less variance than a plain random walk says. An All Last hand is
   played by seats who mostly know what they need, and the round ends the moment somebody has it.
   Nothing derivable can see that.
3. **Only the measured side sees regression toward the field.** A leader's mean is negative and
   everybody else's is positive; the derived model's mean is zero by construction.

`core/placement.ts` holds the integral and the ruleset and no weights at all, which is what lets
both models share it without breaching ADR-0037's no-borrowing rule — an integral is not a number
either model measured. Independence between seats is the one stated approximation, the same shape
`combineThreats` makes and for the same reason.

## 4. The objective changes the leader's hand, not the loser's

`REFINEMENTS.md`'s motivating example is a desperate seat: South 4, fourth place, nine terminals, go
for the kokushi. The scan says otherwise. Over twenty seeded walls in South 4:

| This seat's position          | Seeds where placement and points play a different hand |
| ----------------------------- | ------------------------------------------------------ |
| 6 000, three seats at ~31 000 | **none**                                               |
| 44 000, one seat at 32 000    | `golden-12`, `golden-19`                               |

The reason is not that placement is inert behind — it is that **points already push there.** A seat
with nothing has a give-up cost of the noten penalty and a deal-in cost it can barely feel, so the
points objective was already taking every branch placement would. A lead is the thing placement can
see and points cannot: first place is worth more than any hand on the table, and the seat starts
declining risk it would otherwise take.

The golden test uses the lead board for exactly that reason, and says so.

## 5. The API as built

```ts
// core/round.ts
RoundOptions.abortiveDraws?: boolean          // default TRUE — a rule, not a permission
RoundOptions.ev?: readonly (EvSeat | undefined)[]
PlayerState.ev: EvSeat                        // live, like `algorithm`; every seat carries one
RoundState.ended?: 'win' | 'exhaustive' | 'abort'
PendingClaim = PendingDiscardClaim | PendingAbort
ClaimAnswer  = … | { kind: 'abort' }
LogEntry     = … | { kind: 'abort'; seat }    // `Q` + seat in `actionLog`
canDeclareKyuushu(state, options, seat): boolean
seatView(state, options, seat): SeatView      // now exported, for `evOf`

// core/policy.ts
SeatAlgorithm = 'efficiency' | 'defense' | 'tsumogiri' | 'manual' | 'ev'
kyuushuKinds(hand): number
KYUUSHU_KINDS = 9

// core/algorithm.ts
Algorithm.abort(view): boolean                // sixth decision point
SeatView.ev: EvSeat

// core/ev.ts
EvSeat { model: EvModelName; objective: EvObjective }
DEFAULT_EV_SEAT = { model: 'statistical', objective: 'points' }
EvOptions.objective?: 'points' | 'placement'
keepEv(view, opts): number
abortWorthIt(view, opts): boolean

// core/placement.ts  — new
Swing { mean; stddev }
totalRounds(sanma), roundIndex(match, sanma), ranks(scores)
resultPoints(score, rank, sanma), rankOdds(scores, swings, seat)
expectedResult(scores, swings, seat, sanma)

// core/evModel.ts
EvModel.swing(rank, round, rules): Swing      // the one function allowed to see the table

// core/hououPrior.ts — GENERATED
HOUOU_SWING                                   // Variance.csv, [rank-1][round], points

// core/table.ts
evOf(core, seat): SeatEv | null               // on demand only
```

## 6. Deliberate simplifications, each stated in the code

- **`abortWorthIt` compares against zero**, because `EV(abort)` is zero under the pinned ruleset
  (Tenhou practice: honba +1, dealership rotating). A dealer's forfeited dealership is unpriceable
  without round sequencing (ADR-0023) and is named as a ceiling rather than guessed at.
- **A deal-in term names the seat the points go to; nothing else does.** The later-turns term is
  averaged over threats so it has no single recipient, and the win term prices the winner's gain
  only. Under placement all three are approximations in the same direction.
- **The rank integral treats the seats as independent**, which they exactly are not.
- **The value function is fixed by the ruleset**: 25000/30000 with uma ±10/±20, sanma 35000/40000
  with +15/0/−15. No free knobs, and no way to configure it, on purpose.
- **`evOf` is on demand and stamped.** Not a getter beside `ranked`/`danger` — those are
  milliseconds and this is hundreds of them.

## 7. Left undone

Ordered by how likely the next session is to want it.

1. **The push branch cannot switch to folding mid-sequence** (§2). Now the largest single unbuilt
   piece, and it needs the per-draw win curve `Outlook` does not carry.
2. **The two measurement sessions**, unchanged and still the only route from "is this any good" to a
   number: memo lifetime (`EV-5` §2.7) and the backtest against real logs (§2.13).
3. **A yaku-less dama branch.** Still pinned as a failing-by-design test in `ev.test.ts`.
4. **Posture** (`EV-5` §2.12). Still open, still blocking nothing.
5. **`AllLast.csv` and `CoinflipRatio.csv`.** Neither is extracted. The first would anchor South 4
   for a third-place seat; the second is a genuine validation target for the placement value
   function, in the way `DorasobaDanger.csv` is for the deal-in model.
6. **A trainer that grades on EV.** The lab shows it; nothing scores against it. `EV-5` §2.5's band
   and §2.8's Advanced folding option both want the backtest first.
7. **`EV-5` §1.10's coverage gaps**, unchanged: no redness in the DP, no ippatsu, no kan or kita
   replacement draws, chiitoi tanki folded into plain tanki, `HOUOU_OPEN_PRIOR` unreachable until
   open-tenpai reading exists.
8. **Round sequencing** stays deferred and stays its own ADR (ADR-0023). Placement no longer needs
   it; a dealer's kyuushu decision and a full-match trainer still would.

## 8. Things that would be easy to get wrong next

- **`abortiveDraws` defaults on.** Anything new that deals a board and does not want the hand ending
  at turn one must say so, the way the three drills do.
- **The no-borrowing rule survived the placement work and is the thing to keep checking.** Both
  models share `core/placement.ts`, and that is allowed _only_ because it holds no weights. The
  moment a fallback there reads one model's table under the other's name, the lab's comparison is
  measuring the fallback.
- **`PendingClaim` is a union now.** Anything reading `claim.from`/`claim.tile`/`claim.options` has
  to narrow on `kind === 'discard'` first — `EfficiencyPage`, `LabPage` and `ManualControls` all do.
- **Every seat carries an `EvSeat`, including the ones that ignore it.** A new `SeatView` built by
  hand in a test needs one.
- **A number out of `ev.ts` is meaningless without its objective.** The lab's panel names the seat,
  the model and the currency above every figure, and anything else showing them must too.
- **`useFoldingRound.test.ts` has a second flaky test** in the same family as the documented one
  ("a mid-hand link replays the discards behind it"), roughly one full run in six and never in
  isolation. Both go through that file's `deal()` helper, which waits on `loading` — a signal that
  reads the same for "searching" and "gave up". It is not an EV regression: folding runs no `'ev'`
  seat and turns abortive draws off.
