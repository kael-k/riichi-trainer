# ADR-0041 — Daiminkan and kakan are a match-only ruleset switch, not a permission

**Status:** Accepted · **Date:** 2026-08-27
**Amends:** [ADR-0010](0010-match-wide-permissions.md) ("Daiminkan is never offered to anyone")
**Source:** `core/policy.ts#availableCalls`, `core/round.ts#RoundOptions.calledKan`,
`core/round.ts#callKakan`, `core/actionLog.ts`

## Context

ADR-0010 recorded a real gap as a permanent one: "the engine models no called kan at all... so
offering it to one manual seat alone would be the one call no algorithm could answer." That was
true of every trainer that existed then — five drills, all graded against a frozen golden hash,
none of which needed a player to call kan to finish its lesson.

`/match` (ADR-0040) is a different kind of trainer: a whole game against the bots, not a drill. A
manual seat that holds three of a kind and cannot call kan on the fourth, or cannot add its own
held fourth tile to a pon it already made, is missing ordinary mahjong — confirmed the moment
someone actually played a hand and hit both.

## Decision

**Called kan is a ruleset switch, `RoundOptions.calledKan` (default `false`), shaped exactly like
`kiriageMangan` — not a fifth entry in ADR-0010's permission table**, for the same reason
`abortiveDraws` isn't one either (ADR-0038): it says which game is being played, not who may act
in it. Only `useMatchRound.ts` turns it on.

- **Daiminkan** (kan on a discard) is `Call.kind === 'minkan'`, one more entry
  `policy.ts#availableCalls` can push — legal from any seat's discard, honours included, unlike
  chi. **`chooseCall` never receives the flag** (it always calls `availableCalls` with the 3-arg
  form, defaulting `calledKan` to `false`): an AI seat never takes a minkan regardless of the
  ruleset, which is what keeps every graded drill's frozen hash untouched even if a future trainer
  turned the flag on by mistake. The manual claim path (`claimOptions`/`answerClaim`) is the only
  reader that ever passes `options.calledKan` through.
- **Kakan** (`callKakan`) is the acting seat's own action, mirroring `callAnkan`: it upgrades an
  existing `'pon'` meld to `'minkan'` in place (replacing the meld object, never mutating it —
  `core/table.ts#snapshotTable` shallow-copies the `melds` array but keeps the same `Meld`
  references, so mutating one in place would corrupt an already-taken snapshot), flips a kan-dora
  indicator, and draws a replacement — the same tail every kan runs.
- **Chankan is not modelled.** A real kakan briefly exposes the added tile to every other seat's
  ron before the kan completes; `callKakan` skips straight to completing it. Building that
  properly means a third `PendingClaim` shape threaded through `answerClaim`, `reconsiderClaim`
  and `replayLog` for one rare yaku — out of proportion to what shipped here. Recorded as a known
  gap (`docs/STATUS.md`), not built.
- The action-log codec (`core/actionLog.ts`) gained `'M'` inside a call token for minkan (its
  three `from` tiles are always the same id, so one tile token says as much as three) and a new
  top-level `'G'` token for kakan — additive, so every existing encoded log still round-trips.

## Consequences

- Every graded trainer (`efficiency`, `folding`, `scoring`, `shanten`) is byte-identical:
  `calledKan` defaults off, and even where a future flag flip turned it on, `chooseCall` never
  sees it.
- `/match` alone offers a real minkan claim and a real kakan button
  (`features/table/KitaKanControls.tsx`'s `onKakan`, present only there).
- Rinshan kaihou stays unimplemented (a pre-existing gap this change did not create or close —
  `callAnkan`/`callKita`/`callKakan` all draw a replacement but never check `tryWin` against it);
  `buildContext`'s own comment says so.

## Rejected

- **A fifth `MatchOptions` permission flag.** Considered and dropped for the same reason
  `abortiveDraws` was (ADR-0038): this says which rules are in play, not who is allowed to act —
  and unlike `calls`/`riichi`, no algorithm ever reads it, so it has no "AI choice" half to gate.
- **Building chankan in the same pass.** A real third suspension shape is a bigger, separate
  change; shipping kakan without it is a narrow, named gap rather than a blocked feature.
