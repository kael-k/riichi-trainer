---
status: resolved
trigger: "copy-link-button-broken-lan: The app's \"Copy Link\" button (CopyLinkButton) does not work when the dev server is run with `npm run dev -- --host` and accessed from a LAN IP instead of localhost. Reported twice in UAT (G-01-6 generic, G-01-8 on /lab page) — likely same root cause."
created: 2026-08-13T00:00:00Z
updated: 2026-08-13T13:15:00Z
resolved_by: src/lib/clipboard.ts (shared copyText() helper with execCommand fallback); commit 6cdc44f
---

## Current Focus

hypothesis: `navigator.clipboard` is `undefined` in a non-secure-context origin (plain HTTP on a
non-localhost host, e.g. a LAN IP), so `navigator.clipboard.writeText(...)` throws synchronously
inside the button's async click handler. No try/catch wraps the call anywhere it's used, so the
throw becomes an unhandled promise rejection: silent to a user without devtools open, and the
`copied` state never flips, so the button gives no feedback either way.
test: confirmed via source read — no isSecureContext guard, no try/catch, no HTTPS dev config
anywhere in the repo. Cross-referenced against MDN spec: Clipboard API is restricted to secure
contexts (HTTPS or localhost); `navigator.clipboard` itself is `undefined` on insecure origins in
Chromium/Firefox.
expecting: confirms both G-01-6 and G-01-8 share this one root cause, since both routes go through
`CopyLinkButton` -> `navigator.clipboard.writeText`.
next_action: none — root cause confirmed, diagnose-only mode, returning diagnosis to caller.

## Symptoms

expected: Clicking "Copy Link" on any trainer page copies the current shareable situation URL to
the clipboard, giving the user some confirmation it copied.
actual: Nothing is copied (or the action silently fails) when the app is accessed over the LAN via
its IP address (e.g. http://192.168.x.x:5173) rather than localhost/127.0.0.1. Reported as
generally broken (G-01-6), and specifically broken again on the /lab page (G-01-8).
errors: None reported by the user (no console access mentioned during UAT).
reproduction: Run `npm run dev -- --host`, open the app from another device (or via the machine's
LAN IP) on the network, navigate to any trainer page (e.g. /efficiency or /lab), click "Copy Link".
started: Present since CopyLinkButton was introduced; surfaced during UAT for phase
01-table-architecture-centralization, 2026-08-13.

## Eliminated

(none — hypothesis confirmed on first pass, no competing hypotheses required elimination)

## Evidence

- timestamp: 2026-08-13T00:00:00Z
  checked: src/components/CopyLinkButton.tsx (full file)
  found: |
    `copy` handler (line 10-15) calls `await navigator.clipboard.writeText(...)` directly, with no
    `isSecureContext` check, no try/catch, and no fallback (e.g. `document.execCommand('copy')` or a
    hidden-textarea select+copy). Used by every trainer page (efficiency, efficiency-solo, folding,
    scoring, lab) per the earlier grep.
  implication: any environment where `navigator.clipboard` is undefined or `writeText` rejects will
    break every one of these callers identically — one shared root cause for G-01-6 and G-01-8.

- timestamp: 2026-08-13T00:00:00Z
  checked: src/components/TrainerLayout.tsx lines 127-145 (CopyButton, used by log-row copy-link and
    copy-hand actions)
  found: identical unguarded pattern — `await navigator.clipboard.writeText(text)` with no
    try/catch, no secure-context check.
  implication: this is a second caller with the exact same defect (not yet reported in UAT, but the
    same class of failure) — confirms the defect is structural (the pattern itself), not a one-off
    typo in a single component. Root-cause fix belongs wherever both callers can share it, not
    patched in `CopyLinkButton` alone.

- timestamp: 2026-08-13T00:00:00Z
  checked: grep for `clipboard`, `isSecureContext` across src/
  found: only the two call sites above use `navigator.clipboard`; no existing guard or fallback
    anywhere in the codebase.
  implication: no prior handling of the insecure-context case exists to have regressed — this has
    been broken on LAN/HTTP since CopyLinkButton (and CopyButton) were written.

- timestamp: 2026-08-13T00:00:00Z
  checked: vite.config.ts, package.json `dev` script
  found: `"dev": "vite"` — plain Vite dev server, no HTTPS plugin (no vite-plugin-mkcert, no
    basicSsl), so `npm run dev -- --host` serves plain HTTP on the LAN IP.
  implication: confirms the reproduction path in the bug report is exactly a non-secure context —
    `http://<lan-ip>:5173` is neither `https:` nor `localhost`/`127.0.0.1`, so
    `window.isSecureContext` is `false` there per the Secure Contexts spec, and per the Clipboard
    API spec (https://w3c.github.io/clipboard-apis/#dom-navigator-clipboard) the `clipboard`
    property itself is only exposed in secure contexts — browsers implement this by leaving
    `navigator.clipboard` as `undefined` off-HTTPS/off-localhost, so the call throws
    `TypeError: Cannot read properties of undefined (reading 'writeText')` before any network or
    permissions-policy concern even applies.

## Resolution

root_cause: |
  `CopyLinkButton` (src/components/CopyLinkButton.tsx) and the log-row `CopyButton`
  (src/components/TrainerLayout.tsx) both call `navigator.clipboard.writeText(...)` unconditionally,
  with no secure-context check and no try/catch/fallback. The Clipboard API is spec-restricted to
  secure contexts (HTTPS, or localhost/127.0.0.1 which browsers special-case as secure). When the
  dev server is started with `npm run dev -- --host` and opened via a LAN IP over plain HTTP, the
  origin is not a secure context, so `navigator.clipboard` is `undefined` in the browser and the
  `.writeText` call throws a TypeError synchronously inside the async handler. That throw becomes an
  unhandled promise rejection (visible only in devtools console, which the user did not have open),
  and because `setCopied(true)` never runs, the button also gives no visual feedback that anything
  failed — from the user's perspective the button simply "doesn't work." Same code path serves every
  trainer page (including /lab), which is why G-01-6 (generic report) and G-01-8 (lab-specific
  report) are one bug, not two.
fix: (not applied — diagnose-only mode)
verification: (not applicable — diagnose-only mode)
files_changed: []
