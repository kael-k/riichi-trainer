# ADR-0025 — One interface: the board *is* the page

**Status:** Accepted · **Date:** 2026-08-18
**Source:** `UX.md`; the one-interface commit run of 2026-08-18
**Amends:** [ADR-0019](0019-mobile-first-board.md) (fullscreen as a place), [ADR-0015](0015-what-persists.md) (`mobileFullscreen` no longer exists)

## Context

[ADR-0019](0019-mobile-first-board.md) made fullscreen "somewhere you stay". It worked, and that
became the problem: the good layout was behind a button, and everything had to exist twice. A
header and a chrome row. A status bar and nothing. A log panel and a log drawer. Two feedback
densities picked by which shape you were in. Six pages threading a `full` prop into a component
that branched on it at the top.

The two were not equals, either. The inline layout was the one with the ukeire lists and the wall
reveal; the fullscreen one was the one that fit on a phone. A reader on a phone got the better
frame and the worse content, and the button between them was the app admitting it had not decided.

## Decision

**There is one layout.** `BoardStage` is the page a trainer renders — normal flow, `h-svh`, no
`full` prop, no overlay, no toggle. `TrainerLayout` is deleted; the stage carries what it owned
(the tile-scale variables, the clear-the-log-on-first-render guard) and renders the settings dialog
itself so the gear is always last in the chrome row.

**Everything that was inline-only moved onto it, in a session panel.** Score, clock, the full
feedback with its tile lists, the wall reveal, the share link, the lab's rankings, the log — one
renderer, two placements: docked beside the board from `lg` up and open by default, a drawer over
the top below that. Nothing lives in only one of them.

**Fullscreen stops being a mode and becomes a request.** `useMobileFullscreen` asks the browser for
real fullscreen on a phone, on the reader's first tap, once — and never again once they have left
it. No button, no persisted setting. The call only ever removed the browser's *own* chrome, which
is worth having on Android and does not exist on iOS.

**The size setting is one control over the whole table.** `BOARD_SCALES` pairs with `TILE_SCALES`
by index and reaches `Table` as `--board-scale`; XL is all the room there is. With the board no
longer sharing a page there is no "don't balloon" cap left to keep — `--table-max`/`--table-cap`
are gone.

## Consequences

- Net ~500 lines lighter, and every layout fix now lands once.
- `noticeCompact` keeps its job but narrows it: it floats over the board only while the panel is
  shut. Open in either shape, the panel's full feedback is the only copy — the same verdict in two
  wordings on one screen reads as a difference rather than a repeat.
- The pause a graded trainer owes the log is now derived from *drawer* open, not panel open: a
  docked panel hides no tiles, so it must not stop the clock.
- **The score is behind a tap on a phone.** Deliberate: mid-drill the board and the hand are what
  matter, the floating verdict still lands after every decision, and the alternative was a status
  strip taking height from a board that is already the tightest thing on the screen.
- `e2e/board.spec.ts` loses its `enterFullscreen` helper and gains a breakpoint assertion; the two
  drawer tests skip on wide viewports, where there is no drawer to test.

## Rejected

- **Keeping the toggle "for desktop users who want the chrome back."** The chrome was a browser
  header, a page header and a status bar — none of it about mahjong. Wanting it back is wanting
  the old layout, which is the thing being removed.
- **A persisted opt-out for the phone fullscreen request.** Leaving fullscreen is already an
  answer; remembering it for the session is enough, and a settings row for it is a row explaining
  a browser behaviour rather than a trainer one.
- **Repeating the score in the chrome row on phones.** Seven touch targets already fill a 390px
  row, and held sideways that row is a 44px gutter.
