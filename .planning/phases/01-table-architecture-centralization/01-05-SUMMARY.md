---
phase: 01-table-architecture-centralization
plan: 05
subsystem: ui
tags: [react-hook, table-round, efficiency-trainer, i18n, routing]

requires:
  - phase: 01-table-architecture-centralization/01-03
    provides: "features/table/useTableRound.ts: TableRoundInput, UserDrawContext, DiscardStats, AgariCall, useTableRound(input)"
provides:
  - "features/efficiency/grade.ts: TurnResult, lostVs, gradeAction, efficiencyLogRows, handFromSnapshot — pure grading shared by both efficiency apps"
  - "features/efficiency/useEfficiencyRound.ts rebuilt as a thin useTableRound consumer (table app: real opponents always on)"
  - "features/efficiency-solo/useEfficiencySoloRound.ts + EfficiencySoloPage.tsx — the new solitaire app (one seat, no board)"
  - "Two routes (/efficiency, /efficiency-solo), HomePage.tsx Solitaire/Table sections"
  - "opponents deleted from settingsStore.ts, urlCodec.ts (Situation + FLAGS), and useTableRound.ts's situation()"
affects: [01-06, 01-07]

actuals:
  tokens: 24500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Pure grading module (features/efficiency/grade.ts) shared by two thin hooks over useTableRound — no React/zustand, so a table mistake and a solitaire mistake grade through the exact same code"
    - "handFromSnapshot(hand, drawn, melds) rebuilds a working core/hand.ts Hand from a TableSnapshot's display-only tile arrays — needed once a consumer wants a same-value-kan check, which core/table.ts's TableAnalysis doesn't itself carry"
    - "Deferred log-row resolution: onUserDiscard grades a kita/kan immediately (drawn tile unknown yet) and stashes the result in a ref; the onUserDraw that immediately follows resolves it once the replacement (rinshan) draw is known. A plain discard's drawn tile is already known, so it logs immediately."
    - "useTableRound.ts exposes `replayed: ParsedTile[]` (the discards a replay actually played) so a consumer's own logReplay can write one log row per replayed discard without reaching back into core/table.ts"

key-files:
  created:
    - src/features/efficiency/grade.ts
    - src/features/efficiency/grade.test.ts
    - src/features/efficiency-solo/useEfficiencySoloRound.ts
    - src/features/efficiency-solo/useEfficiencySoloRound.test.ts
    - src/features/efficiency-solo/EfficiencySoloPage.tsx
  modified:
    - src/features/efficiency/useEfficiencyRound.ts
    - src/features/efficiency/useEfficiencyRound.test.ts
    - src/features/efficiency/EfficiencyPage.tsx
    - src/features/table/useTableRound.ts
    - src/routes/index.tsx
    - src/routes/HomePage.tsx
    - src/features/i18n/trainerLinks.ts
    - src/features/i18n/locales/en.json
    - src/features/i18n/locales/ja.json
    - src/features/i18n/locales/zh.json
    - src/features/i18n/locales/it.json
    - src/features/situation/urlCodec.ts
    - src/features/situation/urlCodec.test.ts
    - src/features/settings/settingsStore.ts

key-decisions:
  - "The table app's MatchOptions hardcode calls:true, riichi:true unconditionally (real opponents always play at /efficiency) — the old options.opponents-gated conditional is gone, since /efficiency-solo is now the entire no-opponents variant as a separate route"
  - "useTableRound.ts (built in 01-03, not in this plan's file list) needed two small additive fixes to make Task 1's stated design work: its own situation() still emitted the now-deleted Situation.opponents field, and it needed to expose replayed discards for a consumer's own log-replay row-writing — both are Rule 3 (blocking issue) fixes, additive only, no existing consumer's behavior changed"
  - "handFromSnapshot lives in grade.ts (not core/hand.ts) — it's specifically 'rebuild the Hand a TableSnapshot implies', a table-layer concern, not a generic core/hand.ts utility"

requirements-completed: [REQ-01]

coverage:
  - id: D1
    description: "The efficiency trainer is two routes: /efficiency-solo deals one seat with no board, /efficiency deals a full table with real opponents always on — no setting or URL flag changes which app a route is"
    requirement: "REQ-01"
    verification:
      - kind: unit
        ref: "src/features/efficiency-solo/useEfficiencySoloRound.test.ts#deals exactly one seat"
        status: pass
      - kind: static
        ref: "grep -cE \"from '.*tiles/Table'\" src/features/efficiency-solo/EfficiencySoloPage.tsx == 0"
        status: pass
      - kind: static
        ref: "grep -cE \"'opponents'\" src/features/situation/urlCodec.ts == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both efficiency apps grade every discard, kita and kan through the same pure functions (features/efficiency/grade.ts), so a solitaire mistake and a table mistake score identically"
    requirement: "REQ-01"
    verification:
      - kind: unit
        ref: "src/features/efficiency-solo/useEfficiencySoloRound.test.ts#grades the same 14-tile hand identically through both hooks"
        status: pass
      - kind: unit
        ref: "src/features/efficiency/grade.test.ts (12 tests covering lostVs, gradeAction ok/warning/error, handFromSnapshot, efficiencyLogRows)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The solitaire app is genuinely one seat and still reserves a dead wall / flips a dora indicator"
    requirement: "REQ-01"
    verification:
      - kind: unit
        ref: "src/features/efficiency-solo/useEfficiencySoloRound.test.ts#reserves a dead wall and flips a dora indicator when deadWall is on"
        status: pass
    human_judgment: false
  - id: D4
    description: "The home page groups its cards under a Solitaire heading (efficiency-solo, shanten) and a Table heading (efficiency, folding, scoring), with distinguishable copy for the two efficiency cards"
    requirement: "REQ-01"
    verification:
      - kind: static
        ref: "node -e check: all four locale files carry trainer.efficiencySolo.title, home.section.solitaire, home.section.table"
        status: pass
      - kind: static
        ref: "node -e check: trainer.efficiencySolo.desc differs from English in ja/zh/it (translated, not left in English)"
        status: pass
    human_judgment: true
    rationale: "Visual layout/copy legibility on a phone-width viewport is the plan's own <human-check> item — not something a unit test can confirm."
  - id: D5
    description: "opponents is gone from settings, the URL codec, and the round options everywhere in the tree"
    requirement: "REQ-01"
    verification:
      - kind: static
        ref: "grep -rn '\\.opponents\\b|opponents:' src (excluding opponentWins/showOpponentHands) == empty"
        status: pass
      - kind: other
        ref: "npm test (328 tests), npm run lint, npm run build — all exit 0"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-08-13
status: complete
---

# Phase 1 Plan 5: Efficiency trainer split into solitaire and table apps Summary

**The efficiency trainer's opponents checkbox is gone — `/efficiency-solo` (one seat, no board) and `/efficiency` (full table, real opponents always on) are now two honest routes, both grading through one shared pure module (`features/efficiency/grade.ts`).**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 completed
- **Files modified:** 19 (5 created, 14 modified)

## Accomplishments

- `features/efficiency/grade.ts` (new): pure grading shared by both apps — `TurnResult`, `lostVs`, `gradeAction`, `efficiencyLogRows`, and a small `handFromSnapshot` helper that rebuilds a working `Hand` from a `TableSnapshot`'s display-only tile arrays (needed for the same-value-kan check, since `TableAnalysis` doesn't carry the raw `Hand`).
- `features/efficiency/useEfficiencyRound.ts` rewritten from 629 lines of independent match-stepping to a 203-line thin hook over `useTableRound`: `calls`/`riichi` are now hardcoded `true` (real opponents always play at the table app), and `rankDiscards`/`runOpponents`/`advanceAfterDiscard`/`createRound`/`snapshot` are all gone — that mechanics now lives in `core/table.ts`/`useTableRound`.
- `features/efficiency-solo/` (new): `useEfficiencySoloRound.ts` mirrors the table hook with exactly three differences (`players: 1`, `seatIndex: 0`, `calls`/`riichi: false`) and imports all grading from `../efficiency/grade` — no grading logic duplicated. `EfficiencySoloPage.tsx` keeps today's flat layout (hand, own river, nuki/kan piles, wall/dora chips) and never imports `<Table>`.
- `EfficiencyPage.tsx`: the `showTable` branch is gone — the board is now always rendered, and the opponents settings toggle is removed.
- Two routes wired in `routes/index.tsx`; `HomePage.tsx`'s mode list restructured into a **Solitaire** section (`efficiency-solo`, `shanten`) and a **Table** section (`efficiency`, `folding`, `scoring`), each under a small heading.
- `opponents` deleted from `settingsStore.ts`'s `efficiency` section, from `situation/urlCodec.ts`'s `Situation` interface and flag list, and from `useTableRound.ts`'s own `situation()` builder (a pre-existing bug this plan's rewrite exposed — see Deviations).
- All four locale files (en/ja/zh/it) get `trainer.efficiencySolo.{title,desc,intro}` and `home.section.{solitaire,table}`, properly translated (not left in English); `trainer.efficiency.desc` reworded to name the real opponents the table app adds; `efficiency.settings.opponents` deleted from all four.

## Task Commits

1. **Task 1: One shared grader, and the table app rebuilt on `useTableRound`** - `c49b81f` (feat)
2. **Task 2: The solitaire app — one seat, no board** - `b409db7` (feat)
3. **Task 3: Two routes, two cards, and the `opponents` flag deleted everywhere** - `8a61f10` (feat)

## Files Created/Modified

- `src/features/efficiency/grade.ts` - new: pure grading shared by both apps
- `src/features/efficiency/grade.test.ts` - new: 12 tests, one per `<behavior>` grading case plus log-row/handFromSnapshot coverage
- `src/features/efficiency/useEfficiencyRound.ts` - rewritten as a thin `useTableRound` consumer
- `src/features/efficiency/useEfficiencyRound.test.ts` - `opponents` dropped from `BARE`/all option objects; two tests whose wall-position pinning assumed opponents were off updated for the always-on-opponents reality
- `src/features/efficiency/EfficiencyPage.tsx` - `showTable` branch deleted, opponents toggle removed
- `src/features/table/useTableRound.ts` - `situation()` no longer emits the deleted `opponents` field; exposes `replayed: ParsedTile[]`
- `src/features/efficiency-solo/useEfficiencySoloRound.ts` - new: the solitaire hook
- `src/features/efficiency-solo/useEfficiencySoloRound.test.ts` - new: one seat, dead wall/dora, cross-hook grading parity, tenpai stop, kan grading
- `src/features/efficiency-solo/EfficiencySoloPage.tsx` - new: flat-layout solitaire page, no `<Table>`
- `src/routes/index.tsx` - `/efficiency-solo` route added
- `src/routes/HomePage.tsx` - `MODES` split into `SOLITAIRE_MODES`/`TABLE_MODES` under section headings; card markup extracted into `ModeCard`
- `src/features/i18n/trainerLinks.ts` - `TRAINER_WIKI.efficiencySolo` added
- `src/features/i18n/locales/{en,ja,zh,it}.json` - new keys added and translated, `opponents` setting key removed, `trainer.efficiency.desc` reworded
- `src/features/situation/urlCodec.ts` / `.test.ts` - `opponents` removed from `Situation` and `FLAGS`
- `src/features/settings/settingsStore.ts` - `opponents` removed from the `efficiency` settings section and its default

## Decisions Made

- Table app's `calls`/`riichi` are unconditionally `true` now (not gated on a flag) — the whole point of the split is that `/efficiency` is always the real-opponents drill.
- `handFromSnapshot` lives in `grade.ts`, not `core/hand.ts` — it's specifically "rebuild the `Hand` a `TableSnapshot` implies," a table-layer concern used by both thin hooks, not a generic engine utility.
- Deferred log-row resolution for kita/kan: grading happens immediately in `onUserDiscard` (drawn tile isn't needed yet), but writing the actual log row waits for the `onUserDraw` that immediately follows, once the replacement (rinshan) draw is known. A plain discard already knows its drawn tile, so it logs immediately — no deferral needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `useTableRound.ts`'s `situation()` still emitted the deleted `opponents` field**
- **Found during:** Task 1, while designing `situationQuery()` for the rewritten hook
- **Issue:** `useTableRound.ts` (built in plan 01-03, not in this plan's file list) builds a `Situation` object in its own `situation()` helper that included `opponents: input.options.calls` — a field this plan deletes from the `Situation` interface entirely in Task 3. Left unfixed, either Task 3's deletion would break `useTableRound.ts`'s typecheck, or Task 1's `situationQuery()` (built to delegate to `table.situation()`) would silently leak a field the rest of the app no longer understands.
- **Fix:** Removed the `opponents:` line from `situation()`'s returned object.
- **Files modified:** `src/features/table/useTableRound.ts`
- **Verification:** `npm run build` passes; `useTableRound.test.ts`'s existing suite (12 tests) still passes unchanged.
- **Committed in:** `c49b81f`

**2. [Rule 3 - Blocking] `useTableRound.ts` didn't expose which discards a replay actually played**
- **Found during:** Task 1, implementing the thin hook's `logReplay()` (explicitly required by the plan text: "now fed by `useTableRound`'s replayed-discards result")
- **Issue:** `buildRound()`'s call to `replayDiscards(...)` computed the actual list of replayed tiles internally but discarded the return value — no field on the hook's return object exposed it, so a consumer couldn't log one row per replayed discard.
- **Fix:** Added a `replayed` ref, populated from `replayDiscards`'s return value, and exposed it (`replayed: replayed.current`) on the hook's return object — purely additive, no existing field changed shape.
- **Files modified:** `src/features/table/useTableRound.ts`
- **Verification:** `useEfficiencyRound.test.ts`'s replay-logging tests ("logs the pre-discard situation...", "logs one rewindable entry per discard...") pass unchanged.
- **Committed in:** `c49b81f`

**3. [Rule 1 - Bug] `finished` derivation omitted fixed-meld tile count**
- **Found during:** Task 1, first test run — the existing kan test ("kan locks a held quad as a meld... `finished` toBe(false)") failed
- **Issue:** `finished = table.hand.length + (table.drawn ? 1 : 0) < 14` doesn't account for a locked ankan meld counting as 3 tiles toward the 14 — after a kan, `hand.length` (concealed, meld tiles excluded) + `drawn` undercounts by exactly the meld's contribution, so the hook reported a still-in-progress hand as finished.
- **Fix:** Added `+ table.melds[table.seatIndex].length * 3` to the derivation, in both `useEfficiencyRound.ts` and `useEfficiencySoloRound.ts`.
- **Files modified:** `src/features/efficiency/useEfficiencyRound.ts`, `src/features/efficiency-solo/useEfficiencySoloRound.ts`
- **Verification:** the previously-failing kan test now passes; full suite green.
- **Committed in:** `c49b81f`, `b409db7`

**4. [Rule 1 - Bug] Two existing tests assumed opponents were off**
- **Found during:** Task 1, test run after the rewrite
- **Issue:** `useEfficiencyRound.test.ts`'s "runs until tenpai, not for a fixed turn count" and "draws a red five from a pinned wall and drops it again on discard" both pinned exact wall positions assuming the user draws every wall tile in sequence (the old opponents-off behavior). With real opponents now unconditionally on, ~4 wall tiles drain per turn instead of 1, so a fixed wall position no longer names "the user's Nth own draw," and the naive `discard(0)` strategy no longer reliably reaches tenpai within the old 200-iteration/single-tile-drain budget.
- **Fix:** The tenpai test now uses a seed (`seed-6`, found empirically to converge within ~30 available turns) and a tighter, honestly-labeled iteration bound. The red-five test now only asserts the redness contract (a red five is dropped for good once discarded) rather than the specific identity of the tile drawn two turns later, since that position is no longer predictable once real opponents are consuming the wall between the user's own turns.
- **Files modified:** `src/features/efficiency/useEfficiencyRound.test.ts`
- **Verification:** both tests pass; full suite (328 tests) green.
- **Committed in:** `c49b81f`

---

**Total deviations:** 4 auto-fixed (3 Rule 3/blocking, 1 Rule 1/bug — all necessary consequences of Task 1's own stated design; no scope creep beyond what Task 1 explicitly asked for).
**Impact on plan:** None of these change what the plan asked for; they're the concrete implementation work the plan's own action text implied ("now fed by `useTableRound`'s replayed-discards result") or bugs the rewrite's own test suite caught before commit.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None — this plan's threat register (T-01-15, T-01-16, T-01-17) named exactly the mitigations built: `decodeSituation`'s existing `validateWall` gate is unchanged (this plan only removes a codec field, adds none), the stale `efficiency.opponents` persisted key is simply no longer read (its cleanup rides plan 01-06's version bump), and the `opponents` URL flag that could switch a route's drill is deleted from the codec entirely (Task 3).

## Next Phase Readiness

- Both efficiency apps are fully migrated onto `core/table.ts`/`useTableRound`, sharing one grading module — the pattern plan 01-06 (table settings unification) and 01-07 (statistical lab) can build on.
- `useTableRound.ts` now carries two small additive fields (`replayed`, and a corrected `situation()`) that later consumers can rely on.
- No blockers.

## Self-Check: PASSED

All created files verified present on disk; all three commits (`c49b81f`, `b409db7`, `8a61f10`) verified present in `git log`; `npm test` (328 tests), `npm run lint`, and `npm run build` all exit 0 as of the final commit.

---
*Phase: 01-table-architecture-centralization*
*Completed: 2026-08-13*
