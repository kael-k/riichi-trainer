# ADR-0030 — The felt sizes itself: container units, and a scale only where there is room

**Status:** Accepted · **Date:** 2026-08-24
**Source:** `components/tiles/Table.tsx`, `components/tiles/BoardStage.tsx`, `src/index.css`,
`e2e/board.spec.ts`
**Amends:** [ADR-0019](0019-mobile-first-board.md) (the square's sizing only; the mobile-first
goal and the fullscreen decision there stand as amended by [ADR-0025](0025-one-interface.md))

## Context

The board is one square whose whole layout is derived from a single width. Three separate bugs came
out of not honouring that consistently, and each was invisible in the environment it was written in.

A fixed pixel size anywhere inside the square does not scale with it. A `h-11` seat trigger — the
44px touch target the project requires — ran a phone-sized board's corner plate clean off the felt.

A percentage height against a box that gets its own height only from `aspect-ratio` is **indefinite
in WebKit**. `h-full` on the felt therefore fell back to auto, the grid rows sized to content
instead of to their `fr` shares, and the board came out 390x468 on an iPhone while Chrome drew it
square. Chrome and Firefox device emulation cannot see this bug class at all.

And the square's height cap was an estimate: `--board-max-h` was `100svh` minus a nominal chrome row
and a nominal hand strip. Whenever the guess came out tighter than the truth, it was the guess that
sized the board.

Meanwhile the tile-size setting was a reader preference offered at every viewport, including the
ones where the board is already limited by width and has no room to give.

## Decision

**Container units only, inside the square.** `--tile-w: calc(100cqw/14)` on the board's outer div;
everything in the square derives from it. Width goes on that outer div, never on the square itself,
or a `w-full` child collapses when the board is a flex item. Grid tracks stay `minmax(0,…)` — a seat
block is measured before it rotates.

**A 44px target without a 44px box.** The seat trigger is `8cqw` tall and keeps its ≥44px hit area
from an `after:size-11` pseudo-element: a real touch target over a layout box that costs the corner
only what it draws. Which is also why the box hugs its icon rather than carrying a `min-w`, whose
empty sides read as gap.

**`aspect-square w-full`, never `h-full`.** The felt is square by construction — a square with equal
percentage padding on all four sides, resolved against the width — which is the one form both
engines agree on. `e2e/board.spec.ts` asserts squareness on iPhone portrait, iPhone landscape and
desktop, and the UI suite runs a real WebKit for exactly this.

**The cap is `calc(min(100%, 100cqh) * var(--board-scale, 1))`** — the space it has, times the size
setting. The stage's board area declares itself a size container, so `100cqh` is the height
genuinely left after the chrome row and the hand strip have taken theirs. Nothing estimates it.

**The scale applies from tablet size up only** (`sizable:` = `(min-width: 768px) and
(min-height: 521px)`). `BoardStage` always declares the reader's choice as `--board-scale-pref`, and
only that variant resolves it into `--board-scale`, which is otherwise 1. The tile half
(`--tile-scale`) is gated by the same variant, so a phone is always at M — and the settings dialog
says so (`SIZABLE_QUERY`, the variant as a query; keep the two in step) rather than offering four
dead buttons.

`sizable:` is its own variant rather than `roomy:` (1024) because the two mean opposite things:
`roomy:` is where the layout **spends** room it has; `sizable:` is where the board has more room
than it needs and the reader may take some back.

**Where the setting applies it is a ceiling on the hand, not a width.** The hand strip is an
inline-size container and the box inside it caps `--tile-w-base` at `(100cqw - 4.5rem)/14`, so
asking for bigger tiles cannot wrap the hand onto a second row and take that row's height off the
board. Below the gate nothing is capped: the board there is limited by width, a second hand row
costs it nothing, and it reads better than the sliver a cap would leave.

## Consequences

- Below the gate the board always fills its room. That is a board rule, not a preference: the side
  seats' hand rows are `items-end` against the square's own edge, so a square smaller than its room
  pulls those hands off the screen edge by exactly the margin it leaves (39px on a 390px phone at
  the old S).
- There is no desktop "don't balloon" cap. `--table-max`/`--table-cap` are gone ([ADR-0025](0025-one-interface.md));
  the board fills the stage and the scale says how much of it to take.
- The felt's `p-[10%]` is the only thing naming the hand ring now — the constant that used to name
  it went with `--table-cap`. The ring is `absolute inset-0` on the **outer** square (the `relative`
  box the padding lives inside); `display: contents` on the per-seat grid wrapper generates no box,
  so the ring resolves against that outer square regardless of its grid-item ancestry, and
  `items-end` lands it flush against the square's true edge.

## Rejected

**The seat plate in a centre-panel row.** Tried, and too narrow: three 44px targets plus the round
wind, the wall count and the dora row do not fit that strip.

**The seat plate on a ring outboard of the seat's hand.** Tried, and its ring margin ran ~50px on a
phone — the plate and the hand row overflowed onto the seat's third river row. That band survives
the move at 10% of the square's edge, but as the revealed-hand ring alone (one row of tiles at
`100cqw/16`, ~8.3cqw deep), and only while `showsHands`.

**Keeping `--board-max-h` beside `100cqh` inside the same `min()`.** Harmless-looking, and it is
what actually sized the board whenever the estimate was tighter than the truth. With no size
container at all, `cqh` falls back to the small viewport anyway, so the estimate bought nothing.

**Offering the size setting at every viewport.** It is four buttons, three of which are a lie the
board cannot honour on a phone.
