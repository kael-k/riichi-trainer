# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node 26 (`.nvmrc`).

```sh
npm run dev                          # dev server
npm test                             # all tests (vitest run)
npx vitest run src/core/shanten.test.ts   # single test file
npx vitest run -t "finishes"         # tests matching a name
npm run lint                         # oxlint
npm run build                        # tsc -b + vite build
npm run tiles                        # regenerate SVG tile sprite (only when tiles change; output is committed)
npm run format                       # prettier
```

`README.md` documents the situation-URL format; keep it current when behavior changes.

## Architecture

Three layers: pure engine (`src/core/`), URL situation codec (`src/features/situation/urlCodec.ts`), React trainers built on both.

### Engine (`src/core/`) — pure TypeScript, zero dependencies, no React

- Tiles are `TileId` numbers 0–33 (9 man, 9 pin, 9 sou, 7 honors; offsets `MAN`/`PIN`/`SOU`/`HONOR` in `tiles.ts`).
- `Hand` (`hand.ts`) is a `Uint8Array(34)` of counts plus a fixed-meld count. It deliberately does **not** track red fives — `ParsedTile { id, red }` carries redness at parse/display level, and the efficiency hook tracks which red copies are held in a separate `reds` set alongside the `Hand`.
- `shanten.ts`: backtracking 5-block decomposition for standard shanten; closed-form chiitoitsu and kokushi; `shanten()` takes the minimum (skipping chiitoi/kokushi when melds exist).
- `ukeire.ts` / `efficiency.ts` probe by add-tile/remove-tile around `shanten()`. `ukeire(hand, visible)` computes remaining copies against a caller-supplied 34-length visibility array. `evaluateDiscards` ranks every discard (shanten asc, then ukeire desc); ties must be compared with `isBestDiscard` (shanten + ukeire count), never by tile id.
- Determinism: `rng.ts` (`mulberry32` seeded by string hash) + Fisher-Yates `shuffle`; `wall.ts` builds the 136-tile wall. Same seed string ⇒ same wall, which is what makes situations shareable. `wall.ts#deal` (simple seeded 13-tile deal) serves the shanten trainer; the efficiency trainer builds richer rounds itself in `createRound` (see below).

### Tenhou notation + situation URLs (the shared DSL)

Tenhou strings (`123m406p11z`, `0` = red five) are the interchange format everywhere: URL params, log copy buttons, tests. `serializeTenhou` sorts (hands); `serializeTenhouOrdered` preserves order (walls/rivers, where draw/discard order matters).

`urlCodec.ts` round-trips a `Situation` (seed, hand, wall prefix, river, round/seat, and optional `opponents`/`deadWall`/`aka` rule overrides) through query params. Every trainer page decodes it from `useSearchParams`, so a URL fully reproduces a drill. Semantics that matter: the wall prefix is consumed by *whoever* draws next (opponents included); `river` is the user's own past discards, **replayed** from the deal to fast-forward to a mid-round decision point — its tiles are not extra copies, so `allTiles` (the pool-exclusion + validation source) covers only hand + wall. The rule-override flags exist so a shared link pins round behavior regardless of the receiver's settings; `situationQuery()` in the hook produces such a dump (same seed unsuffixed on first load — that's why `startRound` only appends `:restartCount` after a restart).

### Trainer pattern (`src/features/*`)

Each trainer is a page component plus a `use*Round` hook (`useEfficiencyRound`, `useShantenRound`). The hooks keep mutable round state in a `useRef` and mirror render-ready snapshots into `useState`; an unspecified seed stays random per mount, and restart/next-hand appends a counter suffix.

The efficiency round lives in plain functions in `useEfficiencyRound.ts` so interactive play and URL-river replay share one code path: `createRound` (seeded pool minus pinned tiles → aka marking → dead wall + hidden opponent hands reserved from the pool *tail*, never the pinned prefix → deal → seat-ordered first draws → river replay) and `advanceAfterDiscard` (user discard → opponents tsumogiri cyclically → next user draw). `RoundCore.visible` accumulates every face-up tile (all rivers + dora indicator) and feeds ukeire remaining counts. The `PLAYERS` constant is the single knob future sanma support turns (together with the tile set inside `buildWall`) — never hardcode 4/3 in round logic. "finished" is derived (hand below 14 tiles), not stored.

State stores are zustand: `settingsStore.ts` (persisted; has a custom section-wise `merge` so adding fields to `efficiency`/`shanten` survives old persisted schemas — extend that merge when adding a new section) and `store/log.ts` (session-only action log; entries can carry inline tiles and a `copyText` for a tenhou copy button). Log entries are written imperatively from user-triggered actions (e.g. inside `discard()`), not from `useEffect`s watching round state — effect-based logging inverts entry order and duplicates under StrictMode (the shanten page's result effect is the one tolerated exception: its dep starts null on mount, so it fires once).

### UI

Tiles render as `<use>` references into a build-time SVG sprite (`src/assets/tiles/sprite.svg`, generated by `scripts/build-tile-sprite.mjs` from FluffyStuff assets, injected raw in `AppShell`). Tile size flows through the CSS var `--tile-w`; components scale locally by overriding it (e.g. `[--tile-w:calc(var(--tile-w-base)*0.8)]`). Tailwind 4; dark mode is a `dark` class on `<html>` toggled by `AppShell` from the persisted theme setting. `TrainerLayout` provides the shared header, settings dialog, and log panel. Routing uses `basename: import.meta.env.BASE_URL` (GitHub Pages); pushes to `main` deploy via Actions, and the app is a PWA (`vite-plugin-pwa`, autoUpdate).

Mobile-first is a project goal: touch targets are ≥44px (`min-h-11`), layouts must work at phone widths.
