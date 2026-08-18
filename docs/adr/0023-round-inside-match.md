# ADR-0023 — A round is one deal; a match is the game it sits inside

**Status:** Accepted · **Date:** 2026-08-16
**Source:** `core/match.ts`, `core/round.ts`; `PLAN-match-context.md` T0–T6

Amends [ADR-0009](0009-decision-seam.md)'s rejection of points/honba/sticks on `SeatView`.

## Context

The engine modelled exactly one deal and called it a match. Dealer was hardcoded `seat === 0`, and
nothing anywhere tracked points, honba, riichi sticks, or which round it was. `ScoringRules.honba`
existed with its 300/100 payout maths and was passed a literal `0`. ADR-0009 deferred the lot as
"additive later", on the ground that a permanently-`undefined` field is one every algorithm has to
defend against.

No trainer needs any of it today. What needs it is the *contract*: an EV algorithm cannot be
written against a table with no scores, and the statistical lab has nothing to measure without
one. This is the deferred half arriving, without the trainers that will eventually read it.

## Decision

**Mahjong Soul's naming, and a real match-level state above the round.** A **round** is one deal —
deal, draws, discards, a win or an exhaustive draw. A **match** is the game rounds sit inside.

- `core/match.ts` → `core/round.ts`, with the full cascade: `RoundState`, `RoundOptions`,
  `RoundEvent`, `createRound`, `playRound`, `stepRound`, `findRound(Async)`,
  `features/table/useMatch.ts` → `useRound.ts`, `TableCore.match` → `TableCore.round`. The five
  feature-level `RoundOptions` took per-trainer names (`EfficiencyOptions`, `SoloOptions`,
  `LabOptions`, `FoldingOptions`, `ScoringOptions`) because core wins the collision.
- `core/match.ts` is now a standalone, pure, ~40-line module: `MatchState { prevalentWind, round,
  honba, dealerRepeat, dealer, riichiSticks, points }` plus `createMatch(sanma, overrides?)`.
  Starting points are always assigned — 25000 yonma, 35000 sanma.
- `RoundOptions.match` is **required**, replacing the old `round: TileId` (now
  `MatchState.prevalentWind`, which pairs with the existing `SeatView.seatWind`).
  `createRound` takes a **copy**, so a round's own mutation never writes through to caller-owned
  options.
- **`honba` and `dealerRepeat` are separate fields.** They diverge by ruleset — some rulesets zero
  the repeat on a noten-dealer exhaustive draw yet still add a honba — so one field would bake a
  ruleset into the type.
- **Carry-in and within-round mutation only.** No `nextRound()`, no dealer rotation, no honba
  increment, no payout settlement, no end-of-match detection, and the winner does not collect the
  sticks — all of that is sequencing, and sequencing is a later wave. The one thing that moves is
  riichi: `finishTurn` takes 1000 off the declarer and adds a stick.
- It reaches everything: `RoundState.match`, `SeatView.match` (live, the same object — **this is
  the amendment to ADR-0009**, whose rejection rested on there being no model behind the numbers),
  `TableSnapshot.match` (a copy — points move mid-round, a snapshot must not), the situation link
  (each field omitted at its default, so an unmodified link stays exactly as short), and the board
  (round number beside the wind, per-seat points on the plate).
- Three "east is seat 0" assumptions died with it: `seatWind` is now
  `HONOR + ((seat - dealer + players) % players)`, "am I dealer" is `seat === state.match.dealer`,
  and the turn counter increments on the dealer's seat.

## Consequences

- Every default is identity with the old hardcoding (`dealer: 0`, `honba: 0`, East 1), which is why
  the golden hashes ([ADR-0016](0016-testing-strategy.md)) stayed byte-identical across the rename,
  the plumbing and the seat-wind fix. Only the riichi deduction moved a stored state, and only in
  `round.replay.test.ts`'s snapshot.
- The vocabulary of every ADR written before this one is one word off: 0006, 0007, 0009, 0010 and
  0012 say `MatchState`/`MatchOptions`/`useMatch` where the code now says
  `RoundState`/`RoundOptions`/`useRound`. Those decisions stand as written; only the names moved.
- EV, deal-in rates and push/fold grading are **unblocked, not adopted** —
  [ADR-0004](0004-ordinal-danger.md) is not superseded by this. Danger stays ordinal.
- `MatchState` is reachable from an algorithm and nothing reads it yet. That is the intended state:
  a field that is always populated and sometimes unread, rather than ADR-0009's feared field that
  is permanently `undefined`.

## Rejected

- **Naming a round a "hand".** It collides with `Hand`, the 34-count array every hot path uses.
- **One `repeat` field for both honba and dealer repeats.** See above — it is a ruleset difference,
  not a synonym.
- **Sequencing in the same wave.** Dealer rotation and settlement need payout rules, abortive-draw
  handling and end conditions this codebase has not decided on; shipping types plus carry-in keeps
  the decision open rather than guessing it.
- **Points as an optional field.** Always assigned, per ruleset. An optional score is a score every
  reader has to branch on, which is exactly what ADR-0009 was avoiding.
