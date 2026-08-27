# ADR-0038 — Kyuushu kyuuhai is a rule of the game, and the abort offer rides the claim suspension

**Status:** Accepted · **Date:** 2026-08-27
**Builds on:** [ADR-0009](0009-decision-seam.md) (the seam it adds a sixth method to),
[ADR-0010](0010-match-wide-permissions.md) (the flags it deliberately is _not_ one of),
[ADR-0016](0016-testing-strategy.md) (the golden hashes it had to not move)
**Source:** `core/round.ts`, `core/policy.ts`, `core/algorithm.ts`, `core/ev.ts`,
`features/table/ManualControls.tsx`, `plans/PLAN-ev-model.md`

## Context

`plans/PLAN-ev-model.md`'s next-wave list had seven items. Six of them are additive modules and
one is not: kyuushu kyuuhai — nine or more distinct terminals and honours in an untouched opening
hand, and the seat may abandon it — needs the engine to model an ending it has never had. It is the
one piece of the EV wave that edits `round.ts`, and the plan said so from the start.

It is also the decision `plans/REFINEMENTS.md` used to argue that table status cannot be deferred:
_East 3 in third place, nine terminals — abort. South 4 in fourth with 100 points, the same hand —
go for the kokushi._ Same tiles, opposite answers, and nothing but the score separates them.

## Decision

**It is a rule of the game, not a permission.** `RoundOptions.abortiveDraws` defaults **on**, unlike
the four ADR-0010 flags, which all gate what somebody is _allowed_ to do. The three graded drills
turn it off, and for the reason they already turn `wins` off: an abortive draw ends the hand on
something the reader did not cause, and a per-turn drill has nothing to grade in it. The lab leaves
it on.

**The three hand-written algorithms decline it, so the frozen hashes do not move.** `Algorithm`
gains a sixth method and `efficiency`, `defense` and `tsumogiri` all answer `false` — not as a
placeholder but because none of them has anything to price the two branches with. Ukeire ranks the
discards of whatever hand it is handed; it has no opinion on whether the hand is worth playing.
That is what let the rule ship on by default with `round.golden.test.ts`'s twenty hashes untouched,
which is the outcome ADR-0016 asks for and `plans/EV-5` §2.9 predicted would need an ADR to break.

**Only an EV seat decides it, and it decides through the same identity as everything else.**
`EV(abort)` is zero — under the ruleset `plans/EV-3` §7 pins (Tenhou practice: a ryuukyoku with
honba +1 and the dealership rotating) nobody pays and nobody collects — so the whole decision is
`EV(keep) < 0`, which is `abortWorthIt`.

**A manual seat is asked, through the suspension a claim already uses.** `PendingClaim` becomes a
union: `PendingDiscardClaim` (a reaction to somebody's discard, restartable, multi-seat) and
`PendingAbort` (the acting seat's own offer, one seat, one question, no answers map). They share the
suspension, `answerClaim`, and the prompt surface, and share nothing else. Declining costs nothing:
unlike a passed ron it leaves no furiten behind, and the turn resumes exactly where `beginTurn`
suspended it, fourteenth tile still in hand.

**`RoundState.ended` gains `'abort'` rather than borrowing `'exhaustive'`.** An abortive draw is a
ryuukyoku, but it is not an exhaustive one: nobody is noten and nobody pays. Collapsing the two
would be a lie a future settlement reads as truth.

**"First draw, uninterrupted" is `river.length === 0` plus no melds anywhere, not `turn === 1`.**
Seats are served in index order while the turn counter increments on the _dealer's_ seat, so with a
dealer other than seat 0 the counter moves in the middle of the opening go-around. Nukidora is
deliberately not disqualifying: a kita is not a call and leaves no meld behind.

## Consequences

- The rule is live on every board that has not opted out, and today that is the lab. A reader with
  nine orphans gets a prompt naming how many they hold, and two buttons.
- A link reproduces it: `LogEntry` gains an `abort` entry, `actionLog` encodes it as `Q` + seat, and
  `replayLog` answers the offer from the log. Replay forces every seat manual, so it raises the
  offer for seats that declined it silently in live play — nothing in the log is a decline, exactly
  the way a claim nobody answered is a pass.
- Two ceilings ship stated rather than hidden, and both are in `abortWorthIt`. A kyuushu hand is
  four or more shanten, above `probability.ts`' exact ceiling, so the collapsed chain prices **no
  win value at all** and `EV(keep)` is dominated by the give-up term: an EV seat therefore aborts
  almost every legal kyuushu hand. That is close to how the hand is really played and it is
  arithmetic rather than judgement, and it stops being arithmetic only when the win side can price
  a 4-shanten hand. Separately, a dealer that aborts gives up a dealership the points objective
  cannot price at all, because nothing here sequences to a next round (ADR-0023).
- **Under the placement objective the decision becomes the one `plans/REFINEMENTS.md` described.**
  `EV(keep)` is in result points there, and a last-place seat in South 4 values the tail of a
  kokushi differently from a comfortable one. Points alone cannot see that, which is why the two
  landed in the same wave (ADR-0039).

## Rejected

**A fifth `RoundOptions` permission flag alongside `wins`/`calls`/`riichi`/`claims`, default off.**
It would have kept the hashes frozen for free, and it would have cost the opposite thing: a rule of
mahjong absent from every board unless somebody found the switch. The flags in ADR-0010 answer
"may this seat do X"; this one answers "is this ruleset being played", which is the same kind of
field as `sanma` or `kiriageMangan`.

**A control button beside kita/kan instead of the claim suspension.** The offer would never block,
which is wrong — the engine has to know whether the hand is continuing before the seat discards —
and it would be a second prompt surface for a question the first one already answers.

**Offering it to AI seats only.** It is the decision the plan's own motivating example is about. A
reader who cannot make it is watching the model make it.
