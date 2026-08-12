# riichi-trainer

## What This Is

A web-based riichi mahjong trainer: a small set of focused drills (shanten, hand efficiency,
scoring, defensive folding) built on a deterministic, pure-TypeScript match engine. Situations are
shareable as URLs so a specific decision point can be sent to another player. Mobile-first PWA,
deployed to GitHub Pages.

## Core Value

Every drill is graded against the same deterministic engine a human could hand-verify — no invented
numbers. Danger and efficiency are measured, never guessed (`core/danger.ts`, `core/efficiency.ts`).

## Requirements

### Validated

<!-- Shipped and in use today, per CLAUDE.md and git history. -->

- ✓ Shanten trainer — solitaire, `wall.ts#deal`, continuous stream of hands
- ✓ Efficiency trainer — opponents toggle currently controls one route's behavior (being split, see Active)
- ✓ Scoring trainer — hand entry against `scoreHand`, table display via `<Table>`
- ✓ Folding trainer — ordinal danger model (`core/danger.ts`), full betaori grading
- ✓ Situation URL codec — seed + hand + wall prefix + river reproduces a decision point
- ✓ i18n (en/ja/zh/it), glossary popovers, beginner/advanced settings split
- ✓ PWA / GitHub Pages deploy, dark mode, mobile-first layout

### Active

<!-- This milestone: Phase 1, see ROADMAP.md -->

- [ ] REQ-01: Efficiency trainer splits into two routed apps — solitaire (no opponents) and table
      (with opponents) — instead of one route with a behavior-changing checkbox
- [ ] REQ-02: Boards are shared as explicit, validated walls (`createMatch` takes a wall directly);
      seeds stop being the shared/URL record but keep backing random generation and tests
- [ ] REQ-03: Turn-stepping and per-turn analysis are centralized in a pure `core/table.ts` module
      plus a `useTableRound` React hook, absorbing the duplication currently split across
      `useEfficiencyRound.ts` and `useFoldingRound.ts` (see Phase 1 CONTEXT for the audit)
- [ ] REQ-07: Folding is migrated onto `core/table.ts`'s pure stepper too — via its own thin hook,
      not through `useTableRound`'s callback contract (folding's mid-hand policy flip needs
      turn-granularity control `playMatch`/`useTableRound` don't offer; see Phase 1 CONTEXT D-08)
- [ ] REQ-04: Table settings (`opponentWins`, `deadWall`, `threats`, `showOpponentHands`,
      `hideConcealedHands`, `showWall`) move to one shared schema with a global default and a
      per-app override; `sanma`/`aka` stay global settings
- [ ] REQ-05: A standalone "statistical lab" trainer loads or authors a wall, plays your own
      discards, and shows full ukeire/danger/score analysis with no grading
- [ ] REQ-06: Folding's threat-hand reveal is hard-gated on hand end — no setting combination may
      show a threat's hand before the hand is over

### Out of Scope

- Expected-value / push-fold modeling, deal-in probabilities — no simulation harness exists to
  back real numbers, and `danger.ts` is deliberately ordinal by design; inventing a number here is
  worse than not showing one
- Backward compatibility for old seed-based `opponents=` links or the persisted `efficiency.opponents`
  setting — project is pre-release, explicitly not maintaining old-link compatibility this milestone
- Scoring trainer restructuring — it already renders `<Table>` presentationally and generates a
  frozen result via `findMatchAsync`; no shape change needed for this milestone

## Context

Full architecture is documented in `CLAUDE.md` at the repo root — read it before planning or
implementing; it is the canonical source, not duplicated here. Key facts that shaped Phase 1:

- Three layers: pure engine (`src/core/`, zero deps, no React), URL situation codec
  (`src/features/situation/urlCodec.ts`), React trainers built on both.
- `core/match.ts` (`createMatch`/`beginTurn`/`finishTurn`/`playMatch`/`findMatch`) is the one
  deterministic match engine every trainer drives differently — stop conditions are the only thing
  that differs between them.
- `components/tiles/Table.tsx` already holds zero game logic — purely presentational, driven by
  `SeatView[]` props. Nothing about Phase 1 needs to change it.
- A three-Explore-agent audit this session found ten distinct duplications between
  `useEfficiencyRound.ts` and `useFoldingRound.ts` (identical drawn-tile extraction, snapshot
  bodies, `seenBy` in three different implementations, opponent go-round loops, replay fast-forward,
  `logReplay`, render-time reset blocks) — this is the concrete motivation for REQ-03.

## Constraints

- **Tech stack**: React + TypeScript, Vite, Zustand (persisted settings store with a hand-written
  section-wise merge), Tailwind 4, Vitest, oxlint, Node 26 — see `CLAUDE.md` Commands section
- **Determinism**: `mulberry32`-seeded RNG must keep backing `buildWall` for tests even after seeds
  stop being the shared/URL record (REQ-02) — the census test (`match.test.ts`, every tile kind
  accounted for exactly four times) and the 3000-hand shanten-equivalence fuzz depend on it
- **Performance**: a full match is ~17ms today (`standardShanten` ~475x faster than the reference
  search); new wall-construction and table-stepping code must not regress this — `danger.test.ts`
  already runs 150 seeded matches under a 15s timeout, which is the ceiling to watch
- **No backward compatibility**: pre-release, explicit decision this milestone — do not spend
  effort migrating old links or persisted keys

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Two routes, two pages, two hooks for the efficiency split | UI discoverability — a checkbox silently changing app behavior is the bug being fixed; forking the hook was rejected as duplicating 600 shared lines to avoid 25 opponent-conditional ones | — Pending |
| Solo is genuinely one seat (`createMatch(wall, 1, …)`), dead wall + dora kept | `createMatch` already deals sequentially per seat and slices the dead wall off the pool tail independent of player count — true solo needed no new dealing path | — Pending |
| Three layers: pure `core/table.ts` → React `useTableRound()` → presentational `<Table>` (unchanged) | Scoring never re-touches its match after generation and has no user discard — a stateful `<Table>` would break it; `<Table>` already documents "the caller decides" | — Pending |
| Callbacks: `onUserDraw`, `onUserDiscard` (carries pre-computed ukeire/danger stats), `onAgariCall` | Grading needs pre-throw state; a post-apply callback would require every trainer to remember to snapshot first — exactly the bug class being removed | — Pending |
| Scoring subscribes to `onAgariCall`; engine loops random-wall matches until it fires when no wall is given | Matches scoring's existing `findMatchAsync`-until-win shape; generation (via random walls, not seed suffixes) survives dropping seeds as the shared record | — Pending |
| Statistical lab is a standalone route + home card, not a panel bolted onto existing trainers | A panel would collide with folding's own hard rule against pre-answer danger markers and early threat-hand reveal | — Pending |
| EV/probabilities explicitly out of scope | No simulation harness exists; `danger.ts` is deliberately ordinal — see Out of Scope | — Pending |
| Table settings: global `table` section + per-app override, absent key = inherit | Avoids a three-state (inherit/on/off) UI and a resolver users have to debug; `sanma`/`aka` stay global because shanten needs them too | — Pending |
| Seeds dropped as the stored/shared record; `buildWall(seed)` kept for random generation and tests | Sharing an arbitrary hand-authored wall needs the wall as data; `findMatch`'s rejection-sampler shape survives unchanged with random walls as the candidate source | — Pending |
| Wall share format: single flat draw-order string, dead wall = last 14 tiles | User's explicit choice over a zone-named alternative; positional boundaries are the accepted tradeoff — validation must name the offending zone/tile on rejection | — Pending |
| Folding's threat-hand reveal hard-gated on `round.finished` | `FoldingPage.tsx:160-164` currently has no such gate — the global `showOpponentHands` setting can defeat the drill's own stated rule today; this is a bug fix riding the settings move, not a new feature | — Pending |
| Folding is migrated onto `core/table.ts`'s pure stepper via its own thin hook, not `useTableRound` | Folding's mid-hand riichi-target policy flip runs at turn granularity between `beginTurn`/`finishTurn`, which is exactly why it doesn't use `playMatch` today (`playMatch`'s `stop` only fires after a whole turn completes) — forcing it through `useTableRound`'s 3-callback contract would mean growing that contract with a generic escape hatch shaped around one consumer | — Pending |
| Solo efficiency keeps today's layout exactly (hand, river, nuki/kan piles, wall/dora chips), no `<Table>` | User wants phone usability and does not consider solo "a table"; `<Table>`'s slot layout is written for 3-4 seats | — Pending |

---
*Last updated: 2026-08-12 after Phase 1 scaffolding (onboarding-equivalent, no mapper agents run — context sourced from this session's codebase audit)*
