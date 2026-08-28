# ADR-0044 — Every decision the EV seat makes is priced, claim time included

**Status:** Accepted · **Date:** 2026-08-28
**Supersedes:** [ADR-0037](0037-the-ev-seat-decides.md) in the part naming "only two of the five
decision points are priced through the identity"
**Amends:** [ADR-0043](0043-one-turn-one-decision.md) ("Daiminkan by an AI seat… revisit when there
is a cheap `P(win)`")
**Source:** `core/ev.ts#rankCalls`/`bestCall`/`winWorthIt`/`kitaWorthIt`/`passEv`,
`core/evModel.ts#winValue`, `core/policy.ts#yakuRoute`, `core/ev.bench.test.ts`

## Context

`plans/EV-3` §7 and `plans/PLAN-ev-model.md` both specify that the `'ev'` decider prices **every**
decision point through the push/fold identity. Three waves in, three of them were still honest
stand-ins: `call` was `chooseCall`'s shanten rule plus a tenpai guard, `win` was `() => true`, and
the kita half of `turn` was `efficiency`'s ukeire comparison. The consequence a reader hits first is
that an `'ev'` seat could not answer the simplest question a claim asks — holding `78999m` with a
`9m` coming from the left, is chi better than pon better than kan?

Two things had been recorded as the reasons not to finish it, and reading the code found both to be
wrong.

**The cost.** ADR-0043 rejected pricing the call gate because it "would cost a `rankDiscards` per
seat per discard", against a documented `~460ms` a turn — a round going from half a second to
minutes. The `~460ms` is a whole **hand**. `core/ev.bench.test.ts` measures it: an `'ev'` seat plays
a 424ms hand over ~12 own turns, so a turn is ~35ms, and `efficiency`'s paired `~40ms` is a hand
too — impossible as a per-turn figure for one `evaluateDiscards`. Four doc sites said "hand" and
seven said "a turn"; the seven were citation drift, and every argument built on them was off by a
factor of eighteen. The second half of the estimate was wrong as well: a seat has a legal call on
~2.4 discards a hand, not on all of them, and `availableCalls` says so in pure counts arithmetic
before anything is priced.

**The shanten wall.** `chooseCall` was said to reject a daiminkan because a concealed triplet is
already a complete block, so `shantenAfterCall` returns `after === current` and the
`after >= current` guard fires. That is a generalisation from one hand and it is false: the real
answer was usually `after === current + 1`, because `shantenAfterCall` called `bestDiscards` on the
post-call hand. Right for a pon or a chi, which leave fourteen tiles and owe a throw — wrong for a
minkan, which leaves thirteen and draws its replacement, so `bestDiscards` probed a twelve-tile
hand. `shanten` is tile-count-blind, so nothing threw; the number was simply one too high, which is
exactly enough to make any screen built on it reject every open kan.

Under both of those sat one real gap. `probability.ts#collapsed` runs above `maxShanten` and never
reaches a leaf, so `Outlook.score` came back undefined and `conditionalWin` returned **zero**. That
single hole was three stated ceilings: `bestKan` declined above 2 shanten, `abortWorthIt` abandoned
nearly every kyuushu hand (they are 4+ shanten, so the zero _was_ the decision), and any call priced
early in a hand compared two branches that both carried no win value.

## Decision

**Every decision point goes through the identity, and the hole under them is filled first.**

- **`EvModel.winValue(hand, board)`** is a sixth member beside `dealInCost`/`giveUpCost`/
  `riichiUplift`: what this seat's own hand pays when it wins, for the hands the DP declined to
  price. `ev.ts#conditionalWin` reads it **only** where `Outlook.score` is undefined, so the exact
  DP is untouched wherever it ran. It takes a `HandShape` — dora held, closed, declared, yaku route
  — never tiles, which keeps `BoardCost`'s "a model prices costs, it does not see a hand" rule
  intact; `riichiUplift` set that precedent by taking a hand-derived scalar `houou` ignores.
  The no-borrowing rule holds: `statistical` derives it from the dora the hand holds and a stated
  per-route han, `houou` reads `HandScore.csv`'s own columns.
- **`policy.ts#yakuRoute`** replaces `hasYakuRoute`'s boolean with _which_ yaku, and
  `hasYakuRoute` becomes `yakuRoute(...) !== null` so the two cannot drift. The five answers are
  not an arbitrary carve-up — they are the columns `HandScore.csv` publishes for open wins, so a
  route names a measured price directly.
- **`ev.ts#rankCalls`/`bestCall`** price claim time: every legal call and the pass, each as a hand.
  `EV(pass)` is the thirteen-tile hand held as it stands (`passEv`, the `null`-tile shape of the
  same `evTerms` a discard uses — no immediate deal-in, and the later-turn walk starts a turn
  earlier). `EV(call)` is `keepEv` of the hand the call leaves, which dispatches on tile count: a
  pon or chi leaves fourteen-equivalent and is ranked by `rankDiscards`; a minkan leaves
  thirteen-equivalent and is priced by `passEv`.
- **`ev.ts#winWorthIt` and `kitaWorthIt`** close the last two stand-ins.

**Folding is still not a second code path.** `keepEv` weighs push against fold on _both_ hand
sizes. A thirteen-tile branch priced as a pure push would understate the alternative and lean every
comparison toward acting.

**A daiminkan's kan dora is priced as a multiplier, not left at zero.** The indicator is face down,
so the post-kan hand cannot be shown holding it. `KAN_DORA_UPLIFT` is `2 ** (14/34) − 1` — one
indicator, thirty-four kinds, fourteen tiles, and a han doubles — applied to the same
win/dealIn/danger terms `bestKan` scales, and it is arithmetic about the ruleset rather than a
figure either model measured, so both read it. `bestKan` needs no such constant because a closed kan
is a _binary_ choice against the identical hand and the multiplier cancels; a daiminkan is ranked
against a pon, a chi and a pass, so the magnitude has to be named.

**A declared seat pulls only a north it has just drawn.** `callKita` checks that a north is held and
nothing else, so the restraint lives in the algorithm: that is the one pull nukidora is free on,
since the locked thirteen are untouched and the wait cannot move.

## Consequences

- **`GOLDEN`'s forty hashes do not move.** `chooseCall` is untouched, so `efficiency`, `defense` and
  `tsumogiri` play every seeded round exactly as before.
- **`EV_GOLDEN` does not move either**, which was not expected and is a fact about `golden-3`
  rather than about the change: `calledKan` is off there, so no minkan is ever a candidate, and on
  that one wall the priced answer to every call matched `chooseCall`'s. At ~2.4 call opportunities
  a hand there are plenty of walls where the two never part.
- **The placement-divergence pair re-scanned to `golden-2`/`golden-8`** (from `golden-2`/`golden-6`).
  A re-scan, not a hunt — the test pins the claim, never the walls.
- **Measured cost: +23% on a hand**, 424ms → 520ms for one `'ev'` seat. `core/ev.bench.test.ts`
  keeps that number honest and is gated on `EV_BENCH` so it never runs in CI.
- **`abortWorthIt` changes materially**, and that is the point: a kyuushu hand is now weighed on
  what it is worth rather than on a structural zero. `round.test.ts`'s replay test was quietly a
  test of that zero, and now takes its abort from a person instead.
- Two bugs fixed on the way, both latent: `shantenAfterCall`'s minkan probe, and a daiminkan's
  replacement never being win-checked — the one kan path no caller covered, live for a manual seat
  since ADR-0041.
- Honba was being counted twice in the win term (`scoringRules` hands it to the DP's leaf and
  `computePayments` folds it into `payments.total`, then `price` added it again). Invisible until a
  hand is played at honba > 0, which no seeded test ever was.

### Ceilings this ships with, each stated in the code

- A daiminkan is priced without knowing _which_ dora the indicator turns out to be, only what one
  is worth on average.
- A pon steals turns and that prices at zero: `drawsLeft` is identical on both branches.
- On a quiet board a call has no cost side at all — `dealIn.ts` refuses to speak about a seat that
  has not declared — so an `'ev'` seat opens more in the first half of a hand than it should. Same
  refusal `bestKan` already carries, and it lifts in the same place.
- Declining a ron is honestly priced only for a seat in riichi, where the furiten is permanent and
  the DP's tsumo-only `soloWin` _is_ the post-decline value. Elsewhere the decline is understated
  and the answer leans toward taking the win, which is the safe direction.

## Rejected

- **Raising `maxShanten` instead of adding `winValue`.** `probability.ts` measures a fourteen-way
  ranking at ~84ms at 2-shanten against ~1.8s at 3, and a kyuushu hand is 4+.
- **Giving `collapsed()` a leaf price inside `probability.ts`.** It would define `Outlook.score`
  everywhere, which is tidier — but it puts a _price_ in the probability layer, which is the one
  thing ADR-0037 keeps out of it.
- **Deferring to `chooseCall` above `maxShanten`.** Considered while the hole was still open; once
  `winValue` fills it there is nothing to defer to, and a decider that switched rules by shanten
  would be two deciders.
- **Surfacing the call ranking in the lab panel.** `CallEv` carries its terms and the tests read
  them, but nothing draws them yet. `core/table.ts#evOf` stays a discard surface.
