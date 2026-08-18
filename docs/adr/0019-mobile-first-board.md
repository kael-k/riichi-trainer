# ADR-0019 — Mobile-first: a square board, and fullscreen as a place

**Status:** Amended by [ADR-0025](0025-one-interface.md) · **Date:** 2026-08-14
**Source:** CLAUDE.md UI section; the `UX(mobile)` commit run of 2026-08-13/14

## Context

The project's stated goal is a phone-usable trainer, and the phone is where the layout keeps
breaking — a real mahjong table is square, a phone screen is not, and a browser's own chrome eats
the difference. This is also the single most bug-prone area of the codebase.

## Decision

- **Mobile-first is a hard requirement**: touch targets ≥44px (`min-h-11`); every layout must work
  at phone widths.
- **The board sizes itself from one width.** `Table` is a 3x3 grid measured in tile widths
  (4fr/6fr/4fr = 14 across) using container query units (`--tile-w: calc(100cqw/14)`). Put width
  on the outer div, never on the square, or a `w-full` child collapses when the board is a flex
  item. Tracks stay `minmax(0,…)` — a seat block is measured before it rotates.
- **The hand stays under the board at every size.** A real client and a real table both put your
  tiles along your own edge of the felt.
- **`short:` (max-height 520px — a phone held sideways)** keys the tile width off `vh` instead of
  `vw`, since a square board is only ever limited by height; the leftover width becomes the
  gutters chrome and notices sit in.
- **Fullscreen is somewhere you stay, not somewhere you visit.** `BoardStage`'s fixed overlay is
  what actually lays the board out; the real Fullscreen API only drops browser chrome on top of
  it. Back-to-home, the log drawer, the settings dialog, the trainer info button and the
  start/pause pair all live inside it. It auto-enters on phone-sized viewports behind
  `mobileFullscreen` (persisted, default on); exiting on a phone writes the setting false rather
  than closing for one visit.
  _Taken further by [ADR-0025](0025-one-interface.md): the overlay became the only layout, so the
  toggle, the setting and the inline shape it moved between are all gone. Everything else in this
  bullet still holds — those controls are the stage's, and the API still only drops browser
  chrome._
- **`requestFullscreen` only ever fires inside a real user gesture.** A load-time call is rejected
  outright, so an auto-entered stage defers to the reader's first `pointerdown` — and the
  "no gesture yet" flag is cleared only from inside that listener, never eagerly in the effect
  body, because StrictMode replays the effect with no real gesture in between.
- **iOS gets the overlay and nothing more.** Safari has no element fullscreen; its bars are removed
  only by installing the PWA to the Home Screen, which `IOSInstallHint` points at.
  `viewport-fit=cover` plus `env(safe-area-inset-*)` padding keeps the layout out from under those
  bars, with the padded side flipping as `short:` moves the chrome row into the left gutter.
- **Feedback must not cover the tiles it is talking about.** Two densities: `notice` (full) and
  `noticeCompact` (one line, icon, colour) floating over the board — and in the right-hand gutter
  instead once `short:`. _Under [ADR-0025](0025-one-interface.md) the full one lives in the session
  panel and the compact one floats only while that panel is shut._

## Consequences

- This lands compact feedback on phones and full on desktop — originally with no JS media query at
  all; since [ADR-0025](0025-one-interface.md) the panel's own docked/drawer split is one
  `useMediaQuery` read, because a layout that changes *shape* cannot be expressed in CSS alone.
- Severity is always **derived at display level** from the grade or partial credit that already
  exists — never a new grading concept.
- **The board being square in every orientation is an invariant, not a preference**, and it is
  currently violated on some phone layouts. See `docs/STATUS.md`.

## Rejected

A separate mobile layout component tree. The `short:` variant and container query units keep one
tree, which is the only reason a fix lands in both shapes at once.
