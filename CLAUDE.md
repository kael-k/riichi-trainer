# CLAUDE.md

## What is in here, and what is not

This file is guidance for Claude Code, and it is **how the code works today**: the commands, the
layer rules, and the invariants — the rules whose default guess is wrong and whose breakage is
silent. One question decides whether a line belongs here: _would somebody get this wrong by
guessing, and would the breakage be quiet?_ If not, it goes somewhere else or nowhere.

- **`docs/`** — the documentation site (VitePress, served at `/docs`). Why the models say what they
  say: the danger and EV models, where the measured numbers come from, and the stated limits of
  both. Also the architecture map and the contributing rules. **English only, and never the source
  of an in-app string.**
- **`src/features/i18n/locales/`** — what a trainer is and how to use it, in four languages. The
  in-app intros and glossary are the user-facing documentation; the docs site does not duplicate
  them.
- **`README.md`** — the shop window, not documentation: what the app is, the routes, how to run it,
  and nothing else. **Never edit it unprompted.** Adding to it needs the user's explicit permission,
  asked before the edit (in the plan, when there is one) and stating exactly what would be added and
  why it cannot live elsewhere.

Precedence: **code > `CLAUDE.md` > the docs site.** A `###` section here that runs past ~10KB is
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

**`npm run build` empties `dist/`, so `docs:build` runs after it, never before** — the other way
round deletes the docs and sweeps the site into the PWA precache. CI does them in that order.

**Two files are generated and committed** (`src/assets/tiles/sprite.svg`, `src/core/hououPrior.ts`).
Edit the generator, never the output — including its comments, which the generator emits.

## Architecture

Three layers: pure engine (`src/core/`), URL situation codec
(`src/features/situation/urlCodec.ts`), React trainers built on both. `core/` imports nothing from
the app; `components/tiles/Table.tsx` imports no game logic. Both rules are load-bearing.

**See:** [docs/dev/architecture.md](docs/dev/architecture.md)

### Engine (`src/core/`) — pure TypeScript, zero dependencies, no React

- Tiles are `TileId` numbers 0–33 (9 man, 9 pin, 9 sou, 7 honors; offsets `MAN`/`PIN`/`SOU`/`HONOR`
  in `tiles.ts`).
- `Hand` (`hand.ts`) is a `Uint8Array(34)` of counts plus a fixed-meld count, and nothing else — no
  redness, no drawn tile.
- Which physical copies a seat holds is **stored, not inferred**. `PlayerState.concealed:
ParsedTile[]` (`round.ts`) is the concealed hand as held, redness included, kept sorted **except
  for its last element** while `PlayerState.drawn?: ParsedTile` is set — that 14th tile is appended
  rather than sorted in, which is what lets a discard know tedashi from tsumogiri without inferring
  it.
- `drawn` is always `concealed.at(-1)` while set, and is cleared the moment the tile leaves the hand
  (discard, kita, ankan) — before any algorithm decision reads it, so a `SeatView` never sees a
  `drawn` naming a tile no longer held.
- Both are maintained beside `hand.counts` at **every** mutation site: `take`, `drawReplacement`,
  `finishTurn`, the pon/chi meld loop, `callAnkan`, `callKita`, the deal loop. They can drift; the
  census test (`round.test.ts`) is the guard.
- `pickTile` (`round.ts`) is a **policy, not an inference**: given a plain and a red copy of one
  kind, throw the plain one — an explicit prefer-`!red` find over `concealed`.
- `ukeire(hand, visible)` computes remaining copies against a **caller-supplied** 34-length
  visibility array. `evaluateDiscards` ranks every discard (shanten asc, then ukeire desc); ties
  must be compared with `isBestDiscard` (shanten + ukeire count), **never by tile id**.
- Determinism: `rng.ts` (`mulberry32` seeded by string hash) + Fisher-Yates `shuffle`. Same seed
  string ⇒ same wall, which is what makes situations shareable.
- `wall.ts#deal` (seeded 13-tile deal, returns just the `Hand`) serves the shanten trainer; every
  other trainer goes through `round.ts#createRound`.
- Win legality is free from existing code: `decompose()` non-empty is the shape, `scoreHand()`
  returning null is "no yaku". Guard both behind a single `shanten()` call — that gate fails for
  almost every seat on almost every discard and everything past it is far more expensive.

**Performance.** `standardShanten` decomposes each suit separately and merges, ~475x faster than
searching all 34 kinds at once; **`referenceStandardShanten` is the specification it is proved
against in `shanten.test.ts`, not dead code** — change one, re-run that. Simulated players use
`bestDiscards` (shanten only) and price ukeire just for the tiles already tied. A round is ~17ms.

### Round and match: the naming model

A **round** is one deal; a **match** is the game the rounds sit inside. `core/round.ts` plays a
hand; `core/match.ts` holds what persists across them.

- `prevalentWind` is an honour tile id (`HONOR` = East) and pairs with `SeatView.seatWind`; `round`
  is which kyoku within it (East 1 is `1`).
- `honba` and `dealerRepeat` are **separate fields** — they diverge by ruleset — and are never
  collapsed into one.
- `MatchState` is **carry-in context, not a sequencer**. Riichi's 1000-point deduction is the only
  mutation `round.ts` ever makes to it, so **`createRound` takes a copy of `options.match`, never an
  alias** — a round must never write through to caller-owned options.
- **Dealer is not assumed to be seat 0**: `seatWind` is `HONOR + ((seat - dealer + players) %
players)`, "am I dealer" is `seat === state.match.dealer`, and the turn counter increments on the
  dealer's seat.
- **The sequencer is `match.ts#settleRound`, and it is never called from `round.ts`** — a round must
  not know what follows it. It prices from `Payments.total`/`.main`/`.fromDealer` (honba already
  folded in) rather than re-deriving the ruleset math.
- **A round is "redealt" by a fresh wall array identity, nothing more.**

### The round engine (`core/round.ts` + `core/policy.ts`)

`createRound(wall, players, options, fillSeed?)` deals off an **explicit wall in draw order**: the
deal (`players * 13`), then the live draws, then the trailing 14 the dead wall is cut from.

- **Every wall-index-to-seat mapping goes through `dealtSeat`/`dealtIndices`**: `validateWall`'s
  error zones, `wallWithHand`/`wallWithHands`, and the wall reveal's perspective highlight.
- **The wall is dealt in index order; play starts at the dealer.** The two are separate facts and
  only the first keeps `MatchState` out of an index-to-seat mapping.
- The dead wall is seven stacks: `doraStack`/`uraStack` are read off that block **backwards** (the
  deal's indicator is `chunk[8]` of a full 14) while each pair stays in draw order. The leading block
  is dealt `DEAL_CHUNKS = [4, 4, 4, 1]`, never a slab per seat.
- **A short wall is a prefix**, completed at random from the copies it leaves (`completeWall`) — the
  start of a _deal_, not one seat's hand. `players: 1` collapses to `wall[0..12]`.

**Stepping.** `beginTurn` (draw, then the tsumo check on the tile it drew, then kyuushu) and
`finishTurn` (the acting seat's own kita and kans, its discard, then everyone else's ron and calls);
`playRound` loops both, and a `stop` predicate ends it early — **the only thing trainers differ by**.
`stepRound(state, options, canAct?)` is the one stepper. It deliberately does **not** stop at a
manual seat, so "stop where a person must decide" rides in through `canAct`, asked once per turn
before anything is drawn. Its **`player.drawn` guard** is what makes it safe to resume into a turn
someone else started — `beginTurn` would otherwise draw a second tile on top.

Rejection sampling (deal a wall, play it, keep it if `accept` takes it) is capped and yields between
attempts, in plain loops **never driven through React** — a hundred simulations through state costs a
render apiece.

**Seats and algorithms.** `PlayerState.algorithm: SeatAlgorithm` (`'efficiency' | 'defense' |
'tsumogiri' | 'manual'`, `core/policy.ts`).

- `'manual'` is not "a human" — it is the algorithm "ask, don't decide", and it is **live**: flip it
  mid-hand and the next turn obeys, no redeal, no re-search. **Changing a player's algorithm must
  never change the hand.** `isManual(state, seat)` is the one predicate that reads it.
- `RoundOptions.algorithms?` only _seeds_ each player at `createRound`. The live value afterward
  lives on `PlayerState`.
- A manual seat is **drawn for but never decided for**: no auto-kita, no auto-riichi (riichi locks
  every later discard to tsumogiri, so it must stay the player's choice), no auto-pon/chi. More than
  one seat can be manual at once.
- What an algorithm _does_ is the seam's business, **never `algorithm === …` conditionals in
  `round.ts`**.

**Riichi overrides everything.** `forcedTsumogiri` overrides every algorithm **and every explicit
discard**, so it is the **first** branch in `finishTurn`'s choice of tile, never the fallback one —
in the `else` a manual seat in riichi could hand in any tile it liked. `HandDisplay`'s
`lockedToDrawn` renders the thirteen as plain tiles, leaving only the drawn one live.

**Claims.** `RoundOptions.claims?: boolean` (default **false**, so every graded drill stays
bit-for-bit unchanged) makes a manual seat get _asked_ about another seat's discard.

- While an answer is pending, `RoundState.claim` is set and **`beginTurn`/`finishTurn` are no-ops** —
  one guard in the shared functions, not one in every caller.
- `answerClaim` resolves through an internal **restartable** `resolveReactions`: it runs from the top
  on every answer and suspends again on the first seat that hasn't replied. Everything it re-runs is
  idempotent (`tryWin`/`couldHaveWon` restore the hand they probe, `missedWin` only ever goes true).
- **Three phases, in this order, and the order is the point: ask every manual seat first, then
  resolve rons in seat order, then calls.** That is what stops a pon answered early from outranking
  a ron the seat order says comes first.
- **Daiminkan and kakan are match-only** (`RoundOptions.calledKan`): `availableCalls` offers a
  `'minkan'` claim only when the flag is on, and `chooseCall` never receives it. Kakan upgrades an
  existing `'pon'` meld **by replacing the meld object, never mutating it**, since `snapshotTable`
  shallow-copies `melds` but keeps the same `Meld` references. **Chankan is not modelled.**
- `reconsiderClaim` re-enters `resolveReactions` from scratch when a seat stops being manual
  mid-claim. It **never invents a pass**: a pass sets `missedWin` and would poison the hand with
  furiten over a decision nobody made.
- **A manual seat's own tsumo is a call too.** `PendingWin` is the third `PendingClaim` shape and
  **one function raises it** — `offerOrEnd`. Every **self-drawn** win goes through it; a **ron never
  does**, and **neither does an AI seat**. Anything but `'tsumo'` hands the turn straight back with
  the fourteenth tile still in hand, and **leaves no furiten** — furiten is a rule about a ron you
  passed up.
- **The rinshan check lives in the three `call*` functions** (`replacementWin`), not in their
  callers, which is why `callAnkan` takes `RoundOptions`. Rinshan kaihou the yaku is unmodelled.

**Permissions live entirely in `RoundOptions`, never in `Table`.** Four flags, each shared by every
seat:

| Flag     | Gates                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| `wins`   | `tryWin` itself — `false` blocks ron **and** tsumo and drops the ron entry from `claimOptions` |
| `calls`  | Whether an AI algorithm may pon/chi at all                                                |
| `riichi` | `canDeclareRiichi`, for AI and manual seats alike                                          |
| `claims` | Whether a **manual** seat is _asked_ — about another seat's discard, and about its own tsumo |

Layering is legality (`RoundOptions`) → choice (the algorithm) → prompt (`claims`, manual seats only).
**`abortiveDraws` is a fifth field and deliberately not one of those four**: it says which ruleset is
being played, like `sanma`, so it defaults **on**.

**Kyuushu kyuuhai.** Nine or more distinct terminals and honours on a seat's own first draw with
nobody having melded.

- **"First draw, uninterrupted" is `river.length === 0` plus no melds anywhere, never `turn === 1`**
  — the counter says which go-around, not which draw. A kita is not a call and does not disqualify.
- **`beginTurn` asks after the tsumo check**, because a dealt thirteen-orphan kokushi is nine
  distinct terminals and a completed hand at once, and the win outranks the abort.
- `RoundState.ended` gains **`'abort'`**, not `'exhaustive'`: nobody is noten and nobody pays.
  Declining leaves no furiten and returns the turn where `beginTurn` suspended it.

**The riichi river mark is derived, not a one-shot flag.** `finishTurn` writes `entry.riichi` when
`player.riichiAt === player.river.length` — true for the declaration and again for the next discard
after a call popped the declaration tile out of the river. **`state.discards` keeps the called copy.**

`finishTurn`'s optional **`beforeReactions`** runs after the discard is on the river and any riichi
declared, **before any seat reacts**.

**Furiten.** Ron legality lives in `tryWin` alone, and `claimOptions` offers `'ron'` only when
`tryWin` returns a record — exactly one place can offer a furiten seat a ron, and it never does.

- **Own-river** furiten is derived, read through **`seatWaits(player, sanma)`, never `waits` on the
  live hand**: `waits` means its "13-tile hand" literally, so a hand mid-turn answers `0` and
  `improvingTiles` probes fifteen, returning the union of every tenpai-producing discard's wait
  rather than this hand's own. `seatWaits` removes `player.drawn` and puts it back.
- **Temporary** furiten is `PlayerState.missedWin`, lifted in `finishTurn` on the seat's own
  **discard** — the end of the turn that clears it, not the draw that opens it.
- It is `player.missedWin = !declaring && player.riichiAt !== undefined && player.missedWin`, **not
  a plain clear**. **`!declaring` is the load-bearing half** — `riichiAt` is set earlier in the same
  `finishTurn`, so without it the clause reads true for the first time on the declaring discard and
  freezes a temporary furiten into a permanent one.
- `missedWin` is set only for a seat that genuinely declined. A manual seat with `claims: false` is
  skipped **without being asked**.
- `couldHaveWon` tests the hand's **shape** and nothing else: a yakuless tenpai is furiten on its own
  waits like any other.

`policy.ts` holds the pure maths the algorithms are written in terms of — **every ranking with an
explicit tie-break, never sort stability**. **Calls happen only when they lower shanten _and_
`hasYakuRoute` still holds.**

### The decision seam (`core/algorithm.ts`)

Five decision points — the whole of a seat's own turn, pon/chi, riichi declaration, take-a-win,
abortive draw — are one dispatch table: `ALGORITHMS: Record<AIAlgorithm, Algorithm>`. `AIAlgorithm`
is `SeatAlgorithm` minus `'manual'`, which is **never a key here**.

**`turn(view): TurnAction` is one method, not four, because a turn's actions compete.** It is asked
**repeatedly until it answers with a discard** — a turn may hold several kans and several kita, each
drawing a replacement the next answer sees.

- **The loop is `round.ts#takeTurn`, called from `finishTurn` and nowhere else.** Asking from
  `beginTurn` too would make an `'ev'` seat run `rankDiscards` twice a turn.
- It runs **before `finishTurn` reads `forcedTsumogiri`**, since a nukidora pull replaces the tile a
  declared seat is locked to.
- **A manual seat never reaches it**; **a seat in riichi may pull a north and nothing else**; **an
  illegal action is a no-op, not a throw**. Bounded at four kans plus four kita, never `while (true)`.
- **Every replacement is win-checked by the loop**, because the three `call*` functions never do it
  themselves.
- `policy.ts#kanOptions` is the **one** notion of own-turn kan legality. Daiminkan is not in it.
- **Claim time is deliberately not collapsed.** Ron-beats-pon is a rule `resolveReactions` enforces
  in seat order, not a preference an algorithm may override.
- Adding an algorithm is one ~10-line object literal plus its `AIAlgorithm` member. **No base class,
  no `Partial` merge.**
- **The EV model and the objective are a per-seat field, not keys.** `PlayerState.ev: EvSeat
{ model, objective }` beside `algorithm`, live in exactly the same way. **Every seat carries an
  `EvSeat` and every non-`'ev'` seat ignores it** — an optional field is a default every reader has
  to remember.
- `TurnAction`'s `'discard'` carries `fromDrawn`, an **advisory** read of tedashi vs tsumogiri;
  `finishTurn` re-derives the river's actual flag from the tile `pickTile` really resolves.
- What an algorithm may know is a curated **`SeatView`**, never raw `RoundState`: public information
  only, plus its own hand and the board. `seen` and `threats` are **lazy getters**.
- `win(view, candidate)` is the one method with a second argument, already priced by `tryWin`.
- Purity: same view ⇒ same choice, every ranking a total order.
- **`SeatView.match` is the same object `RoundState.match` holds**, not a snapshot, so a mid-round
  riichi's deduction is visible to whoever reads it next.

### The table layer (`core/table.ts` + `features/table/useRound.ts`)

**`core/table.ts` is pure**, over a `TableCore` (`round`, `options`, per-page bookkeeping):

- `actingSeat(core)` is `round.seat`, **except that a pending claim outranks the turn order**.
- `TableCore` carries **no seat at all**. `seenBy(core, seat)` and `analysisOf(core, seat)` take the
  seat explicitly, and `snapshotTable` is uniformly per-seat.
- `snapshotTable` holds a **copy** of `MatchState` — points move mid-round, so a snapshot must not
  shift under whoever holds it.
- `analysisOf` returns **lazy getters, not eager fields**: `evaluateDiscards` costs ~476 shanten
  probes per turn.
- `goRound(core)` plays every AI-decided seat and stops at the next manual turn, a pending claim, or
  the hand's end.

**`useRound(input)` drives a round and reports what the engine did**; it has no opinion about what
any of it means. One callback, `onEvent({ event, core, replaying, analysis, logLength })`. A handler
steers by what it **returns**: nothing to carry on, `{ stop: true }` to halt where the board stands,
`{ restart: wall }` to abandon the deal.

- **`analysis` copies the hand** (captured at the draw that completes it, reported on the
  discard/kita/ankan that spends it), so grading measures the pre-throw hand.
- **`logLength`** is how long `round.log` was when the turn began: by report time the whole turn is
  applied, so a rewind link has to slice back to it.
- Replayed events are **reported, tagged `replaying: true`**, not suppressed.
- The round is built **once**, during the render that first needs a board (`ensureBuilt`); replayed
  events are queued by the build and drained by the effect so nothing grades or logs mid-render.

**Pacing is this layer's, and `pace: 0` must take no `await`.**

- **0 is not "fast", it is the old code path.** The `await` lives inside `show`, behind a
  `pace.current > 0 &&` short-circuit, which is what keeps every caller that settles a round inside a
  synchronous `act()` working. An `await` on a plain value still defers to a microtask, and that
  alone breaks them.
- **`discard` and `answer` return `void`, never the promise.** An `async` function hands back a
  promise even when its body never awaits, and a thenable returned from an `act(() => …)` callback
  switches React's `act` to its asynchronous path. Their bodies are `playDiscard`/`playAnswer`.
- **The pre-reaction frame comes from the engine, not from a delay** (`beforeReactions`) — otherwise
  a ponned tile only ever appears inside the meld it ends up in.
- **`callBanner` and `tedashi` are produced here** because only the driver knows _when_. `tedashi` is
  set on a throw out of the thirteen and **cleared** on one straight off the draw, so a hole never
  outlives the throw that opened it.

### The danger model (`core/danger.ts`) + the folding trainer

`assessDiscards` ranks every tile into danger tiers — **ordinal, never probabilistic**, judged on
**public information only**. **`TIER_SCORE` is one table, deliberately**: the calibration knob for
the whole trainer — tune there, never scatter the numbers. Ranks are **dense** over the score, and
grading is `rank === 0`, **never list position**.

**Genbutsu has two sources and the second is the one people forget**: the threat's own discards, and
anything anyone discarded after they declared without being ronned. Both derive from
`RoundState.discards`, **not `player.river`** — `finishTurn` pops a claimed discard out of the river,
and it is still a tile that seat threw. `threatViews(state)` is exported from `round.ts` so
`chooseFold` gets the exact same view the trainer grades against.

**Generation** searches fresh random walls, yields between attempts, and **falls back to fewer
threats** rather than failing. When its riichi target is reached, every seat that has not declared
and is not manual switches to `'defense'` — and **"the moment" is literal**: the flip rides in
through `beforeReactions`, because the declaration tile is one every other seat reacts to — applied a
moment later, a seat still on `'efficiency'` pons the tile it is about to defend against. **The wall
alone reproduces the board**, round wind and handover offset included.
Generation keys only on what shapes the hand, **never on the per-seat algorithms**.

Because perspective moves, **the felt hand `FoldingPage` omits is the seat the board is _drawn
from_, never the drill's graded seat**.

Three reveal rules the UI must keep:

- **`showOpponentHands` is board-wide**, not one that carves the drill's answer key back out.
- **`showSeatWaits` gates the wait _tiles_ only.** The rule is **tiles on screen ⇒ badge**, and it is
  never computed for a hand the reader cannot see. `waits` costs ~34 shanten probes per seat, so
  `seatRead` runs **inside the snapshot builders**, never per render.
- **No tier below `genbutsu` may ever read as "safe"**: suji only ever spoke about ryanmen, and a
  wall only about runs.

**See:** [docs/model/danger.md](docs/model/danger.md)

### The EV model (`core/dealIn.ts`, `probability.ts`, `evModel.ts`, `ev.ts`, `placement.ts`)

The chain is one-way — `dealIn`/`probability` → `evModel` → `ev` → `algorithm.ts`, with
`placement.ts` hanging off `ev.ts` — and `danger.ts` and `policy.ts` are untouched by all of it.
`core/hououPrior.ts` is **generated and committed**.

What the models compute and why is the docs site. What breaks quietly:

- **`core/table.ts#evOf` is the only surface, and it is on demand, never a getter beside
  `ranked`/`danger`** — those are a handful of milliseconds and this is hundreds at 2-shanten.
- **`rankDiscards` needs the hand mid-turn and throws otherwise.** `Algorithm.riichi` is asked
  _after_ the discard, so its view holds thirteen tiles; ranking from it would leave a twelve-tile
  hand the DP can never complete.
- **A term's `value` is what the outcome is worth, never an expectation that already carries its own
  probability.** The win term takes `conditionalWin()` (`score / soloWin`), not `score` — pairing
  `soloWin` with `score` multiplies `P(win)` in twice and biases the whole decider toward folding.
  Every existing test survived that: they check that a row adds up, not what its value is.
- **The exhaustive-draw term belongs to the push branch alone.** `foldEv` never has one.
- **Honba is inside `Outlook.score` already**, so `price` must not add it to the win term a second
  time. Riichi sticks are the opposite: nothing in `score.ts` knows about them.
- **`giveUpCost` excludes deal-ins**, by construction on both sides. Deal-ins are priced per turn
  against the tile actually thrown, and adding them twice is the easiest mistake the interface
  invites.
- **Node values are never shared across the candidates of a ranking** — two candidates reach the same
  hand having drawn different things, so their pools differ. What is shared is everything depending
  on the hand alone.
- **`soloWin` is not a win rate and must never be shown with a percent sign.**
- **`objective` is not a presentation detail**: win, tenpai and score name different discards.
  Whatever consumes this says which on screen.
- **Ties are broken on the dora, then the id** (`ev.ts#byValue`). At the end of a hand that cannot
  reach tenpai every term is identical across candidates, so **1.7% of priced turns tie exactly**,
  and `a.tile - b.tile` then threw whatever sat nearest 1m.
- **A deal-in term's per-threat probabilities are scaled to the union** (`ev.ts#dealInShares`), not
  summed raw: a discard deals into one seat.
- **The safe half of the candidate union is skipped entirely with no threats declared** — every
  `combined` entry is zero there, so the sort would fall through to its `a - b` tie-break.
- **`EvModel.winValue` fires only where `Outlook.score` is undefined** — the exact DP is untouched
  wherever it ran. It takes a `HandShape`, never tiles, so a price never sees a hand.
- **`houou.unsupported(sanma)` returns the reason it may not speak, never a silent swap.**
- `core/ev.ts#foldRanking` is the fold branch priced per tile; `foldEv` itself is untouched, so
  `EV_GOLDEN` does not move. `pushRankingOf` is its efficiency-side twin, always forcing
  `exhaustive: true`. The grading band both feed lives in `features/table/evGrade.ts`, not either
  trainer's folder.

**See:** [docs/model/push-fold.md](docs/model/push-fold.md), [docs/model/limits.md](docs/model/limits.md)

### Tenhou notation + situation URLs (the shared DSL)

Tenhou strings (`123m406p11z`, `0` = red five) are the interchange format everywhere.
**`serializeTenhou` sorts** (hands); **`serializeTenhouOrdered` preserves order** (walls, rivers).

`urlCodec.ts` round-trips a `Situation` through query params, so a URL fully reproduces a drill.

- **`wall` is the deal itself**, not a prefix consumed on the next draw — so the flipped indicator is
  the **9th of the 14**. A short wall is completed at random.
- This is the **one codec in the repo that rejects rather than repairs**: `validateWall` sets
  `wallError` and empties `wall`, since a silent repair hands back a different board than the link
  claimed. (Contrast `parseTenhou`, which drops a malformed digit.)
- **`log` is every seat's decisions**, replayed by `replayLog`, which puts every seat on `'manual'`
  and so **consults no algorithm at all**. Nothing in it is an extra tile.
- **`seed`/`hand` are the shanten trainer's alone.**
- The match context is carried **key-by-key and omitted at its default**. **`matchOverrides` builds
  `Partial<MatchState>` one key at a time rather than by spreading** — a present-but-`undefined` key
  would clobber `createMatch`'s own default through a shallow merge.
- `Situation.round` is the prevalent-wind letter; `kyoku` is the number within it.
- What travels is the round's **starting** match, never the live `RoundState.match`: a riichi's 1000
  is re-applied when the link's `log` replays that discard.
- **From 1.0 this format is committed** — an old link must keep resolving.

### Trainer pattern (`src/features/*`)

Each trainer is a page plus a `use*Round` hook. The hooks keep mutable round state in a `useRef` and
mirror render-ready snapshots into `useState`.

**A link names one hand, not every hand from here on** (`useLinkedHand`): every hook pairs a
`handIndex` counter with `fromLink` (`handIndex === 0`). **Every branch that replays what the URL
names must gate on `fromLink`**, or "new hand" re-poses the link's hand forever.
`useRound.ts`'s `restartCount` is this same counter under its table-layer name.

**Shanten is a continuous stream**: `submit()` grades, then bumps `handIndex` carrying `running`
forward, so the next hand is dealt already revealed with the previous feedback in `lastResult`
(which holds **its own tiles**, since the on-screen hand has moved on).

**The two efficiency trainers are two routes, not a checkbox.** Both run `wins: false` (a hand ending
on someone else's tsumo would cut a per-turn drill short on a result the player did not cause) and
`riichi: false`; solo also runs `calls: false`. Both stop at their own seat's discard reaching tenpai,
leaving 13 tiles so it reads as finished. The graded `seatIndex` comes from the link alone, never
from the seat panel.

**Grading and session state live in one place, `useEfficiencyDrill`.** Each app's own hook only
builds its own `RoundOptions` and `seatIndex` and calls the drill. **`nuki` is not in the drill's
return** — its shape differs per app.

Other rules that hold across trainers:

- `RoundState.visible` accumulates every face-up tile and feeds ukeire remaining counts.
- **Player count is derived per round (`options.sanma ? 3 : 4`) — never hardcode 4/3.**
- **"finished" is derived** (hand below 14 tiles), not stored — and it is a tile count, never "the
  drill is over": it is true for the whole window between the seat's discard and its next draw, which
  a pending claim holds open. Anything that should appear only at drill end reads **`drillOver`**.
- **Sanma is "these ids have zero copies", not a smaller id space.** `NUM_TILE_TYPES` stays 34;
  `buildWall`/`deal` skip 2m-8m via `inTileSet`, and `improvingTiles`/`ukeire`/`evaluateDiscards`
  take a `sanma` flag.
- **Kita is graded, not free**: it reuses north's own `evaluateDiscards` entry (`NORTH = HONOR + 3`)
  compared against `ranked[0]` with `isBestDiscard`. No special tie-break is needed.
- **The table app (never solo) can grade a plain discard on the EV model instead of ukeire,
  Advanced-only and alpha.** `EfficiencyOptions.ev` exists only on the table hook's own types, so the
  mode is structurally unreachable in solo, not merely defaulted off. `applyEvGrade` overrides only
  `grade` (collapsed to binary ok/error — ukeire's `'warning'` already means "missed a free
  kan/kita", a different question) and leaves `yours`/`best`/`missed` untouched. **Kita and kan stay
  ukeire-graded regardless**, since they are themselves the call being evaluated.

**Stores.** Zustand: `settingsStore.ts` (persisted; **has a custom section-wise `merge` — extend it
when adding a section**, or old persisted schemas drop the new fields) and `store/log.ts`
(session-only). **Do not bump the persist version to drop a stale key** — a bump drops the whole
blob, costing every reader their theme, language and settings; from 1.0 a schema change needs a real
migration in that `merge`. Rules of the game that are not scoped to one trainer — `sanma`, `aka`,
`kiriageMangan` — are **top-level** store fields, not inside a section.

**Log rows are written imperatively from user-triggered actions** (inside `discard()` / `submit()`),
**never from `useEffect`s watching round state** — effect-based logging inverts entry order and
duplicates under StrictMode.

- The one exception is the round-build effect (`logReplay`). It **deduplicates on the decoded
  situation/link object's identity**, since that effect runs twice per mount and four times under
  StrictMode, which is also why those objects come from `useUrlData` (memoised per navigation).
- The `log.dealt` row is written per **board**, not per link. **Not the `TableCore`**, tempting as it
  looks: `useRound` rebuilds in its own effect, so the core a render captured is still the outgoing
  board by the time a consumer's effect reads it.
- `BoardStage` clears the log during its **first render**, not from a mount effect — effects run
  children-first, so a page that logs as its round mounts would have those rows wiped a moment later.

**Per-seat table configuration** (`features/settings/tableSettings.ts`): `SeatConfig { modes; ev? }`.
**`Table` itself has no concept of a "player"** — the only thing that makes a seat one somebody plays
is `'manual'`.

- **Seat algorithms are board state, not a preference, and are not persisted.**
- **A reader acts from the seat the board is drawn from.** Perspective decides **which** manual
  seat's controls are live. **Perspective itself is not in this schema at all** — each page's own
  `viewSeat` `useState`. The page's own `hand` slot follows perspective, not the acting seat, and is
  **click-through only when perspective and the seat mid-turn agree**.
- `resolveSeatConfig` guarantees at least one manual seat, **anchored on `defaultSeat`, never on
  perspective**. `fallbackModes` overrides the generic default with what the board is _actually_
  running, so the panel never shows an algorithm it isn't running.
- **Every patch sent to `onChange` is built off the _raw_ `SeatConfig`, never the resolved one.**
  Writing resolved fallbacks back made an unrelated change look like a real `modes` edit and
  re-searched folding for a new hand.
- **The graded `seatIndex` is the trainer's, never the seat panel's.**
- **Whether a manual seat is asked about another seat's discard is not a setting** — lab and match
  hardcode `claims: true`; folding and efficiency leave it unset.

`ManualControls` **renders nothing once the hand is over with nothing left to answer**, or in the
single-manual-seat, no-claim, no-riichi, own-perspective case, so every trainer mounts it
unconditionally. **Its `ended` flag never outranks a pending claim.** **Watching any seat other than
the one that owes the decision renders nothing at all** (`acting !== viewSeat`, with
`manualControlsVisible` in lockstep).

### UI

`Table.tsx` is the shared board: a 3x3 grid in tile widths (4fr/6fr/4fr = 14 across), seats placed by
`(seat - seatIndex + players) % players` and rotated `-90deg` per step. `BoardStage.tsx` **is the
trainer page** — no second layout, no `full` prop; `board` is optional and a boardless trainer's
`children` render in the board area rather than being dropped. `seatIndex` is only which seat the
board is drawn **from** — a perspective, not "the user's seat".

**Board:**

- **Absence of `tsumogiri` on a `RiverTile` means tedashi.** Flags, not parallel arrays.
- **The caller owns the river's width, not `River`** — a river that widens as it fills moves the hand
  under it.
- **`showsHands` counts melds and nuki as well as hands.** A seat's calls ride on its hand ring, so a
  board with no hands but one call still has to pay for the ring, or those calls land across a river.
- **Points are board truth like `riichi`/`melds`, never `seatInfo`.** Routing board state through the
  page's render prop would make what the felt says depend on whether the seat panel is enabled.
- **A tedashi holds its own slot open; a tsumogiri never does.** The tile in flight looks the same
  either way, so the read is at the other end: the tile thrown out of the thirteen leaves its slot
  empty for the flight time (`gapIndex` in `Tile.tsx`, pure presentation over the sort the row is
  already drawn in). **A face-down row takes the hole in its middle instead**, and `gapIndex`'s
  `concealed` flag is what says so: every trainer but efficiency hands the felt `BACK_TILE` filler
  for a hidden seat, so the sorted position of anything thrown out of one is past the last tile — a
  spacer a centred row renders as a half-tile shudder rather than a hole. **Both hands get it**:
  `SeatView.tedashi` for the felt's rows and `HandDisplay.tedashi` for the hand below the board.
  **Only while the board is paced.** A tsumogiri frame clears whatever the previous throw left open.
- **Every seat's 14th tile is split off, not just the bottom hand's** (`SeatView.drawn`, filled via
  `splitDrawn`/`splitConcealedDrawn`). Without it an opponent mid-turn draws as an undifferentiated
  block of fourteen.
- **The `call` banner is a _value_**, `{ seat, kind }`. **`Table` never derives which call a meld
  represents** — a meld-count diff plus `meld.kind` is game logic in a pure view. Its lifetime
  belongs to whoever set it.
- **Board motion is mount-once CSS and nothing else** (every use site `motion-safe:` and gated on
  `boardAnimation`). River tiles and melds are keyed positionally, so the tile that just landed is a
  new DOM node and an unconditional `animation` runs exactly once — no refs, no length diffing.
  **Discard origins are written in the river's own unrotated frame**, so one keyframe pair covers all
  four seats. The **tsumogiri flash** is drawn only when the standing `showTsumogiri` mark is off.
- **Each score pins to a square overlay that carries the seat's rotation**, never positioned per seat
  and then turned: a transform does not move the box it was laid out in.
- **`seatInfoNodes` is computed once per seat**, not per render.
- **The wind's fallback is `||`, never `??`**: a caller returning `seatsEnabled && <SeatStrip/>` hands
  back `false`, which a nullish check reads as a node and drops the wind entirely.
- **Transient controls (the claim prompt, kita/kan, the riichi arm) render in `BoardStage`'s
  `controls` overlay, never in the `hand` slot.** The hand strip is `shrink-0` and its height feeds
  the board area's `100cqh` — a control laid out in flow there resizes the felt when it appears, and
  walks the hand under the reader's finger. A page must compute whether it has anything to show and
  pass `undefined` rather than a node that renders empty — `controls && …` can't tell an empty turn
  from a busy one, and an empty card is still `pointer-events-auto`, a dead zone on the felt.

**Sizing — container units only, never pixels inside the square:**

- **`--tile-w: calc(100cqw/14)` goes on the outer div**, never on the square, or a `w-full` child
  collapses when the board is a flex item.
- **Tracks stay `minmax(0,…)`**: a seat block is measured before it rotates.
- **The felt is `aspect-square w-full`, never `h-full`** — a percentage height against a box that
  gets its height only from `aspect-ratio` is indefinite in WebKit. `e2e/board.spec.ts` asserts
  squareness; the bug class is invisible to Chrome/Firefox device emulation, which is why the UI
  suite runs a real WebKit.
- Cap is `calc(min(100%, 100cqh) * var(--board-scale, 1))` — `100cqh` against a declared size
  container, so it is the height genuinely left rather than an estimate.
- **`--board-scale`/`--tile-scale` apply from `sizable:` up only.** `SIZABLE_QUERY` is that variant
  as a query — **keep the two in step**.
- **A ≥44px target on the felt comes from an `after:size-11` pseudo-element**, never a pixel height:
  a fixed `h-11` ran a phone-sized board's plate off the felt.
- **The stage itself is capped from `ultrawide:` up** at `--stage-max`. **Everything docked to that
  right edge is a child of the capped box and inherits the cap — nothing re-derives the number.** The
  settings sheet portals into the stage element and is `absolute inset-0` there. `HomePage` puts that
  same capped box round the menu, off the same variable, so the app box does not change width between
  home and a trainer. Its box is `h-svh overflow-hidden` with the menu scrolling inside — a page
  taller than the viewport would otherwise stretch a full-height sheet past the bottom of the screen.
- **`flow`'s board area is `container-type: inline-size`, not `size`** — size containment collapses a
  box that sizes itself to its own content. Content that rides up must be a **fixed size whatever it
  holds, and that is the page's job**: a hand that moves under the pointer is a hand you misclick.

**Session panel** (docked from `lg` via `WIDE_QUERY`, drawer below that):

- **Both halves override `--tile-w-base`, not `--tile-w` alone**, so a nested override composes with
  the panel's 0.6 instead of ignoring it.
- **`UkeireTiles` wraps per suit, never inside one**: it groups its tiles by suit and each group is
  one non-wrapping flex item. The grouping is in the component, not in whoever renders it.
- **`onLogOpen` (the clock pause) is derived from _drawer_ open, not panel open** — a docked panel
  hides nothing — and is reported from an effect on that one derived flag, so a resize, Escape or the
  scrim each resume exactly once and never lift a pause the reader pressed themselves.
- The drawer is the **stage's** child, not the board area's, so it covers the hand strip too.

**`LogList` is the feedback surface**, not a transcript beside one.

- **A row with no `severity` is a separate case from `'ok'` and must not fall back to it**
  (`NO_VERDICT`). A rewind, a replayed discard, the tenpai note and every lab row are not graded
  decisions, and a green spine beside one claims a verdict nobody gave. Spine width carries the
  signal alongside colour, for a colour-blind reader.
- **A `LogDetail` is an i18n key plus params and tiles, never text.** `folding.equallySafe` is logged
  unconditionally and gated **at render**, so the toggle reaches rows already on the record.
- **A detail line's three optional fields say what it _is_, and each has one owner.** `header` makes
  it the muted label above a list — written only when one follows, and it **draws no tiles**.
  `tone: 'error'` is decided where the wrong-answer _phrasing_ is decided (`fieldDetail`), never
  derived a second time. `seam` splits the line's tiles: the subject leads, the evidence follows — so
  a tier whose evidence _is_ the subject (genbutsu) must drop it rather than draw it twice.
- **`LogDetail.bars`** is per-tile EV, normalized on the ranking's own best entry (`fraction`,
  computed where the row is written, never in the renderer). Built by the one shared
  `evGrade.ts#evBandDetail` under one locale key for both trainers that write it.
- **Ordinals are assigned before filtering**, so `log.rewound` stays honest.
- **`log.dealt`/`log.dealtHand` carry no tiles** — a hand is drawn on exactly one row, the one that
  grades it.
- **A tile is drawn once per row, and the sentence draws its own.** `splitTileCodes` tokenizes the
  **already-translated** sentence and `LogSentence` draws every tenhou code where it stood. Two
  consequences: `LogEntry.tiles` carries only what the sentence **cannot** name, and a locale string
  must never contain a bare code (`0p`, `4z`) of its own or it silently becomes a tile.
  `formatLogEntry.test.ts` walks the four JSONs and fails if one ever does.
- Its rewind/share buttons are the one sharing surface a trainer has — no page-level copy-link.

**Feedback is one line, everywhere.** `status` is **not** panel content — a clock behind a drawer tap
goes unread — so it is a HUD strip above the board at every viewport, **except held sideways**
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
`<body>`. Two sections render unconditionally on every screen, including home: Ruleset and UI; Misc
holds the Advanced switch alone, since flipping it changes what the other sections show. A hidden
row must never leave a feature silently running — `useAdvancedSettings` resolves the stored value
either way. The docs link sits at the bottom of the dialog, and it is a plain `<a>`: **the docs are
not a route, so a `<Link>` renders the crash page** (`e2e/smoke.spec.ts` pins this).

**Fullscreen is not a mode with a button or a store.** `useMobileFullscreen` asks on phone-sized
viewports only, on the reader's **first `pointerdown`** — `requestFullscreen` is rejected outside a
real user gesture — and never again once they have left it. iOS Safari has no element fullscreen at
all; `IOSInstallHint.tsx` points at the PWA instead — dismissible, persisted, **home page only**.
`viewport-fit=cover` plus `env(safe-area-inset-*)` padding keeps the layout clear of the bars; the
chrome row's padding side flips with orientation.

**Tiles and assets.** Tiles are `<use>` references into a build-time sprite; components scale locally
by overriding `--tile-w`. Tailwind 4, dark mode a `dark` class on `<html>`, routing on
`basename: import.meta.env.BASE_URL`, PWA via `vite-plugin-pwa`. **`workbox.navigateFallbackDenylist`
keeps `/docs/` off the service worker's navigation fallback** — without it an installed worker
answers a docs URL with the app shell, which react-router then crashes on, and a first visit works so
it ships unnoticed. The two app icons are hand-built SVGs, **not** produced by the sprite script:
transparent with **no corner radius of their own** and deliberately **`purpose: 'any'`, never
`'maskable'`** — a maskable crop would clip a tile that runs the square's full height.

**Mobile-first is a project goal**: touch targets ≥44px (`min-h-11`), layouts work at phone widths.

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
- A furiten seat's felt mark uses `InfoPopover` **directly**, not `GlossaryTerm`: the plate is rotated
  with its seat, so an inline hover card hangs sideways and the word draws at the page's 16px instead
  of the board's `cqw` scale.

**See:** [docs/dev/architecture.md](docs/dev/architecture.md)

## Working rules

- **One task = one commit**, conventional prefix (`feat`/`fix`/`refactor`/`test`/`docs`/`UX`).
- **Verify per task before committing:** `npm test` · `npm run lint` · `npm run build`. A UX task also
  gets a real browser check at 390x844.
- **A behaviour change updates this file in the same wave.**
- **The golden hash protocol.** `round.golden.test.ts` is the only thing that catches a silently
  reordered tie-break. A refactor's proof is "the hashes are unchanged", never "the tests still
  pass"; regenerate them only in the commit that changes behaviour, saying so in the message.
- **The census** (`round.test.ts`) asserts every tile kind is accounted for exactly four times (zero
  for 2m-8m under sanma) and that each seat's `concealed` still agrees with `hand.counts`.
- **From 1.0, situation URLs and the persisted settings schema are committed formats.**

**Adding a trainer** — four places, every time, or the route is half-wired:

- `src/routes/index.tsx` — the route table
- `src/routes/HomePage.tsx` — the `MODES` array
- `src/features/i18n/trainerLinks.ts` — `TRAINER_WIKI`
- `src/features/i18n/locales/{en,ja,zh,it}.json` — `trainer.<name>.*`

`ja`/`zh` carry fewer keys than `en`/`it` by design (glossary terms, yaku tables, trainer intros,
`_one` plurals — `src/features/i18n/localeSpecificKeys.ts`), so add all four anyway:
`locales.test.ts` fails if a new shared key lands in only two locales, but it can't tell a genuine
gap from one that belongs on that allowlist.
