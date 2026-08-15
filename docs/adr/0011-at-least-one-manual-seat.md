# ADR-0011 — At least one seat stays manual

**Status:** Accepted · **Date:** 2026-08-15
**Source:** `resolveSeatConfig` in `features/settings/tableSettings.ts`; `goRound` in `core/table.ts`

## Context

Once every seat is a player with an algorithm ([ADR-0007](0007-every-seat-is-a-player.md)), the
seat panel can obviously offer "put every seat on an algorithm and watch". Nothing in the seat
panel prevents it. But `goRound(core)` plays every AI-decided seat and stops at the next manual
turn — with no manual seat, nothing stops it.

## Decision

`resolveSeatConfig(config, players, defaultSeat, fallbackModes?)` fills every seat and
**guarantees at least one manual seat**, anchored on `defaultSeat` (a link's `?seat=`, or the seat
the trainer generated) rather than on perspective.

Zero-manual boards are **deferred, not forbidden in principle**: they are a statistical-lab
feature with their own step and autoplay controls, which is real work — an autoplay path through
every round hook — not a seat-panel tweak.

## Consequences

- An advanced reader cannot yet put every seat on an algorithm and watch a hand play itself out.
  This is a known limitation, recorded so it is not mistaken for an oversight.
- The guarantee is the one standing restriction on an otherwise uniform seat model: every trainer
  offers every mode on every seat, with no baked-in "you vs opponents" distinction.

## Rejected

Letting `goRound` run to the hand's end when no seat is manual. It would be an autoplay
implementation hidden inside a loop guard, with no way to step, pause or watch it.
