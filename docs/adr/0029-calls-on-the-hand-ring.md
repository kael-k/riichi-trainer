# ADR-0029 — A seat's calls ride on its hand ring, not on the felt

**Status:** Accepted · **Date:** 2026-08-24
**Source:** `components/tiles/Table.tsx`, `HandDisplay`; CLAUDE.md UI section, which carried this
decision as "(ADR pending)" from the day it shipped

## Context

Melds and nuki used to pile up in the 3x3 grid's corner cell beside their seat. That is what a real
table looks like from above — a called set lies on the felt in front of whoever called it — and it
is not what a client looks like, because a client has to draw four seats' worth of that inside a
square whose middle is already a river.

Four melds drawn at hand size run past the felt's own edge. In the corner cell they also compete
with the seat plate for a cell that is four tile widths square, and a corner cell holding both is a
corner cell holding neither legibly.

## Decision

A seat's melds and nuki draw at the **right-hand end of its own hand ring** — the band outside the
felt that the square's own 10% padding pays for — at `100cqw/22` against the hand's `100cqw/16`.

- **The seat the board is drawn from has no hand out there**, so its calls go to `HandDisplay`
  under the board instead (`melds`/`nuki` props, the same 0.75 proportion and 0.8-tile gap). Every
  board page — scoring included — drops `melds`/`nuki` from that seat's `SeatView` and wraps the
  hand row in `justify-center`, since calls hanging off its right put an uncentred block under a
  centred board.
- **`HandDisplay` carries a `justify-center` of its own** for the case that wrapper cannot reach: a
  called hand is wider than the column under the board, so the calls drop to a second line and the
  tiles above them would otherwise sit flush left. Unwrapped, that class does nothing — the box is
  sized to its own content.
- **`showsHands` counts melds and nuki as well as hands.** A board where nobody's hand is drawn but
  somebody has called still has to pay for the ring, or those calls land across a river.

## Consequences

- The hand ring is load-bearing whenever any seat has called, not only when hands are revealed.
- Calls read as belonging to a seat's hand rather than to the table, which is what they are for the
  purposes this app is drawing them: what that seat's shape is, and what it is not concealing.
- The corner cell is free for the seat plate alone (ADR-0030).

## Rejected

**The corner cell.** A real felt seen from above, and the arrangement the board shipped with. It
loses to the fact that the same cell is the only place the seat plate fits, and to four melds not
fitting at hand size regardless.

**Drawing calls at hand size on the ring.** Straightforward, and overflows the felt. `100cqw/22`
is the size at which four melds fit the band the padding already pays for.
