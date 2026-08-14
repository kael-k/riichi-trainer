---
phase: 1
slug: table-architecture-centralization
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| **Framework**          | Vitest (devDependency; config in `vite.config.ts`)                                                    |
| **Config file**        | `vite.config.ts:33-37` — `{ environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' }` |
| **Quick run command**  | `npx vitest run <changed-file>.test.ts`                                                               |
| **Full suite command** | `npm test` (= `vitest run`)                                                                           |
| **Estimated runtime**  | ~15-20 seconds (danger.test.ts alone runs a 150-match simulation under a 15s timeout)                 |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed-file>.test.ts`
- **After every plan wave:** Run `npm test` (full suite — census/pinned-wall invariants in `match.test.ts` and the danger simulation in `danger.test.ts` must stay green through the `createMatch` reshape)
- **Before `/gsd-verify-work`:** `npm test`, `npm run lint`, `npm run build` all green (mirrors ROADMAP.md Success Criterion 5 verbatim)
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement   | Threat Ref | Secure Behavior                                                                                                                                                       | Test Type        | Automated Command                                                                          | File Exists                       | Status |
| -------- | ---- | ---- | ------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ | --------------------------------- | ------ |
| 01-01-xx | 01   | 0    | REQ-02        | —          | Wall-codec validation rejects malformed/untrusted input (length bounds, copy counts, red-per-suit, sanma exclusion)                                                   | unit             | new wall-codec test file                                                                   | ❌ Wave 0                         |
| 01-01-xx | 01   | 1    | REQ-02        | —          | `createMatch` deals starting hands from wall's leading segment, reserves last 14 as dead wall                                                                         | unit             | `npx vitest run src/core/match.test.ts` (existing `createMatch` describe block, rewritten) | ✅ existing, rewrite              |
| 01-01-xx | 01   | 1    | REQ-02        | —          | Census invariant (every tile kind exactly 4 copies, sanma 0 for 2m-8m) holds under wall-taking `createMatch`                                                          | unit             | `npx vitest run src/core/match.test.ts -t census`                                          | ✅ existing                       |
| 01-02-xx | 02   | 0    | REQ-03        | —          | `core/table.ts` stepper/`seenBy`/snapshot/replay match the three prior implementations' behavior                                                                      | unit             | `npx vitest run src/core/table.test.ts`                                                    | ❌ Wave 0                         |
| 01-03-xx | 03   | 0    | REQ-03/REQ-07 | —          | `useTableRound` callbacks fire correctly (draw before discard-decision, discard after throw with pre-throw stats, agari on any seat) and are suppressed during replay | unit (hook test) | `npx vitest run src/features/table/useTableRound.test.ts`                                  | ❌ Wave 0                         |
| 01-04-xx | 04   | 1    | REQ-01        | —          | Two efficiency routes render distinctly (solo has no `<Table>`, table does) — no setting silently changes which app a route is                                        | unit             | new/rewritten hook test files per split                                                    | ❌ Wave 0 (solo), rewrite (table) |
| 01-05-xx | 05   | 0    | REQ-04        | —          | Settings `merge` resolves `{ ...defaultsForApp, ...global, ...appOverride }` and survives a version bump (old shape dropped, not migrated)                            | unit             | new test near `settingsStore.ts`                                                           | ❌ Wave 0                         |
| 01-05-xx | 05   | 1    | REQ-06        | —          | Folding never passes threat hand data before `round.finished`, under every combination of `showOpponentHands`/`hideConcealedHands`                                    | unit/component   | `useFoldingRound.test.ts` extended: `hand` prop asserted `undefined` pre-finish            | ✅ existing, extend               |
| 01-06-xx | 06   | 0    | REQ-05        | —          | Lab surfaces full `evaluateDiscards`/`assessDiscards` output for a loaded/authored wall with no grading                                                               | unit/component   | new test file for lab hook/page                                                            | ❌ Wave 0                         |
| 01-07-xx | 07   | 1    | REQ-03/REQ-07 | —          | Folding's round hook built on `core/table.ts`'s pure stepper, none of the duplicated `seenBy`/snapshot/replay logic remains                                           | unit             | `npx vitest run src/features/folding/useFoldingRound.test.ts`                              | ✅ existing, rewrite              |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — exact Task IDs finalized once `/gsd-planner` decomposes each plan._

---

## Wave 0 Requirements

- [ ] `src/core/table.test.ts` — covers REQ-03 (stepper/seenBy/snapshot/replay parity with the three current implementations)
- [ ] A new wall-codec test file — covers REQ-02's validation rules (length bounds, copy counts, red-per-suit, sanma tile-set exclusion, and the "reject naming zone+tile" error shape)
- [ ] A `useTableRound` hook test file — covers REQ-03/REQ-01's callback-firing and replay-suppression behavior
- [ ] A settings-schema test (new; no existing `settingsStore.test.ts` found under `src/features/settings/` — confirm during planning) — covers REQ-04's resolution order and version-bump behavior
- [ ] A lab hook/page test file — covers REQ-05
- [ ] Framework install: none — Vitest/`@testing-library/react`/jsdom are already devDependencies

---

## Manual-Only Verifications

_All phase behaviors have automated verification per the map above; the mobile-first/touch-target and dark-mode rendering aspects of the new lab UI (CLAUDE.md's UI section) are spot-checked visually during execution but are not blocking gates._

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
