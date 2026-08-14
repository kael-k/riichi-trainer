# Phase 1: Table architecture centralization - Research

**Researched:** 2026-08-12
**Domain:** Internal TypeScript/React architecture refactor (no new external dependencies)
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Efficiency trainer splits into two routes, two pages, two hooks — not a shared hook
  behind a flag. `opponents` is removed entirely: from `Settings['efficiency']`, from the URL
  codec's `FLAGS` (`urlCodec.ts:26`), and from `situationQuery()`. The route is the choice.
- **D-02:** Solo is genuinely one seat — `createMatch(wall, 1, …)` — keeping the dead wall and
  dora indicator. No new dealing path is needed: `createMatch` already deals sequentially per seat
  (`match.ts:243-247`) and slices the dead wall off the pool tail independent of player count
  (`:199-213`).
- **D-03:** Solo's board keeps today's layout exactly — hand, your river, nuki/kan piles, wall/dora
  chips (`EfficiencyPage.tsx:238-263`) — no `<Table>`. User wants phone usability and does not
  consider solo "a table"; `Table`'s slot mapping (`SLOTS`/`SEAT_SLOTS`, `Table.tsx:46-54`) is
  written for 3-4 seats and would render mostly-empty cells for one.
- **D-04:** Three layers, strictly: pure `core/table.ts` (stepper wrapping `beginTurn`/`finishTurn`,
  the go-round loop, the snapshot builder, one canonical `seenBy` — replacing the three current
  implementations at `match.ts:278-282`, `useEfficiencyRound.ts:121-125`, `useFoldingRound.ts:202-209`
  — `yourDiscards`, replay fast-forward, per-turn analysis as memoized getters) → React
  `useTableRound()` hook (owns round state, fires callbacks) → presentational `<Table>`
  (unchanged — it already holds zero game logic, `Table.tsx:19-21`).
- **D-05:** Callback contract, exact names (user's own naming, keep verbatim):
  - `onUserDraw(ctx)` — fires once you hold 14 tiles, before the discard decision
  - `onUserDiscard(tile, stats)` — fires after the throw, `stats` carries the chosen action's
    ukeire/danger computed from the ranking captured at draw time (not recomputed post-throw)
  - `onAgariCall(win)` — fires when any seat wins; scoring's entry point
    Analysis is exposed as memoized getters, not eagerly computed — solo never reads danger, folding
    never reads ukeire, and `evaluateDiscards` costs ~476 shanten probes per turn
    (`efficiency.ts:38-41`); nobody should pay for what they don't read.
- **D-06:** Callbacks are suppressed during replay fast-forward (loading a shared link or a log
  row's rewind) — restored turns must not grade or log as if they were live.
- **D-07:** Scoring keeps its existing shape unchanged: it generates a result and never re-touches
  the match, and keeps rendering `<Table>` presentationally exactly as today
  (`ScoringPage.tsx:292-306`). It now subscribes to `onAgariCall` as its entry point. When no wall
  is supplied, the engine loops fresh random-wall matches — capped attempts, yielding between them,
  same shape as today's `findMatch`/`findMatchAsync` (`match.ts:654,670`) — until `onAgariCall`
  fires.
- **D-08:** Folding's own round hook (`useFoldingRound.ts`) **is** migrated onto `core/table.ts`
  this phase — but onto the pure stepper directly, not through `useTableRound`. Reason: folding's
  mid-hand riichi-target policy flip (the moment the target is reached, every seat that hasn't
  itself declared switches to `policy: 'defense'`) runs at turn granularity between
  `beginTurn`/`finishTurn`, which is exactly why `useFoldingRound.ts` drives those directly today
  instead of `playMatch` — `playMatch`'s `stop` fires per event only _after_ the whole turn has
  run, too late for the flip. `useTableRound`'s `onUserDraw`/`onUserDiscard`/`onAgariCall`
  contract is shaped around efficiency/scoring/lab's needs and stays exactly those three — it does
  not grow a generic event escape hatch for this one consumer. Folding gets a thin, folding-owned
  React hook that calls `core/table.ts`'s exported stepper/snapshot/`seenBy`/replay-fast-forward
  primitives directly, alongside its own board-generation-with-riichi-predicate loop (same
  capped-attempts, randomwall-until-accept shape as D-07's scoring loop) and its own mid-hand
  policy mutation between step calls. This removes the duplication without forcing folding's
  genuinely different control flow through a contract built for someone else.
- **D-09:** Seeds are dropped as the stored/shared record. `createMatch` takes an explicit wall.
  `buildWall(seed, sanma)` (`wall.ts:11`) is kept internally for random generation
  (`buildWall(String(Math.random()), sanma)`) and for existing seeded tests (3000-hand shanten
  fuzz, 150-match danger simulation, 40-seed census in `match.test.ts`) — none of those need to
  change.
- **D-10:** Wall share format is a single flat `wall` param in draw order: seat 0's 13 tiles, seat
  1's 13, … , then draws, then the last 14 tiles are the dead wall (dora indicator first). User's
  explicit pick over a zone-named two-param alternative (`wall=`+`dead=`) — the positional-boundary
  tradeoff (confusing to hand-author) was accepted knowingly.
- **D-11:** A short/partial wall is a prefix: the given tiles are used in order, the remainder is
  completed from a random wall with those copies removed — generalizes `createMatch`'s existing
  `Pinned` prefix behavior (`match.ts:171-191`). This is what makes partial hand-authoring in the
  lab usable rather than requiring all 136 tiles every time.
- **D-12:** Wall length implies the ruleset (108 tiles = sanma); a loaded wall's length wins over
  the global `sanma` setting for table apps. Validate on load — untrusted input: length within
  bounds, no kind exceeding four copies (exactly four when the wall is full), at most one red per
  suit, no 2m-8m under sanma. Reject with an error naming the offending zone and tile; never
  silently repair.
- **D-13:** Table settings — `opponentWins`, `deadWall`, `threats`, `showOpponentHands`,
  `hideConcealedHands`, `showWall` — move to one shared schema: a global `table` section plus a
  per-app `Partial<TableSettings>` override, resolved as
  `{ ...defaultsForApp, ...global, ...appOverride }` (absent key = inherit, no three-state UI).
  `sanma` and `aka` stay top-level globals — shanten needs them too and they aren't table-specific.
- **D-14:** Folding's threat-hand reveal is hard-gated on `round.finished` — no setting or override
  may show a threat's hand before the hand is over. `FoldingPage.tsx:160-164` today has no such
  gate (only `showOpponentHands` controls it), which already lets the global setting defeat the
  drill's own stated rule. This is a live bug fix riding the settings move, not a new feature.
- **D-15:** Standalone route + home-page card, not a panel toggle inside existing trainers — a
  panel would collide with folding's rule against showing danger markers before the answer and its
  rule that a threat's hand is revealed only once the hand is over. Loads or authors a wall,
  replays only **your own** discards (opponents are always AI-derived via `policy.ts`, never
  scripted or stored — nothing in any URL records opponent lines today), and surfaces the full
  `evaluateDiscards` ranking and the full `assessDiscards` tier list with per-threat reasons — data
  the existing trainers already compute and throw away (`useEfficiencyRound.ts:356-358`,
  `DiscardFeedback.tsx`/`FoldFeedback.tsx` only ever render one or two rows of it).
- **D-16:** EV, deal-in probabilities, and win-rate modeling are explicitly out of scope — for the
  lab and for this phase entirely. No simulation harness exists in the repo (grepped, confirmed);
  `danger.ts` is deliberately ordinal by design (`danger.ts:9-12`) — an invented number is worse
  than showing no number.

### Claude's Discretion

- Exact directory/feature naming for the new solo efficiency app and the lab app
  (`src/features/<name>/`) — not specified by the user, follow the existing trainer pattern
- Exact shape of wall-validation error messages, as long as they name the offending zone and tile
- Whether `core/table.ts`'s stepper is a class, a closure-returning factory, or a set of functions
  over a state object — match the existing `core/` style (plain functions over a mutable state
  object, per `match.ts`)

### Deferred Ideas (OUT OF SCOPE)

- Any EV, push-fold, or deal-in-rate modeling — would need a new simulation harness; explicitly out
  of scope for this milestone (PROJECT.md Out of Scope).
- Migrating or redirecting old `?opponents=` links, or the persisted `efficiency.opponents`
  setting key — explicitly not maintaining back-compat this milestone (pre-release).

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                                                   | Research Support                                                                                                                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-01 | Efficiency trainer splits into two routed apps — solitaire and table — instead of one route with a behavior-changing checkbox | See "Splitting the efficiency trainer" pattern below; `EfficiencyPage.tsx` full read shows exactly what `showTable`/`options.opponents` branches to peel apart                                                                                                                                                 |
| REQ-02 | Boards shared as explicit, validated walls; seeds keep backing random generation and tests                                    | See "Wall format and `createMatch` reshape" — full read of `createMatch`'s current dealing loop and `Pinned` interface, plus the exact two `match.test.ts` unit tests that call `createMatch` directly and must change                                                                                         |
| REQ-03 | Turn-stepping and per-turn analysis centralized in `core/table.ts` + `useTableRound`                                          | See "The three duplicated implementations" — verbatim line-cited comparison of `seenBy`, snapshot bodies, and replay logic across `match.ts`/`useEfficiencyRound.ts`/`useFoldingRound.ts`                                                                                                                      |
| REQ-07 | Folding migrates onto `core/table.ts`'s pure stepper via its own thin hook                                                    | See "Folding's control-flow divergence" — full read of `playToRiichi`/`buildRound`/`advanceAfterDiscard` shows exactly which primitives are shared vs. folding-owned                                                                                                                                           |
| REQ-04 | Table settings unify under global + per-app override schema; `sanma`/`aka` stay global                                        | See "Settings schema today" — full read of `settingsStore.ts`, confirms which fields are top-level globals today (`showOpponentHands`, `hideConcealedHands`, `showWall`) vs. per-section (`efficiency.deadWall`, `folding.threats`, `folding.opponentWins`) and the section-wise `merge` that must be extended |
| REQ-05 | Statistical lab loads/authors a wall, plays own discards, shows full ukeire/danger/score with no grading                      | See "Statistical lab data sources" — `evaluateDiscards`/`assessDiscards` signatures confirmed, both already computed and discarded by existing trainers                                                                                                                                                        |
| REQ-06 | Folding's threat-hand reveal hard-gated on hand end                                                                           | See "The reveal-gate bug" — exact line in `FoldingPage.tsx` where `showOpponentHands` alone currently controls the reveal, with no `finished` check                                                                                                                                                            |

</phase_requirements>

## Summary

This phase has no new external dependencies — it is a pure internal architecture refactor of an
already-mapped codebase (React 19.2, Zustand 5, react-router 7, i18next, Vite/Vitest — all
`[VERIFIED: package.json]`, already in use, no version changes needed). All research below is
sourced from direct reads of the files this phase touches, not from external documentation.

The core finding, confirmed by reading all three implementations side by side: `useEfficiencyRound.ts`
and `useFoldingRound.ts` independently reimplement (1) a `seenBy`-equivalent visibility computation,
(2) a "run every seat back around to you" opponent go-round loop (`runOpponents` /
inline loop in `advanceAfterDiscard`), (3) a discard-replay fast-forward for shared links, (4) a
`logReplay` StrictMode-dedup pattern keyed on decoded-object identity, and (5) a snapshot builder
that mirrors `MatchState` into render-ready arrays. `match.ts` itself has a fourth `seenBy`
(`match.ts:278-282`, module-private, used by AI seats). `core/table.ts` needs to absorb the
snapshot/replay/seenBy pieces (shared shape) while leaving discard-choice grading (efficiency's
ukeire delta, folding's danger tier, scoring's nothing) to each consumer, per the callback
contract's `stats` payload.

The wall-sharing change (`createMatch` seed+pinned → explicit wall) is the single riskiest piece:
it inverts the current relationship between "wall prefix" and "starting hand" (today a `Pinned.wall`
prefix is _drawn after_ the deal; the new format's leading segment _is_ the deal) and forces
`createMatch`'s dealing loop to be rewritten from "loop `take()` per seat off a shuffled pool" to
"slice an explicit array by seat segments." Two existing `match.test.ts` unit tests call
`createMatch` directly with a seed string and will need rewriting to the new wall-taking signature
— this is not covered by D-09's "none of those need to change" (that clause covers only the
seed-taking `playMatch`/`findMatch`-based tests, not the two `describe('createMatch', ...)` tests
that call `createMatch` itself).

**Primary recommendation:** Sequence the plan exactly as ROADMAP.md's plan list already suggests
(wall→table.ts→useTableRound→split pages→settings→lab→folding-migration), because each step's tests
depend on the previous step's shape being stable — `core/table.ts` cannot be written against a
`createMatch` signature that hasn't landed yet, and `useTableRound` cannot be written against a
`core/table.ts` stepper that hasn't landed yet.

## Architectural Responsibility Map

| Capability                                                             | Primary Tier                                                | Secondary Tier                                                                        | Rationale                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wall construction/validation (explicit wall, prefix completion)        | Engine (`core/wall.ts` + new codec)                         | —                                                                                     | Pure data transform, no UI or React involvement — must stay deterministic and testable in isolation                                                                                                                  |
| Match dealing/turn-stepping (`createMatch`, `beginTurn`, `finishTurn`) | Engine (`core/match.ts`)                                    | —                                                                                     | Already the sole authority; only `createMatch`'s wall-sourcing changes shape                                                                                                                                         |
| Turn-stepper/go-round loop/snapshot/`seenBy`/replay fast-forward       | Engine (new `core/table.ts`)                                | —                                                                                     | Pure, reusable across 3+ consumers; D-04 explicitly locks this at the engine tier, not the hook tier                                                                                                                 |
| Per-turn analysis (ukeire ranking, danger tiers)                       | Engine (`core/efficiency.ts`, `core/danger.ts`)             | `core/table.ts` (memoized getter wrapper)                                             | Computation is already pure/engine-tier; `core/table.ts` only adds lazy-getter plumbing so unused analysis isn't computed                                                                                            |
| Round state ownership, callback firing, replay suppression             | React hook tier (`useTableRound`, folding's thin hook)      | —                                                                                     | `useRef` mutable core + `useState` snapshot mirror is the established hook pattern (`CLAUDE.md` Trainer pattern section) — must stay React, not engine, since it owns commit-time effects (StrictMode dedup, timers) |
| Board rendering (seats, rivers, melds, centre panel)                   | Presentational component (`<Table>`)                        | —                                                                                     | Already zero-game-logic per `Table.tsx:19-21`; explicitly unchanged this phase                                                                                                                                       |
| Solo layout (hand/river/nuki/wall chips, no `<Table>`)                 | Page component (new solo `EfficiencyPage`)                  | React hook tier (likely `useTableRound` per D-05's "solo never reads danger" framing) | D-03 locks the visual shape; D-05 implies solo still consumes the same hook/getter contract as table apps, just renders differently and never reads the danger getter                                                |
| Settings resolution (global + per-app override)                        | React hook/component tier (a `resolveTableSettings` helper) | Zustand store (`settingsStore.ts`)                                                    | Storage stays flat key/value per Zustand convention; resolution (`{...defaultsForApp, ...global, ...appOverride}`) is a pure function callable from any page, not baked into the store itself                        |
| URL wall/situation codec                                               | Engine-adjacent pure module (new or extended `urlCodec.ts`) | —                                                                                     | Must stay React-free like the existing codec — it is called from `useSearchParams` at the page boundary only                                                                                                         |
| Statistical lab data surfacing                                         | Page component + thin hook                                  | Engine (`evaluateDiscards`, `assessDiscards` — reused directly)                       | No new computation; the lab is a rendering surface over engine outputs already computed elsewhere and thrown away                                                                                                    |

## Standard Stack

No new external packages are introduced by this phase. Everything needed already ships in
`package.json` `[VERIFIED: package.json]`:

### Core (already in use, no version change)

| Library                 | Version (installed)                               | Purpose               | Why Standard (for this repo)                                                                                                    |
| ----------------------- | ------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| react / react-dom       | ^19.2.8                                           | UI runtime            | Already the app's framework; hooks (`useRef`+`useState` mirror pattern) are the established trainer pattern                     |
| react-router            | ^7.18.2                                           | Routing               | New routes (solo efficiency, lab) are added to the existing `createBrowserRouter` array (`src/routes/index.tsx`)                |
| zustand                 | ^5.0.14                                           | Settings + log stores | `settingsStore.ts`'s `persist` middleware and hand-written section-wise `merge` is the established pattern for schema evolution |
| i18next / react-i18next | ^26.3.6 / ^17.0.11                                | i18n                  | New routes need `trainer.<name>.*` keys in all four locale JSON files, same as every existing trainer                           |
| vitest                  | (devDependency, config in `vite.config.ts:33-37`) | Test runner           | `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.ts'` — unchanged                                        |

### Alternatives Considered

None — this is an internal refactor of code the project already owns; no library choice is in play.

**Installation:** None required.

**Version verification:** Not applicable — no packages are added or upgraded this phase.

## Package Legitimacy Audit

Not applicable. This phase introduces zero new npm packages — confirmed by reading every import
statement in the files this phase touches (`match.ts`, `wall.ts`, `useEfficiencyRound.ts`,
`useFoldingRound.ts`, `urlCodec.ts`, `settingsStore.ts`, `Table.tsx`, `tiles.ts`, `danger.ts`,
`efficiency.ts`) — all imports resolve to either React/react-router/zustand/i18next (already
installed) or sibling files under `src/core`/`src/features`/`src/components`. The Package
Legitimacy Gate is skipped per its own trigger condition ("every phase that installs external
packages").

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │              core/wall.ts                   │
                     │  buildWall(seed, sanma) → TileId[]           │
                     │  (kept: random gen fallback + existing tests)│
                     └───────────────┬───────────────────────────────┘
                                     │ fills remainder of a short/partial wall
                                     ▼
     URL query "wall=" ──▶ ┌─────────────────────────────┐
     (untrusted input)     │  new wall codec (validate)   │
                            │  D-12: length/copies/red/    │
                            │  sanma-set checks, reject     │
                            │  with zone+tile named          │
                            └───────────────┬─────────────┘
                                            │ explicit ParsedTile[] wall
                                            ▼
                            ┌─────────────────────────────┐
                            │   core/match.ts#createMatch   │
                            │   (reshaped: wall-taking,      │
                            │   not seed+pinned)              │
                            └───────────────┬─────────────┘
                                            │ MatchState
                                            ▼
                            ┌─────────────────────────────────────┐
                            │           core/table.ts               │
                            │  stepper (beginTurn/finishTurn wrap)   │
                            │  go-round loop, canonical seenBy       │
                            │  snapshot builder, yourDiscards        │
                            │  replay fast-forward                    │
                            │  memoized analysis getters              │
                            │  (evaluateDiscards / assessDiscards)    │
                            └──────┬───────────────┬─────────┬──────┘
                                   │               │         │
                    ┌──────────────▼───┐  ┌────────▼──────┐ │
                    │  useTableRound()   │  │ folding's own │ │
                    │  onUserDraw         │  │ thin hook      │ │
                    │  onUserDiscard      │  │ (drives        │ │
                    │  onAgariCall        │  │ primitives      │ │
                    │  (React hook)       │  │ directly +      │ │
                    └───┬───────┬────┬────┘  │ own riichi-     │ │
                        │       │    │        │ target search + │ │
              ┌─────────▼─┐ ┌───▼──┐ ┌▼─────┐ │ mid-hand policy │ │
              │ Solo       │ │Table │ │ Lab  │ │ flip)           │ │
              │ efficiency │ │effic.│ │      │ └─────────────────┘ │
              │ (no        │ │(+    │ │(load/│                     │
              │ <Table>)   │ │<Table│ │author│                     │
              │            │ │>)    │ │ wall,│                     │
              │            │ │      │ │ full │                     │
              │            │ │      │ │ranked│                     │
              │            │ │      │ │view) │                     │
              └────────────┘ └──────┘ └──────┘                     │
                                                        ┌───────────▼──────┐
                                                        │  Scoring          │
                                                        │  (subscribes to   │
                                                        │  onAgariCall via  │
                                                        │  its own          │
                                                        │  findMatchAsync-  │
                                                        │  shaped loop;     │
                                                        │  <Table> render   │
                                                        │  unchanged)       │
                                                        └───────────────────┘
```

A reader tracing "shared link opens the identical board in another trainer" (success criterion 2)
follows: URL `wall=` param → validation → `createMatch` → whichever consumer's snapshot/getters
render it. A reader tracing "folding's mid-hand policy flip" follows the right-hand branch only —
it never touches `useTableRound`.

### Recommended Project Structure

```
src/
├── core/
│   ├── match.ts          # reshaped createMatch (wall-taking); beginTurn/finishTurn unchanged
│   ├── wall.ts            # buildWall unchanged, kept for random gen + tests
│   ├── table.ts            # NEW: pure stepper, seenBy, snapshot, replay, memoized getters
│   └── table.test.ts       # NEW: unit tests for the above (see Validation Architecture)
├── features/
│   ├── efficiency/          # becomes the TABLE app (opponents always on)
│   │   ├── EfficiencyPage.tsx
│   │   └── useTableRound.ts  # OR this lives at src/features/table/useTableRound.ts if shared
│   ├── efficiency-solo/       # NEW (naming: Claude's discretion) — no <Table>
│   │   └── EfficiencySoloPage.tsx
│   ├── folding/
│   │   └── useFoldingRound.ts # rewritten onto core/table.ts primitives directly
│   ├── lab/                    # NEW (naming: Claude's discretion) — statistical lab
│   │   └── LabPage.tsx
│   ├── table/                   # NEW (if useTableRound is shared across efficiency+lab, it
│   │   └── useTableRound.ts     #  likely lives in its own feature dir rather than "efficiency")
│   ├── settings/
│   │   └── settingsStore.ts      # `table` section added; merge extended
│   └── situation/
│       ├── urlCodec.ts             # `opponents` removed from FLAGS/Situation
│       └── wallCodec.ts (or similar) # NEW: explicit-wall param + validation (D-12)
```

Note: whether `useTableRound` lives under `features/efficiency/` or a new `features/table/`
shared by efficiency-table and the lab is not settled by CONTEXT.md — flagged in Open Questions.

### Pattern 1: The three duplicated implementations `core/table.ts` must absorb

**What:** `seenBy` (visibility = hand + face-up), the opponent go-round loop, and the snapshot
builder are each implemented three times today.

`match.ts`'s own private `seenBy` (used only by the AI, module-private, not exported):

```typescript
// Source: src/core/match.ts:278-282
function seenBy(state: MatchState, player: PlayerState): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (let i = 0; i < NUM_TILE_TYPES; i++) seen[i] = state.visible[i] + player.hand.counts[i]
  return seen
}
```

`useEfficiencyRound.ts`'s equivalent, inlined into `rankDiscards` (`useEfficiencyRound.ts:120-127`):

```typescript
// Source: src/features/efficiency/useEfficiencyRound.ts:120-127
function rankDiscards(core: RoundCore, sanma: boolean) {
  const player = you(core)
  const seen = new Uint8Array(NUM_TILE_TYPES)
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = player.hand.counts[i] + core.match.visible[i]
  }
  return { seen, ranked: evaluateDiscards(player.hand, seen, sanma) }
}
```

`useFoldingRound.ts`'s equivalent, with an extra clamp `match.ts` doesn't have
(`useFoldingRound.ts:202-209`):

```typescript
// Source: src/features/folding/useFoldingRound.ts:201-209
function seenBy(core: RoundCore): Uint8Array {
  const seen = new Uint8Array(NUM_TILE_TYPES)
  const counts = core.match.players[core.seatIndex].hand.counts
  for (let i = 0; i < NUM_TILE_TYPES; i++) {
    seen[i] = Math.min(TILES_PER_KIND, core.match.visible[i] + counts[i])
  }
  return seen
}
```

**When to use canonical version:** Any consumer needing "what this seat can see" — the folding
variant's `Math.min(TILES_PER_KIND, …)` clamp is arguably a bug-fix the canonical version should
adopt (visibility can't exceed 4 copies of a kind), worth flagging to the planner as a
behavior-preserving-or-fixing choice, not silently dropped.

**Opponent go-round loop**, near-identical in both hooks:

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
  if (!match.ended && match.liveWall.length > 0) {
    beginTurn(match, options)
  }
}
```

Folding's version has no "opponents off" branch (folding always has opponents — they're the
threats) and always draws the player's next tile inline; efficiency's version separates
"run opponents" from "advance after discard" (the latter also checks tenpai-stop). `core/table.ts`'s
stepper should expose the go-round loop as one primitive that both call, with each hook layering
its own stop condition (tenpai for efficiency, "did the hand end" for folding) on top.

**`logReplay` StrictMode-dedup pattern**, identical shape in both hooks — this is a _hook-tier_
pattern (not engine-tier), so it stays in each consumer, but should be recognized as the same
pattern rather than independently reinvented for the lab:

```typescript
// Source: src/features/efficiency/useEfficiencyRound.ts:320-323 (shape mirrored in useFoldingRound.ts:477-479)
function logReplay() {
  const r = core.current
  if (!r || loggedReplay.current === situation) return
  loggedReplay.current = situation
  // ... play() over each replayed discard
}
```

### Pattern 2: `createMatch`'s current dealing loop (must be rewritten for explicit walls)

**What it does today** — deals sequentially per seat off a shuffled pool, unshifts a pinned prefix
_after_ the deal so it names what's drawn next (not what's dealt):

```typescript
// Source: src/core/match.ts:243-254
for (const player of state.players) {
  while (tileCount(player.hand) < INITIAL_HAND_SIZE && state.liveWall.length > 0) {
    take(state, player)
  }
}
// the pinned prefix goes in front only now: it names what gets *drawn* next, so the deal must
// come out of the seeded pool first or a pinned wall would end up in somebody's starting hand
if (pinned?.wall.length) state.liveWall.unshift(...pinned.wall)
state.liveWallSnapshot = [...state.liveWall]
```

**What the new format requires** (D-10): the wall's _leading_ `players * 13` tiles ARE the
starting hands, in seat order — the inverse of today's relationship between "wall" and "hand".
`createMatch`'s new signature needs to slice the explicit wall directly:
`wall.slice(0, 13)` → seat 0's hand, `wall.slice(13, 26)` → seat 1's hand, … , then everything up
to `wall.length - 14` is the live-draw wall, then the last 14 are the dead wall (dora indicator
first per D-10). Short/partial walls (D-11) need the remainder filled from
`buildWall(String(Math.random()), sanma)` with already-used copies removed — this is the same
"used tiles filtered from the pool" logic `createMatch` already has for `pinned`
(`match.ts:171-184`), just generalized to cover the whole wall rather than a hand+prefix pair.

### Pattern 3: Folding's control-flow divergence (why D-08 keeps it off `useTableRound`)

Folding's `playToRiichi` (`useFoldingRound.ts:158-199`) drives `beginTurn`/`finishTurn` in a raw
loop with a **turn-boundary stop condition evaluated between the two calls**, not after — checking
`riichiSeats(match).length < threats` right after `finishTurn` returns, then mutating
`player.policy` on every non-declaring seat before continuing. This is structurally different from
`playMatch`'s `stop` callback, which only fires per _event_ (draw/discard/riichi/call/win),
_after_ the whole turn (both `beginTurn` and `finishTurn`) has completed — too coarse for a
flip that must land before the next `beginTurn`. `core/table.ts`'s exported primitives (not
wrapped in `useTableRound`'s 3-callback React contract) are what folding's thin hook composes
directly, matching D-08 exactly.

### Anti-Patterns to Avoid

- **Growing `useTableRound`'s callback contract to also serve folding:** D-08 explicitly forbids
  this — a 4th "generic event" callback would be built for one consumer and immediately violate
  the "nobody pays for what they don't read" principle (D-05) since every other consumer would
  receive events it doesn't need.
- **Silently repairing an invalid shared wall:** D-12 requires rejecting with a named zone+tile,
  never coercing an over-count or wrong-ruleset wall into something playable — a repaired wall is
  a different board than the one the link claimed to share.
- **Recomputing `onUserDiscard`'s stats post-throw:** D-05 explicitly requires the stats attached
  to the callback be the ranking captured _at draw time_, before the tile leaves the hand — a
  post-throw recomputation is measuring a different (already-13-tile) hand.
- **Bumping the settings-store `merge`'s per-section list without bumping `persist`'s `version`:**
  `settingsStore.ts:195-196` already documents "pre-v2 schemas are dropped, not migrated" — since
  keys are being _removed_ (`efficiency.opponents`) and _moved_ (`folding.threats` → `table`), the
  existing merge (`settingsStore.ts:200-210`) would otherwise leave a stale `efficiency.opponents`
  boolean sitting in `localStorage` forever, unread by anything, doing nothing but confusing a
  future reader of devtools. See Runtime State Inventory below.

## Don't Hand-Roll

| Problem                                              | Don't Build                                                 | Use Instead                                                                                                                                                       | Why                                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ukeire/shanten ranking for the lab's discard view    | A second ranking function for "show everything" mode        | `evaluateDiscards` (`core/efficiency.ts:17`) — same function every trainer already calls                                                                          | It already ranks every discard, shanten-then-ukeire; the lab just renders the whole list instead of a `[0]`/comparison, no new engine code                  |
| Danger tiers for the lab's threat view               | A second danger function for "no threats declared yet" mode | `assessDiscards` (`core/danger.ts:122`), already total over an empty threat list via `NO_THREAT` (`danger.ts:118-120`)                                            | `assessDiscards` is documented as never assuming a riichi is out — the lab can pass whatever `threatViews(match)` (`match.ts:289`) returns, including empty |
| Wall RNG for random generation and prefix-completion | A new shuffle/seed scheme                                   | `mulberry32` + `shuffle` via `buildWall(seed, sanma)` (`rng.ts`, `wall.ts:11-18`)                                                                                 | D-09 explicitly keeps `buildWall` for this; census/fuzz tests already prove its distribution is fair per-kind                                               |
| Settings inheritance resolution                      | A three-state (inherit/on/off) UI control per field         | Plain object spread `{ ...defaultsForApp, ...global, ...appOverride }` (D-13)                                                                                     | Absent key already means "inherit" with plain JS spread semantics — a tri-state UI is solving a problem spread already solves                               |
| Detecting "hand worth drilling" logic in the lab     | New heuristics                                              | None needed — the lab has no grading, so `worthwhile()` (`useFoldingRound.ts:220-235`, folding-specific) does not apply; the lab accepts whatever wall it's given | The lab explicitly has no grading (D-15); a "worth showing" filter would contradict its purpose (analysis surface, not a drill)                             |

**Key insight:** Every piece of analysis the lab needs to show is already computed somewhere in the
codebase and thrown away after rendering one or two rows of it (`DiscardFeedback.tsx`,
`FoldFeedback.tsx`). The lab is a rendering problem, not a computation problem.

## Runtime State Inventory

Triggered because this phase renames/removes/moves persisted settings keys.

| Category            | Items Found                                                                                                                                                                                                                                                                                                                                                                                                                         | Action Required                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored data         | `localStorage` key `'riichi-trainer-settings'` (Zustand `persist`, `settingsStore.ts:194`), currently `version: 2` (`settingsStore.ts:196`), holds `efficiency.opponents`, `efficiency.deadWall`, `folding.threats`, `folding.opponentWins`, top-level `showOpponentHands`/`hideConcealedHands`/`showWall` — all of which move or are removed this phase `[VERIFIED: src/features/settings/settingsStore.ts:194-196, quoted above]` | Code edit: bump `version` (e.g. to `3`) so an old persisted blob is dropped rather than merged — the existing comment `// pre-v2 schemas are dropped, not migrated: those installs fall back to defaults` (`settingsStore.ts:195`) documents this is the established pattern for exactly this situation. No data migration needed (Deferred Ideas explicitly excludes back-compat for `efficiency.opponents`) |
| Live service config | None — static SPA, no backend, no external service config                                                                                                                                                                                                                                                                                                                                                                           | None                                                                                                                                                                                                                                                                                                                                                                                                          |
| OS-registered state | None — browser-only PWA, no OS-level task/service registration                                                                                                                                                                                                                                                                                                                                                                      | None                                                                                                                                                                                                                                                                                                                                                                                                          |
| Secrets/env vars    | None found; only `GITHUB_SHA`/`process.env.GITHUB_SHA` in `vite.config.ts:10` for the build footer, unrelated to this phase                                                                                                                                                                                                                                                                                                         | None                                                                                                                                                                                                                                                                                                                                                                                                          |
| Build artifacts     | None — no compiled/installed artifact caches the old settings shape; `settingsStore.ts`'s `merge` function is itself the only place old-shape data is read, and it is being edited directly this phase                                                                                                                                                                                                                              | None beyond the `merge` edit itself                                                                                                                                                                                                                                                                                                                                                                           |

**The canonical question, answered:** after every source file is updated, the only runtime state
still holding the old shape is each user's browser `localStorage` blob — handled entirely by the
existing `persist` `version` bump mechanism, not by a data migration.

## Common Pitfalls

### Pitfall 1: Treating the wall-format inversion as a drop-in `Pinned` rename

**What goes wrong:** Reusing `Pinned`'s current semantics ("prefix is drawn next") for the new
explicit-wall format silently deals the wrong hands — under the new format the leading segment
_is_ the starting hand, not the next draw.
**Why it happens:** `Pinned.wall`'s doc comment (`match.ts:139`) literally says "consumed by
whoever draws next" — a naive read carries that semantic forward.
**How to avoid:** Rewrite `createMatch`'s dealing loop to slice by seat segment first (see Pattern
2 above), and delete/replace the `Pinned` interface rather than extend it.
**Warning signs:** A test asserting the wall's first 13 tiles land in seat 0's _drawn tiles_
rather than its _starting hand_ — that's the old semantic bleeding through.

### Pitfall 2: `match.test.ts`'s direct `createMatch(...)` calls silently break

**What goes wrong:** The two `describe('createMatch', ...)` tests
(`match.test.ts:176-219` — "seeds exactly one red five…" and "honours a pinned hand and wall
prefix…") call `createMatch(seed, players, options, pinned)` directly with a seed string. Once
`createMatch` takes an explicit wall, these calls have the wrong argument shape and either fail to
compile or (worse, if TypeScript is lenient) silently misbehave at runtime.
**Why it happens:** D-09's "none of those need to change" clause names only the _seed-based_ tests
(shanten fuzz, danger simulation, census) — which go through `playMatch`/`findMatch`, not
`createMatch` directly — leaving these two tests unaddressed by that decision.
**How to avoid:** Explicitly plan to rewrite these two tests (and any other direct `createMatch`
caller — grep confirms `EfficiencyPage`'s round hook and `FoldingPage`'s round hook are the only
other call sites, both already covered by REQ-03/REQ-07) to the new wall-taking signature.
**Warning signs:** `npm test` failing on `match.test.ts` after `createMatch`'s signature changes,
with a type error at the `pinned` argument.

### Pitfall 3: Partial/short walls can't infer sanma from length (D-12 ambiguity)

**What goes wrong:** D-12 says "wall length implies the ruleset (108 = sanma)" — but that only
resolves for a _full_ wall. A short/partial wall (D-11) of, say, 20 tiles is a valid prefix under
either ruleset, and inferring `sanma` from its length alone is not possible.
**Why it happens:** D-12's wording covers the full-wall case explicitly; the partial case is not
addressed by any locked decision.
**How to avoid:** Flagged in Open Questions below — the planner needs to either (a) require an
explicit `sanma` param alongside a partial wall, falling back to the global setting, or (b) only
apply length-based inference when the wall reaches its ruleset's exact full length, otherwise fall
back to the global/situation `sanma` flag.
**Warning signs:** A short shared wall containing a 2m/8m tile (invalid under sanma) being silently
accepted because the yonma inference path was taken by default.

### Pitfall 4: StrictMode double-invocation breaking `logReplay`'s dedup when ported to `core/table.ts`

**What goes wrong:** `logReplay`'s dedup pattern (`useEfficiencyRound.ts:320-323`,
`useFoldingRound.ts:477-479`) keys on **object identity** of the decoded situation/link, not on a
string. If any part of this pattern moves into `core/table.ts` (a non-React module) without
preserving that identity-keyed dedup at the React-effect boundary, StrictMode's double-invoke (or
four-times-under-StrictMode-per-CLAUDE.md) will double- or quadruple-log replayed discards.
**Why it happens:** `core/table.ts` is meant to be pure and React-free (D-04) — the dedup ref
(`loggedReplay = useRef(...)`) is inherently a React concern and must stay in each hook, not move
into the pure module, even though the _loop that builds the replayed events_ can move.
**How to avoid:** Keep the `useRef`-based StrictMode dedup guard in `useTableRound` and folding's
thin hook; only the underlying replay-loop mechanics (fast-forwarding tiles/events through
`beginTurn`/`finishTurn` given a discard list) move into `core/table.ts`.
**Warning signs:** Duplicate `log.replay` rows in the action log panel after a page reload in dev
mode (StrictMode is on by default in dev).

### Pitfall 5: The folding reveal-gate fix (D-14/REQ-06) needs both the hand-pass AND the concealed-flag checked

**What goes wrong:** `FoldingPage.tsx`'s current seat-mapping
(`FoldingPage.tsx:160-164` — the `hand: seat !== round.seatIndex && (showOpponentHands ||
!hideConcealedHands) ? round.hands[seat] : undefined` line) passes a threat's live concealed hand
to `<Table>` on every render while the hand is in progress whenever `showOpponentHands` is on —
`<Table>`'s own `concealed` flag only controls face-up vs. face-down rendering, it does not
withhold the hand data itself. Gating only the `concealed` flag on `round.finished` (rendering
tile backs but still passing real tile IDs into the DOM) is not a real fix — tile IDs would still
be present in the rendered markup/component props, inspectable via devtools.
**Why it happens:** The two concerns (whether to pass hand data at all, vs. whether to draw it
face-up) are currently conflated into one boolean gate that only handles the second.
**How to avoid:** Gate the `hand` prop itself (not just `concealed`) on `round.finished` for any
threat seat — `hand: seat !== round.seatIndex && round.finished && (showOpponentHands ||
!hideConcealedHands) ? round.hands[seat] : undefined`.
**Warning signs:** Reveal data visible in React DevTools' component tree mid-hand even though the
rendered tile faces look correct (face-down).

### Pitfall 6: `evaluateDiscards`'s cost model applies to the lab's "show everything" view too

**What goes wrong:** `evaluateDiscards` costs "~475x faster than the reference search" per suit
but is still real work — the CLAUDE.md-documented cost is ~476 shanten probes per turn
(`efficiency.ts:38-41` comment on `bestDiscards`). If the lab recomputes this on every keystroke of
a hand-authoring UI (rather than on wall-load/discard-commit), it will visibly lag.
**Why it happens:** The lab is explicitly meant to show the _full_ ranking (D-15), which is more
expensive than the graded trainers' "compare against `ranked[0]`" pattern.
**How to avoid:** Memoize on the current hand+visible-tiles snapshot, not on every UI interaction;
D-05's "memoized getters, not eagerly computed" principle for `useTableRound` applies equally here.
**Warning signs:** Input lag while authoring a wall tile-by-tile in the lab's editor.

## Code Examples

### Current `MatchOptions`/`createMatch` shape the reshape must preserve elsewhere

```typescript
// Source: src/core/match.ts:38-55 — every field except wall-sourcing (Pinned) stays as-is
export interface MatchOptions {
  sanma: boolean
  aka: boolean
  round: TileId
  deadWall: boolean
  calls: boolean
  riichi: boolean
  wins: boolean
  human?: number
}
```

### Current `Settings` interface fields relevant to the D-13 unification

```typescript
// Source: src/features/settings/settingsStore.ts:11-66 (relevant excerpts)
efficiency: {
  // ...
  opponents: boolean // REMOVED entirely per D-01
  deadWall: boolean // MOVES into `table` schema per D-13
}
folding: {
  // ...
  threats: number // MOVES into `table` schema
  opponentWins: boolean // MOVES into `table` schema
  showEquallySafe: boolean // folding-only, stays
  feedbackAtEnd: boolean // folding-only, stays
}
```

And, top-level in `SettingsState` (not inside any section today):

```typescript
// Source: src/features/settings/settingsStore.ts:103-117
showWall: boolean // MOVES into `table` schema per D-13
showOpponentHands: boolean // MOVES into `table` schema per D-13
hideConcealedHands: boolean // MOVES into `table` schema per D-13
```

### Current section-wise `merge` pattern to extend

```typescript
// Source: src/features/settings/settingsStore.ts:200-210
merge: (persisted, current) => {
  const p = (persisted ?? {}) as Partial<SettingsState>
  return {
    ...current,
    ...p,
    efficiency: { ...current.efficiency, ...p.efficiency },
    shanten: { ...current.shanten, ...p.shanten },
    scoring: { ...current.scoring, ...p.scoring },
    folding: { ...current.folding, ...p.folding },
    // NEW: table: { ...current.table, ...p.table } — and per-app override objects, if those are
    // also stored as their own nested keys rather than folded into each trainer's section
  }
}
```

### Current `FLAGS`/`Situation` shape `opponents` is removed from

```typescript
// Source: src/features/situation/urlCodec.ts:26 and :17-24
const FLAGS = ['opponents', 'deadWall', 'aka', 'sanma'] as const
// Situation.opponents?: boolean  — removed per D-01
```

### `SafetyTier` enum (verbatim — feeds the lab's danger view and any UI mapping table)

```typescript
// Source: src/core/danger.ts:19-35
export type SafetyTier =
  'genbutsu' | 'noChance' | 'oneChance' | 'doubleSuji' | 'suji' | 'honour' | 'halfSuji' | 'nonSuji'
```

### Wall/tile-count constants relevant to the wall codec's validation math

```typescript
// Source: src/core/wall.ts:5-7
export const TILES_PER_KIND = 4
export const DEAD_WALL_SIZE = 14
export const INITIAL_HAND_SIZE = 13
```

```typescript
// Source: src/core/tiles.ts:1
export const NUM_TILE_TYPES = 34
```

Full wall length = `players * INITIAL_HAND_SIZE + liveDraws + DEAD_WALL_SIZE`; a full yonma wall
is 136 tiles (`NUM_TILE_TYPES * TILES_PER_KIND`), a full sanma wall is 108 (27 kinds * 4, per
`inTileSet`'s 2m-8m exclusion, `tiles.ts:61-63`).

## State of the Art

| Old Approach                                                                                                           | Current Approach                                                                   | When Changed                  | Impact                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed + optional `Pinned{seat,hand,wall}` partial override, drawn-next semantics                                        | Explicit flat wall in draw order, dealt-hands-first semantics                      | This phase (REQ-02/D-09–D-12) | `createMatch`'s dealing loop and the `Pinned` type are rewritten, not extended; two `match.test.ts` unit tests must be rewritten                                |
| One `useEfficiencyRound` hook branching on `options.opponents`                                                         | Two hooks (solo, table) sharing `core/table.ts` primitives, opponents-flag removed | This phase (REQ-01/D-01)      | `EfficiencyPage.tsx`'s `showTable`/branching logic (`EfficiencyPage.tsx:55-70` etc.) splits across two page components                                          |
| `seenBy`/snapshot/replay/`logReplay` independently implemented per trainer                                             | Centralized in `core/table.ts` (engine tier) + shared React dedup pattern per hook | This phase (REQ-03/D-04)      | Net line reduction; single source of truth for the AI-vs-player visibility computation, unifying `match.ts`'s private `seenBy` with the hooks' public ones      |
| `showOpponentHands`/`hideConcealedHands`/`showWall` top-level; `deadWall`/`threats`/`opponentWins` per-trainer-section | Single `table` global + per-app `Partial<TableSettings>` override                  | This phase (REQ-04/D-13)      | `settingsStore.ts`'s `persist` version must bump; every page reading these six settings switches from `useSettings((s) => s.xxx)` to a resolved-settings helper |

**Deprecated/outdated (as of this phase):**

- `Pinned` interface (`match.ts:135-141`) — superseded by the explicit wall format; likely deleted
  outright rather than kept for compatibility (pre-release, no back-compat commitment).
- `efficiency.opponents` / `Situation.opponents` — removed, not deprecated-with-fallback, per
  Deferred Ideas explicitly declining migration.

## Assumptions Log

| #   | Claim                                                                                                                                                                    | Section                                                           | Risk if Wrong                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Solo efficiency's page/hook builds on `useTableRound` (rather than calling `core/table.ts` primitives directly like folding does)                                        | Architectural Responsibility Map, "Recommended Project Structure" | If wrong, solo needs its own thin hook mirroring folding's pattern instead — a smaller but still real restructuring difference for the planner to decide explicitly rather than infer. Based on D-05's phrasing ("solo never reads danger" — grouped with the getter-consumer framing, not with folding's separate-hook framing) and the domain summary's "useTableRound (efficiency's two apps, the lab)" wording, but neither is a locked decision naming solo explicitly |
| A2  | A short/partial shared wall falls back to the global/situation `sanma` flag rather than being rejected outright when its length doesn't reach either ruleset's full size | Common Pitfalls #3, Open Questions                                | If the planner instead requires an explicit `sanma` param on every partial-wall link, the wall codec's parameter surface grows by one field beyond what D-10/D-12 describe                                                                                                                                                                                                                                                                                                  |
| A3  | `useTableRound` and the folding thin hook are separate files/modules, not one file exporting two hooks                                                                   | Recommended Project Structure                                     | Low risk — purely a file-organization guess; either shape satisfies D-04/D-08                                                                                                                                                                                                                                                                                                                                                                                               |
| A4  | `settingsStore.ts`'s `persist` `version` should be bumped to drop old persisted state, rather than hand-writing a migration that strips the removed keys                 | Runtime State Inventory                                           | Low risk — the existing code comment (`settingsStore.ts:195`) already documents version-bump-drops-old-schema as the established pattern for schema changes in this repo; a hand migration would be new, unprecedented complexity for a pre-release app that explicitly declined back-compat                                                                                                                                                                                |

## Open Questions

1. **Where does the new wall-sharing codec live — a rewritten `urlCodec.ts`, or a new adjacent module?**
   - What we know: CONTEXT.md's own Code Context section flags this explicitly ("the wall-sharing
     format (D-10/D-11) likely lives in a new or adjacent codec rather than this one, since
     `Situation.wall` today means something different"). `urlCodec.ts`'s `Situation.wall` today is
     a _prefix consumed on next draw_ (`urlCodec.ts:9-11`), not the new full/partial explicit wall.
   - What's unclear: whether `Situation` itself is restructured (wall + river + rule-override
     flags all still needed for a mid-hand replay link) or whether a wholly separate `wall=`
     parameter/module is introduced alongside a slimmed `Situation`.
   - Recommendation: the planner should decide this explicitly as a plan-level architecture call,
     since it affects every page that currently imports `decodeSituation`/`encodeSituation`
     (`EfficiencyPage.tsx`, and presumably the new solo/table/lab pages).

2. **How does a short/partial shared wall (D-11) signal its ruleset, since length-based inference (D-12) only resolves for a full wall?**
   - What we know: D-12 says "wall length implies the ruleset (108 = sanma); a loaded wall's
     length wins over the global `sanma` setting for table apps" — but only names the full-length
     case (108 vs. 136).
   - What's unclear: whether a partial wall carries an explicit `sanma` flag (mirroring
     `Situation.sanma` today, `urlCodec.ts:23`) that the codec falls back to, or whether partial
     walls are validated against whichever ruleset (sanma or yonma) they're consistent with,
     erroring if ambiguous or invalid under both.
   - Recommendation: retain an explicit `sanma` override parameter for wall links generally (not
     just partial ones) — it costs one query param and removes the ambiguity outright, consistent
     with the existing `Situation.sanma` override pattern this phase is otherwise replacing.

3. **Does the `deadWall: false` setting still make sense against a wall format that positionally reserves its last 14 tiles as dead wall?**
   - What we know: D-10's format unconditionally treats "the last 14 tiles" as the dead wall
     (dora indicator first). `MatchOptions.deadWall` (`match.ts:44`) is still a live toggle in
     `Settings['efficiency']` today and moves into the `table` schema per D-13, implying it stays
     a toggle.
   - What's unclear: when `deadWall` is off for a wall-backed table app, do those positional last-14
     tiles fold into the live wall (available to be drawn) instead of being reserved, or does the
     wall format assume `deadWall` is always effectively on for anything sharing a wall link?
   - Recommendation: preserve today's behavior — `createMatch`'s `options.deadWall` flag continues
     to gate whether the trailing 14 tiles are reserved as dead wall vs. folded into the live draw
     pool, independent of whether the wall came from a link or from `buildWall`. This matches
     `createMatch`'s current code structure (`match.ts:199-213`, `if (options.deadWall) { ... }`)
     and requires no format change — just confirm this reading with the user if the planner's
     first draft surfaces ambiguity.

4. **`showWall`'s `advanced`-setting gate — does it survive the move into the `table` schema?**
   - What we know: `showWall` is currently read through `useAdvancedSettings()`
     (`useAdvancedSettings.ts:17,23`), which zeroes it out unless `advanced` is on — a UI-layer
     gate, not a stored-value gate. `showOpponentHands`/`hideConcealedHands` are explicitly _not_
     advanced-gated per that file's own doc comment (`useAdvancedSettings.ts:9-11`).
   - What's unclear: D-13 doesn't mention the `advanced` gate at all when describing the `table`
     schema's fields — it's silent on whether `showWall`'s special gating survives the move.
   - Recommendation: preserve `showWall`'s `advanced`-gating exactly as today (resolve the
     `table.showWall` value, then apply the same `advanced && showWall` gate at read sites) —
     nothing in CONTEXT.md suggests this behavior should change, and it's cheap to keep.

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies beyond what's already
installed and verified working (Node 26 per `.nvmrc`, npm scripts per `package.json`). No new
CLI, database, or service dependency is introduced.

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Vitest (`^4.1.10`-family devDependency; exact version not directly relevant — config only) `[VERIFIED: package.json + vite.config.ts:33-37]` |
| Config file        | `vite.config.ts:33-37` — `{ environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' }`                                        |
| Quick run command  | `npx vitest run src/core/table.test.ts` (or any single new/changed test file)                                                                |
| Full suite command | `npm test` (= `vitest run`)                                                                                                                  |

### Phase Requirements → Test Map

| Req ID        | Behavior                                                                                                                                                                | Test Type                                                                                                            | Automated Command                                                                                                                 | File Exists?                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| REQ-02        | `createMatch` deals starting hands from the wall's leading segment, reserves last 14 as dead wall, validates untrusted wall input                                       | unit                                                                                                                 | `npx vitest run src/core/match.test.ts` (existing `describe('createMatch', …)` block rewritten) + new wall-codec validation tests | ✅ existing file, rewrite needed / ❌ new codec test file, Wave 0 |
| REQ-02        | Census invariant (every tile kind exactly 4/4 copies, sanma 0 for 2m-8m) still holds under wall-taking `createMatch`                                                    | unit                                                                                                                 | `npx vitest run src/core/match.test.ts -t census` (existing `census()` helper, `match.test.ts:32-52`)                             | ✅ existing                                                       |
| REQ-03        | `core/table.ts`'s stepper/`seenBy`/snapshot/replay match the three implementations' current behavior                                                                    | unit                                                                                                                 | `npx vitest run src/core/table.test.ts`                                                                                           | ❌ Wave 0                                                         |
| REQ-03/REQ-07 | `useTableRound`'s callbacks fire correctly (draw before discard-decision, discard after throw with pre-throw stats, agari on any seat) and are suppressed during replay | unit (hook test, `@testing-library/react` present as devDependency)                                                  | `npx vitest run src/features/table/useTableRound.test.ts` (or wherever it lands)                                                  | ❌ Wave 0                                                         |
| REQ-01        | Two efficiency routes render distinctly (solo has no `<Table>`, table does)                                                                                             | existing pattern: `useEfficiencyRound.test.ts`/`useFoldingRound.test.ts` show the hook-level test style already used | unit                                                                                                                              | New/rewritten hook test files per split                           | ❌ Wave 0 for the solo hook; rewrite for table hook |
| REQ-04        | Settings `merge` correctly resolves `{ ...defaultsForApp, ...global, ...appOverride }` and survives a version bump (old shape dropped, not merged)                      | unit                                                                                                                 | New test in or near `settingsStore.ts` (no existing `settingsStore.test.ts` found — confirm during planning)                      | ❌ Wave 0                                                         |
| REQ-06        | Folding never passes threat hand data before `round.finished`, under every combination of `showOpponentHands`/`hideConcealedHands`                                      | unit/component                                                                                                       | Existing `useFoldingRound.test.ts` extended with a case asserting `hand` is `undefined` for a threat seat before `finished`       | ✅ existing file, extend                                          |
| REQ-05        | Lab surfaces full `evaluateDiscards`/`assessDiscards` output for a loaded/authored wall with no grading                                                                 | unit/component                                                                                                       | New test file for the lab's hook/page                                                                                             | ❌ Wave 0                                                         |

### Sampling Rate

- **Per task commit:** `npx vitest run <changed-file>.test.ts`
- **Per wave merge:** `npm test` (full suite, including `match.test.ts`'s census/pinned-wall
  invariants and `danger.test.ts`'s 150-match 15s-timeout simulation — both must stay green
  through the `createMatch` reshape)
- **Phase gate:** `npm test`, `npm run lint`, `npm run build` all green before `/gsd-verify-work`
  (mirrors ROADMAP.md's Success Criterion 5 verbatim)

### Wave 0 Gaps

- [ ] `src/core/table.test.ts` — covers REQ-03 (stepper/seenBy/snapshot/replay parity with the
      three current implementations)
- [ ] A new wall-codec test file — covers REQ-02's D-12 validation rules (length bounds, copy
      counts, red-per-suit, sanma tile-set exclusion, and the "reject naming zone+tile" error shape)
- [ ] A `useTableRound` hook test file — covers REQ-03/REQ-01's callback-firing and
      replay-suppression behavior (D-05/D-06)
- [ ] A settings-schema test (new or added to an existing settings test, none currently found under
      `src/features/settings/`) — covers REQ-04's resolution order and version-bump behavior
- [ ] A lab hook/page test file — covers REQ-05
- [ ] Framework install: none — Vitest/`@testing-library/react`/jsdom are already devDependencies

## Security Domain

This is a client-side-only static SPA (GitHub Pages deploy, no backend, no auth, no persisted
server-side data) — most ASVS categories do not apply. The one relevant category is input
validation of the untrusted `wall=` URL parameter.

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication     | No      | No auth in this app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V3 Session Management | No      | No sessions/cookies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V4 Access Control     | No      | No authorization boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| V5 Input Validation   | Yes     | D-12's explicit wall-validation rules (length bounds, ≤4 copies per kind, exactly 4 when full, ≤1 red per suit, no 2m-8m under sanma) — reject-with-named-error, never silently repair, per the untrusted-input handling this project already follows for `parseTenhou` (`tiles.ts:73-101`, malformed input silently dropped rather than crashing — a comparable "never throw on bad input, never trust it either" posture the wall codec should match, adapted to _reject_ rather than _drop_ since a wall is positionally meaningful) |
| V6 Cryptography       | No      | No cryptographic operations anywhere in this app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Known Threat Patterns for this stack

| Pattern                                                                                                                                                                                                                                    | STRIDE                                                                  | Standard Mitigation                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maliciously crafted `wall=` param causing out-of-bounds array access or an inconsistent `MatchState` (e.g. more than 4 copies of a kind, causing downstream `shanten`/`ukeire` computations to behave on impossible data)                  | Tampering                                                               | D-12's validate-before-`createMatch` gate — reject at the codec boundary, never let an invalid wall reach `createMatch`'s dealing logic            |
| A crafted wall claiming sanma while containing 2m-8m tiles (or vice versa), causing `inTileSet`-dependent logic (`ukeire`/`evaluateDiscards`/`assessDiscards`, all of which take a `sanma` flag) to disagree with the actual wall contents | Tampering                                                               | D-12's explicit "no 2m-8m under sanma" check, validated against the _wall's own inferred/declared ruleset_, not the reader's local `sanma` setting |
| Denial of service via a pathological wall causing `evaluateDiscards`'s ~476-probe-per-turn cost to spike unboundedly (e.g. an extremely long partial-wall completion loop)                                                                 | Tampering/DoS (client-side only, self-inflicted — no server to protect) | Bound wall length validation strictly (D-12's "length within bounds") before any engine computation runs                                           |

## Sources

### Primary (HIGH confidence — direct source reads this session, file:line cited throughout)

- `src/core/match.ts` (full read) — `createMatch`, `beginTurn`, `finishTurn`, `playMatch`,
  `findMatch`/`findMatchAsync`, `threatViews`, `seenBy`, `Pinned`, `MatchOptions`, `MatchState`
- `src/core/wall.ts` (full read) — `buildWall`, `deal`, `TILES_PER_KIND`/`DEAD_WALL_SIZE`/`INITIAL_HAND_SIZE`
- `src/core/hand.ts` (full read) — `Hand`, `createHand`, `addTile`/`removeTile`, `tileCount`
- `src/core/tiles.ts` (full read) — `TileId`, `ParsedTile`, `RiverTile`, `NUM_TILE_TYPES`, `inTileSet`, `parseTenhou`/`serializeTenhou*`
- `src/core/efficiency.ts` (full read) — `DiscardOption`, `evaluateDiscards`, `bestDiscards`, `evaluateKan`, `isBestDiscard`
- `src/core/danger.ts` (partial read, lines 1-135) — `SafetyTier`, `ThreatView`, `TileDanger`, `TIER_SCORE`, `assessDiscards` signature
- `src/features/efficiency/useEfficiencyRound.ts` (full read) — every duplication cited in this document
- `src/features/folding/useFoldingRound.ts` (full read) — every duplication and divergence cited
- `src/features/efficiency/EfficiencyPage.tsx` (full read) — solo-layout branching (D-03's target)
- `src/features/folding/FoldingPage.tsx` (full read) — reveal-gate bug (D-14/REQ-06)
- `src/features/scoring/ScoringPage.tsx` (partial read, lines 1-60, 260-320) — `<Table>` usage this phase leaves unchanged
- `src/features/settings/settingsStore.ts` (full read) — `Settings` interface, `merge`, `persist` version
- `src/features/situation/urlCodec.ts` (full read) — `Situation`, `FLAGS`, `encodeSituation`/`decodeSituation`
- `src/features/situation/useUrlData.ts` (full read) — memoization-per-navigation pattern
- `src/features/settings/useAdvancedSettings.ts` (full read) — `showWall`'s advanced-gate
- `src/components/tiles/Table.tsx` (full read) — `SeatView`, `Table`, confirmed zero game logic
- `src/routes/index.tsx`, `src/routes/HomePage.tsx` (full read) — route table and `MODES` array, new-route integration points
- `src/features/i18n/trainerLinks.ts` (full read) — `TRAINER_WIKI` map, new-route integration point
- `src/store/log.ts`, `src/lib/useSessionStats.ts` (full read) — shared session/log patterns
- `vite.config.ts` (full read) — test config, no new tooling needed
- `package.json` (partial read) — confirmed dependency set, no external packages needed
- `src/core/match.test.ts` (partial read, lines 1-60, 176-225) — exact tests that call `createMatch` directly and must change

### Secondary (MEDIUM confidence)

- None — no external documentation was consulted; this phase is entirely internal-codebase research

### Tertiary (LOW confidence)

- None

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages, confirmed via direct `package.json`/import reads
- Architecture: HIGH — every claim traces to a specific file:line read this session; the four
  genuinely unresolved points are called out explicitly in Open Questions rather than guessed at
- Pitfalls: HIGH — each pitfall is grounded in a specific, quoted current-code excerpt, not a
  generic refactor-risk list

**Research date:** 2026-08-12
**Valid until:** Until the codebase changes underneath this research (no external time-based decay
applies — this is a snapshot of the repo's own current state, valid as long as no other phase
lands first)
