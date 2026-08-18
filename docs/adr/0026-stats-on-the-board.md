# ADR-0026 — Session stats float on the board; the log carries its own share

**Status:** Accepted · **Date:** 2026-08-18
**Amends:** [ADR-0025](0025-one-interface.md) ("the score is behind a tap on a phone" is reversed)

## Context

ADR-0025 put the clock, the running score and the accuracy line in the session panel's top box,
alongside the full per-decision feedback, the share link and the log itself — one panel, four
jobs. On a phone that panel is a drawer, so ADR-0025 accepted the consequence deliberately: "the
score is behind a tap on a phone."

In practice a clock behind a drawer tap is a clock nobody reads mid-drill. It is not log content —
it does not belong to a specific decision the way a log row does, and it should not share the log's
container or its visibility. The panel's remaining jobs (full feedback, the lab's own extras, the
log) also read more clearly without a fourth, unrelated one mixed in.

Separately, the panel's share pill (`CopyLinkButton`, "Copy situation link") duplicated something
the log already half-did: every graded decision already left a rewindable, shareable row behind it
(`log.replay`, `log.shanten.result`, …) via `LogEntry.situation`. The one gap was the board as
freshly dealt, before any decision — there was no row for that, so the page-level pill existed
only to cover it.

## Decision

**Session stats float as a small HUD in the board area's own corner**, not in the session panel.
`BoardStage`'s `status` prop now renders inside the board area (the same box `noticeCompact`
floats in), positioned opposite it — bottom-left rather than the notice's top-center — so the two
floats never compete for the same strip. Always on screen, panel open or shut, at every viewport;
kept short and glossary-clickable rather than `pointer-events-none` as a whole, since efficiency's
ukeire line carries a live `GlossaryTerm` trigger.

**Every deal writes its own log row.** Each trainer's round-build effect now logs `log.dealt` (or,
for the shanten stream, `log.dealtHand`, carrying the hand inline) with `situation` set to the
board as dealt (or, for folding, as handed over) and an empty action log. That row's existing
rewind and share buttons (`LogList.tsx`) become the one way to send or return to a fresh board.

**The page-level share pill is deleted.** `CopyLinkButton` and its five call sites are gone —
sharing goes through the log exclusively now, the same surface every other decision already shared
through.

## Consequences

- The session panel is left holding exactly three things: full feedback, the lab's own rankings/
  wall authoring, and the log. One job removed, none added.
- A trainer's log now opens with a "Board dealt" (or "Hand dealt") row rather than starting empty —
  every board is shareable from the moment it exists, not only after the first decision.
- `situationQuery()` stays on every round hook: T2's dealt rows are built from it (or its
  equivalent per-hook expression), it is no longer read from any page.
- `LogEntry.situation` is "before this action" by construction; the dealt row's situation is
  therefore "before anything happened", i.e. the deal itself — sharing from the newest row mid-hand
  still hands the receiver the board one action back from the exact current state, same as every
  other row already did.

## Rejected

- **A second `statusCompact` density for the HUD**, mirroring `notice`/`noticeCompact`. The
  existing stat sentences read fine stacked in a small corner chip; a second density is a prop and
  a sync problem for wording that was never the issue.
- **Putting the stats in the chrome row.** ADR-0025 already rejected this for the score generally:
  seven touch targets fill a 390px row, and held sideways that row is a 44px gutter with no room
  for text.
- **Carrying a second "situation after" field per log row** so a share always lands on the exact
  current state rather than one action back. Rewind needs "before"; a duplicate "after" field buys
  an off-by-one nobody drilling will notice, at the cost of a field every row must now keep in
  sync.
