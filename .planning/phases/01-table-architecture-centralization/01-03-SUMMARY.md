---
phase: 01-table-architecture-centralization
plan: 03
subsystem: ui
tags: [react-hook, table-round, scoring, wall-link, agari-callback]

requires:
  - phase: 01-table-architecture-centralization/01-02
    provides: "core/table.ts: TableCore, seenBy, goRound, yourDiscards, snapshotTable, replayDiscards, analysisOf"
provides:
  - "features/table/useTableRound.ts: TableRoundInput, UserDrawContext, DiscardStats, AgariCall, useTableRound(input)"
  - "core/match.ts#playWall(wall, players, options, stop?) — explicit-wall equivalent of playMatch"
  - "features/scoring/scoringUrl.ts#encodeScoringWallUrl, ScoringUrl.wall — replaces the seed-based scoring link"
affects: [01-04, 01-05, 01-06, 01-07]

actuals:
  tokens: 14300
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Three-callback React hook contract (onUserDraw/onUserDiscard/onAgariCall) over a pure core/table.ts stepper, with draw-time analysis stashed in a ref so a discard is graded against the pre-throw hand, never a post-throw recomputation"
    - "Identity-keyed dedup ref (wall + restart count) for the initial callback fire, mirroring useEfficiencyRound's logReplay pattern — the mechanics may build the round twice under StrictMode's double-invoked mount effect, but the user-visible callback fires once"
    - "AgariCall as a fixed (win: WinRecord) => void contract: a consumer that needs more context (scoring needs the wall/match too) stashes it in a ref immediately before invoking the shared handler, rather than widening the callback's own signature"
    - "Wall-derived RNG keys (wallKey = serializeTenhouOrdered(wall)) replacing seed strings for reproducible per-board randomness (round wind, honba) — the same wall always re-derives the same round/honba, which is what makes a wall link exact"

key-files:
  created:
    - src/features/table/useTableRound.ts
    - src/features/table/useTableRound.test.ts
  modified:
    - src/core/match.ts
    - src/features/scoring/scoringUrl.ts
    - src/features/scoring/scoringUrl.test.ts
    - src/features/scoring/useScoringRound.ts
    - src/features/scoring/useScoringRound.test.ts

key-decisions:
  - "AgariCall's signature stays exactly (win: WinRecord) => void per the plan's D-05 contract; scoring's handler reads the wall/match it needs from a ref (pending.current) set immediately before each call site, rather than widening the type — keeps useTableRound's contract the single source of truth for what 'the three callbacks' means, with scoring as a documented exception (D-07) rather than a second shape"
  - "Test fixtures for the scoring hook rebuild the exact wallKey-derived round useScoringRound's own matchOptions uses (via a small duplicated helper) rather than a fixed round, so a wall confirmed to win in the test setup is guaranteed to still win when the hook independently replays it"

requirements-completed: [REQ-03]

coverage:
  - id: D1
    description: "useTableRound exposes exactly onUserDraw/onUserDiscard/onAgariCall, drives a real core/match round through them, and grades every discard against the draw-time analysis by reference identity"
    requirement: "REQ-03"
    verification:
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#onUserDiscard's stats.analysis is the same object onUserDraw handed over"
        status: pass
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#fires onUserDraw again with a fresh analysis object and an advanced turn after a live discard"
        status: pass
      - kind: static
        ref: "grep -cE 'onUserDraw|onUserDiscard|onAgariCall' src/features/table/useTableRound.ts >= 6; grep -c 'onGenericEvent\\|onEvent' == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "A shared link's replayed discards fire zero callbacks; the live turn the replay lands on fires exactly one onUserDraw, including under React StrictMode's double-invoked mount effect"
    requirement: "REQ-03"
    verification:
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#replaying discards fires zero onUserDraw/onUserDiscard, then exactly one onUserDraw for the live turn"
        status: pass
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#fires each callback once per real event even under React StrictMode double-invoked effects"
        status: pass
    human_judgment: false
  - id: D3
    description: "DiscardStats.yours/best/danger are lazy getters over the stashed analysis — reading one never forces the other's underlying computation"
    verification:
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#reading .danger never triggers evaluateDiscards, and reading .yours never triggers assessDiscards"
        status: pass
    human_judgment: false
  - id: D4
    description: "stopAtTenpai stops the round at 13 tiles the moment your discard reaches tenpai; unset, the round plays on"
    requirement: "REQ-03"
    verification:
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#stopAtTenpai leaves the hand at 13 tiles and fires no further onUserDraw"
        status: pass
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#without stopAtTenpai, the round plays on past tenpai and draws again"
        status: pass
    human_judgment: false
  - id: D5
    description: "kita()/kan() route through the same onUserDiscard/onUserDraw contract, tagged with stats.kind"
    verification:
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#kita() fires onUserDiscard with stats.kind 'kita', then onUserDraw for the replacement"
        status: pass
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#kan() fires onUserDiscard with stats.kind 'kan', then onUserDraw for the replacement"
        status: pass
    human_judgment: false
  - id: D6
    description: "onAgariCall fires exactly once with the winning seat's WinRecord, matching the returned snapshot's own win field"
    requirement: "REQ-03"
    verification:
      - kind: unit
        ref: "src/features/table/useTableRound.test.ts#fires onAgariCall once with the winning seat, matching the snapshot win field"
        status: pass
    human_judgment: false
  - id: D7
    description: "Scoring's only entry point is a single named onAgariCall handler (typed with AgariCall); a scoring link carries a wall, not a seed, and round-trips to the identical winning hand — an invalid wall= surfaces wallError and falls back to a generated hand"
    requirement: "REQ-03"
    verification:
      - kind: unit
        ref: "src/features/scoring/scoringUrl.test.ts#round-trips a wall exactly through encodeScoringWallUrl/decodeScoringUrl"
        status: pass
      - kind: unit
        ref: "src/features/scoring/scoringUrl.test.ts#surfaces a wallError and empties wall on an invalid wall= (five copies of a kind)"
        status: pass
      - kind: unit
        ref: "src/features/scoring/useScoringRound.test.ts#replays the hand its own situationQuery names, han and fu included"
        status: pass
      - kind: unit
        ref: "src/features/scoring/useScoringRound.test.ts#falls back to a generated hand when a pinned wall has no legal win"
        status: pass
      - kind: static
        ref: "grep -c 'onAgariCall' src/features/scoring/useScoringRound.ts >= 2; grep -c 'situationFromWin(' == 2"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-08-12
status: complete
---

# Phase 1 Plan 3: `useTableRound` hook + scoring on `onAgariCall`/wall links Summary

**New `useTableRound` React hook drives a real match through exactly `onUserDraw`/`onUserDiscard`/`onAgariCall`, with draw-time-stashed analysis proved by reference identity and StrictMode-safe callback dedup; scoring now enters through a single named `onAgariCall` handler and shares its board as an explicit wall (`playWall`/`encodeScoringWallUrl`) instead of a seed.**

## Performance

- **Duration:** ~21 min
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `src/features/table/useTableRound.ts` (new): the React hook layer over `core/table.ts` (01-02). Exactly three callbacks (`onUserDraw`, `onUserDiscard`, `onAgariCall`), named verbatim per the user's own contract — no generic event escape hatch (checked by grep in Task 1's acceptance criteria).
- `DiscardStats.yours`/`.best`/`.danger` are getters over the *draw-time* `TableAnalysis` (stashed in a `drawAnalysis` ref, never a fresh `analysisOf` call at discard time) — proved correct by reference identity (`onUserDiscard`'s `stats.analysis === onUserDraw`'s handed-over `analysis`) and proved lazy by `vi.mock` call-count assertions on `evaluateDiscards`/`assessDiscards`.
- `input.replay` fast-forwards silently (D-06): a `replaying` ref suppresses all three callbacks while `replayDiscards` steps the board through recorded discards, then fires exactly one `onUserDraw` for the live turn the replay lands on.
- StrictMode-safety: the mount effect's initial callback fire is deduped via a `{wall, restartCount}`-keyed ref (`builtFor`), the same identity-keyed pattern `useEfficiencyRound.ts`'s `logReplay` already established — proved by an actual `renderHook` test wrapped in `<StrictMode>`, not just by code inspection.
- `core/match.ts`: `playMatch`'s guard loop extracted into a private `playFrom(state, options, stop?)`; new `export function playWall(wall, players, options, stop?)` plays an explicit wall through the same loop. `playMatch`'s own exported signature is unchanged, so every existing seeded test stayed green.
- `scoringUrl.ts`: `ScoringUrl.seed: string` replaced with `wall: ParsedTile[]` + `wallError?: WallError`; `encodeScoringSeedUrl` replaced with `encodeScoringWallUrl`; `decodeScoringUrl` validates `wall` the same way `urlCodec.decodeSituation` does (D-12: reject by name, never repair). The pinned-hand (`hand=`) branch and `encodeScoringUrl` are untouched, per the plan.
- `useScoringRound.ts`: `matchOptions`/`situationFromWin` derive the round wind and honba roll from the wall's own content (`wallKey = serializeTenhouOrdered(wall)`) rather than a seed — the same wall always reproduces the same round and honba. A single `onAgariCall` handler (typed with `useTableRound`'s `AgariCall`) is the hook's only reader of `WinRecord`/`outcome.state.win`; a pinned wall plays directly via `playWall`, falling through to a capped/yielding random-wall search (`findWall`, mirroring `findMatchAsync`'s shape) when that specific wall has no legal win. `ScoringPage.tsx` and `<Table>` are untouched (D-07) — confirmed via `git diff --stat` showing no changes to that file across both commits.

## Task Commits

1. **Task 1: `useTableRound` — three callbacks, draw-time stats, silent replay** - `d30d4d0` (feat)
2. **Task 2: Scoring enters through `onAgariCall` and shares a wall, not a seed** - `41a482a` (feat)

## Files Created/Modified

- `src/features/table/useTableRound.ts` - new: `TableRoundInput`, `UserDrawContext`, `DiscardStats`, `AgariCall`, `useTableRound(input)`
- `src/features/table/useTableRound.test.ts` - new: 12 tests covering every `<behavior>` bullet, including a real StrictMode double-invoke case
- `src/core/match.ts` - `playFrom` extracted; `playWall` added
- `src/features/scoring/scoringUrl.ts` - `ScoringUrl.wall`/`wallError` replace `.seed`; `encodeScoringWallUrl` replaces `encodeScoringSeedUrl`; `decodeScoringUrl` validates the wall
- `src/features/scoring/scoringUrl.test.ts` - wall round-trip + invalid-wall coverage added
- `src/features/scoring/useScoringRound.ts` - wall-keyed `matchOptions`/`situationFromWin`; single `onAgariCall` handler; `playWall`/`findWall` replace the seed-based `findMatchAsync` path
- `src/features/scoring/useScoringRound.test.ts` - every `seed:` fixture replaced with a `completeWall(..., seed)`-built wall; added wall round-trip, invalid-wall-fallback, and reproducibility-from-the-same-wall cases

## Decisions Made

- `AgariCall`'s type stays exactly `(win: WinRecord) => void` — scoring's handler needs the wall and match a win came from too, but rather than widening the shared contract for one consumer, it reads those from a `pending` ref set immediately before each of its two call sites. Keeps `useTableRound`'s three-callback contract the single definition of "the three callbacks" that later plans (01-04 onward) can trust verbatim.
- Test fixtures for `useScoringRound` re-derive the exact `wallKey`-based round the hook's own `matchOptions` computes (a small duplicated helper, `hasWin`) rather than using a fixed round — a wall confirmed to win in test setup is then guaranteed to still win when the hook independently replays it under its own derived round, avoiding a class of flaky tests where the search round and the replay round silently diverged.

## Deviations from Plan

None — this plan's own commit sequence needed no `main` fast-forward (unlike 01-02): the worktree branch for this plan started from a stale `main` (`baa1b2c`, before waves 1–2 merged) and was fast-forward-merged onto `main` (`23ac1bd`, which already carried 01-01 and 01-02) before Task 1 began, so `core/table.ts` and the explicit-wall `createMatch` signature were present from the start of execution. No conflicts; a plain fast-forward, tracked as the one setup step outside the plan's own tasks.

## Issues Encountered

- Two test-authoring bugs surfaced (and were fixed) during Task 1's own test-writing, before any commit: an inline `wall: []`/`replay: [...]` array literal written directly inside a `renderHook(() => useTableRound({...}))` callback gets a fresh identity every render, which fails the hook's own documented "identity-stable wall/replay" contract and spins the mount effect forever (100% CPU, had to `pkill` the runaway `vitest` worker). Fixed by hoisting both to stable `const`s outside the render callback — a concrete demonstration of why `useTableRound`'s doc comment insists on caller-side identity stability.

## Known Stubs

None.

## Threat Flags

None — this plan's threat register (T-01-08, T-01-09) named exactly the mitigations built: `decodeScoringUrl`'s `validateWall` gate (proved by the invalid-wall test) and `replayDiscards`'s silent-stop-plus-suppressed-callbacks (proved by the replay test). T-01-10 (random-wall search DoS) is accepted per the plan's own threat register — the attempt budget and yield are carried over unchanged from `findMatchAsync`'s existing shape.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `useTableRound` is a complete, tested, three-callback hook ready for the two efficiency apps and the statistical lab to build on (01-05, 01-06 per the roadmap).
- Scoring is fully migrated onto `playWall`/`onAgariCall`/wall links; its page and grading are byte-for-byte the same drill as before.
- `useFoldingRound.ts` is untouched by this plan (REQ-07/01-04's own work, run in the sibling wave-3 worktree) — folding still carries its own duplicated turn-stepping logic pending its migration onto `core/table.ts`'s primitives via its own thin hook (not `useTableRound`, per D-08).
- No blockers.

## Self-Check: PASSED

All modified/created files verified present on disk; both commits (`d30d4d0`, `41a482a`) verified present in `git log`; `npm test` (304 tests), `npm run lint`, and `npm run build` all exit 0 as of the final commit.

---
*Phase: 01-table-architecture-centralization*
*Completed: 2026-08-12*
