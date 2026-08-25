# Riichi Trainer

Mobile-first riichi mahjong trainer: efficiency, shanten, scoring and defensive folding drills, plus a free-play statistical lab — with reproducible, shareable training situations.

## Why

[Euophrys/Riichi-Trainer](https://github.com/Euophrys/Riichi-Trainer) is a good existing tool but unmaintained, and has concrete gaps this project targets:

1. Not responsive
2. Clunky settings UI
3. Efficiency trainer can load a hand but not the wall, so specific situations aren't reproducible
4. Ukeire is shown as a number, not as the actual improving tiles
5. Shanten trainer's number input doesn't submit on Enter
6. Shanten trainer timer starts on first guess instead of on reveal
7. No integrated scoring trainer (cf. [scoringtrainer.konbamwa.net](https://scoringtrainer.konbamwa.net/))

## Modes

Every mode is its own route — no setting silently changes which trainer you are using.

| Route              | Drill                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `/shanten`         | Guess the shanten count of a dealt hand, timed, as a continuous stream                        |
| `/efficiency-solo` | 14 tiles and nothing else to read: pick the discard, graded on shanten and ukeire             |
| `/efficiency`      | The same drill at a full table, opponents playing themselves                                  |
| `/folding`         | Someone riichis and you are not tenpai; every discard to the end of the hand is graded        |
| `/scoring`         | A finished hand: guess han, fu and points                                                     |
| `/lab`             | Free play, nothing graded, everything shown. Under development, not linked from the home page |

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

Architecture notes live in `CLAUDE.md`; the decisions behind them are in [`docs/adr/`](docs/adr/), with a source map in [`docs/STRUCTURE.md`](docs/STRUCTURE.md) and current state in [`docs/STATUS.md`](docs/STATUS.md).
