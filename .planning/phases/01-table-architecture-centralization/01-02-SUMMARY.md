---
phase: 01-table-architecture-centralization
plan: 02
subsystem: engine
tags: [table-stepper, seenBy, snapshot, replay, lazy-analysis]

requires:
  - "createMatch(wall, players, options, fillSeed?) — 01-01's explicit-wall dealing"
provides:
  - 'core/table.ts: TableCore, seenBy, goRound, yourDiscards, snapshotTable, replayDiscards, analysisOf'
  - 'match.ts#seenBy — now exported and clamped to TILES_PER_KIND'
affects: [01-03, 01-04, 01-05, 01-06, 01-07]

actuals:
  tokens: 5641
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - 'Pure, React-free stepper module (core/table.ts) composed by every trainer hook instead of each hook reimplementing seenBy/go-round/snapshot/replay'
    - 'Lazy per-object getters (analysisOf) for expensive analysis a consumer may not read (D-05)'

key-files:
  created:
    - src/core/table.ts
    - src/core/table.test.ts
  modified:
    - src/core/match.ts

key-decisions:
  - "Merged Task 2's grep-checked doc-comment fix into a fourth, separate fix commit rather than amending Task 2's commit — GSD's atomic-commit protocol prefers a new commit over rewriting history, even for a one-line wording fix caught by the plan's own acceptance grep."

requirements-completed: [REQ-03]

coverage:
  - id: D1
    description: "There is exactly one seenBy in the codebase — match.ts's is exported and clamped; table.ts's is a thin wrapper over it"
    requirement: 'REQ-03'
    verification:
      - kind: unit
        ref: 'src/core/table.test.ts#seenBy equals visible + hand counts, clamped, at every turn of 20 seeded matches'
        status: pass
      - kind: static
        ref: "grep -c '^export function seenBy' src/core/match.ts == 1"
        status: pass
    human_judgment: false
  - id: D2
    description: 'The go-round loop, render snapshot and discard-replay fast-forward each exist once, as pure functions over a match state, with no React in core/table.ts'
    requirement: 'REQ-03'
    verification:
      - kind: unit
        ref: 'src/core/table.test.ts#goRound (three cases: still-running seat, one-seat no-op, guard bound)'
        status: pass
      - kind: unit
        ref: 'src/core/table.test.ts#snapshotTable (drawn split, per-seat mirroring, defensive copies)'
        status: pass
      - kind: unit
        ref: 'src/core/table.test.ts#replayDiscards (full playback, stops on missing tile, stops on step()===false)'
        status: pass
      - kind: static
        ref: 'grep -cE "from ''react''|useState|useRef|useEffect" src/core/table.ts == 0'
        status: pass
    human_judgment: false
  - id: D3
    description: 'Per-turn analysis is computed only when a consumer reads it — evaluateDiscards and assessDiscards are each paid for independently'
    requirement: 'REQ-03'
    verification:
      - kind: unit
        ref: 'src/core/table.test.ts#analysisOf caches .ranked: reading it twice returns the identical array reference'
        status: pass
      - kind: unit
        ref: 'src/core/table.test.ts#analysisOf never calls evaluateDiscards when only .danger is read (vi.mock call count)'
        status: pass
      - kind: unit
        ref: 'src/core/table.test.ts#analysisOf never calls assessDiscards when only .ranked is read (vi.mock call count)'
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-12
status: complete
---

# Phase 1 Plan 2: Pure table stepper (core/table.ts) Summary

**`core/table.ts` now holds the one canonical `seenBy`, one `goRound` opponent loop, one `snapshotTable` render mirror, one `replayDiscards` fast-forward and one lazily-computed `analysisOf` — replacing the three separate `seenBy` implementations and two separate go-round/snapshot/replay bodies split across `useEfficiencyRound.ts` and `useFoldingRound.ts`.**

## Performance

- **Duration:** ~25 min
- **Files modified:** 3 (`src/core/match.ts`, `src/core/table.ts` new, `src/core/table.test.ts` new)

## Accomplishments

- `match.ts`'s module-private `seenBy` is now `export`ed and clamped to `TILES_PER_KIND` (`Math.min(4, visible[i] + counts[i])`) as a documented safety net — a 20-seeded-match test proves the clamp changes nothing on valid data, since the unclamped sum already never exceeds 4.
- `core/table.ts` (new, React-free): `TableCore` (`{ match, options, seatIndex }`), `seenBy(core)` (thin wrapper over `match.ts`'s exported one), `goRound(core)` (the shared 8-guard opponent loop both hooks wrote independently), `yourDiscards(core, from?)` (reads `match.discards`, not the river, so a called-out discard survives).
- `TableSnapshot` + `snapshotTable(core)`: the render-ready mirror both hooks build — drawn tile split out of hand, per-seat rivers/hands/melds/nuki/riichi, wall/dead-wall bookkeeping — with every array a fresh defensive copy and no trainer-specific field (no score, clock, grading result or `finished` flag).
- `replayDiscards(core, discards, step)`: generalises the two identical fast-forward loops (`useEfficiencyRound.ts`'s `createRound` river replay, `useFoldingRound.ts`'s `buildRound` discards replay). `step` is what actually advances the board — this function only knows "keep going / stop", which is how efficiency's tenpai-stop and folding's hand-ended-stop both ride the same primitive without it knowing about either.
- `TableAnalysis` + `analysisOf(core)`: `seen`/`ranked`/`danger` as per-object cached getters. Proved lazy by `vi.mock` call-count assertions (not code inspection) — reading only `.danger` never calls `evaluateDiscards`, and reading only `.ranked` never calls `assessDiscards`.

## Task Commits

1. **Task 1: One canonical `seenBy`, one canonical go-round** - `bd9878c` (feat)
2. **Task 2: One snapshot builder, one replay fast-forward** - `83e6a97` (feat)
3. **Task 3: Per-turn analysis as lazy getters** - `c92a10e` (feat)
4. **Fix: reword doc comment so the react-free grep check passes** - `255f10c` (fix)

_Also required before Task 1 could start: this worktree's branch was created before wave 1's
`01-01` merged into `main` — fast-forward-merged `main` (`4ddabb3`) into this branch first so
`createMatch`'s explicit-wall signature (this plan's `depends_on`) was actually present. No
conflicts; a plain fast-forward._

## Files Created/Modified

- `src/core/table.ts` - new: `TableCore`, `seenBy`, `goRound`, `yourDiscards`, `TableSnapshot`, `snapshotTable`, `replayDiscards`, `TableAnalysis`, `analysisOf`
- `src/core/table.test.ts` - new: 17 tests covering every `<behavior>` bullet across all three tasks
- `src/core/match.ts` - `seenBy` exported and clamped to `TILES_PER_KIND`; `TILES_PER_KIND` imported from `./wall`

## Decisions Made

- The Task 2 acceptance criterion `grep -cE "from 'react'|useState|useRef|useEffect" src/core/table.ts` returns 0 initially failed — not because of a real React import, but because a doc comment named `useRef` literally while explaining why the StrictMode-dedup ref guard stays in each React hook. Reworded to "mutable-ref guard" in a small follow-up commit rather than amending the already-pushed Task 2 commit, per GSD's atomic-commit-over-rewrite protocol.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Merged wave 1's merged `main` into this worktree branch before starting**

- **Found during:** Pre-Task-1 setup
- **Issue:** This worktree's branch (`worktree-agent-a46e26b1c2acdbffa`) was created before `01-01` finished and merged into `main`. `01-02` `depends_on: ["01-01"]` — without `createMatch`'s explicit-wall signature, `core/wall.ts`'s `TILES_PER_KIND`/`validateWall`/`wallWithHand`, and `Situation.wall`, this plan's Task 1 (which imports `TILES_PER_KIND` from `./wall`) could not even compile.
- **Fix:** `git merge main --no-edit` — a clean fast-forward from `baa1b2c` to `4ddabb3`, since no commits had landed on this branch yet. No conflicts.
- **Files modified:** none directly (brought in `01-01`'s already-committed changes).
- **Verification:** `npm test` passed (277 tests) immediately after the merge, before any of this plan's own edits.
- **Committed in:** the merge commit itself (fast-forward, no new commit object).

**2. [Rule 1 - Bug] Reworded a doc comment that tripped the plan's own react-free grep check**

- **Found during:** Post-Task-3 verification pass
- **Issue:** `replayDiscards`' doc comment explained that "The StrictMode-dedup `useRef` guard... stays in each React hook" — the literal string `useRef` inside that prose matched the plan's acceptance grep `grep -cE "from 'react'|useState|useRef|useEffect" src/core/table.ts`, which is meant to catch an actual React import, not a comment mentioning a hook by name.
- **Fix:** Reworded to "mutable-ref guard", preserving the exact same meaning without the literal hook name.
- **Files modified:** `src/core/table.ts`
- **Verification:** `grep -cE "from 'react'|useState|useRef|useEffect" src/core/table.ts` now returns 0; `npm test`/`npm run lint`/`npm run build` all still exit 0.
- **Committed in:** `255f10c` (fix)

---

**Total deviations:** 2 auto-fixed (1 blocking setup step, 1 bug)
**Impact on plan:** Neither changed the plan's design or scope — the merge brought in an already-approved prior plan's work, and the wording fix corrected an over-matching acceptance grep without changing behavior.

## Issues Encountered

None beyond the deviations documented above.

## Known Stubs

None.

## Threat Flags

None — this plan's threat register (T-01-05, T-01-06, T-01-07) named exactly the mitigations built: the `seenBy` clamp (proved inert on valid data), the `goRound` 8-guard bound (carried over verbatim), and `analysisOf`'s laziness (proved by call count). No new unmitigated surface.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `core/table.ts` is a complete, tested, React-free primitive layer: `TableCore`, `seenBy`, `goRound`, `yourDiscards`, `snapshotTable`, `replayDiscards`, `analysisOf` — every symbol the plan's artifacts table named.
- `useEfficiencyRound.ts` and `useFoldingRound.ts` still carry their own duplicated implementations of these mechanics — this plan built the shared layer but did not yet migrate either hook onto it. That migration is later plans' work (01-04's split efficiency apps, 01-07's folding migration) per the phase's own sequencing.
- No blockers.

## Self-Check: PASSED

All modified/created files verified present on disk; all four commits (`bd9878c`, `83e6a97`,
`c92a10e`, `255f10c`) verified present in `git log`.

---

_Phase: 01-table-architecture-centralization_
_Completed: 2026-08-12_
