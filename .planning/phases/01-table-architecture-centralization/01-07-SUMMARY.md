---
phase: 01-table-architecture-centralization
plan: 07
subsystem: ui
tags: [react, i18next, tailwind, danger-model, ukeire]

requires:
  - phase: 01-table-architecture-centralization
    provides: "core/table.ts + useTableRound (plan 01-03), TableSettings/useTableSettings('lab')
      default row (plan 01-06), useFoldingRound's BACK_TILE reveal-gate filler (plan 01-04)"
provides:
  - "useLabRound: a use*Round hook over useTableRound with zero grading — full
    evaluateDiscards ranking + full assessDiscards tier list stashed once per turn, no score, no
    useSessionStats, no worthwhile-style filter"
  - "LabPage: standalone /lab trainer — tenhou-notation wall loader (Load/Build/Reset, parsed only
    on button press), plain empty state, inline red D-12 error sentence, and two height-capped
    scrolling lists (full ranking, full danger-tier breakdown) reusing the existing feedback row
    shapes with no new list component and no invented probability/EV figure"
  - "Home page's Table group grows to four cards (efficiency, folding, scoring, lab); trainer.lab.*
    and lab.* locale keys (incl. per-WallError.reason zone/reason keys) translated in en/ja/zh/it"
affects: []

actuals:
  tokens: 7330
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A hook that wants both evaluateDiscards and assessDiscards reads both off the same
      onUserDraw-stashed TableAnalysis object once per turn (D-05), never during render — the lab
      is the one consumer that reads both getters where every other trainer reads only one"
    - "A reveal-gate filler constant (BACK_TILE) is exported from the trainer that first needed
      it (useFoldingRound.ts) and reused by name from a sibling trainer, rather than each hook
      redefining its own 'no identity' tile"

key-files:
  created:
    - src/features/lab/useLabRound.ts
    - src/features/lab/useLabRound.test.ts
    - src/features/lab/LabPage.tsx
  modified:
    - src/features/folding/useFoldingRound.ts
    - src/features/i18n/trainerLinks.ts
    - src/features/i18n/locales/en.json
    - src/features/i18n/locales/ja.json
    - src/features/i18n/locales/zh.json
    - src/features/i18n/locales/it.json
    - src/routes/index.tsx
    - src/routes/HomePage.tsx

key-decisions:
  - "Ranked/danger list rows are local, non-exported LabPage.tsx components (RankedRow/DangerRow)
    that mirror DiscardFeedback's and FoldFeedback's row JSX rather than exporting and reusing
    those components directly — keeps this plan's edit footprint exactly the files its own task
    list names (LabPage.tsx only), at the cost of a small amount of duplicated row markup"
  - "A hand-pasted wall's own ruleset is resolved via the already-exported resolveSanma(wall,
    situation.sanma, globalSanma) at Load-press time, stored alongside the accepted wall in local
    state, and threaded into RoundOptions.sanma — reusing the exact inference a shared ?wall= link
    already gets, so a pasted 108-tile sanma wall doesn't get silently padded back out to 136
    tiles under a stale yonma setting"
  - "situation/wall/river passed into useLabRound are memoized (useMemo, module-level EMPTY_WALL/
    EMPTY_RIVER constants) rather than built as fresh object/array literals per render — an
    unmemoized empty array would look like a new wall to useTableRound's restart-detection on
    every render and redeal the match in a loop"

patterns-established:
  - "A trainer with no grading still drives useTableRound's full callback contract
    (onUserDraw/onUserDiscard/onAgariCall) — the contract doesn't presuppose scoring, so a
    pure-analysis surface costs nothing beyond what it actually reads"

requirements-completed: [REQ-05]

coverage:
  - id: D1
    description: "useLabRound exposes the full evaluateDiscards ranking and full assessDiscards
      tier list per turn, with no score/correct-incorrect/session-counter fields and no
      worthwhile-style filter on the wall it's given"
    requirement: REQ-05
    verification:
      - kind: unit
        ref: "src/features/lab/useLabRound.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "useLabRound's boardHands reveal-gate hides every non-own seat's real tiles
      (BACK_TILE filler) until the hand is finished, reusing useFoldingRound's own filler"
    requirement: REQ-05
    verification:
      - kind: unit
        ref: "src/features/lab/useLabRound.test.ts#mid-hand, every other seat's boardHands is BACK_TILE filler / boardHands reveals every seat once the hand is finished"
        status: pass
    human_judgment: false
  - id: D3
    description: "LabPage renders a standalone /lab route with a wall loader, empty state, inline
      red D-12 error state, and the two full lists with no new list component, no new colour, and
      no invented probability/EV figure anywhere"
    requirement: REQ-05
    verification:
      - kind: unit
        ref: "npm run build (tsc -b && vite build) exit 0; acceptance-criteria greps (text-red-600,
          overflow-y-auto, absence of font-bold/font-semibold/text-lg+/toFixed/Math.round/
          dangerScore, min-h-11 count, round.finished usage) all pass"
        status: pass
    human_judgment: true
    rationale: "The plan's own acceptance criteria mark the invalid-wall-link rendering and the
      34-row phone-width scroll behaviour as <human-check> — visual/interaction verification a
      grep or unit test cannot substitute for"
  - id: D4
    description: "/lab is routed, has a fourth Table-group home card, and trainer.lab.*/lab.* copy
      (including per-WallError.reason zone/reason keys) is translated, not left in English, in
      en/ja/zh/it"
    requirement: REQ-05
    verification:
      - kind: unit
        ref: "node -e locale-key-presence and desc!=en checks (plan's Task 3 acceptance
          criteria); npm test/lint/build all exit 0"
        status: pass
    human_judgment: true
    rationale: "The plan's own acceptance criteria mark the home page's two-solitaire/four-table
      layout as <human-check> — a visual layout claim, not something the automated checks assert"

duration: 16min
completed: 2026-08-13
status: complete
---

# Phase 01 Plan 07: Statistical Lab Summary

**Standalone `/lab` trainer that loads/authors a wall, plays only the user's own discards, and
renders the complete `evaluateDiscards` ranking plus the complete `assessDiscards` danger-tier
breakdown with zero grading anywhere.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-13T08:55Z
- **Completed:** 2026-08-13T09:11Z
- **Tasks:** 3
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments

- `useLabRound.ts`: a `use*Round` hook over `useTableRound` that stashes both `analysis.ranked`
  and `analysis.danger` per turn, plays the hand out (`stopAtTenpai: false`), logs one plain
  tile+turn row per discard with no grading, and gates every non-own seat's hand behind
  `useFoldingRound`'s exported `BACK_TILE` filler until the hand is finished — 8 unit tests
  covering ranked/danger completeness, the reveal gate, and "nothing is filtered."
- `LabPage.tsx`: tenhou-notation wall loader (Load/Build/Reset, parsed only on button press, never
  per keystroke), a one-sentence empty state, an inline red D-12 error sentence naming the
  offending zone and tile, the shared `<Table>` board, and two height-capped scrolling lists
  (`RankedRow`/`DangerRow`) reusing `DiscardFeedback`'s and `FoldFeedback`'s row shapes — no new
  list component, no new colour, no `toFixed`/`Math.round`/`dangerScore` anywhere in the file.
- `/lab` route, a fourth Table-group home-page card, and `trainer.lab.*`/`lab.*` (including
  per-`WallError.reason` zone/reason keys for the error sentence) translated across en/ja/zh/it —
  home page now lists two solitaire and four table apps.

## Task Commits

1. **Task 1: The lab's round hook — full analysis, zero grading** - `df054dc` (feat)
2. **Task 2: The lab page — loader, empty and error states, the two full lists** - `25e8de6` (feat)
3. **Task 3: Route, home card and four translations** - `fe53c96` (feat)

_No separate plan-metadata commit — SUMMARY.md is committed together with STATE.md by the
orchestrator after this worktree merges (worktree mode)._

## Files Created/Modified

- `src/features/lab/useLabRound.ts` - the lab's round hook: full analysis, zero grading, reveal gate
- `src/features/lab/useLabRound.test.ts` - 8 behavior tests
- `src/features/lab/LabPage.tsx` - loader, empty/error states, board, two full lists
- `src/features/folding/useFoldingRound.ts` - exported `BACK_TILE` for reuse by the lab
- `src/features/i18n/trainerLinks.ts` - added `TRAINER_WIKI.lab`
- `src/features/i18n/locales/{en,ja,zh,it}.json` - `trainer.lab.*`, `lab.*`, `log.lab.discard`
- `src/routes/index.tsx` - `/lab` route
- `src/routes/HomePage.tsx` - fourth Table-group card

## Decisions Made

- Reused `resolveSanma` (already exported from `urlCodec.ts`) at wall-load time instead of hand-
  rolling ruleset inference for pasted walls — a pasted 108-tile wall now resolves to sanma the
  same way a shared `?wall=` link's own length would.
- Kept `RankedRow`/`DangerRow` as local presentational functions inside `LabPage.tsx` rather than
  exporting `FeedbackRow`/`Row` from `DiscardFeedback.tsx`/`FoldFeedback.tsx`, to keep this plan's
  file-edit footprint exactly what its own task list named.
- Memoized `situation`/`options` (and stable `EMPTY_WALL`/`EMPTY_RIVER` module constants) rather
  than passing fresh object/array literals into `useLabRound` every render — otherwise an
  unmemoized empty wall/river would look like a new board to `useTableRound` on every render and
  redeal in a loop.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `TRAINER_WIKI.lab` during Task 2 instead of Task 3**
- **Found during:** Task 2 (`LabPage.tsx` references `TRAINER_WIKI.lab` for its info-popover link)
- **Issue:** The plan assigns `TRAINER_WIKI.lab` to Task 3, but Task 2's own verify command
  (`npm run build`) fails without it — `tsc` errors on `Property 'lab' does not exist`.
- **Fix:** Added the `lab: 'https://riichi.wiki/Tile_efficiency'` entry to
  `src/features/i18n/trainerLinks.ts` in Task 2's commit instead. Task 3 found it already present
  and didn't re-add it.
- **Files modified:** `src/features/i18n/trainerLinks.ts`
- **Verification:** `npm run build` exits 0 after the addition.
- **Committed in:** `25e8de6` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy Task 2's own verify command; no scope creep — the value
added is identical to what Task 3 already specified.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- This was the final plan (wave 6) of Phase 01 (table-architecture-centralization). All seven
  plans (REQ-01 through REQ-07) are now complete pending the orchestrator's phase-level
  verification and STATE.md/ROADMAP.md updates.
- No blockers identified. The lab's `<human-check>` items (invalid-wall-link rendering, phone-width
  scroll behaviour, dark-mode read, home-page layout) are flagged in this SUMMARY's `coverage`
  block for the phase's UAT pass.

---
*Phase: 01-table-architecture-centralization*
*Completed: 2026-08-13*
