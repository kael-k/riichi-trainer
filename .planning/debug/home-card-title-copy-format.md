---
status: resolved
trigger: "UAT feedback (phase 01-table-architecture-centralization, test 2) asked for a small copy tweak to the two efficiency trainer cards on the home page. Locate exact current strings and confirm exactly what needs to change and where (all four locale files)."
created: 2026-08-13T00:00:00Z
updated: 2026-08-13T13:15:00Z
resolved_by: en/it/ja/zh.json trainer.efficiency*.title dash-suffix edits; commit bac6198
---

## Current Focus

hypothesis: N/A — this is a scoped copy-location task, not a behavioral bug. Root cause is "where do the strings live," not "why is something broken."
test: grep all four locale files for `trainer.efficiency.title` / `trainer.efficiencySolo.title`, then grep the whole src tree for any other place the literal English strings or these translation keys are consumed.
expecting: exactly 8 title strings (2 keys x 4 locales) to update, no other literal-string dependents.
next_action: none — diagnosis complete, hand off to plan/fix.

## Symptoms

expected: Home page card titles for the two efficiency trainers read `Efficiency trainer - solo` (solitaire route, `/efficiency-solo`) and `Efficiency trainer - with opponents` (table route, `/efficiency`), replacing the current parenthetical/bare forms.
actual: `trainer.efficiencySolo.title` = "Efficiency trainer (solo)" and `trainer.efficiency.title` = "Efficiency trainer" (English locale); ja/zh/it carry their own translated equivalents (see Evidence).
errors: None — copy/wording request, not a runtime error. UAT gap G-01-2, severity minor.
reproduction: Open home page, look at Solitaire section card 1 ("Efficiency trainer (solo)") and Table section card 1 ("Efficiency trainer").
started: Reported during UAT for phase 01-table-architecture-centralization, test 2, 2026-08-13.

## Eliminated

(none — no hypotheses needed testing; this was a straight locate-and-confirm task)

## Evidence

- timestamp: 2026-08-13T00:00:00Z
  checked: src/routes/HomePage.tsx
  found: `SOLITAIRE_MODES[0].titleKey = 'trainer.efficiencySolo.title'` (route `/efficiency-solo`), `TABLE_MODES[0].titleKey = 'trainer.efficiency.title'` (route `/efficiency`). Both rendered via `t(mode.titleKey)` in `ModeCard`, used both as visible card heading text and as the `aria-label` on the card's stretched `<Link>`.
  implication: only the locale JSON values need to change — no hardcoded strings in HomePage.tsx itself, and no separate aria-label string to update (it derives from the same `t()` call).

- timestamp: 2026-08-13T00:00:00Z
  checked: src/features/i18n/locales/en.json lines 109-119
  found: |
    "trainer": {
      "efficiency": { "title": "Efficiency trainer", ... },
      "efficiencySolo": { "title": "Efficiency trainer (solo)", ... },
      ...
    }
  implication: en.json needs `trainer.efficiency.title` -> "Efficiency trainer - with opponents" and `trainer.efficiencySolo.title` -> "Efficiency trainer - solo".

- timestamp: 2026-08-13T00:00:00Z
  checked: src/features/i18n/locales/ja.json lines 71-78
  found: |
    "efficiency": { "title": "牌効率トレーナー", "desc": "..." },
    "efficiencySolo": { "title": "牌効率トレーナー（ソロ）", "desc": "..." }
  implication: ja.json holds the Japanese equivalents; the "（ソロ）" (parenthetical "solo") and the bare title need the same dash-suffix restructuring, translated appropriately (not just copy-pasted English suffix).

- timestamp: 2026-08-13T00:00:00Z
  checked: src/features/i18n/locales/zh.json lines 71-78
  found: |
    "efficiency": { "title": "牌效率训练", "desc": "..." },
    "efficiencySolo": { "title": "牌效率训练（单人）", "desc": "..." }
  implication: zh.json holds the Simplified Chinese equivalents; same parenthetical pattern to convert.

- timestamp: 2026-08-13T00:00:00Z
  checked: src/features/i18n/locales/it.json lines 110-118
  found: |
    "efficiency": { "title": "Allenamento efficienza", "desc": "...", "intro": "..." },
    "efficiencySolo": { "title": "Allenamento efficienza (solitario)", "desc": "...", "intro": "..." }
  implication: it.json holds the Italian equivalents (note: it.json's efficiency/efficiencySolo blocks also carry `desc`/`intro` fields ja/zh lack — those are untouched, only `title` needs edits).

- timestamp: 2026-08-13T00:00:00Z
  checked: grep -rn "Efficiency trainer" across src/ and README.md
  found: Only two hits inside en.json itself (the title strings being changed) plus one unrelated hit in README.md prose ("Efficiency trainer (`/efficiency`) — 14-tile hand...") describing the feature in general, and one hit in a JSDoc comment in SettingsDialog.tsx (`/** Trainer name, already translated (e.g. "Efficiency trainer"); omitted on the home screen. */`) which is just an illustrative example in a comment, not a literal dependency.
  implication: no other file hardcodes or duplicates the exact title string. README.md's usage is prose describing the trainer generically, not a copy of the home-card title — no obligation to change it for this ticket, though it could optionally be kept in sync.

- timestamp: 2026-08-13T00:00:00Z
  checked: grep -rln "efficiencySolo|trainer.efficiency" across src/**/*.{ts,tsx}
  found: Three consumers of the translation keys: `HomePage.tsx` (card title + aria-label), `EfficiencyPage.tsx:90` (`title={t('trainer.efficiency.title')}` passed to `TrainerLayout`), `EfficiencySoloPage.tsx:72` (`title={t('trainer.efficiencySolo.title')}` passed to `TrainerLayout`).
  implication: the same locale keys also drive the trainer page header (`TrainerLayout`'s `title` prop) — changing the JSON values will also change what's shown at the top of `/efficiency` and `/efficiency-solo` themselves, not just the home-page cards. This is expected/desired (same string, one source of truth) but worth flagging so the fix plan doesn't scope it as "home page only."

- timestamp: 2026-08-13T00:00:00Z
  checked: grep -rn "efficiencySolo|trainer.efficiency" across **/*.test.ts, **/*.test.tsx; searched for playwright/e2e/spec test infra
  found: Only hit is `src/features/settings/tableSettings.test.ts` referencing the string literal `'efficiencySolo'` as a `TableApp` id in an array (`APPS: TableApp[] = ['efficiency', 'efficiencySolo', 'folding', 'scoring', 'lab']`) and `TABLE_DEFAULTS.efficiencySolo.deadWall` — this is the app/route identifier key, unrelated to the `.title` display string. No e2e/playwright test infrastructure exists in this repo. No test asserts the literal title text anywhere.
  implication: no test will break from changing the `.title` values in the four locale JSON files. Nothing else in the codebase derives or depends on the literal current title string.

## Resolution

root_cause: |
  Not a bug — a confirmed, scoped copy-location task. The two home-page card titles (and, by the
  same shared i18n key, the corresponding trainer page headers) are defined purely in the locale
  JSON files, one `title` string per (trainer, locale) pair, with no other hardcoded duplicates
  anywhere in the codebase.

  Exact keys/values to change, all under the `trainer` top-level object in each locale file:

  | Locale | Key | Current value | Needed value (per UAT feedback) |
  |---|---|---|---|
  | en.json:111 | `trainer.efficiency.title` | `"Efficiency trainer"` | `"Efficiency trainer - with opponents"` |
  | en.json:116 | `trainer.efficiencySolo.title` | `"Efficiency trainer (solo)"` | `"Efficiency trainer - solo"` |
  | ja.json:72 | `trainer.efficiency.title` | `"牌効率トレーナー"` | translated equivalent of "- with opponents" suffix |
  | ja.json:76 | `trainer.efficiencySolo.title` | `"牌効率トレーナー（ソロ）"` | translated equivalent of "- solo" suffix (dash form, not parenthetical) |
  | zh.json:72 | `trainer.efficiency.title` | `"牌效率训练"` | translated equivalent of "- with opponents" suffix |
  | zh.json:76 | `trainer.efficiencySolo.title` | `"牌效率训练（单人）"` | translated equivalent of "- solo" suffix (dash form, not parenthetical) |
  | it.json:111 | `trainer.efficiency.title` | `"Allenamento efficienza"` | `"Allenamento efficienza - con avversari"` (or similar "- with opponents" translation) |
  | it.json:116 | `trainer.efficiencySolo.title` | `"Allenamento efficienza (solitario)"` | `"Allenamento efficienza - solitario"` (dash form, not parenthetical) |

fix: (not applied — goal is find_root_cause_only; diagnosis only)
verification: (not applicable — no fix applied in this session)
files_changed: []
