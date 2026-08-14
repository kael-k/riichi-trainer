---
phase: 01-table-architecture-centralization
plan: 04
subsystem: ui
tags: [react-hooks, folding-trainer, danger-model, url-codec, wall-sharing]

requires:
  - phase: 01-table-architecture-centralization
    provides: 'core/table.ts: TableCore, seenBy, goRound, yourDiscards, snapshotTable, replayDiscards, analysisOf (plan 01-02)'
provides:
  - "useFoldingRound.ts rebuilt on core/table.ts's shared primitives, with no duplicated seenBy/go-round/snapshot/replay of its own"
  - 'FoldingUrl.wall replacing FoldingUrl.seed — a folding link shares a wall (D-09), validated at the codec boundary (D-12)'
  - 'RoundState.boardHands — the D-14 hard reveal gate, living below the settings layer'
affects: [01-05, 01-06, 01-07]

actuals:
  tokens: 10518
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A hook that composes core/table.ts's primitives directly instead of through useTableRound, for the one trainer whose control flow (a turn-boundary policy flip) the three-callback contract cannot express"
    - 'A reveal gate implemented as data substitution (BACK_TILE filler) rather than a display-only flag, so no setting or override can put real ids in component props before the gate opens'

key-files:
  created: []
  modified:
    - src/features/folding/useFoldingRound.ts
    - src/features/folding/useFoldingRound.test.ts
    - src/features/folding/FoldingPage.tsx

key-decisions:
  - "Kept playToRiichi's raw beginTurn/finishTurn loop untouched rather than routing it through core/table.ts's goRound — the mid-hand riichi-target policy flip has to land between a finishTurn and the next beginTurn, which is exactly why folding never went through playMatch/useTableRound to begin with (D-08)."
  - 'findRound drops seed-string threading entirely and searches fresh truly-random walls via completeWall — D-09 makes the wall itself the shareable unit, so there is no longer a string whose reproducibility the search needs to preserve.'
  - 'Determinism tests pin an already-accepted wall (extracted from result.current.wall after a first successful deal) rather than asserting two independent searches converge — a true-random search cannot promise that, only a fixed wall replayed through the pinned path can.'
  - 'FoldingPage drops the hideConcealedHands check from its hand-passing condition: folding always renders the table (reading it is the drill), and the D-14 gate already withholds real tile ids independent of any setting, so the setting has nothing left to decide there.'

requirements-completed: [REQ-06, REQ-07]

coverage:
  - id: D1
    description: "useFoldingRound.ts composes core/table.ts's seenBy, goRound, yourDiscards, replayDiscards, snapshotTable and analysisOf instead of defining its own; playToRiichi keeps its own turn-boundary policy-flip loop"
    requirement: 'REQ-07'
    verification:
      - kind: static
        ref: "grep -cE '^function seenBy|^function yourDiscards' src/features/folding/useFoldingRound.ts == 0"
        status: pass
      - kind: static
        ref: "grep -cE \"from '\\.\\./\\.\\./core/table'\" src/features/folding/useFoldingRound.ts == 1"
        status: pass
      - kind: static
        ref: 'grep -c "policy = ''defense''" src/features/folding/useFoldingRound.ts == 1'
        status: pass
      - kind: unit
        ref: 'src/features/folding/useFoldingRound.test.ts (all cases, 27 total)'
        status: pass
    human_judgment: false
  - id: D2
    description: 'A folding link carries an explicit wall (FoldingUrl.wall), validated at the codec boundary, replacing the seed-based link; round wind and handover offset are seeded off the wall itself'
    requirement: 'REQ-07'
    verification:
      - kind: unit
        ref: "src/features/folding/useFoldingRound.test.ts > 'the folding link' (round-trip, discards round-trip, unset rules, invalid wall)"
        status: pass
      - kind: unit
        ref: "src/features/folding/useFoldingRound.test.ts > 'is reproducible: the same wall rebuilds the same board' / 'the same wall always deals the same round wind and seat'"
        status: pass
      - kind: unit
        ref: "src/features/folding/useFoldingRound.test.ts > 'an invalid wall link falls back to a fresh search instead of dealing an impossible board'"
        status: pass
    human_judgment: false
  - id: D3
    description: "No reveal setting can show a threat's real concealed hand before round.finished — the gate is RoundState.boardHands, substituting BACK_TILE filler at the correct count for every non-self seat until the hand ends"
    requirement: 'REQ-06'
    verification:
      - kind: unit
        ref: "src/features/folding/useFoldingRound.test.ts > 'boardHands (the D-14 reveal gate)' (3 cases: filler mid-hand, own seat always real, reveal matches the panel once finished)"
        status: pass
      - kind: static
        ref: "grep -c 'boardHands' src/features/folding/FoldingPage.tsx >= 1; grep -c 'round.hands\\[seat\\]' src/features/folding/FoldingPage.tsx == 0"
        status: pass
      - kind: manual_procedural
        ref: "human-check: with every reveal setting on, a threat's seat shows face-down backs at the correct count until the hand ends, then real faces"
        status: unknown
    human_judgment: true
    rationale: "The plan's <verification> names an explicit <human-check> for the visual reveal behavior across the app's live settings UI, which the unit tests approximate at the data layer but cannot substitute for."

duration: 26min
completed: 2026-08-12
status: complete
---

# Phase 1 Plan 4: Folding trainer on core/table.ts, wall-backed links, hard reveal gate Summary

**`useFoldingRound.ts` rebuilt on `core/table.ts`'s shared stepper primitives (no more private `seenBy`/go-round/snapshot/replay), its share link now carries an explicit wall instead of a seed, and a threat's real concealed hand can no longer reach the page before `round.finished` under any combination of reveal settings.**

## Performance

- **Duration:** ~26 min
- **Files modified:** 3 (`src/features/folding/useFoldingRound.ts`, `src/features/folding/useFoldingRound.test.ts`, `src/features/folding/FoldingPage.tsx`)

## Accomplishments

- Deleted folding's private `seenBy` and `yourDiscards`; both now come from `core/table.ts`. `worthwhile`/`discard`/the hook's `ranked()` getter read danger off `analysisOf(core).danger` instead of a local `rank()` wrapper around `assessDiscards`.
- `advanceAfterDiscard`'s inline 8-guard opponent loop is now `goRound(core)`; `buildRound`'s hand-rolled discard replay is now `replayDiscards(core, discards, step)`. `snapshot()` is rebuilt on `snapshotTable(core)`, spread with only folding's own grading/session fields layered on top.
- `playToRiichi` — the one control-flow folding keeps for itself — is untouched: it still drives raw `beginTurn`/`finishTurn` directly, because the mid-hand riichi-target `policy = 'defense'` flip has to land between a `finishTurn` and the next `beginTurn`, a seam `playMatch`'s per-event `stop` (and therefore `useTableRound`) cannot express (D-08).
- `FoldingUrl.seed: string` is now `FoldingUrl.wall: ParsedTile[]` plus `wallError?: WallError`. `decodeFoldingUrl` parses and validates the wall at the codec boundary exactly like `urlCodec.ts#decodeSituation` (D-12) — an invalid wall sets `wallError` and leaves `wall` empty rather than reaching `createMatch`. `encodeFoldingUrl` emits `wall=` in place of `seed=`.
- The round wind (`matchOptions`) and the handover-turns offset (`playToRiichi`) are now seeded off the wall itself via a `wallKey(wall) = serializeTenhouOrdered(wall)` helper feeding `mulberry32`, so the same wall always deals the same round wind and seats you the same way. `findRound` drops seed-string threading entirely, searching fresh `completeWall([], sanma, aka)` walls (true randomness, matching D-09's "seeds are dropped as the stored/shared record") and still falling back to fewer threats rather than failing.
- Added `RoundState.boardHands: ParsedTile[][]` and `BACK_TILE`, built in `snapshot()`: your own seat, and every seat once `finished`, get real `concealedTiles(player)`; every other seat gets `BACK_TILE` filler at the same tile count. `FoldingPage.tsx`'s seat mapping now reads `round.boardHands[seat]` unconditionally (dropping the old `showOpponentHands || !hideConcealedHands` data-side condition — folding always renders the board, and the gate no longer needs a setting's help) and `concealed: !(showOpponentHands && round.finished)`. This closes the live bug (D-14, Pitfall 5 in RESEARCH.md) where `showOpponentHands` alone controlled the reveal, with no `round.finished` check, letting the setting show a threat's hand mid-drill.

## Task Commits

1. **Task 1: Compose the shared primitives, keep the turn-boundary flip** - `2cbeba8` (feat)
2. **Task 2: A folding link carries a wall** - `cdd4307` (feat)
3. **Task 3: Hard-gate the threat reveal on the hand being over** - `52cd22d` (fix)

## Files Created/Modified

- `src/features/folding/useFoldingRound.ts` - rebuilt on `core/table.ts`; `FoldingUrl.wall`; `boardHands` reveal gate
- `src/features/folding/useFoldingRound.test.ts` - seed fixtures replaced with `completeWall(...)`-built walls; new wall-round-trip, wall-determinism and `boardHands` test cases
- `src/features/folding/FoldingPage.tsx` - seat mapping reads `boardHands`; drops the `hideConcealedHands` data-side check

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two pre-existing test assumptions only held by coincidence under the old fixed-seed search**

- **Found during:** Task 2 (test file rewrite) and its stabilization pass
- **Issue:** Moving `findRound` off seed-string threading onto true-random `completeWall` walls (per the plan's own Task 2 instructions) surfaced two test assertions in `useFoldingRound.test.ts` that were never actually invariants of the drill, just accidents of which fixed seed the old tests happened to use: (a) "deals a hand..." checked `rivers[threat].some(t => t.riichi)`, which fails whenever the threat's declaration tile gets called by another seat and popped out of its river (still legitimately in riichi, just not provable from that river read) — flaky roughly 1-in-4 runs; (b) "holds the reveal back..." asserted every revealed threat's hand is exactly 13 tiles with a non-empty wait, which is false the moment a threat wins its own hand via tsumo (14-tile complete hand, `waits()` returns `[]` since `shanten !== 0`) — flaky roughly 1-in-4 runs; (c) "deals a hand..." also assumed the player's own hand is always exactly 13+drawn, which breaks whenever the AI-controlled seat that becomes the player already called a meld before the handover (the pre-existing "never lets the engine call for the player" test's own comment already documents that this is expected).
- **Fix:** (a) replaced the river-tile-flag check with `result.current.riichi[threat]`, the boolean derived from `riichiAt` directly rather than a river read a call can empty; (b) gave that test `opponentWins: false` so no threat can resolve its own tenpai via tsumo before the reveal, matching the pattern already used by the neighboring "with opponent wins off" test; (c) widened the hand-count assertion to subtract any pre-existing meld tiles.
- **Files modified:** `src/features/folding/useFoldingRound.test.ts`
- **Verification:** 15+ consecutive full-suite runs of `useFoldingRound.test.ts` with zero failures (previously failed roughly 1-in-3 runs across a sample of ~8).
- **Committed in:** `cdd4307` (Task 2 commit) and `52cd22d` (folded into Task 3's commit for the boardHands test additions, which run the same stabilized fixtures)

---

**Total deviations:** 1 auto-fixed (bug — test flakiness from a design assumption the plan's own random-search change legitimately broke)
**Impact on plan:** No change to the plan's design or scope — the fixes make the existing test intent hold under the randomness the plan itself introduces; no application code changed as a result.

## Issues Encountered

None beyond the deviation documented above.

## Known Stubs

None.

## Threat Flags

None — the plan's own threat register (T-01-11, T-01-12, T-01-13, T-01-14) named exactly the mitigations built: `validateWall` at the `decodeFoldingUrl` boundary (Task 2), `boardHands` filler substitution (Task 3), `replayDiscards`'s quiet stop on an unhonourable discard list (Task 1, inherited from `core/table.ts`), and `findRound`'s unchanged bounded attempt budget (accepted, unchanged).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `useFoldingRound.ts` now imports its visibility, go-round, snapshot and replay from `core/table.ts` and defines none of them — the last of the two pre-Phase-1 duplicated implementations (`useEfficiencyRound.ts`'s remains an open item outside this plan's `files_modified`).
- Folding shares a wall, not a seed; every downstream plan that touches folding's link format (none currently planned) should build on `FoldingUrl.wall`/`encodeFoldingUrl(wall, ...)`.
- The D-14 reveal gate is now structural (`boardHands`), not a display flag — any future folding UI change that wants to show more of the board should read through `boardHands`, never `round.hands` directly, to keep the gate intact.
- No blockers for 01-05/01-06/01-07.

## Self-Check: PASSED

All modified files verified present on disk; all three commits (`2cbeba8`, `cdd4307`, `52cd22d`) verified present in `git log`. `npm test` (294/294), `npm run lint`, and `npm run build` all exit 0 on the final tree.

---

_Phase: 01-table-architecture-centralization_
_Completed: 2026-08-12_
