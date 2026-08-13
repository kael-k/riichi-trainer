---
status: testing
phase: 01-table-architecture-centralization
source: [01-VERIFICATION.md]
started: 2026-08-13T09:37:13Z
updated: 2026-08-13T09:37:13Z
---

## Current Test

number: 1
name: Folding reveal setting — visual confirmation
expected: |
  Threats' seats show face-down backs of the correct tile count and no real faces until the hand
  ends; the reveal panel then shows the real hands.
awaiting: user response

## Tests

### 1. Folding reveal setting — visual confirmation
expected: |
  Start a folding drill with every reveal setting (show opponent hands / hide concealed hands /
  show wall) turned on. Threats' seats show face-down backs of the correct tile count and no real
  faces until the hand ends; the reveal panel then shows the real hands.
result: [pending]

### 2. Home page Solitaire/Table layout
expected: |
  Open the home page and visually confirm the Solitaire heading over two cards (efficiency-solo,
  shanten) and the Table heading over four cards (efficiency, folding, scoring, lab); open
  `/efficiency-solo` and confirm no board renders, open `/efficiency` and confirm the board renders.
result: [pending]

### 3. Efficiency-solo phone-width layout
expected: |
  On a phone-width viewport, open `/efficiency-solo`. Hand, river and controls fit without a board;
  every interactive control is at least 44px tall.
result: [pending]

### 4. Global "show opponent hands" — cross-page check
expected: |
  Toggle the global 'show opponent hands' setting on; check the efficiency board, the scoring
  board, and a folding board mid-drill. Efficiency and scoring boards reveal opponents' tiles; the
  folding board still shows only face-down backs until the hand ends.
result: [pending]

### 5. Settings dialog UI/UX after schema migration
expected: |
  Open the settings panel from the home page and from each trainer. Every row still works; nothing
  asks for a third 'inherit' state; the wall-reveal row appears only when Advanced is on.
result: [pending]

### 6. Lab invalid wall link — error rendering
expected: |
  In the statistical lab, paste/load a wall string that fails validation (e.g. `wall=11111m`). One
  inline red sentence names the offending zone and tile; the board stays empty; nothing is silently
  loaded.
result: [pending]

### 7. Lab phone-width scroll behavior
expected: |
  In the statistical lab, load a full wall on a phone-width viewport. The 30-plus ranking rows
  scroll inside their own height-capped box; the board and hand stay on screen.
result: [pending]

### 8. Success Criterion #2 — lab/efficiency shared-link round trip
expected: |
  Copy a wall link out of the table efficiency trainer (`/efficiency`) and open it in the
  statistical lab (`/lab`). The identical board appears in the lab, with the full ranking and full
  danger-tier list for the same hand.
result: [pending]

### 9. Lab dark mode read
expected: |
  Switch the app to dark mode and reload the lab. The error sentence, the two lists, and the board
  all read correctly with no new colour introduced.
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0
blocked: 0

## Gaps
