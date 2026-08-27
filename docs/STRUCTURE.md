# Source map

One line per file. What each thing _does_ is here; _how it works_ is `CLAUDE.md`; _why_ is
`docs/adr/`. 34 `*.test.ts(x)` files sit beside the sources they cover; every file in `src/core/`
has one.

## `src/core/` — the engine

Pure TypeScript. Zero dependencies, no React, no imports from `features/` or `components/`
([ADR-0001](adr/0001-three-layers.md)). Deterministic: same wall in, same round out.

| File              | Role                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tiles.ts`        | `TileId` 0–33, suit offsets, tenhou parse/serialize, `inTileSet` (sanma exclusion)                                               |
| `hand.ts`         | `Hand` — `Uint8Array(34)` counts + meld count, nothing else ([ADR-0022](adr/0022-stored-redness.md))                             |
| `rng.ts`          | `mulberry32` seeded by string hash, Fisher-Yates `shuffle`                                                                       |
| `wall.ts`         | `buildWall`, `completeWall`, `wallWithHand`, `deal` — wall construction and prefix completion                                    |
| `shanten.ts`      | Per-suit 5-block decomposition + chiitoi + kokushi; `referenceStandardShanten` is its spec                                       |
| `ukeire.ts`       | `ukeire`, `improvingTiles` — tile-acceptance against a visibility array                                                          |
| `efficiency.ts`   | `evaluateDiscards`, `isBestDiscard`, `bestDiscards` — discard ranking                                                            |
| `agari.ts`        | `decompose` — winning-shape enumeration                                                                                          |
| `yaku.ts`         | Yaku detection over a decomposition                                                                                              |
| `score.ts`        | `scoreHand` — han/fu/points; `null` means "no yaku"                                                                              |
| `danger.ts`       | `assessDiscards` — ordinal danger tiers ([ADR-0004](adr/0004-ordinal-danger.md))                                                 |
| `dealIn.ts`       | `dealInRisk` — deal-in probability by wait-hypothesis enumeration ([ADR-0036](adr/0036-probability-beside-the-tiers.md))         |
| `hououPrior.ts`   | **Generated** (`npm run build-ev-models`) — measured wait-shape counts `dealIn.ts` reads                                         |
| `probability.ts`  | `handOutlook`, `discardOutlooks` — win probability and expected score, the one-player DP                                         |
| `evModel.ts`      | The swappable prices: `EV_MODELS` — `statistical` (derived) and `houou` (measured) ([ADR-0037](adr/0037-the-ev-seat-decides.md)) |
| `ev.ts`           | The push/fold identity: `rankDiscards`, `foldEv`, `riichiWorthIt` — what the two `'ev-*'` seats decide with                      |
| `policy.ts`       | The pure maths algorithms are written in: `chooseDiscard`, `chooseFold`, `chooseCall`, `waits`, …                                |
| `algorithm.ts`    | The decision seam: `SeatView`, `Algorithm`, `ALGORITHMS` ([ADR-0009](adr/0009-decision-seam.md))                                 |
| `round.ts`        | The round engine (one deal): `createRound`/`beginTurn`/`finishTurn`/`playRound`/`stepRound`, claims, `isManual`                  |
| `match.ts`        | The game a round sits inside: `MatchState`, `createMatch` — carry-in only ([ADR-0023](adr/0023-round-inside-match.md))           |
| `table.ts`        | Pure table layer: `actingSeat`, `goRound`, `seenBy`, `snapshotTable`, `seatRead`, per-seat analysis                              |
| `generateHand.ts` | Winning-hand generation for the scoring trainer                                                                                  |

**Round ⊂ match** is the naming model throughout ([ADR-0023](adr/0023-round-inside-match.md)): a
round is one deal, a match is the game. ADRs written before it (0006, 0007, 0009, 0010, 0012) say
`MatchState`/`MatchOptions`/`useMatch` for what the code now calls `RoundState`/`RoundOptions`/
`useRound`; the decisions stand, only the words moved.

`dealIn.ts` and `probability.ts` are the EV model's two probability halves
([ADR-0036](adr/0036-probability-beside-the-tiers.md)); `evModel.ts` prices them and `ev.ts`
decides with them ([ADR-0037](adr/0037-the-ev-seat-decides.md)). The one-way chain is
`dealIn`/`probability` → `evModel` → `ev` → `algorithm.ts`, and nothing in it reads back. Their
specification is `plans/EV-1`–`EV-5`; the two recap files beside them record where the measurements
disagreed with it.

`round.golden.test.ts` freezes an event-stream hash per seed — the regression net for any change
to a tie-break ([ADR-0016](adr/0016-testing-strategy.md)). `round.test.ts`'s census is the other
half: every tile kind accounted for exactly four times, and each player's `concealed` still
agreeing with `hand.counts` ([ADR-0022](adr/0022-stored-redness.md)).

## `src/features/` — trainers and shared feature code

Each trainer is a page plus a `use*Round` hook. Which route is which app is a route, never a
setting ([ADR-0013](adr/0013-efficiency-split.md)).

| Directory          | Route              | Hook                     | Notes                                                     |
| ------------------ | ------------------ | ------------------------ | --------------------------------------------------------- |
| `shanten/`         | `/shanten`         | `useShantenRound`        | Boardless, continuous hand stream                         |
| `efficiency-solo/` | `/efficiency-solo` | `useEfficiencySoloRound` | Boardless, one seat                                       |
| `efficiency/`      | `/efficiency`      | `useEfficiencyRound`     | Board, opponents, graded per discard                      |
| `folding/`         | `/folding`         | `useFoldingRound`        | Grading + a pure board search on `useRound`; see ADR-0012 |
| `scoring/`         | `/scoring`         | `useScoringRound`        | Generates a finished hand, never steps it                 |
| `lab/`             | `/lab`             | `useLabRound`            | Free play, no grading                                     |

`efficiency/useEfficiencyDrill.ts` is the grading/session-state core both efficiency hooks sit on —
`useEfficiencySoloRound` imports it from `features/efficiency/`, same direction as its existing
`grade.ts` import ([ADR-0032](adr/0032-one-efficiency-drill-core.md)).

Shared:

| Path                        | Role                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `table/useRound.ts`         | React owner of a stepped round; reports engine events through one `onEvent`             |
| `table/ManualControls.tsx`  | Riichi arm, claim prompt, playing/watching lines                                        |
| `table/SeatStrip.tsx`       | The per-seat strip on the felt (algorithm badge, waits, furiten)                        |
| `table/Verdict.tsx`         | One-line compact feedback for fullscreen                                                |
| `settings/settingsStore.ts` | Zustand, persisted, hand-written section-wise `merge` — extend it when adding a section |
| `settings/tableSettings.ts` | `TableSettings`, `TABLE_DEFAULTS`, `resolveTableSettings`, `SeatConfig`                 |
| `settings/SeatPanel.tsx`    | The per-seat dialog (watch from here / algorithm / claims)                              |
| `situation/urlCodec.ts`     | `Situation` ⇄ query params; validates walls by zone and tile                            |
| `situation/useUrlData.ts`   | Memoised per-navigation decode — the identity `logReplay` dedupes on                    |
| `i18n/`                     | i18next setup, four locales, glossary registry, trainer wiki links                      |

## `src/components/` — presentational

| Path                           | Role                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `tiles/Table.tsx`              | The board. Zero game logic, no player concept ([ADR-0014](adr/0014-table-is-a-pure-view.md))         |
| `tiles/BoardStage.tsx`         | **The trainer page**: chrome row, board, hand, session panel ([ADR-0025](adr/0025-one-interface.md)) |
| `tiles/useMobileFullscreen.ts` | Asks the browser for real fullscreen on a phone, once per session                                    |
| `tiles/Tile.tsx`               | One tile as a `<use>` into the build-time sprite                                                     |
| `LogList.tsx`                  | The log menu: the session's decisions, each expanding to its own feedback                            |
| `TrainerControls.tsx`          | `TrainerToggles` — start/pause, undo, reset — plus the chrome row's button style                     |
| `InfoPopover.tsx`              | Portalled popover behind both `GlossaryTerm` and the trainer info button                             |
| `AppShell.tsx`                 | Theme class, sprite injection, router outlet                                                         |

## Elsewhere

| Path                            | Role                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/useSessionStats.ts`    | Score, per-decision clock, random seed; owns "clearing the log resets the session" |
| `src/lib/useMediaQuery.ts`      | Live `matchMedia` read; picks the session panel's docked/drawer shape              |
| `src/store/log.ts`              | Session-only action log with inline tiles and copy text                            |
| `src/routes/`                   | Route table and home page                                                          |
| `src/assets/tiles/sprite.svg`   | Generated, **committed** — `npm run tiles` regenerates                             |
| `scripts/build-tile-sprite.mjs` | The generator (FluffyStuff assets, CC0)                                            |
| `src/core/hououPrior.ts`        | Generated, **committed** — `npm run build-ev-models` regenerates                   |
| `scripts/build-ev-models.mjs`   | The generator (houou-statistics CSVs at a pinned commit)                           |
| `.github/workflows/deploy.yml`  | Build and deploy to Pages — **does not run lint or tests yet** (see STATUS)        |

## Dependency direction

```
components/  ←  features/  →  core/
                   ↓
                 store/, lib/
```

`core/` imports nothing from the app. `components/tiles/Table.tsx` imports no game logic. Both
rules are load-bearing, not stylistic — ADR-0001 and ADR-0014.
