---
phase: 01-table-architecture-centralization
verified: 2026-08-13T09:35:40Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Start a folding drill with every reveal setting (show opponent hands / hide concealed hands / show wall) turned on."
    expected: "Threats' seats show face-down backs of the correct tile count and no real faces until the hand ends; the reveal panel then shows the real hands."
    why_human: "Visual/interaction confirmation of the rendered board — the data-layer gate (`boardHands`) is behaviorally tested, but the plan itself (01-04) calls out the on-screen result as a human-check item."
  - test: "Open the home page and visually confirm the Solitaire heading over two cards (efficiency-solo, shanten) and the Table heading over four cards (efficiency, folding, scoring, lab); open `/efficiency-solo` and confirm no board renders, open `/efficiency` and confirm the board renders."
    expected: "Two-heading layout with the correct card counts; efficiency-solo shows a flat hand-only layout, efficiency shows the table board."
    why_human: "Layout/copy legibility — plan 01-05's own acceptance criteria mark this a human-check item."
  - test: "On a phone-width viewport, open `/efficiency-solo`."
    expected: "Hand, river and controls fit without a board; every interactive control is at least 44px tall."
    why_human: "Responsive layout at a specific viewport width — not assertable from a unit test."
  - test: "Toggle the global 'show opponent hands' setting on; check the efficiency board, the scoring board, and a folding board mid-drill."
    expected: "Efficiency and scoring boards reveal opponents' tiles; the folding board still shows only face-down backs until the hand ends."
    why_human: "Cross-page visual confirmation that the settings resolver's per-page wiring behaves as the data-level tests predict."
  - test: "Open the settings panel from the home page and from each trainer."
    expected: "Every row still works; nothing asks for a third 'inherit' state; the wall-reveal row appears only when Advanced is on."
    why_human: "UI/UX confirmation of the settings dialog after the schema migration — plan 01-06's own human-check item."
  - test: "In the statistical lab, paste/load a wall string that fails validation (e.g. `wall=11111m`)."
    expected: "One inline red sentence names the offending zone and tile; the board stays empty; nothing is silently loaded."
    why_human: "Rendered error text and layout — plan 01-07's own human-check item."
  - test: "In the statistical lab, load a full wall on a phone-width viewport."
    expected: "The 30-plus ranking rows scroll inside their own height-capped box; the board and hand stay on screen."
    why_human: "Responsive/scroll behavior at a specific viewport — not assertable from a unit test."
  - test: "Copy a wall link out of the table efficiency trainer (`/efficiency`) and open it in the statistical lab (`/lab`)."
    expected: "The identical board appears in the lab, with the full ranking and full danger-tier list for the same hand."
    why_human: "This is the literal wording of ROADMAP Success Criterion #2. The shared `decodeSituation`/`encodeSituation` codec and `situationQuery()` wiring are confirmed by code trace and unit tests (both consumers round-trip through the same `Situation.wall` field), but no automated cross-page browser test exercises the actual link-copy-and-paste flow between the two routes."
  - test: "Switch the app to dark mode and reload the lab."
    expected: "The error sentence, the two lists, and the board all read correctly with no new colour introduced."
    why_human: "Visual theme check — plan 01-07's own human-check item."
---

# Phase 1: Table architecture centralization Verification Report

**Phase Goal:** Split the efficiency trainer into solitaire (no opponents) and table (with
opponents) routed apps; centralize turn-stepping and per-turn analysis behind a pure
`core/table.ts` and a `useTableRound` React hook; move board sharing from seeds to explicit,
validated walls; unify table settings under a global-default-plus-per-app-override schema; ship a
standalone statistical lab.

**Verified:** 2026-08-13T09:35:40Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Home page lists two solitaire apps and four table apps, each its own route; no setting silently changes which app a route is | ✓ VERIFIED | `src/routes/index.tsx` (7 routes incl. `efficiency-solo`, `lab`); `src/routes/HomePage.tsx` (`SOLITAIRE_MODES` = efficiency-solo, shanten; `TABLE_MODES` = efficiency, folding, scoring, lab). `grep -rn "opponents"` across `src` finds no `opponents` flag/setting left (only `opponentWins`/`showOpponentHands`, distinct fields), confirming no hidden flag can retarget a route. |
| 2 | A wall built or edited in the statistical lab opens as the identical board in the table efficiency trainer via a shared link | ✓ VERIFIED (wiring); see human item | Both `LabPage.tsx` and `EfficiencyPage.tsx` decode via the same `decodeSituation` (`src/features/situation/urlCodec.ts`); `useLabRound.situationQuery()` → `encodeSituation(table.situation())`, and `useTableRound.situation()` (`src/features/table/useTableRound.ts:318-322`) serializes `wall: [...c.match.wall]` — the exact `ParsedTile[]` the lab dealt from, including a hand-authored wall from `wallWithHand`/pasted input. `urlCodec.test.ts`'s round-trip test and `useTableRound.test.ts` cover the codec- and hook-level guarantees; no automated browser test performs the literal copy/paste between `/lab` and `/efficiency`, so the end-to-end flow is a human-verification item (see below). |
| 3 | Turning on every "show hands"/reveal setting during a folding drill never shows a threat's hand before the hand is over | ✓ VERIFIED | `useFoldingRound.ts`'s `boardHands` (data substitution: `BACK_TILE` filler for every non-self seat until `finished`) plus `FoldingPage.tsx`'s `concealed: !(showOpponentHands && round.finished)`. Behaviorally tested, not just presence-checked: `useFoldingRound.test.ts`'s `describe('boardHands (the D-14 reveal gate)', …)` (3 cases: mid-hand filler at correct count/identity, own seat always real, real tiles only once `finished`) — all pass (`npx vitest run src/features/folding/useFoldingRound.test.ts` → 27/27 green). |
| 4 | Folding's round hook is built on `core/table.ts`'s stepper, with none of the duplicated `seenBy`/snapshot/replay-fast-forward logic | ✓ VERIFIED | `useFoldingRound.ts` imports `analysisOf, goRound, replayDiscards, snapshotTable, yourDiscards` from `../../core/table` (grep confirms exactly one such import line). `grep -cE '^function seenBy|^function yourDiscards' useFoldingRound.ts` = 0. `snapshot()` spreads `snapshotTable(core)`; `advanceAfterDiscard` calls `goRound(core)`; `buildRound` calls `replayDiscards(core, discards, step)`. `playToRiichi` retains its own raw `beginTurn`/`finishTurn` loop with the `policy = 'defense'` flip (D-08, by design — this is the one control-flow folding must keep for itself), confirmed by `grep -c "policy = 'defense'"` = 1. |
| 5 | `npm test` (incl. tile-census and shanten-equivalence invariants), `npm run lint`, `npm run build` all pass | ✓ VERIFIED | Ran directly: `npm test` → 660/660 passed (53 files); `npm run lint` (oxlint) → clean, 0 issues; `npm run build` (`tsc -b && vite build`) → exit 0. Census invariant (`src/core/match.test.ts` "never loses or duplicates a tile") and shanten-equivalence (`src/core/shanten.test.ts`, `standardShanten` vs `referenceStandardShanten`) both run as part of the full suite and pass individually when isolated. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Requirements Coverage (REQ-01 through REQ-07)

No `.planning/REQUIREMENTS.md` file exists in this project (checked; not present). ROADMAP.md is
the authoritative requirement source for this phase and lists `REQ-01` through `REQ-07` against
the phase, each mapped to exactly one plan:

| Requirement | Plan | Description (from ROADMAP) | Status | Evidence |
|---|---|---|---|---|
| REQ-01 | 01-05 | Split efficiency into solitaire/table routes; delete `opponents` | ✓ SATISFIED | Routes confirmed above; `opponents` deleted from `settingsStore.ts`, `urlCodec.ts` |
| REQ-02 | 01-01 | Explicit, validated walls replace seed+`Pinned` | ✓ SATISFIED | `core/wall.ts` (`validateWall`, `completeWall`, `wallWithHand`, `WallError`); `createMatch(wall, …)`; `Pinned` interface deleted (`grep -c '^export interface Pinned'` = 0) |
| REQ-03 | 01-02, 01-03 | Pure `core/table.ts` + `useTableRound` three-callback hook | ✓ SATISFIED | `core/table.ts` exports confirmed (`TableCore`, `seenBy`, `goRound`, `yourDiscards`, `snapshotTable`, `replayDiscards`, `analysisOf`); `useTableRound.ts` exposes exactly `onUserDraw`/`onUserDiscard`/`onAgariCall` |
| REQ-04 | 01-06 | Unified table settings, global default + per-app override | ✓ SATISFIED | `tableSettings.ts` (`resolveTableSettings`, `useTableSettings`); all five `TableApp`s (`efficiency`, `efficiencySolo`, `folding`, `scoring`, `lab`) resolved through it, confirmed by grep across all four board pages + lab page |
| REQ-05 | 01-07 | Standalone statistical lab, nothing graded | ✓ SATISFIED | `/lab` route + `LabPage.tsx`; `useLabRound.ts` has no `useSessionStats` import, no `gradeAction`/`averageQuality`/`correctCount` (grep = 0); full `ranked`/`danger` lists exposed |
| REQ-06 | 01-04 | Threat-reveal hard gate | ✓ SATISFIED | See Truth #3 above |
| REQ-07 | 01-04 | Folding rebuilt on `core/table.ts`'s stepper | ✓ SATISFIED | See Truth #4 above |

All 7 declared requirement IDs are covered by exactly one plan each; no requirement ID appears in
ROADMAP.md without a corresponding plan, and no plan claims a requirement ROADMAP doesn't list.
No orphaned requirements.

### Key Artifacts (spot-checked across all 7 plans)

| Artifact | Expected | Status |
|---|---|---|
| `src/core/wall.ts` | `validateWall`, `completeWall`, `wallWithHand`, `WallError`, `fullWallSize` | ✓ VERIFIED — present, exported, used |
| `src/core/match.ts` | `createMatch(wall, …)`, exported `seenBy`, `playWall` | ✓ VERIFIED — `Pinned` gone, `seenBy` exported exactly once |
| `src/core/table.ts` | `TableCore`, `seenBy`, `goRound`, `yourDiscards`, `snapshotTable`, `replayDiscards`, `analysisOf` | ✓ VERIFIED — all 9 exports present; zero React imports (`grep` confirms) |
| `src/features/table/useTableRound.ts` | Three-callback hook | ✓ VERIFIED — `onUserDraw`/`onUserDiscard`/`onAgariCall`; no generic event escape hatch |
| `src/features/efficiency-solo/{useEfficiencySoloRound.ts,EfficiencySoloPage.tsx}` | Solitaire app, one seat, no `<Table>` | ✓ VERIFIED |
| `src/features/lab/{useLabRound.ts,LabPage.tsx}` | Statistical lab, zero grading | ✓ VERIFIED |
| `src/features/settings/tableSettings.ts` | `TableSettings`, `TABLE_DEFAULTS`, `resolveTableSettings`, `useTableSettings` | ✓ VERIFIED |
| `src/features/folding/useFoldingRound.ts` | Rebuilt on `core/table.ts`; `boardHands` reveal gate; wall-backed link | ✓ VERIFIED |

### Anti-Patterns / Debt Markers

`grep`-scanned every file touched by this phase's 7 plans (core/wall.ts, core/match.ts,
core/table.ts, urlCodec.ts, useEfficiencyRound.ts, grade.ts, useEfficiencySoloRound.ts,
EfficiencySoloPage.tsx, useFoldingRound.ts, FoldingPage.tsx, useScoringRound.ts, scoringUrl.ts,
useTableRound.ts, tableSettings.ts, settingsStore.ts, useLabRound.ts, LabPage.tsx, routes/index.tsx,
HomePage.tsx) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming
soon" — **zero matches**. No debt-marker gate triggered.

### Known Issues (Non-Blocking — already flagged by the phase's own code review)

The phase produced `.planning/phases/01-table-architecture-centralization/01-REVIEW.md` (a code
review of this same tree) recording 2 warnings and 2 info items, 0 critical. Both warnings were
independently reproduced during this verification and neither breaks a stated ROADMAP success
criterion or a plan's declared must-have, so they are reported here as non-blocking findings rather
than gaps:

- **WR-01 (reproduced):** `useTableRound.ts`'s `buildRound()` runs twice on every fresh (unpinned)
  mount — once from the `useState` initializer (`useTableRound.ts:222`), once from the mount
  `useEffect` (`useTableRound.ts:224-226`) — because neither call passes a `fillSeed` to
  `createMatch`, so `completeWall`'s `Math.random()` fallback produces two independently-random
  walls; the first is rendered then discarded. Confirmed by code trace (both call sites present as
  described). Wastes a full deal + `goRound()` AI pass on every trainer-page mount and carries a
  theoretical first-paint flash if React yields between commit and the passive effect. Does not
  affect any tested behavior (every existing assertion runs after the effect settles) and does not
  violate D-06 (replay-callback suppression, which is a separate, correctly-guarded path).
- **WR-02 (reproduced by direct probe):** `wallWithHand(seat, hand, sanma, aka, seed)` can silently
  drop a promised red five. Probed directly: `wallWithHand(0, parseTenhou('55p123456789m11z'),
  false, true, seed)` across 20 seeds produced exactly 1 red tile instead of the 3 `aka: true`
  promises, because the padding filter drops the *first* occurrence of each id (which
  `completeWall` also always marks red) whenever `hand` holds a *plain* copy of a red-eligible kind.
  Not reachable through any current production call site — `LabPage.tsx`'s only call
  (`wallWithHand(0, [], sanma, aka)`) always passes an empty hand — so this does not affect
  Success Criterion #2 or any other stated truth today. It is a latent defect in a shipped
  `core/wall.ts` primitive that the plan's own doc comment describes as exactly the case that
  triggers it (a non-empty, hand-authored `hand`), so it is a live trap for the lab's own
  hand-authoring surface if it is ever extended to seed from a pasted/edited hand.

Recommend tracking both as follow-up fixes; neither blocks this phase's completion.

## Human Verification Required

9 items — see YAML frontmatter `human_verification` for full test/expected/why-human detail. In
summary: (1) folding reveal-setting visual check, (2) home-page Solitaire/Table layout + no-board
vs. board check, (3) `/efficiency-solo` phone-width layout, (4) global reveal setting cross-page
check (efficiency/scoring reveal, folding stays hidden), (5) settings dialog UI/UX after the schema
migration, (6) lab invalid-wall-link error rendering, (7) lab phone-width scroll behavior, (8) the
literal Success-Criterion-#2 flow — copying a wall link from `/efficiency` and opening it in `/lab`
— and (9) lab dark-mode read. Every one of these was already flagged with `human_judgment: true` in
the individual plan SUMMARY.md files and left unconfirmed; none has since been visually verified in
this or any other session.

## Gaps Summary

No gaps. All 5 ROADMAP success criteria and all 7 declared requirements are structurally and
(where testable) behaviorally verified against the actual codebase — not just claimed by
SUMMARY.md. `npm test`/`npm run lint`/`npm run build` all pass on the current tree. The phase is
withheld from a clean `passed` verdict only because a substantial set of `<human-check>` items,
explicitly called out across 4 of the 7 plans (01-04, 01-05, 01-06, 01-07) and never marked
resolved in any SUMMARY, remain open — including the literal wording of Success Criterion #2
(lab-to-efficiency link round trip), which this verification confirmed at the code/wiring level
but did not exercise as a live browser flow.

---

_Verified: 2026-08-13T09:35:40Z_
_Verifier: Claude (gsd-verifier)_
