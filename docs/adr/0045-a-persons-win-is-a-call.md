# ADR-0045 — A person's own win is a call, and a claim is answered from wherever you are watching

**Status:** Accepted · **Date:** 2026-08-28
**Amends:** [ADR-0009](0009-decision-seam.md) in the part that says a manual seat's own tsumo is
never an explicit choice, and [ADR-0034](0034-you-act-from-where-you-watch.md) in the part that
gates the claim prompt on perspective.
**Source:** `core/round.ts#PendingWin`/`offerOrEnd`/`replacementWin`,
`features/table/ManualControls.tsx`, `plans/improve-implementation-of-match.md`

## Context

ADR-0009 drew the seam and wrote down, as a deliberate simplification, that
`tryWin` skips `Algorithm.win` entirely once `algorithm === 'manual'`: _"a real person's legal
tsumo is never an explicit choice"_, on the reasoning that riichi.wiki agrees a legal tsumo always
ends the hand. That is true of a **rule**; it is not true of an **interface**. On `/match` the
reader watched hands end on a tsumo they were never offered and had no chance to weigh — damaten,
keeping a cheap hand open for a dealer repeat, or simply seeing what they had drawn before the
board swept it away. A ron was already a button. The tsumo was not.

The same simplification had a second, quieter cost. `callKita`/`callAnkan`/`callKakan` never priced
the replacement they drew — only `takeTurn`'s AI loop did (ADR-0043) — so a **manual seat's rinshan
tsumo did not exist as an engine-level concept at all**. `replayLog` had a hand-rolled copy of the
check for exactly that reason, and `resolveReactions`' daiminkan replacement had grown a third copy
(ADR-0044). One rule, three implementations, and the one path a person could reach had none.

Separately, ADR-0034 gated every manual control on `acting === viewSeat`, so a reader who had
rotated the board to watch another seat lost the claim prompt. `beginTurn`/`finishTurn` are no-ops
while a claim is pending, so that was not a hidden control — it was a frozen board with nothing on
screen to unfreeze it.

## Decision

**Every self-drawn win a manual seat completes is offered, not taken.** `PendingClaim` gains a
third shape:

```ts
interface PendingWin {
  kind: 'win'
  seat: number
  tile: ParsedTile // what completed the hand: the draw, or a kan/kita replacement
  win: WinRecord // already priced, so the prompt can show what declining costs
}
```

raised by one function, `offerOrEnd(state, options, win, tile)`, which ends the hand unless the
winner is manual **and** `RoundOptions.claims` is on. `answerClaim` takes `{ kind: 'tsumo' }` to end
it and anything else to hand the turn straight back — the fourteenth tile is still in hand and the
seat still owes its discard, exactly as the kyuushu offer already worked. Declining leaves **no
furiten**: furiten is a rule about a ron you passed up, and this tile came off the wall.

**A ron does not go through it**, and must not: `claimOptions` has already asked, and `tryWin` only
awards one once the reader has said yes. **An AI seat does not either**: `tryWin` has already
consulted `Algorithm.win`, which is the same decision asked of something that can price it.

**And the rinshan check moves into the three `call*` functions**, as `replacementWin` — one
implementation, shared by the AI loop, by replay and by a person's own pull. `callAnkan` takes
`RoundOptions` for it, which its own doc comment had until now been right to say it did not need.

**A pending claim renders its prompt from any perspective.** Only the riichi arm keeps ADR-0034's
`acting === viewSeat` gate: riichi is an offer, so requiring a rotation to reach it costs nothing.

## Consequences

- The reader can damaten, and can see a rinshan tsumo at all.
- **No golden hash moves.** The offer needs `claims` on _and_ a manual seat; the three graded drills
  run `wins: false`, and no `GOLDEN`/`EV_GOLDEN` fixture has a manual seat. `/lab` and `/match` are
  the two boards that change, which is the intent.
- `replayLog` gets smaller: it answers the offer from the log (a win entry is a yes, nothing at all
  is a decline — the same rule it already applies to kyuushu and to an unanswered claim) instead of
  re-deriving the win itself.
- A declined tsumo, like a declined kyuushu and a declined claim, leaves **no trace in the log**, so
  a link shared from just past one re-offers it. Same known gap `docs/STATUS.md` records for a
  declined claim, and the same fix would close all three.
- `resolveReactions` now hands the turn to the daiminkan caller *before* returning when its
  replacement offer suspends, since the fall-through that used to do it is unreachable behind a
  pending claim.

## Rejected

**Leaving the tsumo automatic and adding a confirm dialog in the UI.** The engine would still have
ended the hand; there would be nothing to confirm. The suspension has to be the engine's, because
what makes the decision real is that `beginTurn`/`finishTurn` stop until it is answered.

**A `RoundOptions.tsumoPrompt` flag.** `claims` already means "ask a manual seat rather than
deciding for it", and this is that question about a tile you drew yourself. A second flag would have
let a board ask about a pon and not about a win, which is a distinction nobody wants.

**Offering a ron the same way, for symmetry.** It would ask the reader twice for one decision.

**Keeping the perspective gate and adding back a "go to seat" button.** That is the line STATUS
item 24 deleted, for the good reason that the felt's turn glow and the seat plate's eye already say
who owes the decision. What they cannot do is answer it.
