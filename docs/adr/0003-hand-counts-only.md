# ADR-0003 — `Hand` stores counts; redness travels beside it

**Status:** Accepted · **TO REVIEW** · **Date:** 2026-08-11
**Source:** `core/hand.ts`, `core/match.ts` (`PlayerState.reds`)

## Context

Red fives (`0m`/`0p`/`0s`) are ordinary fives for every calculation the engine performs — shanten,
ukeire, decomposition, waits — and matter only for scoring and display. Modelling them inside the
hand representation would put a distinction on the hot path that the hot path never reads.

## Decision

`Hand` is a `Uint8Array(34)` of counts plus a fixed-meld count. It does **not** track redness.
`ParsedTile { id, red }` carries redness at parse and display level; `PlayerState.reds:
Set<TileId>` records which *kinds* a seat holds a red copy of.

One narrow, deliberate exception: **`Hand.drawn?: ParsedTile`** names the tile that brought the
hand to 14 (still counted in `counts`), because the redness of *the draw specifically* is not
reconstructable from `reds`, which tracks kinds rather than copies. It is set by `take` /
`drawReplacement` and cleared by `finishTurn` the moment the tile leaves the hand — before any
algorithm decision reads it, so a `SeatView` never sees a `drawn` naming a tile no longer held.

## Consequences

- `shanten()` — the app's hottest function — indexes a flat array and nothing else.
- Every consumer that needs redness must carry it alongside, which is a small, visible tax rather
  than a hidden one.
- The `drawn` exception is the shape the tsumogiri algorithm and the tedashi/tsumogiri river read
  both stand on; without it neither is expressible.

## Rejected

Dora-in-hand as a `Hand` field. It is a function of hand + `reds` + `doraIndicators`, so it
belongs in a helper — a `Hand` property would couple `Hand` to indicators, a far bigger concession
than `drawn`. Nothing needs it today.
