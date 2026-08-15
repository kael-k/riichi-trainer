# Source map

One line per file. What each thing *does* is here; *how it works* is `CLAUDE.md`; *why* is
`docs/adr/`. 31 `*.test.ts(x)` files sit beside the sources they cover; every file in `src/core/`
has one.

## `src/core/` — the engine

Pure TypeScript. Zero dependencies, no React, no imports from `features/` or `components/`
([ADR-0001](adr/0001-three-layers.md)). Deterministic: same wall in, same match out.

| File            | Role                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `tiles.ts`      | `TileId` 0–33, suit offsets, tenhou parse/serialize, `inTileSet` (sanma exclusion)                     |
| `hand.ts`       | `Hand` — `Uint8Array(34)` counts + meld count + `drawn` ([ADR-0003](adr/0003-hand-counts-only.md))     |
| `rng.ts`        | `mulberry32` seeded by string hash, Fisher-Yates `shuffle`                                            |
| `wall.ts`       | `buildWall`, `completeWall`, `wallWithHand`, `deal` — wall construction and prefix completion         |
| `shanten.ts`    | Per-suit 5-block decomposition + chiitoi + kokushi; `referenceStandardShanten` is its spec            |
| `ukeire.ts`     | `ukeire`, `improvingTiles` — tile-acceptance against a visibility array                               |
| `efficiency.ts` | `evaluateDiscards`, `isBestDiscard`, `bestDiscards` — discard ranking                                 |
| `agari.ts`      | `decompose` — winning-shape enumeration                                                               |
| `yaku.ts`       | Yaku detection over a decomposition                                                                   |
| `score.ts`      | `scoreHand` — han/fu/points; `null` means "no yaku"                                                   |
| `danger.ts`     | `assessDiscards` — ordinal danger tiers ([ADR-0004](adr/0004-ordinal-danger.md))                       |
| `policy.ts`     | The pure maths algorithms are written in: `chooseDiscard`, `chooseFold`, `chooseCall`, `waits`, …     |
| `algorithm.ts`  | The decision seam: `SeatView`, `Algorithm`, `ALGORITHMS` ([ADR-0009](adr/0009-decision-seam.md))       |
| `match.ts`      | The match engine: `createMatch`/`beginTurn`/`finishTurn`/`playMatch`/`findMatch`, claims, `isManual`  |
| `table.ts`      | Pure table layer: `actingSeat`, `goRound`, `seenBy`, `snapshotTable`, `seatRead`, per-turn analysis   |
| `generateHand.ts` | Winning-hand generation for the scoring trainer                                                     |

`match.golden.test.ts` freezes an event-stream hash per seed — the regression net for any change
to a tie-break ([ADR-0016](adr/0016-testing-strategy.md)).

## `src/features/` — trainers and shared feature code

Each trainer is a page plus a `use*Round` hook. Which route is which app is a route, never a
setting ([ADR-0013](adr/0013-efficiency-split.md)).

| Directory          | Route              | Hook                        | Notes                                          |
| ------------------ | ------------------ | --------------------------- | ---------------------------------------------- |
| `shanten/`         | `/shanten`         | `useShantenRound`           | Boardless, continuous hand stream               |
| `efficiency-solo/` | `/efficiency-solo` | `useEfficiencySoloRound`    | Boardless, one seat                            |
| `efficiency/`      | `/efficiency`      | `useEfficiencyRound`        | Board, opponents, graded per discard           |
| `folding/`         | `/folding`         | `useFoldingRound`           | Own thin hook on `core/table.ts`; see ADR-0012 |
| `scoring/`         | `/scoring`         | `useScoringRound`           | Generates a finished hand, never steps it      |
| `lab/`             | `/lab`             | `useLabRound`               | Free play, no grading                          |

Shared:

| Path                            | Role                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `table/useTableRound.ts`        | React owner of a stepped round; `onUserDraw`/`onUserDiscard`/`onAgariCall`       |
| `table/ManualControls.tsx`      | Riichi arm, claim prompt, playing/watching lines                                 |
| `table/SeatStrip.tsx`           | The per-seat strip on the felt (algorithm badge, waits, furiten)                 |
| `table/Verdict.tsx`             | One-line compact feedback for fullscreen                                          |
| `settings/settingsStore.ts`     | Zustand, persisted, hand-written section-wise `merge` — extend it when adding a section |
| `settings/tableSettings.ts`     | `TableSettings`, `TABLE_DEFAULTS`, `resolveTableSettings`, `SeatConfig`          |
| `settings/SeatPanel.tsx`        | The per-seat dialog (watch from here / algorithm / claims)                        |
| `situation/urlCodec.ts`         | `Situation` ⇄ query params; validates walls by zone and tile                     |
| `situation/useUrlData.ts`       | Memoised per-navigation decode — the identity `logReplay` dedupes on             |
| `i18n/`                         | i18next setup, four locales, glossary registry, trainer wiki links                |

## `src/components/` — presentational

| Path                    | Role                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| `tiles/Table.tsx`       | The board. Zero game logic, no player concept ([ADR-0014](adr/0014-table-is-a-pure-view.md)) |
| `tiles/BoardStage.tsx`  | Inline and fullscreen layout around `Table`                                    |
| `tiles/Tile.tsx`        | One tile as a `<use>` into the build-time sprite                               |
| `TrainerLayout.tsx`     | Header, settings dialog, log panel, `LogList`                                  |
| `TrainerControls.tsx`   | `TrainerToggles` — start/pause and reset, shared by both surfaces              |
| `InfoPopover.tsx`       | Portalled popover behind both `GlossaryTerm` and the trainer info button       |
| `AppShell.tsx`          | Theme class, sprite injection, router outlet                                    |

## Elsewhere

| Path                              | Role                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| `src/lib/useSessionStats.ts`      | Score, per-decision clock, random seed; owns "clearing the log resets the session" |
| `src/store/log.ts`                | Session-only action log with inline tiles and copy text        |
| `src/routes/`                     | Route table and home page                                      |
| `src/assets/tiles/sprite.svg`     | Generated, **committed** — `npm run tiles` regenerates          |
| `scripts/build-tile-sprite.mjs`   | The generator (FluffyStuff assets, CC0)                        |
| `.github/workflows/deploy.yml`    | Build and deploy to Pages — **does not run lint or tests yet** (see STATUS) |

## Dependency direction

```
components/  ←  features/  →  core/
                   ↓
                 store/, lib/
```

`core/` imports nothing from the app. `components/tiles/Table.tsx` imports no game logic. Both
rules are load-bearing, not stylistic — ADR-0001 and ADR-0014.
