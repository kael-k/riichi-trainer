# ADR-0040 — Rounds sequence into a match; `/match` is the trainer that plays one out

**Status:** Accepted · **Date:** 2026-08-27
**Amends:** [ADR-0023](0023-round-inside-match.md) ("sequencing is a later wave")
**Source:** `core/match.ts#settleRound`, `core/round.ts#roundResult`, `features/match/`

## Context

ADR-0023 gave the engine a real `MatchState` — points, honba, dealer, riichi sticks, which round —
but stopped deliberately short of anything that steps between rounds: no dealer rotation, no honba
increment, no payout settlement, no end-of-match detection. `docs/STATUS.md` listed "Round
sequencing" and "Placement/uma/oka" under _Out of scope, on purpose_ for exactly that reason: no
trainer needed it, only the contract did.

The request that closes that gap is a trainer that plays a **whole match** against the bots —
choose east-only or hanchan, choose the ruleset, choose who plays each seat, then play it out round
by round. That needs the sequencing ADR-0023 deferred, and nothing about the six shipped trainers
asks for it to work any differently than it already does.

## Decision

**Sequencing is one pure function, and it never lives inside `round.ts`.** `core/match.ts#settleRound`
takes the _ended_ round's own `MatchState` (`RoundState.match` — a riichi mid-round already
deducted 1000 and added a stick there) plus a small `RoundResult` (`core/round.ts#roundResult` reads
one off `state.win`/tenpai seats/nothing, for `'win'`/`'exhaustive'`/`'abort'`) and a stated
`{ sanma, format }`, and returns the next round's `MatchState`, each seat's point delta, and whether
the match is over.

- **A round never knows what follows it.** `round.ts` gained one small reader (`roundResult`) and
  nothing else — no call to `settleRound`, no dealer-rotation logic, no format. The caller
  (`features/match/useMatchRound.ts`) reads the ended round's result and feeds it back in.
- **Payments price the same way a real win already does.** `Payments.total`/`.main`/`.fromDealer`
  (`core/score.ts`) already carry honba; `settleRound` turns them into per-seat deltas without
  re-deriving the ruleset math a second time. Exhaustive draws split a flat `(players-1)*1000` pot
  by tenpai/noten count, same as the honba/dealer-repeat rule that's driven the rest of the engine
  since ADR-0023: the _current_ dealer repeats on a win, a draw with the dealer tenpai, or an
  abort; anything else rotates the seat, zeroes the repeat, and advances the round (wrapping the
  wind past the format's own player count).
- **The React side needs no new trick from `useRound`.** A round is "redealt" the same way every
  other trainer already redeals one: a fresh wall **array identity**. `useMatchRound#nextRound`
  sets `settleRound`'s returned `MatchState` and a freshly-dealt wall in the same commit, and
  `useLinkedHand`'s existing "link identity changed -> `handIndex` resets to 0 -> `fromLink` is
  true again" rule (`features/situation/useLinkedHand.ts`) is what makes the next render's
  `useRound` deal it as a new hand. Nothing in `core/table.ts` or `features/table/useRound.ts`
  changed.
- **`/match` plays; it does not grade.** Like the lab, the points are the score — no verdict, no
  accuracy, no session stats. Two steps: a setup screen (format, the shared `RulesetSettings`, a
  per-seat algorithm row reusing `SeatPanel.tsx`'s own five-choice `MODES`) captured once into a
  `MatchConfig`, then the match itself on the same shared table layer every board trainer sits on.
  Seat algorithms are **not** re-captured per round — unlike a hand-graded trainer's seat panel,
  which resets on every new hand, a match's own seat panel state persists for the length of the
  match, exactly like its dealer does.
- **Two `BoardStage`-wrapped subtrees never render in the same pass.** `BoardStage` clears the
  shared log store inline during its own first render (deliberately not a mount effect — see its
  own doc comment). A direct `config ? <MatchBoard/> : <MatchSetup/>` swap between the two steps
  let React render the _new_ `BoardStage`'s clear() while the _old_ one's `LogList` was still
  mounted and subscribed to that store — "cannot update a component while rendering a different
  component". `MatchPage` routes every transition through one blank render first (`settled`), so
  the old tree fully unmounts before the new one mounts.
- **Sticks still on the table when the match ends go to the leader** (ties to the lowest seat, same
  as `placement.ts#ranks`) rather than a next hanchan this engine never plays.

**Deliberately still not modelled**, each a real ruleset variant nobody has decided on yet: dealer
agari-yame/tenpai-yame, West sudden death when nobody has reached the return score, nagashi mangan,
and sanma's nukidora paid out separately from ordinary dora.

**The placement objective's `totalRounds` stays hanchan-length regardless of format** (`core/
placement.ts`) — plumbing `MatchFormat` through `swing`/`evOptions` so an `'ev'` seat on the
placement objective prices a tonpuu match's shorter swing correctly is a separate wave.

## Consequences

- `docs/STATUS.md`'s "Round sequencing" and "Placement/uma/oka" move out of _Out of scope, on
  purpose_ — the first ships, the second (raw `resultPoints` on the standings card) rides along
  since it needed only settled points, which sequencing now provides.
- Every one of the six existing trainers is untouched: `core/round.ts` gained a pure reader with no
  new caller inside the engine, and `core/table.ts`/`features/table/useRound.ts` are unchanged.
  Golden hashes don't move.
- `MatchState`'s fields (`dealerRepeat` vs `honba`, `prevalentWind`/`round` as separate fields) pay
  off exactly as ADR-0023 predicted: `settleRound` never had to bolt a ruleset assumption onto the
  type to tell the two counters apart.

## Rejected

- **Sequencing inside `round.ts`.** A round playing out has no business knowing whether the dealer
  keeps the seat afterward — that question depends on ruleset (format, an eventual agari-yame) a
  single deal has no reason to carry.
- **A `nextRound()` that mutates `MatchState` in place.** `createRound` already takes a _copy_ of
  `options.match` for the identical reason (ADR-0023): a round's own state must never write through
  to state a caller still owns. `settleRound` returns a new object for the same reason.
- **Grading `/match`.** Considered and dropped: a whole-match drill's value is playing dealer
  rotation, honba and placement pressure end to end, not another discard-by-discard verdict the
  other five trainers already give. Push/fold and efficiency grading stay exactly where they are.
