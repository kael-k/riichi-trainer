# ADR-0035 — Efficiency asks for no calls; transient controls float, never resize the board

**Status:** Accepted · **Date:** 2026-08-26
**Amends:** [ADR-0034](0034-you-act-from-where-you-watch.md) (efficiency and lab no longer share
one `claims` answer)
**Source:** `features/efficiency/useEfficiencyRound.ts`, `components/tiles/BoardStage.tsx`,
`features/table/ManualControls.tsx`

## Context

Reported against a live link: after the graded seat in `/efficiency` discarded, the board offered
it a chi on an opponent's next discard. `useEfficiencyRound.ts` hardcoded `RoundOptions.claims:
true`, a regression from ADR-0034, which deleted the reader-facing "ask me to call" checkbox and
replaced it with `claims: true` for both efficiency and lab on the reasoning that the setting
itself was the confusing part, not its default. That reasoning holds for lab (free play — calling
is just part of playing a hand), but it was never re-examined against what efficiency actually
grades: `useEfficiencyDrill`'s `onEvent` dispatch scores exactly three actions — discard, kita,
closed kan (`'discard' | 'kita' | 'ankan'`) — and a pon or chi is none of them. Taking a call
reshapes the hand into something the drill never scored, and answering the prompt is not a
decision the trainer is about. Ron was already structurally unreachable there (`wins: false`
makes `tryWin` return `null`), and daiminkan is never modelled by the engine for anyone
(`ClaimOption.kind` has no `'kan'` case) — so the only real hole was pon/chi.

Investigating the fix surfaced a second, related problem: `ManualControls` and the kita/kan row
lived in `BoardStage`'s hand strip, a `shrink-0` flex sibling of the board area. Since the board
area is a `[container-type:size]` box the felt sizes itself against (`min(100cqw,100cqh)`), every
pixel that strip grew by — a claim prompt, a Kan button — came straight out of the square, and
because the row sat above `HandDisplay`, the hand itself shifted position under the reader's
finger each time a transient control appeared or disappeared. Worst on any height-limited board
(a phone held sideways, a desktop), which is exactly where CLAUDE.md's "a hand that moves under
the pointer is a hand you misclick" already warns against.

## Decision

**`useEfficiencyRound.ts` drops `claims: true` entirely**, leaving the field unset — which
`claimOptions` already treats as off (`round.ts`). `calls: true` stays: opponents calling is board
realism the reader pays nothing for; `claims` is specifically the flag that asks a manual seat
about it. Solo was already claims-free; folding leaves it unset for its own reason (fold-only);
lab is unchanged (`claims: true`, free play).

**`BoardStage` gains a `controls` slot**, rendered as a `position: absolute` overlay bottom-centred
in the board area — the board's own bottom edge is the hand strip's top edge, so it lands exactly
where these controls used to sit in flow, but costs the board no height when it appears or
disappears. It carries the same translucent card treatment `noticeCompact` already uses
(`bg-white/95 … shadow-lg ring-1`), since it now floats over whatever the felt draws underneath
rather than the page's plain background. Every board-rendering trainer (efficiency, folding, lab,
efficiency-solo) moved its `ManualControls` and kita/kan row out of `hand` and into `controls`;
`hand` is left holding only `HandDisplay`.

**A truthy `controls` prop is not the same as one with anything to show.** `ManualControls`
returns `null` in two of its four branches, and a bare `<ManualControls/>` element reference is
truthy regardless — so `controls && (<card>…)` alone would float an empty, still-`pointer-events-
auto` card (a dead zone over the felt) whenever nothing was actually owed. `ManualControls.tsx`
exports `manualControlsVisible(props)`, the same three-branch check its own render uses, so each
page can compute up front whether `controls` has anything in it (combined, for efficiency and
solo, with the kita/kan row's own precise eligibility rather than the old `options.sanma` blanket
check, which stayed true the whole game) and pass `undefined` rather than an empty wrapper.

## Consequences

- `e2e/board.spec.ts` gains two regression tests: one discard simultaneously pon-, chi- and
  daiminkan-shaped (`callableBoard`) proves no prompt appears — chi and pon by construction,
  daiminkan because the engine never offers it to anyone regardless — with two seats set manual
  live through the seat panel, matching how the bug was actually found; a sanma seat given a
  closed kan and a kita at once (`kitaKanBoard`, its two rinshan replacements pinned so neither
  draw can reopen a button already watched close) proves the board and hand-strip boxes never move
  across all three states, on every viewport project.
- `ManualControls.test.tsx` gains direct cases for `manualControlsVisible`'s two decision points
  (the `ended`/claim race, and "nothing to show" in the shipped single-seat setup).
- `useEfficiencyRound.test.ts`'s "the end card and a pending claim" describe block is rewritten:
  the two tests that exercised a pending claim in efficiency tested now-unreachable behaviour and
  are deleted; the multi-manual-seat freeze test (`actingPlayable` vs `finished`,
  `NOTE-efficiency-multi-manual-freeze.md`) is kept, decoupled from claims — it was never really
  about them, just sharing a fixture that happened to seed a second manual seat.
- `waitForFullHand`'s claim-declining defensiveness in `e2e/board.spec.ts` is now dead code for
  `/efficiency` specifically (nothing can ever offer that seat a call there), kept anyway as cheap
  insurance for whatever reuses the helper next; its comment, and `twoFuritenBoard`'s, are
  reworded off "claims are always on now" — still true of `replayLog`, which forces `claims: true`
  for its own duration regardless of the live setting, just no longer true of efficiency's live
  play.
- `handTiles()` drops its `hasNotText: 'Kan'` filter — the ankan button no longer shares the hand
  strip with the tiles at all.

## Rejected

- **Bringing back a reader-facing "ask me to call" checkbox, scoped to efficiency.** Rejected for
  the same reason ADR-0034 rejected it board-wide: a setting a beginner has to find and turn off
  before the screen makes sense is the failure, not the specific default. Efficiency's answer is
  not "off by default" but "not a question this trainer asks at all."
- **A `pointer-events: none` card with no backdrop**, leaving each transient piece to supply its
  own contrast against the felt. Rejected: `ManualControls`' claim branch already carries
  `bg-amber-50`, but the waiting-line and riichi-arm branches, and the kita/kan buttons, do not —
  a shared card is one place to guarantee contrast rather than four.
- **Detecting an empty `controls` from the DOM** (a `:has()`/`:empty` CSS rule on the card).
  Rejected as the same kind of cleverness CLAUDE.md already warns off elsewhere in this codebase:
  correct, but decoded at 3am. `manualControlsVisible` is a plain function call at the one call
  site that needs the answer.
