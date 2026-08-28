# ADR-0012 — The React match layer reports engine events; policy lives in trainers

**Status:** Accepted · **Date:** 2026-08-16
**Source:** `core/table.ts`, `core/match.ts#stepMatch`, `features/table/useMatch.ts`

> Replaces the original ADR-0012 ("Shared `core/table.ts` and `useTableRound`; folding keeps its
> own thin hook"), which was never accepted — it carried a **TO REVIEW** flag, and reading it back
> against the code found all three of its load-bearing claims false. Rewritten in place rather than
> superseded, since there was no accepted decision to preserve a trail for.

## Context

An audit found ten duplications between the efficiency and folding round hooks, `seenBy` alone in
three implementations. The first attempt split the shared mass into a pure `core/table.ts` plus a
React `useTableRound`, and exempted folding on the grounds that its mid-hand algorithm flip needed
turn granularity the hook's three-callback contract could not offer.

That justification did not survive being checked:

1. **The flip is not mid-hand.** It lives in `playToRiichi`, a module-level pure function running at
   _generation_ time, and it sits at a turn boundary — not "between `beginTurn` and `finishTurn`".
2. **`playMatch`'s `stop` never saw a half-stepped turn.** `playFrom` built
   `[...beginTurn(...), ...finishTurn(...)]` eagerly and only then iterated, so by the time a
   predicate fired on the riichi event that turn's discard and reactions were already applied.
3. **`core/table.ts` held no replay fast-forward.** That is `replayLog` in `match.ts`
   ([ADR-0021](0021-action-log-replay.md)).

Underneath all three sat the actual problem. The engine has always emitted a seat-tagged
`MatchEvent` union — draw, discard, riichi, call, win, exhaustive, kita, ankan — from `beginTurn`,
`finishTurn`, `answerClaim`, `callKita`, `callAnkan` and `reconsiderClaim`. **Every call site in
both hooks discarded the return value**, and so did `goRound`. Having thrown the events away, the
React layer had to reconstruct a narrower story from state: three callbacks about one designated
seat. Folding could not be told in that story, so it was exempted — and then re-derived the go-round
loop, the claim-suspension guard, the live algorithm sync and the pre-throw analysis capture for
itself.

## Decision

**The React layer drives a match and reports what the engine did. It has no opinion about what any
of it means.** Every trainer built on a real match uses it, folding included.

**One stepper.** `stepMatch(state, options, canAct?)` (`core/match.ts`) is a generator: turn after
turn, yielding each event. A caller stops by not asking for the next one, so "play a whole hand",
"play until someone declares riichi" and "play up to the next seat a person decides for" are three
callers rather than three loops. `playFrom`, `playMatch`, `playWall` and `goRound` all collapse onto
it. `canAct` is asked once per turn _before_ anything is drawn — the one stop condition a caller
cannot express by walking away, since by the time an event is yielded its turn has already run.

**One callback.** `useMatch`'s consumers subscribe to `onEvent(ctx)` and decide for themselves which
seat they grade, when a round is over, and whether a board is worth keeping. A handler steers by
what it returns: `{ stop }` halts where the board stands, `{ restart }` abandons the deal for a
fresh wall. `stop` is a real action rather than the caller merely declining to continue — the turn's
draw has to be cleared for a hand to read as finished.

**Layer 1 has no privileged seat.** `TableCore` is `{ match, options }`; `seenBy` and `analysisOf`
take an explicit seat; `snapshotTable` is uniformly per-seat, with no `hand`/`drawn` pair naming
one. Which seat a trainer grades and which seat a page draws at the bottom are both that consumer's
business, and keeping them in the same field is what made grading and perspective the same idea for
as long as they were.

**Two things stay with the layer, because only it can know them.** `TableAnalysis` copies the hand
it describes: a discard is reported once the tile has already left, so ranking the live hand would
score thirteen tiles. And `MatchEventContext.logLength` records how long the log was when the turn
began, which is the cut a rewind link needs. Both are temporal facts about when an event fired, not
policy.

**Replayed events are reported, tagged `replaying: true`, not suppressed.** The board really did
reach that state, so a consumer rebuilding _state_ treats them like any event while one that grades
or logs skips them. Blanket suppression was the layer deciding a grading policy on the consumer's
behalf.

**Folding uses all of it.** Its generation stays a pure rejection-sampling search — the reject
condition is `worthwhile` failing at the handover point, and running up to 120 full simulations
through React would cost a render apiece. What that search produces is a wall, the algorithms each
seat ended on, the graded seat and generation's own log; `replayLog` rebuilds the handed-over board
from exactly that. The flip never needs replaying, because replay puts every seat on manual and only
the _starting_ algorithms of live play matter.

## Consequences

- Six invariants maintained in two places become one each: the claim-suspension guard, the live
  algorithm sync, the drawn-tile re-draw guard, the StrictMode build dance, the pre-throw analysis
  capture, and the replay stop condition.
- `buildRound`'s `stoppedAtTenpai` special case is gone. The live path and the replay path stop by
  the identical mechanism instead of the replay path re-implementing the live one.
- The double-build defect is fixed. The round is built once, during the render that first needs a
  board, and the mount effect reuses it; replayed events are queued by the build and drained by the
  effect, so nothing grades or logs mid-render.
- [ADR-0011](0011-at-least-one-manual-seat.md) is superseded: a driver that runs with no manual seat
  is the autoplay it deferred.
- `stepMatch` deliberately does **not** stop at a manual seat — `finishTurn` covers one by borrowing
  `efficiency`'s discard, and `playMatch` has always relied on that. Stopping at a seat the engine
  cannot decide for is `goRound`'s condition, passed in through `canAct`.
- A manual seat is one the engine _draws for_ and never _decides for_, so a driver that stops at one
  must still take its draw. Missing this asked the reader to discard from thirteen tiles, and only
  the e2e suite caught it.

## Rejected

**Named callbacks per event kind** (`onRiichi`, `onWin`, …). The union is already exhaustive and is
the engine's own vocabulary; a prop per event is how a contract grows one consumer at a time, which
is the failure the original ADR was reaching for and misnaming.

**A `tenpai` event in the engine.** Tenpai is a derived property of a hand, not something that
happens in the rules the way a riichi declaration does. It is one `shanten()` call in the one
trainer that stops on it.

**Driving folding's search through `{ restart }`.** Kept as the contract for a consumer that plays
boards to judge them, but folding's own search is pure and stays that way — see above. `{ restart }`
therefore has no production consumer today.
