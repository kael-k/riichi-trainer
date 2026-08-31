# Architecture

A source map, and the boundaries that are load-bearing rather than stylistic.

## Three layers

```
components/  ←  features/  →  core/
                   ↓
                 store/, lib/
```

Two rules hold this up, and both are the kind that breaks silently:

**`core/` imports nothing from the app.** It is pure TypeScript with no dependencies and no React —
same wall in, same round out. That is what makes the engine testable without a renderer, and what
lets a shared link reproduce a board exactly.

**`components/tiles/Table.tsx` imports no game logic.** The board is a pure view: it has no concept
of a player and no notion of which seat is yours. A seat somebody plays and a seat nobody plays are
drawn through the same props, and the only thing that makes one of them a person's is that its
algorithm is `'manual'`.

## `src/core/` — the engine

| File              | Role                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `tiles.ts`        | `TileId` 0–33, suit offsets, tenhou parse/serialize, `inTileSet` (sanma exclusion)                              |
| `hand.ts`         | `Hand` — `Uint8Array(34)` counts plus a meld count, and nothing else                                            |
| `rng.ts`          | `mulberry32` seeded by string hash, Fisher-Yates `shuffle`                                                      |
| `wall.ts`         | `buildWall`, `completeWall`, `wallWithHand`, `deal` — construction and prefix completion                        |
| `shanten.ts`      | Per-suit 5-block decomposition plus chiitoi and kokushi; `referenceStandardShanten` is its specification        |
| `ukeire.ts`       | `ukeire`, `improvingTiles` — tile acceptance against a visibility array                                         |
| `efficiency.ts`   | `evaluateDiscards`, `isBestDiscard`, `bestDiscards` — discard ranking                                           |
| `agari.ts`        | `decompose` — winning-shape enumeration                                                                         |
| `yaku.ts`         | Yaku detection over a decomposition                                                                             |
| `score.ts`        | `scoreHand` — han, fu and points; `null` means "no yaku"                                                        |
| `danger.ts`       | `assessDiscards` — the ordinal danger tiers                                                                     |
| `dealIn.ts`       | `dealInRisk` — deal-in probability by wait-hypothesis enumeration                                               |
| `hououPrior.ts`   | **Generated** (`npm run build-ev-models`) — the measured tables `dealIn.ts` and `evModel.ts` read               |
| `probability.ts`  | `handOutlook`, `discardOutlooks` — the one-player DP for win probability and expected score                     |
| `evModel.ts`      | The swappable prices: `EV_MODELS`, derived and measured                                                         |
| `ev.ts`           | The push/fold identity, and every decision an EV seat makes through it                                          |
| `placement.ts`    | Rank odds and what a rank is worth — the placement objective's integral and ruleset                             |
| `policy.ts`       | The pure maths algorithms are written in: `chooseDiscard`, `chooseFold`, `chooseCall`, `kanOptions`, `waits`, … |
| `algorithm.ts`    | The decision seam: `SeatView`, `Algorithm`, `TurnAction`, `ALGORITHMS`                                          |
| `round.ts`        | The round engine (one deal): `createRound`, `beginTurn`, `finishTurn`, `stepRound`, claims, `isManual`          |
| `match.ts`        | The game a round sits inside: `MatchState`, `createMatch`, `settleRound`                                        |
| `table.ts`        | The pure table layer: `actingSeat`, `goRound`, `seenBy`, `snapshotTable`, `seatRead`                            |
| `generateHand.ts` | Winning-hand generation for the scoring trainer                                                                 |

A `*.test.ts` file sits beside every source in `core/`.

### Round ⊂ match

A **round** is one deal — deal, draws, discards, a win or an exhaustive draw. A **match** is the game
the rounds sit inside. `round.ts` plays a hand; `match.ts` holds what persists across them and takes
the pure step between them.

The direction is strict: a round never knows what follows it, so the sequencer lives in `match.ts`
and is never called from `round.ts`. A round takes its match context as a **copy**, so it can never
write back through to caller-owned options.

### The EV chain

`dealIn.ts` and `probability.ts` are the two probability halves; `evModel.ts` prices them and `ev.ts`
decides with them, every decision point through the one identity. `placement.ts` hangs off `ev.ts`,
holding the integral and the ruleset and no weights of its own, because the moments belong to each
model.

The chain is one-way and nothing in it reads back:

```
dealIn / probability  →  evModel  →  ev  →  algorithm
                                      ↓
                                  placement
```

`evModel.ts` type-imports one name from `policy.ts`, and that is the only edge between them, in that
direction alone.

What these modules compute, and why, is [the model reference](../index.md).

### Determinism, and how a board travels

The engine has no `Math.random()` in it. A seeded RNG plus an explicit wall means the same input
always produces the same round, which is the whole basis for sharing a situation.

**A board is shared as a wall, not as a seed.** A seed only reproduces a board if every line of
generation code stays identical forever; a wall is the board. The wall is the deal itself in dealing
order — the deal, then the live draws, then the last 14 as the dead wall — and a short wall is
completed at random from the copies it leaves.

Two details are easy to state backwards. The leading block is dealt the way a table deals, four
tiles to each seat three times round and then one apiece, not as one slab per seat. And the dead wall
is **seven stacks, not three blocks**: five dora stacks, each indicator sitting over the ura that
pays out under it, then the rinshan at the tail — so the flipped indicator is the 9th of the 14.

**Tenhou notation is the one interchange format** — `123m406p11z`, with `0` for a red five — used by
URL parameters, log copy buttons and tests alike. Hands serialize sorted; walls and rivers serialize
in order, because there the order is the information.

The situation codec is **the one codec in the repo that rejects rather than repairs.** A wall is
positionally meaningful, so an invalid one is reported by name rather than silently fixed into a
different board than the link promised.

**A link carries every seat's decisions**, not just your own river, and replaying it puts every seat
on manual for the duration so no algorithm is consulted. That is what makes a shared link reproduce
the hand that was actually played, rather than the hand today's algorithms would play.

### The decision seam

Every seat is a player, and a player has an algorithm. `'manual'` is not "a human" — it is the
algorithm "ask, don't decide", and the word "human" does not appear in the engine.

Algorithms are reached through one dispatch table over a curated `SeatView`: public information only,
plus the seat's own hand and the board. They never see raw round state.

The purity rule is absolute and its breakage is silent: **same view, same choice.** Every ranking is
a total order with an explicit tie-break, never relying on sort stability. Changing a seat's
algorithm mid-hand must never change the hand.

## `src/features/` — trainers

Each trainer is a page plus a `use*Round` hook. Which trainer you are in is a **route**, never a
setting.

| Directory          | Route              | Hook                     | Notes                                     |
| ------------------ | ------------------ | ------------------------ | ----------------------------------------- |
| `shanten/`         | `/shanten`         | `useShantenRound`        | Boardless, continuous hand stream         |
| `efficiency-solo/` | `/efficiency-solo` | `useEfficiencySoloRound` | Boardless, one seat                       |
| `efficiency/`      | `/efficiency`      | `useEfficiencyRound`     | Board, opponents, graded per discard      |
| `folding/`         | `/folding`         | `useFoldingRound`        | Grading plus a pure board search          |
| `scoring/`         | `/scoring`         | `useScoringRound`        | Generates a finished hand, never steps it |
| `match/`           | `/match`           | `useMatchRound`          | Sequences rounds; free play, no grading   |
| `lab/`             | `/lab`             | `useLabRound`            | Free play, no grading                     |

`efficiency/useEfficiencyDrill.ts` is the grading and session-state core both efficiency hooks sit
on.

Shared:

| Path                        | Role                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `table/useRound.ts`         | React owner of a stepped round; reports engine events through one `onEvent`             |
| `table/ManualControls.tsx`  | Riichi arm and claim prompt                                                             |
| `table/SeatStrip.tsx`       | The per-seat strip on the felt — algorithm badge, waits, furiten                        |
| `table/evGrade.ts`          | The EV grading band both trainers that offer it share                                   |
| `settings/settingsStore.ts` | Zustand, persisted, hand-written section-wise `merge` — extend it when adding a section |
| `settings/tableSettings.ts` | `TableSettings`, `TABLE_DEFAULTS`, `resolveTableSettings`, `SeatConfig`                 |
| `situation/urlCodec.ts`     | `Situation` ⇄ query params; validates walls by zone and tile                            |
| `situation/useUrlData.ts`   | Memoised per-navigation decode                                                          |
| `i18n/`                     | i18next setup, four locales, the glossary registry, trainer wiki links                  |

**The React table layer drives a round and reports what the engine did.** It has no opinion about
what any of it means: the trainer decides which seat it grades, when the round is over, and whether
the board is worth keeping. That is what lets seven trainers differ only by their stop condition.

## `src/components/` — presentational

| Path                           | Role                                                                   |
| ------------------------------ | ---------------------------------------------------------------------- |
| `tiles/Table.tsx`              | The board. Zero game logic, no player concept                          |
| `tiles/BoardStage.tsx`         | **The trainer page**: chrome row, board, hand, session panel           |
| `tiles/Tile.tsx`               | One tile, as a `<use>` into the build-time sprite                      |
| `tiles/useMobileFullscreen.ts` | Asks for real fullscreen on a phone, once per session                  |
| `LogList.tsx`                  | The log: the session's decisions, each expanding into its own feedback |
| `TrainerControls.tsx`          | Start, pause, undo, reset, and the chrome row's button style           |
| `InfoPopover.tsx`              | Portalled popover behind both the glossary and the trainer info button |
| `AppShell.tsx`                 | Theme class, sprite injection, router outlet                           |

## Elsewhere

| Path                            | Role                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| `src/lib/useSessionStats.ts`    | Score, per-decision clock, random seed                             |
| `src/lib/useMediaQuery.ts`      | Live `matchMedia` read; picks the session panel's shape            |
| `src/store/log.ts`              | Session-only action log                                            |
| `src/routes/`                   | Route table and home page                                          |
| `src/assets/tiles/sprite.svg`   | Generated, **committed** — `npm run tiles` regenerates             |
| `scripts/build-tile-sprite.mjs` | The generator (FluffyStuff assets, CC0)                            |
| `src/core/hououPrior.ts`        | Generated, **committed** — `npm run build-ev-models` regenerates   |
| `scripts/build-ev-models.mjs`   | The generator (houou-statistics CSVs at a pinned commit)           |
| `docs/`                         | This site (VitePress), built into `dist/docs`                      |
| `.github/workflows/ci.yml`      | Lint, unit tests and browser tests, then build and deploy to Pages |

Both generated files are **committed**, so their generators only run when their inputs move. Edit the
generator, never the output.
