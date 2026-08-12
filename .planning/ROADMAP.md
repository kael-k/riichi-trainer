# Roadmap: riichi-trainer

## Overview

Phase 1 turns the efficiency trainer's opponents checkbox into two honest routes, pulls the turn-
stepping and per-turn analysis that's currently duplicated between the efficiency and folding round
hooks into a shared pure module and React hook, moves board sharing from seeds to explicit
validated walls, unifies table settings under one schema, and ships a standalone statistical lab on
top of the same shared layer.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Table architecture centralization** - Split the efficiency trainer, centralize the
  table layer, move to shareable walls, unify table settings, ship the statistical lab

## Phase Details

### Phase 1: Table architecture centralization

**Goal**: Split the efficiency trainer into solitaire (no opponents) and table (with opponents)
routed apps; centralize turn-stepping and per-turn analysis behind a pure `core/table.ts` and a
`useTableRound` React hook; move board sharing from seeds to explicit, validated walls; unify table
settings under a global-default-plus-per-app-override schema; ship a standalone statistical lab.

**Depends on**: Nothing (first phase)
**Requirements**: REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06, REQ-07
**Success Criteria** (what must be TRUE):

  1. The home page lists two solitaire apps (efficiency solo, shanten) and four table apps
     (efficiency, folding, scoring, statistical lab), each its own route — no setting silently
     changes which app a route is

  2. A wall built or edited in the statistical lab opens as the identical board in the table
     efficiency trainer via a shared link

  3. Turning on every "show hands"/reveal setting during a folding drill never shows a threat's hand
     before the hand is over

  4. Folding's round hook is built on `core/table.ts`'s stepper, with none of the duplicated
     `seenBy`/snapshot/replay-fast-forward logic the pre-Phase-1 audit found

  5. `npm test` (including the tile-census and shanten-equivalence invariants), `npm run lint`, and
     `npm run build` all pass
**Plans**: 4/7 plans executed, in 6 execution waves — see
  `.planning/phases/01-table-architecture-centralization/01-CONTEXT.md` for the locked decisions
  they respect

Plans:

- [x] 01-01-PLAN.md — explicit, validated walls: `createMatch` takes a `ParsedTile[]` wall, seeds
  drop as the shared record, an invalid `wall=` is rejected by zone and tile (wave 1, REQ-02)

- [x] 01-02-PLAN.md — pure `core/table.ts`: one `seenBy`, one go-round, one snapshot, one replay,
  per-turn analysis as lazy getters (wave 2, REQ-03)

- [x] 01-03-PLAN.md — `useTableRound` (`onUserDraw`/`onUserDiscard`/`onAgariCall`) and scoring
  moved onto that entry point and onto wall-backed links (wave 3, REQ-03)

- [x] 01-04-PLAN.md — folding's own thin hook rebuilt on `core/table.ts`'s stepper, wall-backed
  links, and the threat-reveal hard-gate (wave 3, REQ-07 + REQ-06)

- [ ] 01-05-PLAN.md — split the efficiency trainer into solitaire and table routes; `opponents`
  deleted from settings, codec and round options (wave 4, REQ-01)

- [ ] 01-06-PLAN.md — table settings schema: global default plus per-app override, behind a
  persist version bump (wave 5, REQ-04)

- [ ] 01-07-PLAN.md — statistical lab: load or author a wall, full ukeire ranking and full danger
  tier list, nothing graded (wave 6, REQ-05)

## Progress

**Execution Order:**
Phase 1 only. Its seven plans run in six waves, near-serial by necessity — each layer's tests need
the layer below it to have settled: walls (1) → `core/table.ts` (2) → `useTableRound` + folding's
own hook, in parallel (3) → the efficiency split (4) → table settings (5) → the statistical lab (6).

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 1. Table architecture centralization | 4/7 | In Progress|  |
