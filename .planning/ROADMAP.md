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
**Plans**: TBD — see `.planning/phases/01-table-architecture-centralization/01-CONTEXT.md` for the
  locked decisions this phase's plans must respect; not yet decomposed by `/gsd-plan-phase`

Plans:
- [ ] 01-01: TBD — explicit, validated walls in `core/match.ts` (drop seeds as the shared record)
- [ ] 01-02: TBD — pure `core/table.ts` turn-stepper + per-turn analysis, absorbing the audited duplication
- [ ] 01-03: TBD — `useTableRound` React hook (`onUserDraw`/`onUserDiscard`/`onAgariCall`)
- [ ] 01-04: TBD — split the efficiency trainer into solitaire + table apps on top of the hook
- [ ] 01-05: TBD — table settings schema (global + per-app override) and the folding reveal hard-gate
- [ ] 01-06: TBD — statistical lab trainer
- [ ] 01-07: TBD — migrate folding's round hook onto `core/table.ts`'s pure stepper (own thin hook,
  not `useTableRound`)

## Progress

**Execution Order:**
Phase 1 only.

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 1. Table architecture centralization | 0/7 (TBD) | Not planned | - |
