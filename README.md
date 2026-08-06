# Riichi Trainer

Mobile-first riichi mahjong trainer: efficiency (discard/ukeire) and shanten drills, with reproducible, shareable training situations.

## Why

[Euophrys/Riichi-Trainer](https://github.com/Euophrys/Riichi-Trainer) is a good existing tool but unmaintained, and has concrete gaps this project targets:

1. Not responsive — hard to use on phone — *addressed: mobile-first layout*
2. Clunky settings UI — *addressed: per-trainer settings dialog*
3. Efficiency trainer can load a hand but not the wall/river, so specific situations aren't reproducible — *addressed: situation URLs pin hand, wall and rivers (see below)*
4. Ukeire is shown as a number, not as the actual improving tiles — *addressed: improving tiles shown with remaining counts*
5. Shanten trainer's number input doesn't submit on Enter — *addressed*
6. Shanten trainer timer starts on first guess instead of on reveal, with no pause — *addressed: starts on reveal, pausable*
7. No integrated scoring trainer (cf. [scoringtrainer.konbamwa.net](https://scoringtrainer.konbamwa.net/)) — *planned*

## Modes

- **Efficiency trainer** (`/efficiency`) — 14-tile hand; tap a discard, get feedback: your shanten/ukeire vs. the best discard, with the actual improving tiles and their remaining counts. Draw, discard, repeat until the wall runs dry; cumulative "ukeire lost" scores the round. Optional (all on by default except the wall view): simulated opponents that tsumogiri every turn, a dead wall with visible dora indicator, red fives in the deal, and a face-up wall view. "Copy situation link" exports the current round mid-game as a URL.
- **Shanten trainer** (`/shanten`) — hand is dealt face-down; revealing starts a pausable timer. Guess the shanten count (Enter or quick buttons); standard, chiitoitsu and kokushi are all considered.
- **Scoring trainer** — han/fu scoring drills. *TODO, not implemented yet.*
- **Folding trainer** — defend against riichi. *TODO, not implemented yet.*

## Situation URLs

Trainers read their whole scenario from the query string, so one URL fully reproduces a drill. Tile lists use tenhou notation: `123m406p789s11z` (`m`/`p`/`s` = man/pin/sou, `z` = honors E,S,W,N,haku,hatsu,chun as 1–7, `0` = red five).

| param | meaning |
| --- | --- |
| `seed` | deterministic shuffle of the remaining tile pool; omitted = fresh random round each load |
| `hand` | starting hand; the efficiency trainer fills it to 14 tiles from the wall |
| `wall` | forced draw order, consumed by whoever draws next (opponents included); when exhausted, draws fall back to the seeded pool |
| `river` | your own discards so far, replayed from the deal to rebuild a round mid-game (replay stops early if a discard reaches tenpai, which ends the round) |
| `round`, `seat` | round wind (display only) and your seat — opponents seated before you tsumogiri before your first draw |
| `opponents`, `deadwall`, `aka` | `1`/`0` — pin the round rules into the link, overriding the receiver's settings so it reproduces exactly |

Opponents' rivers are never specified: opponents always tsumogiri, so their discards are fully determined by the wall. Every tile pinned in `hand`/`wall` is removed from the seeded pool, so no tile can appear more than four times (the `river` is a replay of tiles already there, not extra copies). Example:

```
/efficiency?hand=19m19p19s1234567z&wall=9m&seed=kokushi-drill
```

The shanten trainer uses `hand` only when it is exactly 13 tiles; otherwise it deals fresh hands from `seed`.

## Stack

React 19 + TypeScript + Vite, react-router, zustand (persisted settings), Tailwind 4, Vitest. Mahjong engine (`src/core/`) is pure TypeScript with no dependencies. Tiles render from a build-time SVG sprite generated from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) (CC0). Installable PWA with offline support. Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Development

Requires Node 26 (pinned via `.nvmrc`).

```sh
npm install
npm run dev       # dev server
npm test          # engine + component tests
npm run lint      # oxlint
npm run build     # typecheck + production build
npm run tiles     # regenerate the tile sprite from source SVGs
```
