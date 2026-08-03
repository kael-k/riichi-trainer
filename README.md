# Riichi Trainer

Mobile-first riichi mahjong trainer: efficiency (discard/ukeire) and shanten drills, with reproducible, shareable training situations.

## Why

[Euophrys/Riichi-Trainer](https://github.com/Euophrys/Riichi-Trainer) is a good existing tool but unmaintained, and has concrete gaps this project targets:

1. Not responsive — hard to use on phone
2. Clunky settings UI
3. Efficiency trainer can load a hand but not the wall/river, so specific situations aren't reproducible
4. Ukeire is shown as a number, not as the actual improving tiles
5. Shanten trainer's number input doesn't submit on Enter
6. Shanten trainer timer starts on first guess instead of on reveal, with no pause
7. No integrated scoring trainer (cf. [scoringtrainer.konbamwa.net](https://scoringtrainer.konbamwa.net/))

## Stack

React 19 + TypeScript + Vite, react-router, zustand (persisted settings), Vitest. Mahjong engine (`src/core/`) is pure TypeScript with no dependencies. Tiles render from a build-time SVG sprite generated from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) (CC0).

## Development

Requires Node 20 (pinned via `.nvmrc`).

```sh
npm install
npm run dev       # dev server
npm test          # engine + component tests
npm run build     # typecheck + production build
npm run tiles     # regenerate the tile sprite from source SVGs
```
