---
status: diagnosed
phase: 01-table-architecture-centralization
source: [01-VERIFICATION.md]
started: 2026-08-13T09:37:13Z
updated: 2026-08-13T10:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Folding reveal setting — visual confirmation
expected: |
  Start a folding drill with every reveal setting (show opponent hands / hide concealed hands /
  show wall) turned on. Threats' seats show face-down backs of the correct tile count and no real
  faces until the hand ends; the reveal panel then shows the real hands.
result: pass

### 2. Home page Solitaire/Table layout
expected: |
  Open the home page and visually confirm the Solitaire heading over two cards (efficiency-solo,
  shanten) and the Table heading over four cards (efficiency, folding, scoring, lab); open
  `/efficiency-solo` and confirm no board renders, open `/efficiency` and confirm the board renders.
result: issue
reported: "lgtm, just small change replace (solo) with `- solo` and the table versio with `- with opponents`"
severity: minor

### 3. Efficiency-solo phone-width layout
expected: |
  On a phone-width viewport, open `/efficiency-solo`. Hand, river and controls fit without a board;
  every interactive control is at least 44px tall.
result: pass

### 4. Global "show opponent hands" — cross-page check
expected: |
  Toggle the global 'show opponent hands' setting on; check the efficiency board, the scoring
  board, and a folding board mid-drill. Efficiency and scoring boards reveal opponents' tiles; the
  folding board still shows only face-down backs until the hand ends.
result: pass

### 5. Settings dialog UI/UX after schema migration
expected: |
  Open the settings panel from the home page and from each trainer. Every row still works; nothing
  asks for a third 'inherit' state; the wall-reveal row appears only when Advanced is on.
result: pass

### 6. Lab invalid wall link — error rendering
expected: |
  In the statistical lab, paste/load a wall string that fails validation (e.g. `wall=11111m`). One
  inline red sentence names the offending zone and tile; the board stays empty; nothing is silently
  loaded.
result: issue
reported: "copy link buttons are broken (at least, by running the project with `npm run dev -- --host` and accessing with LAN ip"
severity: blocker

### 7. Lab phone-width scroll behavior
expected: |
  In the statistical lab, load a full wall on a phone-width viewport. The 30-plus ranking rows
  scroll inside their own height-capped box; the board and hand stay on screen.
result: skipped
reason: "Deferred follow-up: statistical lab is not as I immagined at all, but to me is out of scope. the important is the core (table.ts and Table component), we'll refine statistical lab in next sprint"

### 8. Success Criterion #2 — lab/efficiency shared-link round trip
expected: |
  Copy a wall link out of the table efficiency trainer (`/efficiency`) and open it in the
  statistical lab (`/lab`). The identical board appears in the lab, with the full ranking and full
  danger-tier list for the same hand.
result: issue
reported: "copy button doesn't work,"
severity: major

### 9. Lab dark mode read
expected: |
  Switch the app to dark mode and reload the lab. The error sentence, the two lists, and the board
  all read correctly with no new colour introduced.
result: pass

## Summary

total: 9
passed: 5
issues: 3
pending: 0
skipped: 1
blocked: 0

## Gaps

- gap_id: G-01-2
  truth: "Home page card titles for the two efficiency apps read \"Efficiency trainer\" and \"Efficiency trainer (solo)\""
  status: failed
  reason: "User reported: lgtm, just small change replace (solo) with `- solo` and the table versio with `- with opponents`"
  severity: minor
  test: 2
  root_cause: "Not a bug — pure locale-JSON wording. trainer.efficiency.title / trainer.efficiencySolo.title in all four locale files hold the display text verbatim, consumed by HomePage.tsx (card heading + aria-label) and by EfficiencyPage.tsx / EfficiencySoloPage.tsx (page header via TrainerLayout's title prop). No test or other file duplicates the literal string."
  artifacts:
    - path: "src/features/i18n/locales/en.json"
      issue: "trainer.efficiency.title = \"Efficiency trainer\" -> \"Efficiency trainer - with opponents\"; trainer.efficiencySolo.title = \"Efficiency trainer (solo)\" -> \"Efficiency trainer - solo\""
    - path: "src/features/i18n/locales/ja.json"
      issue: "trainer.efficiency.title / trainer.efficiencySolo.title need translated dash-suffix equivalents (drop parenthetical form)"
    - path: "src/features/i18n/locales/zh.json"
      issue: "trainer.efficiency.title / trainer.efficiencySolo.title need translated dash-suffix equivalents (drop parenthetical form)"
    - path: "src/features/i18n/locales/it.json"
      issue: "trainer.efficiency.title / trainer.efficiencySolo.title need translated dash-suffix equivalents (drop parenthetical form)"
  missing:
    - "Edit 8 title strings (2 keys x 4 locales) to the dash-suffix form, translated meaningfully per language, not transliterated"
  debug_session: .planning/debug/home-card-title-copy-format.md

- gap_id: G-01-6
  truth: "Copy Link button copies the current situation link to the clipboard on any trainer page"
  status: failed
  reason: "User reported: copy link buttons are broken (at least, by running the project with `npm run dev -- --host` and accessing with LAN ip"
  severity: blocker
  test: 6
  root_cause: "CopyLinkButton.tsx and TrainerLayout.tsx's CopyButton both call navigator.clipboard.writeText(...) unconditionally, with no isSecureContext check and no try/catch. The Clipboard API is spec-restricted to secure contexts (HTTPS, or the localhost/127.0.0.1 special case) — npm run dev -- --host serves plain HTTP, so a LAN-IP origin is not a secure context and navigator.clipboard is undefined there. The call throws inside an async handler (unhandled rejection, invisible without devtools open) and the button gives no visual feedback either, since the post-copy state update never runs."
  artifacts:
    - path: "src/components/CopyLinkButton.tsx"
      issue: "Unguarded navigator.clipboard.writeText call (~line 12), no try/catch, no fallback"
    - path: "src/components/TrainerLayout.tsx"
      issue: "CopyButton (~line 129-145) has the identical unguarded pattern — second independent caller of the same broken shape"
  missing:
    - "Shared clipboard helper/hook both components route through: check navigator.clipboard exists / window.isSecureContext, wrap writeText in try/catch"
    - "Fallback path (e.g. document.execCommand('copy') via hidden textarea) or an explicit failure state when the Clipboard API is unavailable, instead of silently doing nothing"
  debug_session: .planning/debug/copy-link-button-broken-lan.md

- gap_id: G-01-8
  truth: "Copy a wall link out of `/efficiency` and open it in `/lab`: the identical board appears in the lab, with the full ranking and full danger-tier list for the same hand"
  status: failed
  reason: "User reported: copy button doesn't work, (same symptom as G-01-6 — likely one root cause, the app's Clipboard-API-based CopyLinkButton, reported broken again here)"
  severity: major
  test: 8
  root_cause: "Same root cause as G-01-6 — CopyLinkButton is shared by every trainer page including /lab; confirmed as one bug, not two, by the same debug investigation."
  artifacts:
    - path: "src/components/CopyLinkButton.tsx"
      issue: "Same unguarded navigator.clipboard.writeText call used by LabPage"
  missing:
    - "Resolved by the same fix as G-01-6 — no separate fix plan needed"
  debug_session: .planning/debug/copy-link-button-broken-lan.md

## Deferred Follow-Ups

- test: 7
  idea: "Statistical lab isn't as envisioned yet — out of scope for this phase; the core (core/table.ts + Table component) is what matters here. Refine the lab's UI/UX in a future sprint."
  deferred_at: 2026-08-13
