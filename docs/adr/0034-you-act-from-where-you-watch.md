# ADR-0034 — You act from where you watch; the felt says who owes a decision

**Status:** Accepted · **Date:** 2026-08-26
**Amends:** [ADR-0015](0015-what-persists.md) (drops `claims` as a `TableSettings` field)
**Amended by** [ADR-0035](0035-efficiency-asks-for-no-calls.md): efficiency no longer hardcodes
`claims: true` — only lab still does
**Source:** `features/table/ManualControls.tsx`, `components/tiles/Table.tsx`,
`features/table/SeatStrip.tsx`, `features/efficiency/useEfficiencyDrill.ts`

## Context

`plans/NOTE-efficiency-multi-manual-freeze.md` recorded a bug found while executing
`PLAN-ux-6`: with a second seat set to `'manual'` in `/efficiency`, that seat's tiles were inert
on its own turn, because `EfficiencyPage`'s `canAct` read `finished` — a tile count of the
**graded** seat (`seatIndex`), true for the whole window between that seat's discard and its next
draw. `useEfficiencyDrill.ts`'s `hand`/`drawn` already followed the **acting** seat correctly; only
the gate that decided whether those tiles could be clicked was anchored to the wrong seat.

Investigating it live surfaced a second, related problem the NOTE did not name: nothing on the
felt said *who* owed a decision. `ManualControls` suspended its whole control surface — riichi arm,
claim prompt — the instant perspective moved away from `seatIndex`, per ADR-0015's "perspective is
view-only in every trainer." That was fine when only one seat could ever be manual, but with a
second manual seat (or a claim on a seat the reader wasn't watching) the board looked idle with no
way to tell it was waiting on a person, let alone which one. The seat panel's "Ask me to call on
other seats' discards" checkbox (`TableSettings.claims`) added a second question on top, and it
read as confusing rather than as a real choice most readers ever had reason to turn off.

## Decision

**A reader acts — discards, kita, kan, calls, riichi — from the seat the board is drawn from.**
Perspective still never makes a seat manual (that stays `SeatConfig`'s job, ADR-0015 unchanged
there); it now decides **which** manual seat's controls are live. `Table` itself is untouched by
this — it still has no idea what playing is (ADR-0014) — the shift is entirely in the page-level
`ManualControls`, which used to gate everything on `seatIndex` and now gates on `viewSeat`:

- `acting === viewSeat` and no claim: the riichi-arm control, same as before.
- `claim.seat === viewSeat`: the claim prompt.
- Otherwise (a different seat — manual or the claim's own seat — owes the decision): one line
  naming it plus a "Go to {wind}" button that rotates perspective there. This replaces both the old
  "Playing {wind}" (informational, no button) and "Watching {wind} / Back to your seat" (perspective
  escape valve) cases with a single shape, since both were really the same fact: the seat that owes
  the decision is not the one on screen.

**`Table` grows one new field, `activeSeat`** — board truth like `riichi`/`points`, passed in and
drawn as an amber bar on the felt's edge nearest whoever owes the decision (the same
rotated-square-overlay trick `seat-points` already uses to face a value toward one seat). This is
the *ambient* half of the fix; the waiting line's button is the *shortcut* half. Together they are
what makes "the table looks stuck" self-diagnosing: the glow says which way to rotate, the button
does the rotating.

**A claimable discard is displaced in its own river row** (`SeatView.claiming`, `River`/`Discard`
in `Tile.tsx`) — nudged toward its own discarder and ringed amber — rather than the claim prompt
repeating "South discarded" in text. The prompt itself drops that sentence (kept only as an
`aria-label` on the group, for screen readers) and instead draws each call option as the meld it
would actually make, the claimed tile ringed in place. `Ron` is the one filled/emphatic button;
`Pon`/`Chi` are ordinary buttons; `Pass` is a ghost button — declining must not be the loudest
option on screen, which the old solid-black `Pass` was.

**`TableSettings.claims` is removed.** Every manual seat is now simply asked about another seat's
discard: `useEfficiencyRound` and `useLabRound` hardcode `RoundOptions.claims: true`; folding
hardcodes it unset (`undefined`, which `claimOptions` already treats as off) — the drill is
fold-only (CLAUDE.md, and the audit's B3 already suppressed folding's riichi-arm on the same
reasoning), so a pon offer there would be wrong regardless of any setting. The checkbox added a
second axis of "will I be asked" on top of "which seats are manual" that most readers never needed
to touch; dropping it is a straight simplification, not a narrower feature — `RoundOptions.claims`
itself (the engine-level flag `claimOptions`/`answerClaim` read) is untouched.

**"Watch from here" moves out of `SeatButton`'s dialog and onto the seat's own plate** as an eye
icon, between the settings gear and the wind (`SeatStrip.tsx`) — rotating is common enough now (the
turn glow is the whole reason to do it) that it earns a one-tap affordance rather than two taps into
a dialog. This needed the plate to grow from two lines to three (waits, then algorithm+furiten, then
eye+gear+wind): measured live at a 390px board, the two-line version had ~4px of slack left, nowhere
near a third 44px touch target, and adding the icon inline wrapped the algorithm badge onto the
waits row.

**The NOTE's freeze is fixed by a new derived field**, `useEfficiencyDrill`'s `actingPlayable` —
the *acting* seat's own tile-count-complete check, as opposed to `finished`'s graded-seat one:

```ts
const actingPlayable = hand.length + (drawn ? 1 : 0) + actingMelds.length * 3 === 14
```

`EfficiencyPage`'s `canAct` reads it instead of `!finished`. `finished` itself is untouched — it
keeps its existing meaning and its two other readers (`tenpai`, the clock's `running`) — because
the graded seat's own freeze between its turns must still hold, and `finished` is exactly what
holds it. Folding and lab needed no equivalent change: their own `finished` already means "the
round ended," not a tile count, so their `canAct` was never wrong in the way the NOTE described.

## Consequences

- `ManualControls`'s props change shape: `seatIndex` is gone (`acting` is now compared against
  `viewSeat` directly, since `acting` already *is* the claim's own seat whenever one is pending —
  `core/table.ts#actingSeat` puts the claim ahead of the turn order), `onReturn` is renamed
  `onGoTo(seat)` and now targets whichever seat owes the decision rather than always `seatIndex`,
  and a new `ended?: boolean` gate (the drill's own "is it over" — `drillOver` for efficiency,
  `finished` for folding/lab) suppresses the riichi arm and the waiting line once nothing is owed.
  **`ended` deliberately does not outrank a pending `claim`.** Efficiency's `drillOver` rides on
  `finished`, a tile count, so it is true for the whole window between the graded seat's tenpai
  discard and its next draw — and a *replayed* link lands in that window with live play still
  running behind it, so an opponent can offer that seat a call while the end card is already up.
  `beginTurn`/`finishTurn` are no-ops until a claim is answered, so suppressing the only prompt
  that can answer it freezes the board outright (found by `e2e/board.spec.ts`'s restart-after-
  replay test, which deadlocked on a chi; pinned since by `ManualControls.test.tsx`).
- `seats.playingSeat`/`seats.watchingSeat`/`seats.backToYourSeat`/`seats.claims` are dropped from
  all four locales; `seats.waitingSeat`/`seats.goToSeat` replace the first three.
- `SeatButtonProps` loses `onWatch`/`claims`/`onClaimsChange`; `onWatch` moves to `SeatStripProps`
  alone, since only the strip's own eye button reads it now.
- Old persisted settings blobs keep a stale `table.apps.*.claims`/`table.global.claims` key nothing
  reads — accepted the same way ADR-0015 already accepts a stale `seats` key: the persist version
  stays put rather than dropping every reader's theme and language to purge one dead field.

## Rejected

- **Keeping the claims checkbox but defaulting it on.** Rejected per the maintainer: the setting
  itself was the confusing part, not its default — a reader who sees the table "stuck" is expected
  to rotate and act, not to go find a setting.
- **A visible "South discarded" caption on the claim prompt.** Rejected: the felt's own displaced,
  ringed tile already answers "what," and the turn glow already answers "who" — a caption would
  repeat both in text.
- **Anchoring the prompt beside the discarder's river tile**, floating on the felt itself. Rejected:
  it would rotate with the seat (the same `InfoPopover`-on-a-rotated-plate problem the furiten badge
  already worked around), and there is no room for it on a 338px board.
