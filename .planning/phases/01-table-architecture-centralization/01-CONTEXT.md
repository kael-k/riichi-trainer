# Phase 1: Table architecture centralization - Context

**Gathered:** 2026-08-12 (grilling session — see conversation; no live discuss-phase run)
**Status:** Ready for planning

<domain>
## Phase Boundary

Split the efficiency trainer's single opponents-toggle route into two honest routed apps
(solitaire, table). Pull the turn-stepping and per-turn analysis currently duplicated across
`useEfficiencyRound.ts` and `useFoldingRound.ts` into a pure `core/table.ts` module, reused by
three separate React consumers: `useTableRound` (efficiency's two apps, the lab) and folding's own
thin hook (turn-granularity control the shared hook's callback contract doesn't offer). Move board
sharing from seeds to explicit, validated walls. Unify table-related settings under one schema
with a global default and a per-app override. Ship the statistical lab as a fourth table app.

Scoring is explicitly not restructured — it already renders `<Table>` presentationally and keeps
that shape (see Out of Scope in PROJECT.md).

</domain>

<decisions>
## Implementation Decisions

### Split depth & routing
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

### Shared layer shape
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
  instead of `playMatch` — `playMatch`'s `stop` fires per event only *after* the whole turn has
  run, too late for the flip. `useTableRound`'s `onUserDraw`/`onUserDiscard`/`onAgariCall`
  contract is shaped around efficiency/scoring/lab's needs and stays exactly those three — it does
  not grow a generic event escape hatch for this one consumer. Folding gets a thin, folding-owned
  React hook that calls `core/table.ts`'s exported stepper/snapshot/`seenBy`/replay-fast-forward
  primitives directly, alongside its own board-generation-with-riichi-predicate loop (same
  capped-attempts, randomwall-until-accept shape as D-07's scoring loop) and its own mid-hand
  policy mutation between step calls. This removes the duplication without forcing folding's
  genuinely different control flow through a contract built for someone else.

### Wall sharing
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

### Settings
- **D-13:** Table settings — `opponentWins`, `deadWall`, `threats`, `showOpponentHands`,
  `hideConcealedHands`, `showWall` — move to one shared schema: a global `table` section plus a
  per-app `Partial<TableSettings>` override, resolved as
  `{ ...defaultsForApp, ...global, ...appOverride }` (absent key = inherit, no three-state UI).
  `sanma` and `aka` stay top-level globals — shanten needs them too and they aren't table-specific.
- **D-14:** Folding's threat-hand reveal is hard-gated on `round.finished` — no setting or override
  may show a threat's hand before the hand is over. `FoldingPage.tsx:160-164` today has no such
  gate (only `showOpponentHands` controls it), which already lets the global setting defeat the
  drill's own stated rule. This is a live bug fix riding the settings move, not a new feature.

### Statistical lab
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

</decisions>

<specifics>
## Specific Ideas

- User resolved the dora-in-solo tension explicitly: "dora is needed to compute the correct
  ukeire, i don't get the point" — clarified that dora does not enter ukeire/shanten math at all;
  the dead wall/indicator stays for realism regardless, and the grader being ukeire-only (so a kept
  dora can mark a discard "wrong") is accepted as-is, worth one intro line in the trainer.
- Callback names are the user's own, not a placeholder to be renamed: `onUserDraw`, `onUserDiscard`,
  `onAgariCall`.
- "it's a beta project" — repeated twice (sequencing question, back-compat question) as the
  rationale for not spending effort on migration paths or old-link support.

</specifics>

<canonical_refs>
## Canonical References

No external specs/ADRs exist for this project yet. `CLAUDE.md` at the repo root is the canonical
architecture reference — read it before planning; do not duplicate its content into plans.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `core/match.ts` — `createMatch`, `beginTurn`, `finishTurn`, `playMatch`, `findMatch`/
  `findMatchAsync`, `threatViews`, `concealedTiles`, `wallDrawnCount`: the engine API this phase
  builds on. Only `createMatch`'s wall-sourcing changes shape (seed+pinned → explicit wall);
  everything else keeps its signature.
- `core/wall.ts` — `buildWall(seed, sanma)`: kept for random generation and all existing seeded
  tests; not removed.
- `core/efficiency.ts` / `core/ukeire.ts` — `evaluateDiscards`, `isBestDiscard`, `ukeire`,
  `improvingTiles`: what `onUserDiscard`'s stats and the lab's ukeire view reuse directly, no new
  computation needed.
- `core/danger.ts` — `assessDiscards`, `ThreatView`, `TileDanger`: what folding and the lab's
  danger view reuse; `threatViews()` (`match.ts:289`) builds the `ThreatView[]` input.
- `components/tiles/Table.tsx` — `SeatView`, `Table`: stays untouched. Already documents "the
  table itself doesn't gate on any setting; the caller decides" for `showOpponentHands`/
  `hideConcealedHands` (`:19-21`).
- `features/settings/settingsStore.ts` — `Settings` interface, the hand-written per-section
  `merge` (`:200-210`): the new `table` section (and its per-app override fields) MUST be added to
  this `merge` or old persisted state silently wipes it on load.
- `features/situation/urlCodec.ts` — `Situation`, `FLAGS`: `opponents` is deleted from `FLAGS`
  here; the wall-sharing format (D-10/D-11) likely lives in a new or adjacent codec rather than
  this one, since `Situation.wall` today means something different (a prefix, not the whole wall).

- `features/folding/useFoldingRound.ts` — what the folding migration (D-08) has to preserve
  exactly: `findRound` (async, searches `seed`, `seed#1`… for a hand worth drilling — becomes a
  random-wall loop under D-09/D-11), `handedOverAt` (turn offset before control passes to the
  player, seeded separately), the mid-hand `policy: 'defense'` flip on every seat that hasn't
  itself declared once the riichi target is reached, and `feedbackAtEnd` (buffers grading/log rows
  until the hand ends rather than emitting per-turn — a folding-level concern, not the stepper's).

### Established Patterns
- Trainer pattern: page component + `use*Round` hook, session state via `lib/useSessionStats.ts`,
  action log via `store/log.ts`, settings via a per-trainer section of the Zustand store. New
  trainers (solo efficiency, lab) should follow this even where they don't use `useTableRound`.
- Log rows are written imperatively from user actions, never from `useEffect`s watching round
  state — effect-based logging inverts order and duplicates under StrictMode. The one exception is
  `logReplay`, which dedupes on the decoded link object's identity.

### Integration Points
- New routes touch four places every time: `src/routes/index.tsx` (route table),
  `src/routes/HomePage.tsx` (`MODES` array), `src/features/i18n/trainerLinks.ts` (`TRAINER_WIKI`),
  and all four locale JSON files (`en`/`ja`/`zh`/`it`) for `trainer.<name>.*` strings. Both the new
  solo app and the new lab app need all four.

</code_context>

<deferred>
## Deferred Ideas

- Any EV, push-fold, or deal-in-rate modeling — would need a new simulation harness; explicitly out
  of scope for this milestone (PROJECT.md Out of Scope).
- Migrating or redirecting old `?opponents=` links, or the persisted `efficiency.opponents`
  setting key — explicitly not maintaining back-compat this milestone (pre-release).

</deferred>

---
*Phase: 01-table-architecture-centralization*
*Context gathered: 2026-08-12*
