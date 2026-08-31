# CLAUDE.md

## What is in here, and what is not

**How the code works today**: the commands, the layer rules, and the invariants — the rules whose
default guess is wrong and whose breakage is silent. One question decides whether a line belongs
here: _would somebody get this wrong by guessing, and would the breakage be quiet?_ If not, it goes
somewhere else or nowhere.

Where everything else lives — the docs site, the locale files, and which of the three answers what —
is [CONTRIBUTING.md](CONTRIBUTING.md). Two rules are repeated here because they constrain what you
may do:

- **`README.md` is the shop window, not documentation. Never edit it unprompted.** Adding to it
  needs the user's explicit permission, asked before the edit (in the plan, when there is one) and
  stating exactly what would be added and why it cannot live elsewhere.
- Precedence: **code > `CLAUDE.md` > the docs site.** A `###` section here that runs past ~10KB is
  carrying rationale that belongs on the site.

## Commands

Node 26 (`.nvmrc`).

```sh
npm run dev                          # dev server
npm test                             # all tests (vitest run)
npx vitest run src/core/shanten.test.ts   # single test file
npx vitest run -t "finishes"         # tests matching a name
npm run lint                         # oxlint
npm run build                        # tsc -b + vite build
npm run ui-test                      # playwright (real WebKit + chromium)
npm run tiles                        # regenerate SVG tile sprite (output is committed)
npm run build-ev-models              # regenerate core/hououPrior.ts from the pinned houou CSVs (output is committed)
npm run format                       # prettier
npm run docs:dev                     # the docs site, hot reload
npm run docs:build                   # the docs site, into dist/docs
```

**`npm run build` empties `dist/`, so `docs:build` runs after it, never before.** CI does them in
that order.

**`src/assets/tiles/sprite.svg` and `src/core/hououPrior.ts` are generated and committed.** Edit the
generator, never the output — including its comments, which the generator emits.

## Architecture

Three layers: pure engine (`src/core/`), URL situation codec (`src/features/situation/urlCodec.ts`),
React trainers built on both. `core/` imports nothing from the app; `components/tiles/Table.tsx`
imports no game logic. Both rules are load-bearing.

**See:** [docs/dev/architecture.md](docs/dev/architecture.md)

### Engine (`src/core/`) — pure TypeScript, zero dependencies, no React

- Which physical copies a seat holds is **stored, not inferred**. `PlayerState.concealed`
  (`round.ts`) is the hand as held, redness included, sorted **except for its last element** while
  `PlayerState.drawn` is set — appending the 14th rather than sorting it in is what tells a discard
  tedashi from tsumogiri.
- `drawn` is always `concealed.at(-1)` while set, and is **cleared the moment the tile leaves the
  hand** (discard, kita, ankan), before any algorithm reads it.
- Both are maintained beside `hand.counts` at **every** mutation site: `take`, `drawReplacement`,
  `finishTurn`, the pon/chi meld loop, `callAnkan`, `callKita`, the deal loop. The census test
  (`round.test.ts`) is the guard against drift.
- `pickTile` is a **policy, not an inference**: given a plain and a red copy, throw the plain one —
  an explicit prefer-`!red` find over `concealed`.
- `ukeire(hand, visible)` prices against a **caller-supplied** visibility array. `evaluateDiscards`
  ranks shanten asc then ukeire desc; ties are compared with `isBestDiscard`, **never by tile id**.
- `wall.ts#deal` (seeded, returns just the `Hand`) serves the shanten trainer; every other trainer
  goes through `round.ts#createRound`.
- Win legality is free from existing code — `decompose()` non-empty is the shape, `scoreHand()`
  returning null is "no yaku" — but **guard both behind a single `shanten()` call**: that gate fails
  for almost every seat on almost every discard, and everything past it is far more expensive.
- **`referenceStandardShanten` is `standardShanten`'s specification, not dead code** — change one,
  re-run `shanten.test.ts`. Simulated seats use `bestDiscards`; ukeire prices only the tiles tied.

### Round and match: the naming model

`core/round.ts` plays one deal; `core/match.ts` holds what persists across them.

- `prevalentWind` is an honour tile id (`HONOR` = East) and pairs with `SeatView.seatWind`; `round`
  is which kyoku within it (East 1 is `1`).
- `honba` and `dealerRepeat` are **separate fields** — they diverge by ruleset — never collapsed.
- `MatchState` is **carry-in context, not a sequencer**. Riichi's 1000-point deduction is the only
  mutation `round.ts` makes to it, so **`createRound` copies `options.match`, never aliases it**.
- **Dealer is not assumed to be seat 0**: `seatWind` is `HONOR + ((seat - dealer + players) %
players)`, "am I dealer" is `seat === state.match.dealer`, and the turn counter increments on the
  dealer's seat.
- **The sequencer is `match.ts#settleRound`, never called from `round.ts`.** It prices from
  `Payments.total`/`.main`/`.fromDealer` (honba already folded in), never re-deriving ruleset math.
- **A round is "redealt" by a fresh wall array identity, nothing more.**

### The round engine (`core/round.ts` + `core/policy.ts`)

`createRound` deals off an **explicit wall in draw order**: the deal (`players * 13`), the live
draws, then the trailing 14 the dead wall is cut from. `players: 1` collapses to `wall[0..12]`.

- **Every wall-index-to-seat mapping goes through `dealtSeat`/`dealtIndices`**: `validateWall`'s
  error zones, `wallWithHand`/`wallWithHands`, the wall reveal's perspective highlight.
- **The wall is dealt in index order; play starts at the dealer.** Two separate facts, and only the
  first keeps `MatchState` out of an index-to-seat mapping.

**Stepping.** `beginTurn` (draw, the tsumo check, then kyuushu) and `finishTurn` (the acting seat's
kita and kans, its discard, then everyone else's ron and calls); `playRound` loops both, and a
`stop` predicate ends it early — **the only thing trainers differ by**. `stepRound` is the one
stepper, and it deliberately does **not** stop at a manual seat: that rides in through `canAct`,
asked once per turn before anything is drawn. Its **`player.drawn` guard** makes it safe to resume
into a turn someone else started.

Rejection sampling (deal a wall, play it, keep it if `accept` takes it) is capped, yields between
attempts, and runs in plain loops **never driven through React**.

**Seats and algorithms.** `PlayerState.algorithm: SeatAlgorithm` — read the union in
`core/policy.ts`, never copy it here.

- `'manual'` is not "a human", it is the algorithm "ask, don't decide", and it is **live**: flip it
  mid-hand and the next turn obeys, no redeal, no re-search. `isManual(state, seat)` is the one
  predicate that reads it.
- `RoundOptions.algorithms?` only _seeds_ each player; the live value lives on `PlayerState`.
- A manual seat is **drawn for but never decided for**: no auto-kita, no auto-riichi (riichi locks
  every later discard to tsumogiri, so it must stay the player's choice), no auto-pon/chi. More than
  one seat can be manual at once.
- What an algorithm _does_ is the seam's business, **never `algorithm === …` conditionals here**.

**Riichi overrides everything.** `forcedTsumogiri` overrides every algorithm **and every explicit
discard**, so it is the **first** branch in `finishTurn`'s choice of tile, never the fallback — in
the `else` a manual seat in riichi could hand in any tile it liked. `HandDisplay`'s `lockedToDrawn`
renders the thirteen as plain tiles, leaving only the drawn one live.

**Claims.** `RoundOptions.claims?` (default **false**, so every graded drill stays bit-for-bit
unchanged) makes a manual seat get _asked_ about another seat's discard.

- While an answer is pending, `RoundState.claim` is set and **`beginTurn`/`finishTurn` are no-ops**
  — one guard in the shared functions, not one in every caller.
- `answerClaim` resolves through an internal **restartable** `resolveReactions`: it runs from the
  top on every answer and suspends on the first seat that hasn't replied, so everything it re-runs
  is idempotent (`tryWin`/`couldHaveWon` restore the hand they probe, `missedWin` only goes true).
- **Three phases, in this order, and the order is the point: ask every manual seat, then rons in
  seat order, then calls.** That is what stops a pon answered early from outranking an earlier ron.
- **Daiminkan and kakan are match-only** (`RoundOptions.calledKan`); `chooseCall` never receives a
  `'minkan'`. Kakan upgrades a `'pon'` meld **by replacing the meld object, never mutating it** —
  `snapshotTable` shallow-copies `melds` but keeps the same `Meld` references. **Chankan is not
  modelled.**
- `reconsiderClaim` re-enters `resolveReactions` from scratch when a seat stops being manual
  mid-claim, and **never invents a pass**: a pass sets `missedWin` and would poison the hand with
  furiten over a decision nobody made.
- **A manual seat's own tsumo is a call too**, and **one function raises it** — `offerOrEnd`, over
  the third `PendingClaim` shape, `PendingWin`. Every **self-drawn** win goes through it; a **ron
  never does**, and **neither does an AI seat**. Anything but `'tsumo'` hands the turn back with the
  fourteenth tile still in hand and **leaves no furiten**.
- **The rinshan check lives in the three `call*` functions** (`replacementWin`), not their callers,
  which is why `callAnkan` takes `RoundOptions`. Rinshan kaihou the yaku is unmodelled.

**Permissions live entirely in `RoundOptions`, never in `Table`.** Four flags, each shared by every
seat:

| Flag     | Gates                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- |
| `wins`   | `tryWin` itself — `false` blocks ron **and** tsumo and drops the ron entry from `claimOptions` |
| `calls`  | Whether an AI algorithm may pon/chi at all                                                     |
| `riichi` | `canDeclareRiichi`, for AI and manual seats alike                                              |
| `claims` | Whether a **manual** seat is _asked_ — about another seat's discard, and about its own tsumo   |

Layering is legality (`RoundOptions`) → choice (the algorithm) → prompt (`claims`, manual seats
only). **`abortiveDraws` is a fifth field and deliberately not one of those four**: it says which
ruleset is being played, like `sanma`, so it defaults **on**.

**Kyuushu kyuuhai.** Nine or more distinct terminals and honours on a seat's own first draw with
nobody having melded.

- **"First draw, uninterrupted" is `river.length === 0` plus no melds anywhere, never `turn ===
1`.** A kita is not a call and does not disqualify.
- **`beginTurn` asks after the tsumo check**: a dealt thirteen-orphan kokushi is nine distinct
  terminals and a completed hand at once, and the win outranks the abort.
- `RoundState.ended` gains **`'abort'`**, not `'exhaustive'`: nobody is noten and nobody pays.
  Declining leaves no furiten and returns the turn where `beginTurn` suspended it.

**The riichi river mark is derived, not a one-shot flag**: `finishTurn` writes `entry.riichi` when
`player.riichiAt === player.river.length` — true for the declaration, and again for the next discard
after a call popped the declaration tile out of the river. **`state.discards` keeps the called
copy.**

`finishTurn`'s optional **`beforeReactions`** runs after the discard is on the river and any riichi
declared, **before any seat reacts**.

**Furiten.** Ron legality lives in `tryWin` alone, and `claimOptions` offers `'ron'` only when
`tryWin` returns a record — exactly one place can offer a furiten seat a ron, and it never does.

- **Own-river** furiten reads **`seatWaits(player, sanma)`, never `waits` on the live hand**:
  `waits` means its "13-tile hand" literally, so a hand mid-turn answers `0` and `improvingTiles`
  probes fifteen. `seatWaits` removes `player.drawn` and puts it back.
- **Temporary** furiten is `PlayerState.missedWin`, lifted in `finishTurn` on the seat's own
  **discard** — the end of the turn that clears it, not the draw that opens it.
- It is `player.missedWin = !declaring && player.riichiAt !== undefined && player.missedWin`, **not
  a plain clear**, and **`!declaring` is the load-bearing half**: `riichiAt` is set earlier in the
  same `finishTurn`, so without it the clause first reads true on the declaring discard and freezes
  a temporary furiten into a permanent one.
- `missedWin` is set only for a seat that genuinely declined; a manual seat with `claims: false` is
  skipped **without being asked**.
- `couldHaveWon` tests the hand's **shape** and nothing else: a yakuless tenpai is furiten on its
  own waits like any other.

`policy.ts` holds the pure maths the algorithms are written in terms of — **every ranking with an
explicit tie-break, never sort stability**. **Calls happen only when they lower shanten _and_
`hasYakuRoute` still holds.**

### The decision seam (`core/algorithm.ts`)

Five decision points — the whole of a seat's own turn, pon/chi, riichi declaration, take-a-win,
abortive draw — are one dispatch table, `ALGORITHMS`, keyed by `AIAlgorithm` (`SeatAlgorithm` minus
`'manual'`, **never a key here**). Adding one is a ~10-line object literal plus its `AIAlgorithm`
member: **no base class, no `Partial` merge.**

**`turn(view): TurnAction` is one method, not four, because a turn's actions compete.** It is asked
**repeatedly until it answers with a discard** — a turn may hold several kans and several kita, each
drawing a replacement the next answer sees.

- **The loop is `round.ts#takeTurn`, called from `finishTurn` and nowhere else** — asking from
  `beginTurn` too would make an `'ev'` seat rank discards twice a turn.
- It runs **before `finishTurn` reads `forcedTsumogiri`**, since a nukidora pull replaces the tile a
  declared seat is locked to.
- **A manual seat never reaches it**; **a seat in riichi may pull a north and nothing else**; **an
  illegal action is a no-op, not a throw**. Bounded at four kans plus four kita, never `while
(true)`.
- **Every replacement is win-checked by the loop**, because the three `call*` functions never do it.
- `policy.ts#kanOptions` is the **one** notion of own-turn kan legality. Daiminkan is not in it.
- **Claim time is deliberately not collapsed.** Ron-beats-pon is a rule `resolveReactions` enforces
  in seat order, not a preference an algorithm may override.

Other rules of the seam:

- **The EV model and objective are a per-seat field, not keys**: `PlayerState.ev: EvSeat` beside
  `algorithm`, live the same way. **Every seat carries an `EvSeat` and every non-`'ev'` seat ignores
  it** — an optional field is a default every reader has to remember.
- `TurnAction`'s `'discard'` carries `fromDrawn`, an **advisory** read of tedashi vs tsumogiri;
  `finishTurn` re-derives the river's actual flag from the tile `pickTile` resolves.
- What an algorithm may know is a curated **`SeatView`**, never raw `RoundState`; `seen` and
  `threats` are **lazy getters**. **`SeatView.match` is the same object `RoundState.match` holds**,
  not a snapshot, so a mid-round riichi's deduction is visible to whoever reads it next.
- `win(view, candidate)` is the one method with a second argument, already priced by `tryWin`.

### The table layer (`core/table.ts` + `features/table/useRound.ts`)

**`core/table.ts` is pure**, over a `TableCore`:

- `actingSeat(core)` is `round.seat`, **except that a pending claim outranks the turn order**.
- `TableCore` carries **no seat at all**: `seenBy` and `analysisOf` take it explicitly, and
  `snapshotTable` is uniformly per-seat, holding a **copy** of `MatchState` — points move mid-round.
- `analysisOf` returns **lazy getters, not eager fields**; `evaluateDiscards` is not cheap.
- `goRound(core)` plays every AI-decided seat and stops at the next manual turn, a pending claim, or
  the hand's end.

**`useRound(input)` drives a round and reports what the engine did**; it has no opinion about what
any of it means. One callback, `onEvent`, and a handler steers by what it **returns**: nothing to
carry on, `{ stop: true }` to halt, `{ restart: wall }` to abandon the deal.

- **`analysis` copies the hand** (captured at the draw that completes it, reported on the
  discard/kita/ankan that spends it), so grading measures the pre-throw hand.
- **`logLength`** is how long `round.log` was when the turn began — by report time the whole turn is
  applied, so a rewind link has to slice back to it.
- Replayed events are **reported, tagged `replaying: true`**, not suppressed.
- The round is built **once**, during the render that first needs a board (`ensureBuilt`); replayed
  events are queued by the build and drained by the effect so nothing grades or logs mid-render.

**Pacing is this layer's, and `pace: 0` must take no `await`.**

- **0 is not "fast", it is the old code path.** The `await` lives inside `show` behind a
  `pace.current > 0 &&` short-circuit, keeping every caller that settles a round inside a
  synchronous `act()` working — an `await` on a plain value still defers to a microtask.
- **`discard` and `answer` return `void`, never the promise** (bodies are
  `playDiscard`/`playAnswer`): a thenable returned from an `act(() => …)` callback switches React's
  `act` to its async path.
- **The pre-reaction frame comes from the engine, not from a delay** (`beforeReactions`), or a
  ponned tile only ever appears inside the meld it ends up in.
- **`callBanner` and `tedashi` are produced here** because only the driver knows _when_: `tedashi`
  is set on a throw out of the thirteen and **cleared** on one straight off the draw.

### The danger model (`core/danger.ts`) + the folding trainer

`assessDiscards` ranks every tile into danger tiers — **ordinal, never probabilistic**, on **public
information only**. **`TIER_SCORE` is one table, deliberately**: the calibration knob for the whole
trainer — tune there, never scatter the numbers. Ranks are **dense** over the score, and grading is
`rank === 0`, **never list position**.

**Genbutsu has two sources and the second is the one people forget**: the threat's own discards, and
anything anyone discarded after they declared without being ronned. Both derive from
`RoundState.discards`, **not `player.river`** — `finishTurn` pops a claimed discard out of the
river, and it is still a tile that seat threw. `threatViews(state)` is exported from `round.ts` so
`chooseFold` gets the exact view the trainer grades against.

**Generation** searches fresh random walls, yields between attempts, and **falls back to fewer
threats** rather than failing. When its riichi target is reached, every seat that has not declared
and is not manual switches to `'defense'`, and **"the moment" is literal**: the flip rides in
through `beforeReactions`, or a seat still on `'efficiency'` pons the tile it is about to defend
against. **The wall alone reproduces the board**, round wind and handover offset included;
generation keys only on what shapes the hand, **never on the per-seat algorithms**.

Because perspective moves, **the felt hand `FoldingPage` omits is the seat the board is _drawn
from_, never the drill's graded seat**.

Three reveal rules the UI must keep:

- **`showOpponentHands` is board-wide**, not one that carves the drill's answer key back out.
- **`showSeatWaits` gates the wait _tiles_ only**; the rule is **tiles on screen ⇒ badge**, never
  computed for a hand the reader cannot see. `waits` is not cheap, so `seatRead` runs **inside the
  snapshot builders**, never per render.
- **No tier below `genbutsu` may ever read as "safe"**: suji only ever spoke about ryanmen, and a
  wall only about runs.

**See:** [docs/model/danger.md](docs/model/danger.md)

### The EV model (`core/dealIn.ts`, `probability.ts`, `evModel.ts`, `ev.ts`, `placement.ts`)

The chain is one-way — `dealIn`/`probability` → `evModel` → `ev` → `algorithm.ts`, with
`placement.ts` hanging off `ev.ts` — and `danger.ts` and `policy.ts` are untouched by all of it.
What the models compute and why is the docs site. What breaks quietly:

- **`core/table.ts#evOf` is the only surface, and it is on demand, never a getter beside
  `ranked`/`danger`** — those are milliseconds and this is hundreds of them at 2-shanten.
- **`rankDiscards` needs the hand mid-turn and throws otherwise.** `Algorithm.riichi` is asked
  _after_ the discard, so its view holds thirteen tiles and ranking from it would leave a
  twelve-tile hand the DP can never complete.
- **A term's `value` is what the outcome is worth, never an expectation that already carries its own
  probability.** The win term takes `conditionalWin()` (`score / soloWin`), not `score` — pairing
  `soloWin` with `score` multiplies `P(win)` in twice and biases the whole decider toward folding.
- **The exhaustive-draw term belongs to the push branch alone.** `foldEv` never has one.
- **Honba is inside `Outlook.score` already**, so `price` must not add it to the win term twice.
  Riichi sticks are the opposite: nothing in `score.ts` knows about them.
- **`giveUpCost` excludes deal-ins**, by construction on both sides — they are priced per turn
  against the tile actually thrown, and adding them twice is the easiest mistake the interface
  invites.
- **Node values are never shared across the candidates of a ranking**: two candidates reach the same
  hand having drawn different things, so their pools differ. What is shared is everything depending
  on the hand alone.
- **`soloWin` is not a win rate and must never be shown with a percent sign.**
- **`objective` is not a presentation detail**: win, tenpai and score name different discards, so
  whatever consumes this says which on screen.
- **Ties are broken on the dora, then the id** (`ev.ts#byValue`) — at the end of a hand that cannot
  reach tenpai every term is identical across candidates, and `a.tile - b.tile` alone threw whatever
  sat nearest 1m.
- **A deal-in term's per-threat probabilities are scaled to the union** (`ev.ts#dealInShares`), not
  summed raw: a discard deals into one seat.
- **The safe half of the candidate union is skipped entirely with no threats declared** — every
  `combined` entry is zero there, so the sort would fall through to its `a - b` tie-break.
- **`EvModel.winValue` fires only where `Outlook.score` is undefined**, leaving the exact DP
  untouched wherever it ran. It takes a `HandShape`, never tiles, so a price never sees a hand.
- **`houou.unsupported(sanma)` returns the reason it may not speak, never a silent swap.**
- `ev.ts#foldRanking` is the fold branch priced per tile, leaving `foldEv` untouched so `EV_GOLDEN`
  does not move; `pushRankingOf` is its efficiency-side twin, always forcing `exhaustive: true`. The
  grading band both feed lives in `features/table/evGrade.ts`, not either trainer's folder.

**See:** [docs/model/push-fold.md](docs/model/push-fold.md),
[docs/model/limits.md](docs/model/limits.md)

### Situation URLs (`features/situation/urlCodec.ts`)

**`serializeTenhou` sorts** (hands); **`serializeTenhouOrdered` preserves order** (walls, rivers).

- **`wall` is the deal itself**, not a prefix consumed on the next draw — so the flipped indicator
  is the **9th of the 14**. A short wall is a prefix, completed at random by `completeWall`.
- `validateWall` sets `wallError` and empties `wall` rather than repairing: a silent repair hands
  back a different board than the link claimed. (Contrast `parseTenhou`, which drops a malformed
  digit.)
- **`log` is every seat's decisions**, replayed by `replayLog`, which puts every seat on `'manual'`
  and so consults no algorithm at all. Nothing in it is an extra tile.
- **`seed`/`hand` are the shanten trainer's alone.**
- The match context is carried **key-by-key and omitted at its default**: **`matchOverrides` builds
  `Partial<MatchState>` one key at a time rather than by spreading**, since a
  present-but-`undefined` key would clobber `createMatch`'s own default through a shallow merge.
- `Situation.round` is the prevalent-wind letter; `kyoku` is the number within it.
- What travels is the round's **starting** match, never the live `RoundState.match`: a riichi's 1000
  is re-applied when the link's `log` replays that discard.

### Trainer pattern (`src/features/*`)

The hooks keep mutable round state in a `useRef` and mirror render-ready snapshots into `useState`.

**A link names one hand, not every hand from here on** (`useLinkedHand`): every hook pairs a
`handIndex` counter with `fromLink` (`handIndex === 0`), and **every branch that replays what the
URL names must gate on `fromLink`**, or "new hand" re-poses the link's hand forever. `useRound.ts`'s
`restartCount` is the same counter under its table-layer name.

**Shanten is a continuous stream**: `submit()` grades, then bumps `handIndex` carrying `running`
forward, so the next hand is dealt already revealed with the previous feedback in `lastResult` —
which holds **its own tiles**, since the on-screen hand has moved on.

**The two efficiency trainers are two routes, not a checkbox.** Both run `wins: false` (a hand
ending on someone else's tsumo would cut a per-turn drill short on a result the player did not
cause) and `riichi: false`; solo also runs `calls: false`. Both stop at their own seat's discard
reaching tenpai, leaving 13 tiles so it reads as finished. **Grading and session state live in one
place, `useEfficiencyDrill`** — each app's hook only builds its own `RoundOptions` and `seatIndex`.
**`nuki` is not in the drill's return**, its shape differing per app.

Other rules that hold across trainers:

- `RoundState.visible` accumulates every face-up tile and feeds ukeire remaining counts.
- **Player count is derived per round (`options.sanma ? 3 : 4`) — never hardcode 4/3.**
- **"finished" is derived** (hand below 14 tiles), not stored — and it is a tile count, never "the
  drill is over": it holds for the whole window between the seat's discard and its next draw, which
  a pending claim keeps open. Anything that should appear only at drill end reads **`drillOver`**.
- **Sanma is "these ids have zero copies", not a smaller id space.** `NUM_TILE_TYPES` stays 34;
  `buildWall`/`deal` skip 2m-8m via `inTileSet`, and `improvingTiles`/`ukeire`/`evaluateDiscards`
  take a `sanma` flag.
- **Kita is graded, not free**: it reuses north's own `evaluateDiscards` entry (`NORTH = HONOR + 3`)
  against `ranked[0]` with `isBestDiscard`. No special tie-break is needed.
- **The table app (never solo) can grade a plain discard on the EV model instead of ukeire,
  Advanced-only and alpha.** `EfficiencyOptions.ev` exists only on the table hook's own types, so
  the mode is structurally unreachable in solo, not merely defaulted off. `applyEvGrade` overrides
  only `grade` (collapsed to binary ok/error — ukeire's `'warning'` already means "missed a free
  kan/kita", a different question) and leaves `yours`/`best`/`missed` untouched. **Kita and kan stay
  ukeire-graded regardless**, being themselves the call under evaluation.

**Stores.** Zustand: `settingsStore.ts` (persisted, **custom section-wise `merge` — extend it when
adding a section**, or old persisted schemas drop the new fields) and `store/log.ts` (session-only).
Rules of the game not scoped to one trainer — `sanma`, `aka`, `kiriageMangan` — are **top-level**
store fields, not inside a section.

**Log rows are written imperatively from user-triggered actions** (inside `discard()` / `submit()`),
**never from `useEffect`s watching round state** — effect-based logging inverts entry order and
duplicates under StrictMode.

- The one exception is the round-build effect (`logReplay`), which **deduplicates on the decoded
  situation/link object's identity**: that effect runs twice per mount and four times under
  StrictMode, which is also why those objects come from `useUrlData` (memoised per navigation).
- The `log.dealt` row is written per **board**, not per link, and **not off the `TableCore`**,
  tempting as that looks: `useRound` rebuilds in its own effect, so the core a render captured is
  still the outgoing board by the time a consumer's effect reads it.
- `BoardStage` clears the log during its **first render**, not from a mount effect — effects run
  children-first, so a page that logs as its round mounts would have those rows wiped a moment
  later.

**Per-seat table configuration** (`features/settings/tableSettings.ts`): `SeatConfig { modes; ev?
}`. **`Table` itself has no concept of a "player"** — what makes a seat one somebody plays is
`'manual'`.

- **Seat algorithms are board state, not a preference, and are not persisted.**
- **A reader acts from the seat the board is drawn from**, and perspective decides **which** manual
  seat's controls are live. **Perspective itself is not in this schema at all** — it is each page's
  own `viewSeat` `useState`. The page's `hand` slot follows perspective, not the acting seat, and is
  **click-through only when perspective and the seat mid-turn agree**.
- `resolveSeatConfig` guarantees at least one manual seat, **anchored on `defaultSeat`, never on
  perspective**; `fallbackModes` overrides the generic default with what the board is _actually_
  running.
- **Every patch sent to `onChange` is built off the _raw_ `SeatConfig`, never the resolved one.**
- **The graded `seatIndex` is the trainer's, never the seat panel's.**
- **Whether a manual seat is asked about another seat's discard is not a setting** — lab and match
  hardcode `claims: true`; folding and efficiency leave it unset.

`ManualControls` **renders nothing once the hand is over with nothing left to answer**, or in the
single-manual-seat, no-claim, no-riichi, own-perspective case, so every trainer mounts it
unconditionally. **Its `ended` flag never outranks a pending claim**, and **watching any seat other
than the one that owes the decision renders nothing at all** (`acting !== viewSeat`, with
`manualControlsVisible` in lockstep).

### UI

`Table.tsx` is the shared board: a 3x3 grid in tile widths (4fr/6fr/4fr = 14 across), seats placed
by `(seat - seatIndex + players) % players` and rotated `-90deg` per step. `BoardStage.tsx` **is the
trainer page** — no second layout, no `full` prop, and a boardless trainer's `children` render in
the board area rather than being dropped. `seatIndex` is the seat the board is drawn **from**, a
perspective, not "the user's seat".

**Board:**

- **Absence of `tsumogiri` on a `RiverTile` means tedashi.** Flags, not parallel arrays.
- **The caller owns the river's width, not `River`** — one that widens as it fills moves the hand
  under it.
- **`showsHands` counts melds and nuki as well as hands**: calls ride on the hand ring, so a board
  with no hands but one call still pays for the ring.
- **Points are board truth like `riichi`/`melds`, never `seatInfo`** — what the felt says must not
  depend on whether the seat panel is enabled.
- **A tedashi holds its own slot open; a tsumogiri never does**, and **a face-down row takes the
  hole in its middle instead** — `gapIndex` plus its `concealed` flag (`Tile.tsx`), since
  `BACK_TILE` filler puts a throw's sorted position past the last tile. **Both hands get it**
  (`SeatView.tedashi`, `HandDisplay.tedashi`), **only while the board is paced**, and a tsumogiri
  frame clears whatever the last throw left open.
- **Every seat's 14th tile is split off, not just the bottom hand's** (`SeatView.drawn`, via
  `splitDrawn`/`splitConcealedDrawn`).
- **The `call` banner is a _value_**, `{ seat, kind }`, whose lifetime belongs to whoever set it.
  **`Table` never derives which call a meld represents** — that is game logic in a pure view.
- **Board motion is mount-once CSS and nothing else** (`motion-safe:` everywhere, gated on
  `boardAnimation`). River tiles and melds are keyed positionally, so a landed tile is a new DOM
  node and an unconditional `animation` runs exactly once — no refs, no length diffing. **Discard
  origins are written in the river's own unrotated frame**, one keyframe pair for all four seats.
  The **tsumogiri flash** is drawn only when the standing `showTsumogiri` mark is off.
- **Each score pins to a square overlay that carries the seat's rotation**: a transform does not
  move the box it was laid out in.
- **`seatInfoNodes` is computed once per seat**, not per render.
- **The wind's fallback is `||`, never `??`**: a caller returning `seatsEnabled && <SeatStrip/>`
  hands back `false`, which a nullish check reads as a node.
- **Transient controls (claim prompt, kita/kan, riichi arm) render in `BoardStage`'s `controls`
  overlay, never in the `hand` slot** — the hand strip is `shrink-0` and its height feeds the board
  area's `100cqh`, so a control in flow there resizes the felt and walks the hand under the reader's
  finger. Pass `undefined`, never a node that renders empty: an empty card is still
  `pointer-events-auto`, a dead zone on the felt.

**Sizing — container units only, never pixels inside the square:**

- **`--tile-w: calc(100cqw/14)` goes on the outer div**, never the square, or a `w-full` child
  collapses when the board is a flex item.
- **Tracks stay `minmax(0,…)`**: a seat block is measured before it rotates.
- **The felt is `aspect-square w-full`, never `h-full`** — a percentage height against a box sized
  only by `aspect-ratio` is indefinite in WebKit. `e2e/board.spec.ts` asserts squareness; the bug
  class is invisible to Chrome/Firefox device emulation, which is why the UI suite runs a real
  WebKit.
- Cap is `calc(min(100%, 100cqh) * var(--board-scale, 1))` — `100cqh` against a declared size
  container is the height genuinely left, not an estimate.
- **`--board-scale`/`--tile-scale` apply from `sizable:` up only**, and `SIZABLE_QUERY` is that
  variant as a query — **keep the two in step**.
- **A ≥44px target on the felt comes from an `after:size-11` pseudo-element**, never a pixel height:
  a fixed `h-11` ran a phone-sized board's plate off the felt.
- **The stage is capped from `ultrawide:` up** at `--stage-max`, and **everything docked to that
  right edge is a child of the capped box — nothing re-derives the number**: the settings sheet
  portals into the stage element `absolute inset-0`, and `HomePage` wraps the menu in the same
  capped box off the same variable (`h-svh overflow-hidden`, menu scrolling inside), so the app box
  does not change width between home and a trainer.
- **`flow`'s board area is `container-type: inline-size`, not `size`** — size containment collapses
  a box that sizes itself to its own content. Content that rides up must be **a fixed size whatever
  it holds, and that is the page's job**.

**Session panel** (docked from `lg` via `WIDE_QUERY`, drawer below that):

- **Both halves override `--tile-w-base`, not `--tile-w` alone**, so a nested override composes with
  the panel's 0.6 instead of ignoring it.
- **`UkeireTiles` wraps per suit, never inside one**, and the grouping is in the component, not in
  whoever renders it.
- **`onLogOpen` (the clock pause) is derived from _drawer_ open, not panel open** — a docked panel
  hides nothing — and is reported from an effect on that one derived flag, so a resize, Escape or
  the scrim each resume exactly once and never lift a pause the reader pressed themselves.
- The drawer is the **stage's** child, not the board area's, so it covers the hand strip too.

**`LogList` is the feedback surface**, not a transcript beside one.

- **A row with no `severity` is a separate case from `'ok'` and must not fall back to it**
  (`NO_VERDICT`): a rewind, a replayed discard, the tenpai note and every lab row are not graded
  decisions, and a green spine beside one claims a verdict nobody gave. Spine width carries the
  signal alongside colour, for a colour-blind reader.
- **A `LogDetail` is an i18n key plus params and tiles, never text.** `folding.equallySafe` is
  logged unconditionally and gated **at render**, so the toggle reaches rows already on the record.
- **A detail line's three optional fields say what it _is_, and each has one owner.** `header` makes
  it the muted label above a list — written only when one follows, and it **draws no tiles**. `tone:
'error'` is decided where the wrong-answer _phrasing_ is (`fieldDetail`), never derived a second
  time. `seam` splits the line's tiles, subject leading and evidence following — so a tier whose
  evidence _is_ the subject (genbutsu) must drop it rather than draw it twice.
- **`LogDetail.bars`** is per-tile EV normalized on the ranking's own best entry (`fraction`,
  computed where the row is written, never in the renderer), built by the one shared
  `evGrade.ts#evBandDetail` under one locale key for both trainers that write it.
- **Ordinals are assigned before filtering**, so `log.rewound` stays honest.
- **`log.dealt`/`log.dealtHand` carry no tiles** — a hand is drawn on exactly one row, the one that
  grades it.
- **A tile is drawn once per row, and the sentence draws its own**: `splitTileCodes` tokenizes the
  **already-translated** sentence and `LogSentence` draws every tenhou code where it stood. So
  `LogEntry.tiles` carries only what the sentence **cannot** name, and **a locale string must never
  contain a bare code** (`0p`, `4z`) or it silently becomes a tile — `formatLogEntry.test.ts` walks
  the four JSONs and fails if one ever does.
- Its rewind/share buttons are the one sharing surface a trainer has — no page-level copy-link.

**Feedback is one line, everywhere.** `status` is **not** panel content — a clock behind a drawer
tap goes unread — so it is a HUD strip above the board at every viewport, **except held sideways**
(`short:`). **`status` is not `pointer-events-none` as a whole**: efficiency's ukeire line carries a
live `GlossaryTerm` trigger, so only the wrapper is inert. The verdict chip is **top-centre,
transient, `pointer-events-none` in every shape**. **Severity is derived at display level from the
existing grade/partial credit, never a new grading concept.**

**Chrome row**: back, `InfoButton`, the page's `TrainerToggles`, the `wall` slot, the log toggle,
settings **last** (`BoardStage` renders `SettingsButton` itself). Board pages pass no `wall` until
they have dealt, so the button is absent rather than empty. Names appear beside icons behind the
`labelled:` variant, and **the visible text is the same string the `aria-label` already used**, so
the accessible name never depends on the viewport.

**The settings dialog's own title never changes** — always `t('settings.button')`, portalled to
`<body>`. Ruleset and UI render unconditionally on every screen, including home; Misc holds the
Advanced switch alone, since flipping it changes what the other sections show. A hidden row must
never leave a feature silently running — `useAdvancedSettings` resolves the stored value either way.
The docs link is a plain `<a>`: **the docs are not a route, so a `<Link>` renders the crash page**
(`e2e/smoke.spec.ts` pins this).

**Fullscreen is not a mode with a button or a store.** `useMobileFullscreen` asks on phone-sized
viewports only, on the reader's **first `pointerdown`** — `requestFullscreen` is rejected outside a
real user gesture — and never again once they have left it. iOS Safari has no element fullscreen at
all, so `IOSInstallHint.tsx` points at the PWA instead: dismissible, persisted, **home page only**.
`viewport-fit=cover` plus `env(safe-area-inset-*)` padding keeps the layout clear of the bars, and
the chrome row's padding side flips with orientation.

**Tiles and assets.** Tiles are `<use>` references into a build-time sprite; components scale
locally by overriding `--tile-w`. Tailwind 4, dark mode a `dark` class on `<html>`, routing on
`basename: import.meta.env.BASE_URL`, PWA via `vite-plugin-pwa`.
**`workbox.navigateFallbackDenylist` keeps `/docs/` off the service worker's navigation fallback** —
without it an installed worker answers a docs URL with the app shell, which react-router crashes on,
and a first visit works so it ships unnoticed. The two app icons are hand-built SVGs, **not**
produced by the sprite script: transparent, with **no corner radius of their own** and deliberately
**`purpose: 'any'`, never `'maskable'`**, since a maskable crop would clip a tile that runs the
square's full height.

**Audience: technical depth for advanced players, defaults a beginner can still use** — both, not
one. Keep adding the precise feature, but ship it behind a setting whose default reads plainly to
someone who has never scored a hand. **A new option must never be something a beginner has to find
and change before the screen makes sense.**

Glossary rules (`features/i18n/glossary.ts`, marked inline with `<GlossaryTerm id="…">`):

- **Never derive the wiki URL from the term id** — a naming-convention guess drifts the moment the
  wiki's slugs don't match. Hand-check each.
- Terms a player is assumed to know (riichi, ippatsu) are deliberately absent.
- **A term mid-sentence in a translated string is wrapped `<term>…</term>` in the locale JSON and
  rendered via `Trans` + `components={{ term: <GlossaryTerm id="…" /> }}`** — this keeps word order
  correct per language and the term appearing exactly once. **Do not hand-split a translation string
  into prefix/suffix keys to fake it.**
- Pass `iconOnly` only when the surrounding label already spells the term out.
- A furiten seat's felt mark uses `InfoPopover` **directly**, not `GlossaryTerm`: the plate is
  rotated with its seat, so an inline hover card hangs sideways and the word draws at the page's
  16px instead of the board's `cqw` scale.

**See:** [docs/dev/architecture.md](docs/dev/architecture.md)

## Working rules

The commit rules, the census, the compatibility promises and the four places a new trainer must be
wired live in **[CONTRIBUTING.md](CONTRIBUTING.md)**. Four that bite often enough to repeat:

- **Verify per task before committing:** `npm test` · `npm run lint` · `npm run build`. A UX task
  also gets a real browser check at 390x844.
- **A behaviour change updates this file in the same wave.**
- **The golden hash protocol.** A refactor's proof is "the hashes are unchanged"
  (`round.golden.test.ts`), never "the tests still pass"; regenerate them only in the commit that
  changes behaviour, saying so in the message.
- `ja`/`zh` carry fewer keys than `en`/`it` by design (`src/features/i18n/localeSpecificKeys.ts`),
  so add all four anyway: `locales.test.ts` fails if a new shared key lands in only two locales, but
  it can't tell a genuine gap from one that belongs on that allowlist.
