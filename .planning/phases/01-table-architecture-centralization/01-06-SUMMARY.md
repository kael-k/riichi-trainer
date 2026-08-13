---
phase: 01-table-architecture-centralization
plan: 06
subsystem: ui
tags: [zustand, settings, react, persist]

requires:
  - phase: 01-table-architecture-centralization
    provides: useEfficiencyRound/useFoldingRound (plans 01-04, 01-05) whose RoundOptions this plan
      feeds through the new table-settings resolver
provides:
  - One TableSettings schema (opponentWins, deadWall, threats, showOpponentHands,
    hideConcealedHands, showWall) shared by every board-rendering app
  - resolveTableSettings(app, table) — pure app-default -> global -> per-app-override resolver
  - useTableSettings(app) — the resolver wired to the store, with the Advanced gate on showWall
  - Settings['table'] = { global, apps } replacing six scattered settings, persist version 3
affects: [01-07 statistical-lab]

actuals:
  tokens: 8750
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Global-default + per-app-override settings resolved by one pure function per family of
      shared trainer settings, rather than each app growing its own copy of the same fields"

key-files:
  created:
    - src/features/settings/tableSettings.ts
    - src/features/settings/tableSettings.test.ts
    - src/features/settings/settingsStore.test.ts
  modified:
    - src/features/settings/settingsStore.ts
    - src/features/settings/SettingsDialog.tsx
    - src/features/settings/useAdvancedSettings.ts
    - src/features/efficiency/EfficiencyPage.tsx
    - src/features/efficiency-solo/EfficiencySoloPage.tsx
    - src/features/folding/FoldingPage.tsx
    - src/features/folding/useFoldingRound.ts
    - src/features/scoring/ScoringPage.tsx

key-decisions:
  - "SettingsDialog's three global rows write to table.global via an app-agnostic resolveTableSettings('efficiency', table) read — the panel only edits the global layer this phase; per-app override UI is out of scope (absent key = inherit, D-13)"
  - "Each page's own settings-writing rows (deadWall on efficiency/efficiencySolo, threats/opponentWins on folding) merge the existing apps.<app> slice before patching, so update('table', {apps:{...}}) never wipes a sibling field in that same app's override"

patterns-established:
  - "A settings family (six fields, three consumer-app write-sites) resolved via one pure function called from every read site — the same shape plan 01-07's statistical lab inherits with zero new settings surface"

requirements-completed: [REQ-04]

coverage:
  - id: D1
    description: "TableSettings schema + resolveTableSettings resolves app default -> global -> per-app override, absent key = inherit"
    requirement: REQ-04
    verification:
      - kind: unit
        ref: "src/features/settings/tableSettings.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Settings['table'] persisted section replaces the six scattered fields; persist version bumped 2->3, old blobs dropped not migrated"
    requirement: REQ-04
    verification:
      - kind: unit
        ref: "src/features/settings/settingsStore.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "All four board pages (Efficiency, EfficiencySolo, Folding, Scoring) read the six settings exclusively through useTableSettings(app); folding's D-14 reveal gate (concealed = !(showOpponentHands && round.finished)) is unchanged in shape"
    requirement: REQ-04
    verification:
      - kind: unit
        ref: "src/features/folding/useFoldingRound.test.ts (reveal-gate cases)"
        status: pass
      - kind: unit
        ref: "npm test (342 tests, full suite)"
        status: pass
    human_judgment: true
    rationale: "Visual confirmation that toggling the global 'show opponent hands' setting reveals hands on efficiency/scoring boards but still shows only backs on a folding board until the hand ends is a human-check item per the plan's acceptance criteria — automated tests cover the underlying gate logic but not the rendered board."

duration: 10min
completed: 2026-08-13
status: complete
---

# Phase 01 Plan 06: Unified table settings Summary

**Six scattered table settings (opponentWins, deadWall, threats, showOpponentHands, hideConcealedHands, showWall) unified under one `Settings['table']` section with a global-default + per-app-override resolver (`resolveTableSettings`/`useTableSettings`), read by all four board pages.**

## Performance

- **Duration:** 10 min (three task commits, 08:43–08:52 UTC)
- **Tasks:** 3
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments
- `src/features/settings/tableSettings.ts`: `TableSettings` interface, `TableApp` union, `TABLE_DEFAULTS` per app, pure `resolveTableSettings`, and `useTableSettings` (resolver + Advanced gate on `showWall`)
- `Settings['table'] = { global, apps }` replaces `efficiency.deadWall`, `folding.threats`/`opponentWins`, and the top-level `showWall`/`showOpponentHands`/`hideConcealedHands` state+setters; persist version bumped 2 → 3 (old blobs dropped, not migrated)
- `SettingsDialog`'s three global rows and each page's own settings-writing rows (deadWall, threats, opponentWins) now write through `update('table', {...})`, merging the existing layer first so a sibling override survives
- All four board pages (`EfficiencyPage`, `EfficiencySoloPage`, `FoldingPage`, `ScoringPage`) resolve the six settings exclusively via `useTableSettings(app)` — no page reads any of the six fields straight off the store any more
- Folding's D-14 reveal gate (`concealed = !(showOpponentHands && round.finished)`) survived the move verbatim, and its dedicated reveal-gate test file still passes unmodified

## Task Commits

1. **Task 1: The schema and its resolver** - `ac9a212` (feat)
2. **Task 2: Move the six settings into the store behind a version bump** - `1d88bd5` (feat)
3. **Task 3: Every board page reads through the resolver** - `7d64538` (feat)

_Note: Task 2's own file leaves the four board pages referencing removed fields until Task 3 lands in the same session — see Deviations._

## Files Created/Modified
- `src/features/settings/tableSettings.ts` - `TableSettings`, `TableApp`, `TABLE_DEFAULTS`, `resolveTableSettings`, `useTableSettings`
- `src/features/settings/tableSettings.test.ts` - resolver/defaults behavior cases (8 tests)
- `src/features/settings/settingsStore.ts` - `table` section added, six fields removed, persist version 2→3, merge extended
- `src/features/settings/settingsStore.test.ts` - store defaults, table update round-trip, v2-blob-dropped, section-wise merge, persist version, `useAdvancedSettings` shape (6 tests)
- `src/features/settings/SettingsDialog.tsx` - three global rows now read/write through `resolveTableSettings`/`update('table', {global:{...}})`
- `src/features/settings/useAdvancedSettings.ts` - `showWall` removed (gate moved to `useTableSettings`)
- `src/features/efficiency/EfficiencyPage.tsx` - reads via `useTableSettings('efficiency')`; deadWall row writes `update('table', {apps:{efficiency:{...}}})`
- `src/features/efficiency-solo/EfficiencySoloPage.tsx` - same, `'efficiencySolo'` app id
- `src/features/folding/FoldingPage.tsx` - reads via `useTableSettings('folding')`; threats/opponentWins rows write `update('table', {apps:{folding:{...}}})`
- `src/features/folding/useFoldingRound.ts` - `RoundOptions` type widened (see Deviations)
- `src/features/scoring/ScoringPage.tsx` - reads via `useTableSettings('scoring')`; no settings rows on this page for the moved fields

## Decisions Made
- SettingsDialog's global rows resolve through `resolveTableSettings('efficiency', table)` as a representative view of the global layer — the app id passed is arbitrary for fields with no per-app override, and none of the panel's three rows had one at commit time.
- Every write site (`SettingsDialog`'s `updateGlobal`, each page's `updateTable`) spreads the existing `global`/`apps.<app>` object before patching — `update()` only merges at the section level, so a bare `{ apps: { folding: { threats } } }` patch would otherwise silently drop any other override already set for that same app.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened `useFoldingRound.ts`'s `RoundOptions` type**
- **Found during:** Task 3 (board page rewire)
- **Issue:** `RoundOptions` was `Settings['folding'] & { sanma: boolean }`. Task 2 removed `threats`/`opponentWins` from `Settings['folding']`, so `RoundOptions` no longer carried them — `FoldingPage`'s `options` object literal (which still needs to pass `threats`/`opponentWins`, now sourced from `useTableSettings('folding')`) failed to type-check. `useFoldingRound.ts` was not listed in the plan's `files_modified`, but the type change is required for `tsc -b` to pass.
- **Fix:** `RoundOptions = Settings['folding'] & { sanma: boolean; threats: number; opponentWins: boolean }`.
- **Files modified:** `src/features/folding/useFoldingRound.ts`
- **Verification:** `npx tsc -b` clean, `npx vitest run src/features/folding/useFoldingRound.test.ts` (27 tests) passes.
- **Committed in:** `7d64538` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for the build to compile after the settings-schema move; no scope creep beyond widening one type signature.

### Staged intermediate state (not a deviation, documented for clarity)

Task 2's commit (`1d88bd5`) removes the six fields from `Settings['folding']`/`Settings['efficiency']`/the top-level store, but the four board pages are not yet rewired at that point — `tsc -b`/`npm run build` only return to green after Task 3's commit (`7d64538`) lands in the same session. Task 2's own `<verify>` (`npx vitest run src/features/settings/`) was run and passed independently; the full `tsc -b`/`npm run build`/`npm test` verification requested by Task 2's acceptance criteria was confirmed only once, after Task 3, covering both tasks' changes together.

### Acceptance-criteria grep patterns that don't literally match (substance verified another way)

Three of the plan's `grep` acceptance checks assume an indentation/line-count that the actual (correctly prettier-formatted) code doesn't have:
- `grep -cE '^  version: 3,' settingsStore.ts` returns 0, not 1 — the `version: 3,` line is nested 6 spaces deep (inside `persist({...})`'s options object, itself nested inside `create()(persist(...))`), same depth the original `version: 2,` line had. `settingsStore.test.ts`'s `useSettings.persist.getOptions().version === 3` assertion verifies the actual bump.
- `grep -cE '^      table: \{ \.\.\.current\.table' settingsStore.ts` returns 0, not 1 — the `merge`'s `table: { ...current.table, ...p.table }` line sits at the same 10-space depth as the adjacent `efficiency`/`shanten`/`scoring`/`folding` merge lines above it (return-object body inside an arrow function inside `merge:`). `settingsStore.test.ts`'s "merges every section" test verifies the actual merge behavior.
- `grep -c 'useTableSettings' <page>.tsx` returns 2 per file, not 1 — one match is the import line, the other the call site; both are expected and correct.

None of these represent a code defect; all three were left correctly formatted rather than distorted to fake a literal grep match, and the underlying behavior each check was probing for is verified by the test suite instead.

## Issues Encountered
None beyond the deviation and staged-state notes above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 01-07 (statistical lab) can add a `'lab'` `TableApp` entry with zero new settings surface — `TABLE_DEFAULTS.lab` already exists and `useTableSettings('lab')` resolves it the same way every other app does.
- Full verification pass green: `npm test` (342/342), `npm run lint` (0 issues), `npm run build` (`tsc -b` + `vite build` clean).
- <human-check> item still open per the plan's acceptance criteria: visually confirm that toggling the global "show opponent hands" setting reveals opponents' tiles on the efficiency and scoring boards, while the folding board still shows only backs until the hand ends. Not verifiable from this worktree session; flagged in `coverage` (D3) with `human_judgment: true`.

---
*Phase: 01-table-architecture-centralization*
*Completed: 2026-08-13*
