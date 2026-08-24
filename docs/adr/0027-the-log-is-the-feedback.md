# ADR-0027 — The log is the feedback surface

**Status:** Accepted · **Date:** 2026-08-24
**Amends:** [ADR-0026](0026-stats-on-the-board.md) (a deal row is written per board, not per link)

## Context

[ADR-0025](0025-one-interface.md) left the session panel holding the full per-decision feedback
beside the log, and [ADR-0026](0026-stats-on-the-board.md) took the session stats out of it. What
remained was still two renderings of the same event: a feedback box describing the _last_ decision
(`DiscardFeedback`, `FoldFeedback`, shanten's inline card, `BoardStage`'s `notice` prop), and a log
row describing every decision in one flat translated sentence each.

That split cost twice. The box could only ever speak about the most recent turn — the tile lists
and ukeire counts for turn three were gone by turn four, though the row for turn three was still
sitting right beside it. And a panel that says the same thing in two densities has to keep both
wordings in step, in four locales.

## Decision

**The log row is the feedback.** The panel's feedback half is deleted and what it uniquely carried
moves onto the row it belongs to, behind a chevron, for every turn of the session:

- `LogEntry` gains `severity`, `detail` (i18n keys plus params and tiles, never text — a language
  switch has to re-translate an expanded row exactly as it re-translates the row itself) and
  `seam`.
- Rows lead with **tiles**, sentence beneath them, muted. A hand is what a player recognises a turn
  by; the sentence is the explanation of it.
- A **verdict spine** runs down the list's own left edge, one segment per row, coloured from
  `severity`. Read top to bottom it is the session's accuracy record. No `severity` is a distinct
  case from `'ok'` and draws a neutral hairline: a rewind, a replay or a lab row is not a graded
  decision, and a green bar beside one claims a verdict nobody gave.
- The header grows an `All | Mistakes` filter, with ordinals assigned before filtering so a row
  keeps its number under either.
- One feedback density is left on screen: the floating `noticeCompact`. The breakdown is a tap
  away, on the turn's own row.

Two rules follow from "the row is the record", and are the reason this ADR amends ADR-0026:

**A hand is drawn on exactly one row.** ADR-0026 had shanten's dealt row carry the hand inline; its
graded row carries the same thirteen tiles. In a list read newest-first that puts the incoming
hand's tiles directly above the _previous_ hand's verdict, which reads as the deal having replaced
it. The dealt row keeps only what the graded row cannot offer — copy, rewind and share of a hand
nobody has answered yet — and names the hand by number instead.

**A deal row is written per board, not per link.** ADR-0026's "every board is shareable from the
moment it exists" was only true of the first board of a session: every hook's dedup ref keyed on
the URL situation, which a local "New hand" never changes. The key has to be whatever the hook's
own build effect keys on.

## Consequences

- `DiscardFeedback.tsx`, `FoldFeedback.tsx` and `BoardStage`'s `notice`/`noticeKey` full density are
  gone; folding's `feedbackAtEnd` end card stops repeating each turn, since those are the rows
  `flushLog` writes.
- The log column is now something a player _reads_, not glances at, so it is sized for it: the row
  gives its whole width to the tiles (no ordinal gutter, no action cluster beside them), the panel
  widens from 320px to 448px as the desktop allows, and the tiles shrink to fit rather than wrap.
  A full hand reads on one line at every viewport the panel appears in.
- `folding.equallySafe` stays logged unconditionally and gated at _render_ on its setting, so the
  toggle reaches rows already on the record — the one thing a "write it or don't" gate could not do.
- Severity is derived from the grade the trainer already computed, never a new grading concept
  (`efficiencyVerdictSeverity`, `foldingVerdictSeverity`).

## Rejected

- **Keeping a last-action box as well.** Two densities of one verdict is what this removes; the
  float already covers "what just happened" and the row covers "why".
- **Keying a deal row on the `TableCore`.** It reads as the obvious identity for "this board", but
  `useRound` rebuilds in its own effect, so the core a render captured is still the outgoing board
  by the time a consumer's effect runs.
- **Oldest-first rows.** The newest decision is the one being read; a log that grows downward puts
  it behind a scroll.
