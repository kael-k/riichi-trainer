# Phase 1: Table architecture centralization - Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 14 (new/modified)
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/match.ts` (`createMatch` reshape) | model/engine | transform (wall→hands) | itself, current `createMatch` (`match.ts:165-254`) | exact (rewrite in place) |
| `src/core/table.ts` (new) | service/engine stepper | event-driven | `useEfficiencyRound.ts` (`rankDiscards`/`runOpponents`) + `useFoldingRound.ts` (`seenBy`/loop) + `match.ts`'s private `seenBy` | role-match (three-way merge) |
| `src/core/table.test.ts` (new) | test | — | `src/core/match.test.ts` (`describe('createMatch', …)`, census helper) | role-match |
| `src/features/situation/wallCodec.ts` (new, or extend `urlCodec.ts`) | utility/codec | transform + validation | `urlCodec.ts` (`decodeSituation`/`encodeSituation`/`FLAGS`) and `tiles.ts#parseTenhou` (untrusted-input parsing) | exact (sibling codec) |
| `src/features/table/useTableRound.ts` (new) | hook | event-driven (callback contract) | `useEfficiencyRound.ts` (full file — `useRef` core + `useState` snapshot mirror, `logReplay` dedup) | exact |
| `src/features/efficiency/EfficiencyPage.tsx` (split → table variant) | component (page) | request-response (renders round state) | itself, current file (`Table` branch) | exact (split in place) |
| `src/features/efficiency-solo/EfficiencySoloPage.tsx` (new) | component (page) | request-response | `EfficiencyPage.tsx` (solo-layout branch, `:238-263`) | exact (extracted) |
| `src/features/efficiency-solo/useEfficiencySoloRound.ts` (new, if not sharing `useTableRound`) | hook | event-driven | `useEfficiencyRound.ts` | role-match |
| `src/features/folding/useFoldingRound.ts` (rewritten) | hook | event-driven, turn-boundary control | itself, current file (`playToRiichi`, `advanceAfterDiscard`, `seenBy`) | exact (rewrite in place, onto `core/table.ts` primitives) |
| `src/features/lab/LabPage.tsx` (new) | component (page) | request-response | `EfficiencyPage.tsx` / `FoldingPage.tsx` (page+hook trainer pattern) | role-match |
| `src/features/lab/useLabRound.ts` (new) | hook | event-driven | `useTableRound.ts` (new) consumer pattern | role-match |
| `src/features/settings/settingsStore.ts` (`table` section added) | store/config | CRUD (persisted state) | itself, current file (`Settings` interface + `merge`) | exact (extend in place) |
| `src/routes/index.tsx` (two new routes) | route | request-response | itself (existing route array) | exact |
| `src/routes/HomePage.tsx` (two new `MODES` entries) | component | request-response | itself (`MODES` array) | exact |
| `src/features/i18n/trainerLinks.ts` (`TRAINER_WIKI` entries) + 4 locale JSON | config/i18n | — | itself (existing `TRAINER_WIKI` map + `trainer.<name>.*` keys) | exact |

## Pattern Assignments

### `src/core/match.ts` — `createMatch` reshape (model, transform)

**Analog:** itself, current implementation.

**Current signature and dealing loop** (`match.ts:165-220`):
```typescript
export function createMatch(
  seed: string,
  players: number,
  options: MatchOptions,
  pinned?: Pinned,
): MatchState {
  const used = new Uint8Array(NUM_TILE_TYPES)
  const pinnedRedSuits = new Set<TileId>()
  for (const t of [...(pinned?.hand ?? []), ...(pinned?.wall ?? [])]) {
    used[t.id]++
    if (t.red) pinnedRedSuits.add(t.id)
  }

  const pool: ParsedTile[] = buildWall(seed, options.sanma)
    .filter((id) => {
      if (used[id] === 0) return true
      used[id]--
      return false
    })
    .map((id) => ({ id, red: false }))
  if (options.aka) {
    for (const redId of redFiveIds(options.sanma)) {
      if (pinnedRedSuits.has(redId)) continue
      const i = pool.findIndex((t) => t.id === redId)
      if (i >= 0) pool[i] = { id: redId, red: true }
    }
  }

  let deadWall: ParsedTile[] = []
  // ... dead wall reserved off pool TAIL (options.deadWall gate) ...
  const dealable = pool.slice(0, pool.length - reserved)
  // then: for (const player of state.players) while (tileCount < 13) take(state, player)
  // pinned.wall unshifted onto liveWall AFTER the deal (drawn-next semantics)
}
```

**What the new signature must do instead** (D-09/D-10/D-11, `wall.length` implies ruleset per
D-12): take an explicit flat `ParsedTile[]` wall, in draw order — `wall.slice(0, 13)` → seat 0's
starting hand, `wall.slice(13, 26)` → seat 1's, …, remaining up to `length - 14` is the live draw
pool, last 14 (dora indicator first) is the dead wall. Short/partial walls fill the remainder via
`buildWall(String(Math.random()), sanma)` filtered by already-used copies — reuse the exact
`used`-Uint8Array-filter idiom above (`match.ts:171-184`), just keyed off the explicit wall's
tiles instead of `pinned`. `deadWall`/`aka` gating logic (`:193-213`) stays unchanged; only the
*source* of `pool` changes from "seeded shuffle minus pinned" to "explicit wall plus random
completion of the remainder." Delete `Pinned` — do not extend it (Pitfall 1 in RESEARCH.md).

**Two direct-caller tests that must be rewritten** (`src/core/match.test.ts:176-219`,
`describe('createMatch', …)` — "seeds exactly one red five…" and "honours a pinned hand and wall
prefix…"): read the exact current assertions before rewriting to the wall-taking signature; the
census helper (`match.test.ts:32-52`) and its "every tile kind accounted for exactly four times"
invariant stays the contract to preserve.

---

### `src/core/table.ts` (new) — pure stepper, `seenBy`, snapshot, replay (service/engine)

**Analogs:** `match.ts`'s private `seenBy`, `useEfficiencyRound.ts`'s `rankDiscards`/`runOpponents`,
`useFoldingRound.ts`'s `seenBy`/`advanceAfterDiscard`.

**Canonical `seenBy` to converge on** (adopt folding's clamp — flagged in RESEARCH.md as a
behavior-preserving-or-fixing choice worth confirming with planner, not silently dropped):
```typescript
// Source: src/features/folding/useFoldingRound.ts:201-209 (has the extra clamp match.ts lacks)
function seenBy(core: RoundCore): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  const counts = core.match.players[core.seatIndex].hand.counts
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = Math.min(TILES_PER_KIND, core.match.visible[i] + counts[i])
  }
  return seen
}
```
vs. the two unclamped versions to retire: `match.ts:278-282` (module-private AI seenBy) and
`useEfficiencyRound.ts:120-127` (inlined into `rankDiscards`).

**Opponent go-round loop to generalize as one primitive** (both hooks layer their own stop
condition on top — efficiency: tenpai-stop; folding: hand-ended):
```typescript
// Source: src/features/efficiency/useEfficiencyRound.ts:137-149 (runOpponents)
function runOpponents(core: RoundCore, opponents: boolean): void {
  const { match, options, seatIndex } = core
  if (!opponents) {
    match.seat = seatIndex
    match.pendingDraw = true
    return
  }
  for (let guard = 0; guard < 8 && match.seat !== seatIndex && !match.ended; guard++) {
    beginTurn(match, options)
    finishTurn(match, options)
  }
}
```
```typescript
// Source: src/features/folding/useFoldingRound.ts:287-299 (advanceAfterDiscard, inlined loop)
function advanceAfterDiscard(core: RoundCore, tile: ParsedTile): void {
  const { match, options, seatIndex } = core
  finishTurn(match, options, tile)
  for (let guard = 0; guard < 8 && match.seat !== seatIndex && !match.ended; guard++) {
    beginTurn(match, options)
    finishTurn(match, options)
  }
  if (!match.ended && match.liveWall.length > 0) beginTurn(match, options)
}
```

**Memoized analysis getters** — wrap `evaluateDiscards`/`assessDiscards` (already pure, engine-tier
functions) as lazy getters on the stepper's snapshot so solo/folding don't pay for analysis they
never read (D-05):
```typescript
// Source: src/core/efficiency.ts:17 signature to wrap
export function evaluateDiscards(hand: Hand, seen: Uint8Array, sanma: boolean): DiscardOption[]
// Source: src/core/danger.ts:122 signature to wrap
export function assessDiscards(hand: Hand, threats: ThreatView[], visible: Uint8Array, sanma: boolean): TileDanger[]
```

**`logReplay` StrictMode-dedup shape to recognize but NOT move into `table.ts`** (stays hook-tier
per Pitfall 4 — the identity-keyed `useRef` guard is React-specific):
```typescript
// Source: src/features/efficiency/useEfficiencyRound.ts:320-323 (mirrored useFoldingRound.ts:477-479)
function logReplay() {
  const r = core.current
  if (!r || loggedReplay.current === situation) return
  loggedReplay.current = situation
  // ... play() over each replayed discard
}
```
Only the underlying "fast-forward tiles/events through beginTurn/finishTurn given a discard list"
mechanics move into `core/table.ts`; the `useRef` dedup guard stays in each React hook.

---

### `src/features/situation/wallCodec.ts` (new) — explicit wall codec + validation (utility)

**Analogs:** `urlCodec.ts` (query-param round-trip shape) + `tiles.ts#parseTenhou` (untrusted-input
posture, though this codec must *reject* rather than *silently drop*).

**Query-param round-trip shape to mirror**:
```typescript
// Source: src/features/situation/urlCodec.ts:39-54, 57-69
export function decodeSituation(params: URLSearchParams): Situation {
  const s = emptySituation()
  s.seed = params.get('seed') ?? ''
  s.hand = parseTenhou(params.get('hand') ?? '')
  s.wall = parseTenhou(params.get('wall') ?? '')
  // ...
  for (const flag of FLAGS) {
    const v = params.get(flag.toLowerCase())
    if (v !== null) s[flag] = v !== '0'
  }
  return s
}
export function encodeSituation(s: Situation): string {
  const params = new URLSearchParams()
  if (s.wall.length) params.set('wall', serializeTenhouOrdered(s.wall))
  // ...
  return params.toString()
}
```
Note `Situation.wall` today means "prefix consumed on next draw" (`urlCodec.ts:9-11`) — the new
wall format's leading segment IS the deal (Pitfall 1). Per Open Question 1, this likely needs a
new/adjacent module rather than extending `Situation.wall` in place; whichever the planner picks,
`FLAGS`/`opponents` removal (D-01) happens in `urlCodec.ts` regardless:
```typescript
// Source: src/features/situation/urlCodec.ts:26
const FLAGS = ['opponents', 'deadWall', 'aka', 'sanma'] as const
// → 'opponents' removed
```

**Validation constants to build the D-12 checks against**:
```typescript
// Source: src/core/wall.ts:5-7
export const TILES_PER_KIND = 4
export const DEAD_WALL_SIZE = 14
export const INITIAL_HAND_SIZE = 13
// Source: src/core/tiles.ts:1, :61-63
export const NUM_TILE_TYPES = 34
// inTileSet excludes 2m-8m under sanma
```
Full yonma wall = 136 (`34*4`), full sanma = 108 (`27*4`). Reject with a message naming the
offending zone + tile (Claude's Discretion; D-12 requires reject-never-repair) — no existing
codec in this repo currently throws on bad input (`parseTenhou` silently drops), so this is new
behavior for this one boundary, matching the ASVS V5 note in RESEARCH.md.

---

### `src/features/table/useTableRound.ts` (new) — hook, event-driven callback contract

**Analog:** `src/features/efficiency/useEfficiencyRound.ts` (full file) — `useRef` mutable core +
`useState` snapshot mirror is the established hook pattern.

**Core/state shape to mirror**:
```typescript
// Source: src/features/efficiency/useEfficiencyRound.ts:62-80
interface RoundCore {
  match: MatchState
  options: MatchOptions
  seatIndex: number
}
interface RoundState {
  hand: ParsedTile[]
  drawn: ParsedTile | undefined
  turn: number
  doraIndicators: ParsedTile[]
  rivers: RiverTile[][]
  hands: ParsedTile[][]
  riichi: boolean[]
  nuki: ParsedTile[]
  // ...
}
```
Imports to follow (`useEfficiencyRound.ts:1-32`): `useEffect, useRef, useState` from React;
`evaluateDiscards`/`isBestDiscard` from `core/efficiency`; `beginTurn`/`createMatch`/`finishTurn`
from `core/match`; `useSessionStats`/`useLog` for session/log wiring;
`encodeSituation`/`WINDS`/`Situation` from `situation/urlCodec`.

**New callback contract to add** (D-05, verbatim names — no existing hook has this shape yet,
this is new code, not a refactor of an existing callback list):
```typescript
onUserDraw(ctx)       // fires once you hold 14 tiles, before the discard decision
onUserDiscard(tile, stats)  // stats = ranking captured AT DRAW TIME, never recomputed post-throw
onAgariCall(win)       // fires when any seat wins
```
Suppress firing during replay fast-forward (D-06) — reuse the `logReplay` dedup-ref pattern above
as the model for "how this codebase already gates a replay-vs-live distinction."

---

### `src/features/folding/useFoldingRound.ts` — rewrite onto `core/table.ts` primitives directly

**Analog:** itself, current file — this is a migration, not a new pattern.

**Turn-boundary stop condition to preserve exactly** (why this stays off `useTableRound`, D-08):
```typescript
// Source: src/features/folding/useFoldingRound.ts:158-199 (playToRiichi, shape)
// drives beginTurn/finishTurn in a raw loop; checks riichiSeats(match).length < threats
// right after finishTurn returns (turn-boundary, not per-event), then mutates every
// non-declaring seat's player.policy = 'defense' before continuing
```
After migration, this loop calls `core/table.ts`'s exported stepper/snapshot/`seenBy`/
replay-fast-forward primitives directly (not `useTableRound`), keeping its own riichi-target
search loop (mirrors D-07's scoring capped-attempts shape) and its own mid-hand policy mutation
between step calls.

**D-14/REQ-06 reveal-gate fix to apply here** (Pitfall 5 — gate the `hand` prop itself, not just
`concealed`):
```typescript
// Current bug shape, src/features/folding/FoldingPage.tsx:160-164 (approximate):
// hand: seat !== round.seatIndex && (showOpponentHands || !hideConcealedHands) ? round.hands[seat] : undefined
// Fix: add round.finished to the gate —
// hand: seat !== round.seatIndex && round.finished && (showOpponentHands || !hideConcealedHands)
//   ? round.hands[seat] : undefined
```

---

### `src/features/efficiency-solo/*` (new) and `src/features/lab/*` (new) — page + hook, trainer pattern

**Analog:** `EfficiencyPage.tsx` / `FoldingPage.tsx` full page+hook pairing (page component, `use*Round`
hook, session state via `lib/useSessionStats.ts`, action log via `store/log.ts`).

**Solo's target layout to extract verbatim** (D-03 — no `<Table>`):
```
// Source: src/features/efficiency/EfficiencyPage.tsx:238-263 (solo-layout branch)
// hand, your river, nuki/kan piles, wall/dora chips — kept exactly as today
```

**Lab has no grading** — do not add a `worthwhile()`-style filter (that's folding-specific,
`useFoldingRound.ts:220-235`); the lab accepts whatever wall it's given and surfaces the full
`evaluateDiscards`/`assessDiscards` output already computed and thrown away elsewhere
(`useEfficiencyRound.ts:356-358`, `DiscardFeedback.tsx`/`FoldFeedback.tsx`).

---

### `src/features/settings/settingsStore.ts` — add `table` section (store, CRUD)

**Analog:** itself — extend the existing `Settings` interface and `merge` in place.

**Fields moving into the new `table` section** (currently scattered):
```typescript
// Source: src/features/settings/settingsStore.ts:11-20 (efficiency section, current)
efficiency: {
  opponents: boolean   // REMOVED per D-01 (not moved)
  deadWall: boolean    // MOVES into `table`
}
// Source: settingsStore.ts:46-65 (folding section, current)
folding: {
  threats: number        // MOVES into `table`
  opponentWins: boolean  // MOVES into `table`
  showEquallySafe: boolean  // stays (folding-only)
  feedbackAtEnd: boolean    // stays (folding-only)
}
// Source: settingsStore.ts:103-117 (top-level, current)
showWall: boolean            // MOVES into `table`
showOpponentHands: boolean   // MOVES into `table`
hideConcealedHands: boolean  // MOVES into `table`
```

**`merge` to extend** (add a `table` line and per-app override handling; also bump `version`):
```typescript
// Source: src/features/settings/settingsStore.ts:193-210
{
  name: 'riichi-trainer-settings',
  version: 2,  // → bump to 3: keys are being removed/moved, old blobs must be dropped not merged
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<SettingsState>
    return {
      ...current,
      ...p,
      efficiency: { ...current.efficiency, ...p.efficiency },
      shanten: { ...current.shanten, ...p.shanten },
      scoring: { ...current.scoring, ...p.scoring },
      folding: { ...current.folding, ...p.folding },
      // NEW: table: { ...current.table, ...p.table }
    }
  },
}
```

**Resolution helper (new, Claude's Discretion on file location)** — plain object spread per D-13,
no three-state UI:
```typescript
// Pattern to write, not copy — no existing helper does this yet:
function resolveTableSettings(app: AppName): TableSettings {
  return { ...defaultsForApp[app], ...settings.table, ...settings.table.overrides?.[app] }
}
```
`showWall`'s `advanced`-gate must survive the move (Open Question 4) — check
`useAdvancedSettings.ts:17,23` before wiring the read site.

---

### `src/routes/index.tsx` + `src/routes/HomePage.tsx` — two new routes/cards

**Analog:** itself — both files' existing arrays are the pattern to extend, no new pattern needed.

```typescript
// Source: src/routes/index.tsx:9-24 — add two children entries, e.g.
{ path: 'efficiency-solo', element: <EfficiencySoloPage /> },
{ path: 'lab', element: <LabPage /> },
```
```typescript
// Source: src/routes/HomePage.tsx:11-40 — MODES array, add two entries following the exact shape:
{
  to: '/efficiency-solo',
  titleKey: 'trainer.efficiencySolo.title',
  descKey: 'trainer.efficiencySolo.desc',
  introKey: 'trainer.efficiencySolo.intro',
  wikiUrl: TRAINER_WIKI.efficiencySolo,
}
```
Both new routes need matching entries in `src/features/i18n/trainerLinks.ts`'s `TRAINER_WIKI` map
and `trainer.<name>.*` keys in all four locale JSON files (`en`/`ja`/`zh`/`it`), same as every
existing trainer (Integration Points in CONTEXT.md).

## Shared Patterns

### Trainer page+hook pairing
**Source:** `src/features/efficiency/EfficiencyPage.tsx` + `useEfficiencyRound.ts`,
`src/features/folding/FoldingPage.tsx` + `useFoldingRound.ts`
**Apply to:** `efficiency-solo`, `table` (efficiency split), `lab`, folding (rewritten)
Page component + `use*Round` hook; session score/clock/seed via `lib/useSessionStats.ts`; action
log via `store/log.ts`, written imperatively from user actions inside `discard()`/`submit()`,
never from `useEffect`s watching round state (except `logReplay`, keyed on decoded-object identity).

### `useRef` core + `useState` snapshot mirror
**Source:** `src/features/efficiency/useEfficiencyRound.ts` (`RoundCore`/`RoundState` split, full file)
**Apply to:** `useTableRound.ts`, `useEfficiencySoloRound.ts`, `useLabRound.ts`
Mutable round state lives in a `useRef`; render-ready snapshots mirror into `useState`.

### Settings section + `merge` extension
**Source:** `src/features/settings/settingsStore.ts:10-66` (`Settings` interface),
`:193-210` (`merge`)
**Apply to:** the new `table` section
Every new persisted section must be added to `merge`'s section-wise spread or old persisted state
silently wipes it on load (CLAUDE.md, explicitly called out).

### Untrusted-input handling posture
**Source:** `src/core/tiles.ts` (`parseTenhou`, malformed input silently dropped rather than
crashing) — the wall codec adapts this posture to *reject* (never silently repair) since a wall is
positionally meaningful, per D-12.
**Apply to:** `wallCodec.ts`'s validation function.

## No Analog Found

None — every file in scope has a same-repo analog to build from; this phase is a refactor/split of
existing trainer machinery, not new domain territory.

## Metadata

**Analog search scope:** `src/core/`, `src/features/efficiency/`, `src/features/folding/`,
`src/features/settings/`, `src/features/situation/`, `src/routes/`
**Files scanned:** `match.ts`, `wall.ts`, `tiles.ts`, `efficiency.ts`, `danger.ts`,
`useEfficiencyRound.ts`, `useFoldingRound.ts`, `EfficiencyPage.tsx`, `FoldingPage.tsx`,
`settingsStore.ts`, `urlCodec.ts`, `Table.tsx`, `routes/index.tsx`, `routes/HomePage.tsx`,
`trainerLinks.ts` (all read this session or in RESEARCH.md's prior full reads, reused verbatim
here to avoid re-reading ranges already in context)
**Pattern extraction date:** 2026-08-12
