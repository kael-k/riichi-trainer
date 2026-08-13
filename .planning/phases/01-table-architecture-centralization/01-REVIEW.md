---
phase: 01-table-architecture-centralization
reviewed: 2026-08-13T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - src/core/match.ts
  - src/core/table.test.ts
  - src/core/table.ts
  - src/core/wall.ts
  - src/features/efficiency-solo/EfficiencySoloPage.tsx
  - src/features/efficiency-solo/useEfficiencySoloRound.test.ts
  - src/features/efficiency-solo/useEfficiencySoloRound.ts
  - src/features/efficiency/EfficiencyPage.tsx
  - src/features/efficiency/grade.test.ts
  - src/features/efficiency/grade.ts
  - src/features/efficiency/useEfficiencyRound.test.ts
  - src/features/efficiency/useEfficiencyRound.ts
  - src/features/folding/FoldingPage.tsx
  - src/features/folding/useFoldingRound.test.ts
  - src/features/folding/useFoldingRound.ts
  - src/features/i18n/locales/en.json
  - src/features/i18n/locales/it.json
  - src/features/i18n/locales/ja.json
  - src/features/i18n/locales/zh.json
  - src/features/i18n/trainerLinks.ts
  - src/features/lab/LabPage.tsx
  - src/features/lab/useLabRound.test.ts
  - src/features/lab/useLabRound.ts
  - src/features/scoring/ScoringPage.tsx
  - src/features/scoring/scoringUrl.test.ts
  - src/features/scoring/scoringUrl.ts
  - src/features/scoring/useScoringRound.test.ts
  - src/features/scoring/useScoringRound.ts
  - src/features/settings/SettingsDialog.tsx
  - src/features/settings/settingsStore.test.ts
  - src/features/settings/settingsStore.ts
  - src/features/settings/tableSettings.test.ts
  - src/features/settings/tableSettings.ts
  - src/features/settings/useAdvancedSettings.ts
  - src/features/shanten/useShantenRound.ts
  - src/features/situation/urlCodec.test.ts
  - src/features/situation/urlCodec.ts
  - src/features/table/useTableRound.test.ts
  - src/features/table/useTableRound.ts
  - src/routes/HomePage.tsx
  - src/routes/index.tsx
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-13
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Reviewed the table-architecture centralization: `core/table.ts` (the pure stepping/snapshot/replay
primitives), `useTableRound.ts` (the React hook layer every wall-based trainer now composes), and
the four consumer hooks (`useEfficiencyRound`, `useEfficiencySoloRound`, `useLabRound`,
`useFoldingRound`, the last driving `core/table.ts` directly rather than through the hook), plus the
URL codecs, settings plumbing, and i18n surface that changed alongside it.

`npm test` (660 tests, 53 files), `npm run lint` (oxlint) and `tsc -b --noEmit` all pass clean on
this tree — no lint/type issues to report. The unit-level engineering (StrictMode dedup guards,
D-05 laziness, D-12 wall validation, the D-14 reveal gate) is careful and well-tested for the paths
the test suite actually drives through `useTableRound`. Two real defects were found by exercising
paths the existing tests don't cover — both confirmed by instrumenting the actual code rather than
by inspection alone (see each finding for the reproduction). Neither is caught by the 660 passing
tests, which is itself informative: every `useTableRound`-driving test pins either a full wall or an
`aka`-off wall, so the specific conditions that trigger each bug are simply never exercised.

## Warnings

### WR-01: `useTableRound` deals the round twice on every mount, discarding one of two independently-random walls

**File:** `src/features/table/useTableRound.ts:222` (the lazy `useState` initializer) and
`src/features/table/useTableRound.ts:224-250` (the mount `useEffect`)

**Issue:** `buildRound()` is called from two places on first mount: once synchronously as the
`useState` initializer (`const [snapshot, setSnapshot] = useState<TableSnapshot>(() => buildRound())`),
and again from the mount `useEffect` a moment later, which unconditionally calls `buildRound()` and
`setSnapshot(snap)`. `buildRound()` calls `createMatch(wall, input.players, input.options)` **without
a `fillSeed`** (`core/table/useTableRound.ts:209`). Inside `createMatch` (`core/match.ts:151-217`),
whenever `wall.length < fullWallSize(sanma)` — true for every "fresh round" mount, since
`emptySituation()` (the situation every trainer starts from with no shared link) has `wall: []` —
`completeWall(wall, sanma, aka, undefined)` falls back to `seed ?? String(Math.random())`
(`core/wall.ts:60`), i.e. a genuinely random, unseeded fill.

Confirmed by instrumentation (`vi.spyOn(wallMod, 'completeWall')` around a single `renderHook`
mount of `useTableRound` with an empty wall): `completeWall` is called **twice** per mount, and the
two calls produce two different random walls. The first (from the `useState` initializer) is
rendered, then discarded; the second (from the effect) overwrites it via `setSnapshot`, and is the
one whose `onUserDraw` actually fires. Concretely:
- Every "fresh round, no shared link" mount of `useEfficiencyRound`, `useEfficiencySoloRound`, and
  `useLabRound` (all three call `useTableRound`) deals a full match twice — including a full
  `goRound()` pass playing every opponent's AI turn — and throws one deal away. This is pure wasted
  work on the hottest entry point of the app (clicking into the Efficiency trainer from the home
  page).
- Because the two deals are independently random, the hand shown on the very first paint (from the
  `useState` initializer) is not the hand the round actually settles on a moment later (from the
  effect). If React yields to the browser between commit and the passive effect running — not
  guaranteed not to happen — the player sees a hand that changes under them on load.
- Even when the wall *is* fully pinned (a shared link, or any test using `wallWithHand`/`completeWall`
  with an explicit `fillSeed`), the double `buildRound()` call still doubles the CPU cost of every
  mount (two `createMatch` + two `goRound` AI passes), just without the correctness hazard, since a
  full wall skips `completeWall` entirely and both calls agree.

No existing test catches this: every test that renders `useEfficiencyRound`/`useEfficiencySoloRound`/
`useLabRound`/`useTableRound` with a short/empty wall (e.g. `useEfficiencyRound.test.ts`'s "restart
deals a fresh hand" and "seeds no red fives" tests) only asserts on the state *after* the effect has
settled, never on what the initializer alone produced — so the discarded first deal is invisible to
assertions even though it still runs.

**Fix:** Don't build twice. Either (a) make the `useState` initializer cheap (return an empty/loading
snapshot rather than calling `buildRound()`) and let the mount effect be the sole builder, or (b) if
an initial deal has to be present for first paint, thread a stable per-mount seed (the same pattern
`useShantenRound.ts` already uses via `useSessionStats().randomSeed`, which is a `useState(() =>
Math.random()...)` value stable across both the initializer and the mount effect) through to
`createMatch`'s `fillSeed` so both calls agree instead of racing two different `Math.random()` fills:

```ts
// useTableRound.ts — cheapest fix: skip the throwaway initial build
const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null)
// ...
useEffect(() => {
  const snap = buildRound()
  setSnapshot(snap)
  // ...
}, [...])
// callers already guard on `finished`/`loading`-style checks elsewhere in this codebase (see
// useLabRound/useFoldingRound's own `state === null` loading gates) — this hook would need the
// same, or its own `fillSeed` threaded through `buildRound` → `createMatch`.
```

### WR-02: `wallWithHand` silently drops the promised `aka` red five when `hand` holds a matching non-red tile

**File:** `src/core/wall.ts:141-157`

**Issue:** `wallWithHand(seat, hand, sanma, aka, seed)` builds `padding = completeWall([], sanma, aka,
seed)` (a full wall, with `aka` already marking the *first* occurrence of each red-eligible kind
red — `completeWall`'s own `remainder.findIndex(t => t.id === redId)` at `core/wall.ts:71`), then
filters `padding` to drop `hand`'s own tile counts **by id only**, ignoring redness:

```ts
const padding = completeWall([], sanma, aka, seed).filter((t) => {
  if (used[t.id] === 0) return true
  used[t.id]--
  return false
})
```

Because the filter walks `padding` front-to-back and drops the *first* `used[id]` occurrences of
each id, and `completeWall`'s own red-marking also always targets the *first* occurrence of a given
red-eligible id, these two "first occurrence" selections always coincide. When `hand` carries its
own explicitly-red tile for that kind, this is harmless (the padding's red copy is correctly
replaced by hand's own). But when `hand` contains a **plain** (non-red) tile of a red-eligible kind
(5m/5p/5s), the filter still strips the padding's *red* copy (since it's the first occurrence) and
splices in hand's plain one — so the returned wall ends up with **zero** red tiles for that suit even
though `aka: true` was requested and nothing in `hand` claimed to be red.

Confirmed with a direct probe: `wallWithHand(0, parseTenhou('55p123456789m11z'), false, true, seed)`
(a hand holding a plain 5p and a plain 5m, no red claimed) produces a wall with exactly **1** red tile
(only 5s) across 20 different seeds, instead of the 3 promised by `aka: true` — both the 5p and 5m
red fives are silently eaten.

This is not currently reachable through the app's one production call site (`LabPage.tsx`'s
`buildWall`, which always passes `hand: []`), so it isn't user-visible today. But the function's own
doc comment ("A wall pinning **one seat's starting hand**") and its name describe exactly the case
that triggers the bug — a non-empty, hand-authored `hand` — so this is a live trap for the next
caller (e.g. extending the lab's "Build Wall" flow to seed from a pasted/edited hand, which is the
obvious next step for that feature).

**Fix:** Track which id/redness *pairs* have already been consumed by `hand`, not just id counts —
or simpler, run the `aka` red-marking *after* `hand`'s tiles have been filtered out of the remainder,
the same order `completeWall` already uses when a non-empty `prefix` is involved (compare
`completeWall`'s `prefixReds` handling, which correctly skips a kind already named red by its
`prefix`). Concretely, `wallWithHand` could just call `completeWall(hand-shaped-prefix-at-offset, ...)`
patterns instead of post-hoc filtering, or filter first and mark red only among the *filtered*
survivors:

```ts
export function wallWithHand(seat, hand, sanma, aka, seed) {
  const used = new Uint8Array(NUM_TILE_TYPES)
  const handReds = new Set<TileId>()
  for (const t of hand) { used[t.id]++; if (t.red) handReds.add(t.id) }
  // build the un-red-marked remainder, filter hand's copies out, THEN mark red among survivors
  // (skipping any kind hand.reds already covers) — mirrors completeWall's own prefixReds logic.
}
```

## Info

### IN-01: `useEfficiencyRound.ts` and `useEfficiencySoloRound.ts` are near-verbatim duplicates

**File:** `src/features/efficiency/useEfficiencyRound.ts`, `src/features/efficiency-solo/useEfficiencySoloRound.ts`

**Issue:** ~150 lines (`recordChoice`, `writeRows`, `logReplay`, both `useEffect`s, the `finished`/
`tenpai` derivation, and the entire return object) are copy-pasted between the two hooks with only
`players`/`calls`/`riichi` differing. The project's own docs acknowledge this is deliberate ("mirrored
with exactly three differences"), so this is not flagged as a defect to fix, only as a maintenance
note: a change to the grading/logging plumbing (e.g. a new log row, a new session-stat field) has to
be applied twice by hand, and the two files can silently drift apart (as WR-01 above already shows —
both inherit the same `useTableRound` double-build issue, but a future fix applied to one and not
the other would go unnoticed since nothing asserts the two hooks stay in lockstep beyond the
`grade.ts`-level parity test in `useEfficiencySoloRound.test.ts`).

**Fix:** None required now; if a third near-identical consumer shows up, consider factoring the
shared 150 lines into a small parameterized hook (`useGradedTableRound({ players, calls, riichi })`)
rather than a third copy.

### IN-02: ja/zh locales omit ~75 keys present in en/it — appears intentional, worth a periodic check

**File:** `src/features/i18n/locales/ja.json`, `src/features/i18n/locales/zh.json`

**Issue:** `ja.json`/`zh.json` are missing 75 keys that `en.json`/`it.json` both have (glossary
entries, `*Translated` yaku-name tables, `intro` copy, and i18next `_one` plural forms). This lines
up with the documented design ("ja/zh already read these terms as their own words, so there is
nothing to translate" / the `translatedTerms` row hiding under ja/zh) and every `lab.*` key
introduced by this phase's new Lab trainer *is* present in all four locales, so nothing from this
phase's own scope is missing. Flagged only as a maintenance note: this parity gap is currently
indistinguishable, by tooling, from an accidentally-missed translation — there's no automated check
asserting "these 75 keys are deliberately locale-specific" versus "someone forgot to translate them",
so a future genuinely-new shared key could land only in en/it without anything failing.

**Fix:** None required now. If this becomes error-prone, a lint step that diffs key sets against an
explicit allowlist of "intentionally EN/IT-only" keys (glossary.*, *Translated.*, *_one) would turn
this from a silent gap into a caught one.

---

_Reviewed: 2026-08-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
