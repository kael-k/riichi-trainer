# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is in here, and what is not

This file is **how the code works today**: the commands, the layer rules, and the invariants — the
rules whose default guess is wrong and whose breakage is silent. It does not carry _why_, and it
does not carry the alternatives that were tried and lost. Those live in `docs/adr/`, one hop away
behind the `**Why:**` line each section ends with ([ADR-0031](docs/adr/0031-claude-md-carries-how-not-why.md)).

- **`docs/adr/`** — _why_ it works that way. One decision per file, superseded rather than edited.
  Read the relevant ADR before proposing to change a design; write a new one when a decision moves,
  in the same commit as the code. **Only two cases warrant a new ADR**: it supersedes or amends a
  currently Accepted ADR, or the decision is architecturally significant (a layer boundary, an
  invariant future code must not violate, a rejected alternative worth not re-proposing). A small
  fix, a UI tweak, or anything whose rationale fits in a code comment does not get one.
- **`docs/STRUCTURE.md`** — _where_ things live: an annotated source map and the dependency rules.
- **`docs/STATUS.md`** — what is shipped, in flight, known broken, or out of scope on purpose. Read
  it before starting anything; update it when that changes.
- **`README.md`** — the shop window, not documentation: what the project is, the routes, how to run
  it, and nothing else. **No** per-trainer walkthroughs, no settings tours, no rationale, no
  implementation detail, no reference tables — a reader looking at this repo already knows what a
  shanten trainer is, and everything else lives in one of the files above or in the code. The
  situation-URL params are `urlCodec.ts` itself; the two `wall=` examples worth quoting anywhere are
  `src/features/situation/wallExamples.test.ts`, which proves them against the engine.
  **Never edit it unprompted.** Adding to it needs the user's explicit permission, asked before the
  edit (in the plan, when there is one) and stating exactly what would be added and why it cannot
  live in one of those other files.

`docs/README.md` explains the precedence between them and the working rules (one plan file, one task
per commit). A `###` section here past ~10KB is carrying rationale that belongs in an ADR.

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

## Architecture

Three layers: pure engine (`src/core/`), URL situation codec
(`src/features/situation/urlCodec.ts`), React trainers built on both. `core/` imports nothing from
the app; `components/tiles/Table.tsx` imports no game logic. Both rules are load-bearing.

**Why:** [ADR-0001](docs/adr/0001-three-layers.md), [ADR-0014](docs/adr/0014-table-is-a-pure-view.md)

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
  census test (`round.test.ts`) is the guard, asserting per player that `concealed` tallies to
  `counts` per kind and that `drawn === concealed.at(-1)` whenever set.
- `pickTile` (`round.ts`) is a **policy, not an inference**: given a plain and a red copy of one
  kind, throw the plain one — an explicit prefer-`!red` find over `concealed`.
- `shanten.ts`: per-suit 5-block decomposition for standard shanten; closed-form chiitoitsu and
  kokushi; `shanten()` takes the minimum, skipping chiitoi/kokushi when melds exist.
- `ukeire(hand, visible)` computes remaining copies against a **caller-supplied** 34-length
  visibility array. `evaluateDiscards` ranks every discard (shanten asc, then ukeire desc); ties
  must be compared with `isBestDiscard` (shanten + ukeire count), **never by tile id**.
- Determinism: `rng.ts` (`mulberry32` seeded by string hash) + Fisher-Yates `shuffle`; `wall.ts`
  builds the 136-tile wall. Same seed string ⇒ same wall, which is what makes situations shareable.
- `wall.ts#deal` (seeded 13-tile deal, returns just the `Hand`) serves the shanten trainer; every
  other trainer goes through `round.ts#createRound`.
- Win legality is free from existing code: `decompose()` non-empty is the shape, `scoreHand()`
  returning null is "no yaku". Guard both behind a single `shanten()` call — that gate fails for
  almost every seat on almost every discard and everything past it is far more expensive.

**Performance.** `standardShanten` decomposes each suit separately and merges, ~475x faster than
searching all 34 kinds at once, because a draw probe perturbs one suit and the other three come out
of the cache. **`referenceStandardShanten` is the old whole-hand search, kept solely as the
specification** the fast one is proved against over thousands of random hands in `shanten.test.ts` —
change one, re-run that. Simulated players use `bestDiscards` (shanten only) and price ukeire just
for the tiles already tied. A round is ~17ms.

**Why:** [ADR-0002](docs/adr/0002-determinism-and-tenhou-notation.md), [ADR-0022](docs/adr/0022-stored-redness.md), [ADR-0016](docs/adr/0016-testing-strategy.md)

### Round and match: the naming model

A **round** is one deal (deal, draws, discards, a win or an exhaustive draw); a **match** is the
game the rounds sit inside. `core/round.ts` plays a hand; `core/match.ts` is a small, standalone,
pure module holding what persists _across_ rounds:

```ts
MatchState { prevalentWind, round, honba, dealerRepeat, dealer, riichiSticks, points }
createMatch(sanma, overrides?)   // East 1, zeros, dealer 0, 25000 yonma / 35000 sanma
```

- `prevalentWind` is an honour tile id (`HONOR` = East) and pairs with `SeatView.seatWind`; `round`
  is which kyoku within it (East 1 is `1`).
- `honba` and `dealerRepeat` are **separate fields** — they diverge by ruleset — and are never
  collapsed into one.
- It is **carry-in context, not a sequencer**: no `nextRound()`, no dealer rotation, no honba
  increment, no payouts, no end-of-match detection.
- The one in-round mutation is riichi (`finishTurn` takes 1000 off `state.match.points[seat]` and
  adds a stick), so **`createRound` takes a copy of `options.match`, never an alias** — a round must
  never write through to caller-owned options.
- Dealer is not assumed to be seat 0: `seatWind` is `HONOR + ((seat - dealer + players) % players)`,
  "am I dealer" is `seat === state.match.dealer`, and the turn counter increments on the dealer's
  seat. `RoundState.match.honba` feeds `ScoringRules.honba`'s 300/100 payout maths.

**Why:** [ADR-0023](docs/adr/0023-round-inside-match.md), [ADR-0006](docs/adr/0006-one-match-engine.md)

### The round engine (`core/round.ts` + `core/policy.ts`)

One deterministic hand of mahjong drives every trainer. `createRound(wall, players, options,
fillSeed?)` deals off an **explicit wall in draw order**: the deal (`players * 13`), then the live
draws, then the trailing 14 the dead wall is cut from.

- The dead wall is **seven stacks, not three blocks**: five dora stacks, each an indicator over the
  ura that pays out under it, then the four rinshan at the tail (the end `drawReplacement` pops
  from, backfilling at the head off the live wall's tail). The deal's indicator is the stack nearest
  the rinshan (`chunk[8]` of a full 14) and each kan dora walks back toward the live wall, so
  `doraStack`/`uraStack` are read off that block **backwards** while each pair stays in draw order.
- The leading block is dealt the way a table deals: `DEAL_CHUNKS = [4, 4, 4, 1]` — four tiles to
  each seat in index order, three times round, then one apiece. No seat's thirteen sit as a slab.
- **Every wall-index-to-seat mapping goes through `dealtSeat`/`dealtIndices`**: `validateWall`'s
  error zones, `wallWithHand`/`wallWithHands` (the only way to pin a hand, and what the tests build
  claim scenarios with), and the wall reveal's perspective highlight.
- Seats are served in **index order**, not from the dealer — which keeps `MatchState` out of every
  index-to-seat mapping.
- **A short wall is a prefix**, completed at random from the copies it leaves (`completeWall`). A
  13-tile prefix is the start of a _deal_, not one seat's hand. `players: 1` collapses to
  `wall[0..12]`.

**Stepping.** `beginTurn` (draw) and `finishTurn` (discard, then everyone else's ron and calls);
`playRound` loops both, and a `stop` predicate ends it early — **the only thing trainers differ by**.
`stepRound(state, options, canAct?)` is the one stepper, a generator every other runner sits on. It
deliberately does **not** stop at a manual seat (`finishTurn` covers one by borrowing
`'efficiency'`'s discard), so "stop where a person must decide" rides in through `canAct`, asked
once per turn before anything is drawn. Its **`player.drawn` guard** is what makes it safe to resume
into a turn someone else started — a live algorithm flip, a replayed log — since `beginTurn` would
otherwise draw a second tile on top.

A trainer needing a _particular kind_ of hand rejection-samples: deal a fresh wall, play it out,
keep it if an `accept` callback takes it, else retry — capped attempts, yielding between them.
Scoring's `findWall` and folding's `findRound` are separate copies because each accepts on something
different; `round.ts`'s own `findRound`/`findRoundAsync` are **used only by tests**. All are plain
loops, never driven through React — a hundred simulations through state costs a render apiece.

**Seats and algorithms.** Every seat is a **player**, and a player has an **algorithm**:
`PlayerState.algorithm: SeatAlgorithm` (`'efficiency' | 'defense' | 'tsumogiri' | 'manual'`,
`core/policy.ts`).

- `'manual'` is not "a human" — it is the algorithm "ask, don't decide", and it is **live**: flip
  it mid-hand and the next turn obeys, no redeal, no re-search. **Changing a player's algorithm must
  never change the hand.** `isManual(state, seat)` is the one predicate that reads it.
- `RoundOptions.algorithms?: readonly SeatAlgorithm[]` only _seeds_ each player at `createRound` (a
  seat with no entry starts on `'efficiency'`). The live value afterward lives on `PlayerState`, not
  on `RoundOptions`.
- A manual seat is **drawn for but never decided for**: no auto-kita, no auto-riichi (riichi locks
  every later discard to tsumogiri, so it must stay the player's choice), no auto-pon/chi (a call
  opens a hand its player never chose to open). More than one seat can be manual at once.
- What an algorithm _does_ is the seam's business, never `algorithm === …` conditionals in
  `round.ts`. `'defense'` discards by `chooseFold` (full betaori) and never declares, calls or wins.

**Riichi overrides everything.** `forcedTsumogiri` overrides every algorithm **and every explicit
discard**, so it is the **first** branch in `finishTurn`'s choice of tile, never the fallback one —
in the `else` it reached only the seats nobody was deciding for, and a manual seat in riichi could
hand in any tile it liked. Replay is unaffected: a riichi seat's logged discard is its drawn tile
already. The UI keeps its half rather than offering a choice the engine will refuse —
`HandDisplay`'s `lockedToDrawn` (passed by the three board pages as `round.riichi[round.acting]`)
renders the thirteen as plain tiles, leaving only the drawn one live.

**Claims.** `RoundOptions.claims?: boolean` (default **false**, so every existing graded drill stays
bit-for-bit unchanged) makes a manual seat get _asked_ about another seat's discard instead of being
silently skipped.

- While an answer is pending, `RoundState.claim` is set and **`beginTurn`/`finishTurn` are
  no-ops** — one guard in the shared functions, not one in every caller that steps a round.
- `answerClaim` resolves through an internal **restartable** `resolveReactions`: it runs from the
  top on every answer, reads replies out of `claim.answers`, and suspends again on the first seat
  that hasn't replied.
- **Three phases, in this order, and the order is the point: ask every manual seat first, then
  resolve rons in seat order, then calls.** That is what stops a pon answered early from outranking
  a ron the seat order says comes first.
- Everything it re-runs is idempotent: `tryWin`/`couldHaveWon` restore the hand they probe, and
  `missedWin` only ever goes true.
- **Daiminkan is never offered to anyone** — the engine models no called kan at all.
- `canDeclareRiichi(state, options, seat)` gates a manual seat's own declaration, read by
  `finishTurn`'s 4th argument (`declareRiichi`, manual seats only) and by `riichiTiles()`.
- `reconsiderClaim(state, options)` re-enters `resolveReactions` from scratch when a seat stops
  being manual mid-claim. It **never invents a pass**: a pass sets `missedWin` and would poison the
  hand with furiten over a decision nobody made.

**Permissions live entirely in `RoundOptions`, never in `Table`.** Four flags, each shared by every
seat:

| Flag     | Gates                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `wins`   | `tryWin` itself — `false` blocks ron **and** tsumo for every seat and drops the ron entry from `claimOptions` |
| `calls`  | Whether an AI algorithm may pon/chi at all                                                                    |
| `riichi` | `canDeclareRiichi`, for AI and manual seats alike                                                             |
| `claims` | Whether a **manual** seat is _asked_ about another seat's discard                                             |

Layering is legality (`RoundOptions`) → choice (the algorithm) → prompt (`claims`, manual seats
only): with `wins: false` the engine never even asks an algorithm's `win`. A manual seat's own tsumo
is never an explicit choice — `beginTurn` wins the instant the draw completes the hand. Whether
these four need a finer per-algorithm split is open (`docs/STATUS.md`).

**The riichi river mark is derived, not a one-shot flag.** `finishTurn` writes `entry.riichi` when
`player.riichiAt === player.river.length` — true for the declaration and again for the seat's next
discard after a call popped the declaration tile out of the river. The mark says where a seat's
river stopped being safe, so it must survive being called away; `riichiAt` needs no repair either,
since a pop puts the river back to exactly the length it names. **`state.discards` keeps the called
copy** (it is never popped).

`finishTurn`'s optional **`beforeReactions`** runs after the discard is on the river and any riichi
declared, **before any seat reacts** — "the moment a riichi lands" is otherwise not observable from
outside the engine. The folding drill's blanket fold is its only caller.

**Furiten.** Ron legality lives in `tryWin` alone (own-river or `missedWin`), and `claimOptions`
offers `'ron'` only when `tryWin` returns a record — exactly one place can offer a furiten seat a
ron, and it never does (regression test in `round.test.ts`). The two kinds are stored and expire
differently:

- **Own-river** furiten is derived (`isFuriten(waits, river)`), so it comes and goes with the hand
  and needs no bookkeeping.
- **Temporary** furiten is the stored half, `PlayerState.missedWin`, lifted in `finishTurn` on the
  seat's own **discard** — the end of the turn that clears it, not the draw that opens it. Nothing
  is legal in between, so the badge stays up while the reader is deciding.
- It is `player.missedWin = player.riichiAt !== undefined && player.missedWin`, **not a plain
  clear**: a seat that declines a win _while in riichi_ stays furiten for the rest of the hand.
  Setting it stays inside `resolveReactions` and stays monotonic there, which is what keeps that
  function restartable.
- `missedWin` is set only for a seat that genuinely declined. A manual seat with `claims: false` is
  skipped **without being asked** — `claimOptions` returns nothing for it, so it could not have
  declared a ron and cannot have declined one. Same rule `reconsiderClaim` follows.
- `couldHaveWon` tests the hand's **shape** and nothing else: furiten is a rule about your waits,
  not about whether the win would have scored, so a yakuless tenpai is furiten on its own waits like
  any other.

`policy.ts` holds the pure maths the algorithms are written in terms of (`chooseDiscard`,
`chooseFold`, `chooseCall`, `hasYakuRoute`, `waits`, `isFuriten`) — **every ranking with an explicit
tie-break, never sort stability**. **Calls happen only when they lower shanten _and_ `hasYakuRoute`
still holds**; without that guard a shanten-chaser opens itself into hands that cannot legally win.

**Why:** [ADR-0024](docs/adr/0024-real-dealing-order.md), [ADR-0028](docs/adr/0028-dead-wall-stacks.md), [ADR-0007](docs/adr/0007-every-seat-is-a-player.md), [ADR-0008](docs/adr/0008-algorithms-are-live.md), [ADR-0010](docs/adr/0010-match-wide-permissions.md), [ADR-0012](docs/adr/0012-shared-table-layer.md)

### The decision seam (`core/algorithm.ts`)

Five decision points — discard, pon/chi, riichi declaration, take-a-win, kita — are one dispatch
table: `ALGORITHMS: Record<AIAlgorithm, Algorithm>`. `AIAlgorithm` is `SeatAlgorithm` minus
`'manual'`, which is **never a key here** — `round.ts` short-circuits on `isManual` before ever
reaching `ALGORITHMS`. Its five call sites are `ALGORITHMS[player.algorithm].<method>(view, …)`.

- Adding an algorithm is one ~10-line object literal plus its `AIAlgorithm` member; nothing in
  `round.ts` changes. **No base class, no `Partial` merge** — the three are independent literals.
- `Algorithm.discard` returns `{ tile, fromDrawn }`. `fromDrawn` is the algorithm's **advisory** read
  of tedashi vs tsumogiri (it decides at the kind level and never sees redness); `finishTurn`
  re-derives the river's actual flag from the tile `pickTile` really resolves, so the returned slot
  is not authoritative on its own.
- What an algorithm may know is a curated **`SeatView`** (`seatView`), never raw `RoundState`:
  public information only (every seat's river, melds, riichi, nuki) plus its own hand and the board.
  `seen` and `threats` are **lazy getters**, since the call gate builds a `SeatView` for every seat
  on every discard.
- `win(view, candidate)` is the one method with a second argument: `WinCandidate { tile, from?,
score }`, already priced by `tryWin` before it asks. `defense.win` is `() => false`.
- Purity: same view ⇒ same choice, every ranking a total order.
- `SeatView.concealed`/`drawn` name the tiles as actually held while `hand` stays counts-only for
  the maths. `SeatView.dealer` is `seatWind === HONOR`.
- **`SeatView.match` is the same object `RoundState.match` holds**, not a snapshot, so a mid-round
  riichi's 1000-point deduction is visible to whoever reads it next. Nothing reads it today.
- Still rejected as fields: dora-in-hand (a helper over `concealed` + `doraIndicators`) and per-seat
  discard counts (already `players[i].river.length`).

**Why:** [ADR-0009](docs/adr/0009-decision-seam.md), [ADR-0023](docs/adr/0023-round-inside-match.md)

### The table layer (`core/table.ts` + `features/table/useRound.ts`)

Everything a board-rendering trainer needs from a running round, in one pure module and one React
owner. **`core/table.ts` is pure**, over a `TableCore` (`round`, `options`, per-page bookkeeping):

- `actingSeat(core)` is "whose turn is this, right now": `round.seat`, **except that a pending claim
  outranks the turn order** (`claim.seat`).
- `TableCore` carries **no seat at all**. Which seat a trainer grades and which seat a page draws at
  the bottom are both that consumer's business: `seenBy(core, seat)` and `analysisOf(core, seat)`
  take the seat explicitly, and `snapshotTable` is uniformly per-seat, exposing `seat` (whose turn)
  and `drawn: { seat, tile }` rather than one privileged `hand`/`drawn` pair.
- `snapshotTable` holds a **copy** of `MatchState` under one `match` field — points move mid-round,
  so a snapshot must not shift under whoever holds it.
- `analysisOf` returns a `TableAnalysis` of **lazy getters, not eager fields**: solo never reads
  danger, folding never reads ukeire, and `evaluateDiscards` costs ~476 shanten probes per turn.
- `goRound(core)` plays every AI-decided seat and stops at the next manual turn, a pending claim, or
  the hand's end — one line over `stepRound` with the manual check passed as `canAct`. With no
  manual seat at all it plays the hand out.

**`useRound(input)`** is the React owner for every trainer built on a real round. It **drives a
round and reports what the engine did**; it has no opinion about what any of it means. One callback,
`onEvent({ event, core, replaying, analysis, logLength })` — every `RoundEvent` in order, for every
seat. The consumer decides which seat it grades, when the round is over, and whether the board is
worth keeping. A handler steers by what it **returns**: nothing to carry on, `{ stop: true }` to halt where the
board stands (a real action — the turn's draw is cleared so the hand reads as finished),
`{ restart: wall }` to abandon the deal for a fresh one. There is no `stopAtTenpai` flag and no
"your seat": efficiency derives tenpai with its own `shanten()` call and filters on
`event.seat === seatIndex`, which is what lets a second manual seat be _played_ without being
_scored_.

Two things stay with this layer because only it can know them:

- **`analysis` copies the hand** (captured at the draw that completes it, reported on the
  discard/kita/ankan that spends it), so grading measures the pre-throw hand even though a discard
  is reported once the tile has already gone. It carries `drawn` as its own field beside that copied
  `Hand`, which is what the efficiency hooks grade tedashi against.
- **`logLength`** is how long `round.log` was when the turn began: by report time the whole turn
  including reactions is applied, so a rewind link has to slice back to it.

Replayed events are **reported, tagged `replaying: true`**, not suppressed — the board really did
reach that state, so a consumer rebuilding state treats them normally while grading and logging skip
them. The round is built **once**, during the render that first needs a board, with the mount effect
reusing it (`ensureBuilt`); replayed events are queued by the build and drained by the effect so
nothing grades or logs mid-render.

Folding uses this hook like everyone else: generation is a pure search producing a wall, the
algorithms each seat ended on, the graded seat and its own log, and `replayLog` rebuilds the board
from exactly that. The mid-hand flip never needs replaying — replay puts every seat on manual, and
only the _starting_ algorithms of live play matter.

**Why:** [ADR-0012](docs/adr/0012-shared-table-layer.md), [ADR-0021](docs/adr/0021-action-log-replay.md), [ADR-0011](docs/adr/0011-at-least-one-manual-seat.md)

### The danger model (`core/danger.ts`) + the folding trainer

`assessDiscards(hand, threats, visible, sanma)` ranks every tile in hand into danger tiers against
the seats in riichi — **ordinal, never probabilistic**, judged on **public information only**: what
the threat actually holds is never consulted, so a correct-but-unlucky choice still grades correct.

Tiers, safest first: `genbutsu`, `noChance`, `oneChance`, `doubleSuji`, `suji`, `honour`,
`halfSuji`, `nonSuji`. **`halfSuji`** (4/5/6, one side genbutsu) sits _inside_ the non-suji outer
band rather than with real suji — that tile is still wide open to the other ryanmen. **`TIER_SCORE`
is one table, deliberately**: the calibration knob for the whole trainer — tune there, never scatter
the numbers. Ranks are **dense** over the score (equal score ⇒ equal rank), and grading is
`rank === 0`, **never list position**.

The maths worth not re-deriving wrong: a shape `(a, a+1)` waits on `a-1` and `a+2`, so the ryanmen
that wait on `n` are `(n+1, n+2)` and `(n-2, n-1)` — each is furiten-blocked when its **far end** is
genbutsu, and a shape whose far end runs off the suit is a **penchan**, not a ryanmen (that is why
3p is suji off 6p but never off 1p). Kabe checks all three run shapes including the kanchan
`(n-1, n+1)`; no surviving shape ⇒ `noChance`, every surviving shape down to one copy ⇒ `oneChance`.
Sanma is free: tiles failing `inTileSet` count as four visible. Several threats take the **worst**
tier, with per-threat verdicts kept in `against`.

**Genbutsu has two sources and the second is the one people forget**: the threat's own discards, and
anything anyone discarded after they declared without being ronned. Both derive from
`RoundState.discards`, **not `player.river`** — `finishTurn` pops a claimed discard out of the
river, and it is still a tile that seat threw. `threatViews(state)` builds the `ThreatView[]` from
it and is exported from `round.ts` itself, since `chooseFold` needs the exact same view the folding
trainer grades against.

**Generation** (`playToRiichi` + folding's own `findRound`) searches fresh random walls for a hand
worth drilling, yields between attempts, and **falls back to fewer threats** rather than failing.
When its riichi target is reached, every seat that has not declared and is not manual switches to
`'defense'` — and **"the moment" is literal**: the flip rides in through `finishTurn`'s
`beforeReactions` seam, because the declaration tile is one every other seat gets to react to.
Applied a moment later, a seat still on `'efficiency'` pons the very tile it is about to spend the
rest of the hand defending against. The board is handed over a seeded 0…`players-2` turns later,
**after** the flip, so those turns cannot add a threat the link never promised.

**The wall alone reproduces the board**, round wind and handover offset included — both seeded off
`wallKey(wall)`. Everything else that shapes the deal travels beside it as `BoardOptions` (`sanma`,
`threats`, `wins`), and decisions since the handover ride in the situation's `log`. Generation keys
only on what shapes the hand, **never on the per-seat algorithms**: those are live board state, so
flipping one after generation applies to the hand already found.

Any seat can be manual, not only the drill's generated seat (`RoundCore.seatIndex`, which
`worthwhile`/`handedOverAt`/`endOf` anchor to). The seat panel's **raw** `SeatConfig.modes` seeds
`RoundOptions.algorithms` at generation time, and an explicit `'manual'` there outranks the blanket
fold flip. Perspective never reaches this hook — it is `FoldingPage`'s own `useState`, reset on
every new hand. Because it moves, **the felt hand `FoldingPage` omits is the seat the board is
_drawn from_, never the drill's graded seat** (the bottom of the felt is where `HandDisplay` already
sits); the graded seat, once perspective moves off it, is an ordinary face-up seat.

Partial credit per throw is `(worst - yours) / worst` over `dangerScore`, passed as
`useSessionStats.record`'s optional third argument and averaged into `averageQuality`.
`showEquallySafe` and `feedbackAtEnd` are both off by default and neither touches the link.

Three reveal rules the UI must keep:

- **`showOpponentHands` is board-wide**, not one that carves the drill's answer key back out: it
  reveals the declarer live, mid-hand, exactly like every other seat. Otherwise a threat's hand
  shows once the hand is over.
- **`showSeatWaits` gates the wait _tiles_ only.** The `SeatRead` behind them is built for any seat
  whose tiles the reader can already see: `showReads || round.ended || isManual(seat)`, where
  `showReads` is `showSeatWaits || showOpponentHands`. The rule is **tiles on screen ⇒ badge**, and
  it is never computed for a hand the reader cannot see. `waits` costs ~34 shanten probes per seat,
  so `seatRead` runs **inside the snapshot builders**, never per render.
- **No tier below `genbutsu` may ever read as "safe"**: suji only ever spoke about ryanmen, and a
  wall only about runs.

The algorithm badge has no setting at all — every seat's mode is always shown, colour-coded
(efficiency green, defense blue, manual yellow). By design the drill is fold-only: no push control,
no danger markers before the answer, threats up to `players - 1`.

**Why:** [ADR-0004](docs/adr/0004-ordinal-danger.md), [ADR-0008](docs/adr/0008-algorithms-are-live.md), [ADR-0005](docs/adr/0005-walls-not-seeds.md)

### Tenhou notation + situation URLs (the shared DSL)

Tenhou strings (`123m406p11z`, `0` = red five) are the interchange format everywhere: URL params,
log copy buttons, tests. **`serializeTenhou` sorts** (hands); **`serializeTenhouOrdered` preserves
order** (walls, rivers — where draw/discard order matters).

`urlCodec.ts` round-trips a `Situation` — `wall`, `log`, `round`/`seat`, the rule-override `FLAGS`,
the match context, plus `seed`/`hand` — through query params, decoded per page from
`useSearchParams`, so a URL fully reproduces a drill. The flags pin round behaviour regardless of
the receiver's settings; `situationQuery()` produces such a dump.

- **`wall` is the deal itself**, not a prefix consumed on the next draw: the whole deal in dealing
  order, then the live draws, then the last 14 as the dead wall — so the flipped indicator is the
  **9th of the 14**. A short wall is completed at random from the copies it leaves.
- This is the **one codec in the repo that rejects rather than repairs**: `validateWall` sets
  `wallError` and empties `wall`, since a wall is positionally meaningful and a silent repair hands
  back a different board than the link claimed. (Contrast `parseTenhou`, which drops a malformed
  digit.)
- **`log` is every seat's decisions** from the deal to the decision point — `LogEntry` is
  `discard`/`call`/`kita`/`ankan`/`win` — replayed by `replayLog` (`round.ts`), which puts every
  seat on `'manual'` for the duration and so **consults no algorithm at all**. That is what makes a
  shared link reproduce the hand actually played rather than the hand today's algorithms would play.
  Nothing in it is an extra tile: everything named is already accounted for by `wall`.
- **`seed`/`hand` are the shanten trainer's alone** — it deals no wall, so it has nothing to share.
- The match context is carried **key-by-key and omitted at its default**, so an unmodified link is
  exactly as short as it was before the fields existed. **`matchOverrides(situation)` builds
  `Partial<MatchState>` one key at a time rather than by spreading** — a present-but-`undefined` key
  would clobber `createMatch`'s own default through a shallow merge.
- `Situation.round` is the prevalent-wind letter; `kyoku` is the number within it. That is why the
  two are not one field.
- What travels is the round's **starting** match (`input.options.match`, in `useRound#situation`),
  never the live `RoundState.match`: a riichi's 1000 is re-applied when the link's `log` replays
  that discard, so sharing the mutated state would deduct it twice. `scoringUrl.ts` is untouched —
  it round-trips a frozen `ScoringSituation`/`WinContext`, never a running `MatchState`.
- Old links decode to defaults, no shims.

**Why:** [ADR-0002](docs/adr/0002-determinism-and-tenhou-notation.md), [ADR-0005](docs/adr/0005-walls-not-seeds.md), [ADR-0021](docs/adr/0021-action-log-replay.md), [ADR-0020](docs/adr/0020-no-back-compat-pre-release.md), [ADR-0023](docs/adr/0023-round-inside-match.md)

### Trainer pattern (`src/features/*`)

Each trainer is a page plus a `use*Round` hook; all but shanten sit on the shared table layer. The
hooks keep mutable round state in a `useRef` and mirror render-ready snapshots into `useState`; an
unspecified seed stays random per mount, and restart/next-hand appends a counter suffix. The graded
trainers get their session score, per-decision clock and random seed from `lib/useSessionStats.ts`,
which also owns "clearing the log resets the session".

**A link names one hand, not every hand from here on** (`useLinkedHand`,
`features/situation/useLinkedHand.ts`): every `use*Round` hook pairs a `handIndex` counter (bumped
by "new hand"/"restart", reset whenever the decoded link changes identity — a share link, or a
rewind, which is `setSearchParams` under a new `location.key`) with `fromLink` (`handIndex === 0`).
Every branch that replays what the URL names — a pinned situation, a pinned wall, a replay log —
must gate on `fromLink`, or "new hand" re-poses the link's hand forever instead of moving past it.
`useRound.ts`'s `restartCount` is this same counter under its table-layer name.

**Shanten is a continuous stream**, not one graded hand at a time: `submit()` grades, then bumps
`handIndex` carrying `running` forward, so the next hand is dealt already revealed with the previous
feedback in `lastResult` (which holds **its own tiles**, since the on-screen hand has moved on).
There is no next-hand button; stop abandons the hand rather than pausing.

**The two efficiency trainers are two routes, not a checkbox**: `/efficiency-solo` is genuinely one
seat (`createRound(wall, 1, …)`, dead wall and dora kept, no `<Table>`), `/efficiency` is a full
table. Both run `wins: false` (a hand ending on someone else's tsumo would cut a per-turn drill
short on a result the player did not cause) and `riichi: false` (efficiency reads no danger, so an
opponent's riichi was decoration, not signal); solo also runs `calls: false` (nobody else is dealt
in) where the table runs `calls: true`. Both stop at their own seat's discard reaching tenpai,
leaving 13 tiles so it reads as finished. The graded `seatIndex` comes from the link alone, never
from the seat panel.

**Grading and session state live in one place, `useEfficiencyDrill`** (`features/efficiency/`):
`recordChoice`/`writeRows`/`settle`, the `onEvent` grading dispatch (kind === 'discard'/'kita'/
'ankan', the tenpai stop), `logReplay`, the reset effect, and the `finished`/`tenpai` derivation.
Each app's own hook (`useEfficiencyRound`, `useEfficiencySoloRound`) only builds its own
`RoundOptions` and `seatIndex` and calls the drill, then adds the board-only fields its page needs
on top (the table's every-seat `hands`/`melds`/`nuki`, the claim prompt, riichi arming; solo's own
single-seat `nuki`). **`nuki` is not in the drill's return** — its shape differs per app (an array
indexed by seat vs. one seat's own pile), so each hook reads it off the drill's `snapshot`/`table`
rather than the drill guessing which shape to hand back.

Other rules that hold across trainers:

- `RoundState.visible` accumulates every face-up tile and feeds ukeire remaining counts.
- **Player count is derived per round (`options.sanma ? 3 : 4`) — never hardcode 4/3.**
- **"finished" is derived** (hand below 14 tiles), not stored — and it is a tile count, never
  "the drill is over": it is true for the whole window between the seat's discard and its next
  draw, which a pending claim holds open. Anything that should appear only at drill end reads
  `useEfficiencyDrill`'s **`drillOver`** (the tenpai stop or `snapshot.ended`) instead.
- **Sanma is "these ids have zero copies", not a smaller id space.** `NUM_TILE_TYPES` stays 34 and
  the id layout is untouched: `buildWall`/`deal` skip 2m-8m via `inTileSet` (`core/tiles.ts`), and
  `improvingTiles`/`ukeire`/`evaluateDiscards` take a `sanma` flag so they never propose drawing a
  tile that isn't in the wall.
- **Kita is graded, not free** (`useEfficiencyRound.ts#kita`): it reuses north's own
  `evaluateDiscards` entry (`NORTH = HONOR + 3`) as "what pulling it costs", compared against the
  same round's `ranked[0]` with `isBestDiscard` — the exact function `discard()` uses. No special
  tie-break is needed: `ranked[0]` is already the global optimum, so north's entry only ties it when
  pulling really is as good as the best discard. `TurnResult.kind` (`'discard' | 'kita'`) exists
  only to key the log row, and carries no grading logic.

**Stores.** Zustand: `settingsStore.ts` (persisted; **has a custom section-wise `merge` — extend it
when adding a section**, or old persisted schemas drop the new fields) and `store/log.ts`
(session-only). The persist version stayed at 3 rather than bumping to drop stale keys: **a bump
drops the whole blob**, costing every reader their theme, language and scoring settings. Rules of
the game that are not scoped to one trainer — `sanma`, `aka`, `kiriageMangan` — are **top-level**
store fields, not inside a section: `kiriageMangan` moved out of `scoring` when it became a real
`RoundOptions` field every win-pricing round reads, not a scoring-trainer display toggle
([ADR-0033](docs/adr/0033-settings-sections.md)); the settings dialog's own grouping of these
fields (Ruleset, UI, Misc) is a UI concern layered on top, not a store shape.

**Log rows are written imperatively from user-triggered actions** (inside `discard()` / `submit()`),
**never from `useEffect`s watching round state** — effect-based logging inverts entry order and
duplicates under StrictMode. Two consequences that are easy to get wrong:

- The one exception is the round-build effect (`logReplay`, putting a shared link's replayed
  discards on the log). It **deduplicates on the decoded situation/link object's identity**, since
  that effect runs twice per mount and four times under StrictMode for one and the same round —
  which is also why those objects come from `useUrlData` (memoised per navigation).
- The `log.dealt` row is written per **board**, not per link: each hook's dedup ref keys on whatever
  its own build effect keys on (efficiency and solo on `{ situation, restartCount }`, folding on the
  `RoundBoard` itself, scoring and shanten on their hand counter). A local "New hand" is a new board
  under a URL that never moved. **Not the `TableCore`**, tempting as it looks: `useRound` rebuilds in
  its own effect, so the core a render captured is still the outgoing board by the time a consumer's
  effect reads it.
- `BoardStage` clears the log during its **first render**, not from a mount effect — effects run
  children-first, so a page that logs as its round mounts would have those rows wiped a moment later.

**Per-seat table configuration** (`features/settings/tableSettings.ts`) is one schema every
board-rendering trainer shares: `SeatConfig { modes: SeatAlgorithm[] }`, plus `TableSettings.claims`
alongside it. **`Table` itself has no concept of a "player"** — every seat is just a seat with an
algorithm, and the only thing that makes a seat the one you play is `'manual'`. "Your seat" is a
trainer-level idea, not something `Table` reads or needs.

- **Seat algorithms are board state, not a preference, and are not persisted.** `SeatConfig` is
  page state with the same lifetime as `viewSeat` — a `useState` seeded from the link, reset on
  every new hand. The settings store holds no `modes` field. **`TableSettings.claims` is the one
  persisted part**: it answers a question about the reader, not about the board.
- **Perspective is not in this schema at all** — each page's own `viewSeat` `useState`, defaulting
  to `round.seatIndex`, reset per hand, never persisted, **view-only in every trainer**: "watch from
  here" never means "play here", which comes only from a `modes` entry of `'manual'`. The page's own
  `hand` slot follows perspective too, not the acting seat — face-down unless that seat is manual or
  hands are revealed, and **click-through only when perspective and the seat mid-turn agree**.
- `resolveSeatConfig(config, players, defaultSeat, fallbackModes?)` guarantees at least one manual
  seat, **anchored on `defaultSeat`** (the link's `?seat=`, or the generated seat) **never on
  perspective** — with none, nothing would hand the reader a turn. `fallbackModes` overrides the
  generic `'efficiency'` default with what the board is _actually_ running (folding's live
  `algorithms` off `PlayerState.algorithm`), so the panel never shows an algorithm it isn't running.
- **Every patch sent to `onChange` is built off the _raw_ `SeatConfig`, never the resolved one**
  (`withSeatMode` copies just the array a click touches). Writing resolved fallbacks back on every
  edit made an unrelated change — like moving perspective — look like a real `modes` edit and
  re-search folding for a new hand.
- **The graded `seatIndex` is the trainer's, never the seat panel's**: flipping that seat's algorithm
  away from `'manual'` cannot move which seat is graded, only freeze grading in place.
- `useTableSettings(app)`'s `seatsEnabled` only decides whether to render the panel; `seatConfig` is
  page-local and starts at `null` regardless, so nothing persisted runs under a hidden panel.

`SeatButton` is the per-seat dialog ("watch from here", offered on every seat but the one already
watched; the efficiency/defend/manual row; the claims checkbox for manual seats), placed on the felt
by `SeatStrip` through `Table`'s `seatInfo` prop. `ManualControls` is the shared riichi-arm button,
claim prompt and "Playing {wind}" line; **it renders nothing in the single-manual-seat, no-claim,
no-riichi, own-perspective case**, so every trainer mounts it unconditionally. **Watching a seat
other than the one that would act swaps every other line out for "Watching {wind} / Back to your
seat"** — spectating suspends the whole control surface, a pending claim included, rather than
answering it against a hand that isn't on screen.

**Why:** [ADR-0013](docs/adr/0013-efficiency-split.md), [ADR-0032](docs/adr/0032-one-efficiency-drill-core.md), [ADR-0015](docs/adr/0015-what-persists.md), [ADR-0017](docs/adr/0017-imperative-log-rows.md), [ADR-0008](docs/adr/0008-algorithms-are-live.md), [ADR-0014](docs/adr/0014-table-is-a-pure-view.md), [ADR-0033](docs/adr/0033-settings-sections.md)

### UI

`Table.tsx` is the shared board (efficiency, folding, lab always; scoring behind `settings.table`):
a 3x3 grid in tile widths (4fr/6fr/4fr = 14 across), seats placed by
`(seat - seatIndex + players) % players` and rotated `-90deg` per step, each seat's plate in the
corner cell on its right. `BoardStage.tsx` **is the trainer page** — no second layout, no `full`
prop; `board` is optional and a boardless trainer's `children` render in the board area rather than
being dropped. `seatIndex` is only which seat the board is drawn **from** — a perspective, not "the
user's seat"; `SeatView` has no player field, so a seat somebody plays and a seat nobody does are
drawn through the same props.

**Board:**

- **Absence of `tsumogiri` on a `RiverTile` means tedashi.** Flags, not parallel arrays.
- **The caller owns the river's width, not `River`** — a river that widens as it fills moves the
  hand under it.
- **`showsHands` counts melds and nuki as well as hands.** A seat's calls ride on its hand ring
  (the drawn-from seat's go to `HandDisplay`), so a board with no hands but one call still has to
  pay for the ring, or those calls land across a river.
- **Points are board truth like `riichi`/`melds`, never `seatInfo`.** `roundNumber` and
  `SeatView.points` are values in, no logic — routing board state through the page's render prop
  would make what the felt says depend on whether the seat panel is enabled.
- **Each score pins to a square overlay that carries the seat's rotation**, never positioned per
  seat and then turned: a transform does not move the box it was laid out in.
- **`seatInfoNodes` is computed once per seat**, not per render.
- **The wind's fallback is `||`, never `??`**: a caller returning `seatsEnabled && <SeatStrip/>`
  hands back `false`, which a nullish check reads as a node and drops the wind entirely.

**Sizing — container units only, never pixels inside the square:**

- **`--tile-w: calc(100cqw/14)` goes on the outer div**, never on the square, or a `w-full` child
  collapses when the board is a flex item.
- **Tracks stay `minmax(0,…)`**: a seat block is measured before it rotates.
- **The felt is `aspect-square w-full`, never `h-full`** — a percentage height against a box that
  gets its height only from `aspect-ratio` is indefinite in WebKit. `e2e/board.spec.ts` asserts
  squareness on iPhone portrait/landscape and desktop; the bug class is invisible to Chrome/Firefox
  device emulation, which is why the UI suite runs a real WebKit.
- Cap is `calc(min(100%, 100cqh) * var(--board-scale, 1))` — `100cqh` against the stage's board
  area, a declared size container, so it is the height genuinely left rather than an estimate.
- **`--board-scale`/`--tile-scale` apply from `sizable:` up only.** `SIZABLE_QUERY`
  (`settingsStore.ts`) is that variant as a query — **keep the two in step**.
- **A ≥44px target on the felt comes from an `after:size-11` pseudo-element**, never a pixel height:
  a fixed `h-11` ran a phone-sized board's plate off the felt.
- **The stage itself is capped from `ultrawide:` up** (`min-height: 800px` and `min-aspect-ratio:
2/1`) at `--stage-max` (`index.css`), so the docked session panel stops well short of a 21:9
  screen's physical edge. **Everything docked to that right edge is a child of the capped box and
  inherits the cap — nothing re-derives the number for itself.** The settings sheet included: it
  portals into the stage element (`BoardStage`'s own ref, threaded as `SettingsButton`'s
  `container`) and is `absolute inset-0` there, so its scrim dims the stage alone and leaves the
  tint outside it as the seam the sheet ends on. From `md:` up it takes the docked panel's own
  column (`clamp(24rem,26vw,28rem)`) flush and bordered, so the two line up rather than leaving a
  strip of one showing past the other. The board's own sizing is untouched — `--stage-max` is
  built so the board column always stays wider than the square can be tall.
- **`HomePage` puts that same capped box round the menu**, off the same variable, so the app box
  does not change width between home and a trainer and the gear's sheet docks where the app stops.
  Its box is `h-svh overflow-hidden` with the menu scrolling in a column inside — a page taller
  than the viewport would otherwise stretch a full-height sheet past the bottom of the screen.
  `<body>` and `fixed` remain `SettingsButton`'s fallback when no `container` is passed.
- **`flow`'s board area is `container-type: inline-size`, not `size`** — size containment collapses
  a box that sizes itself to its own content. Content that rides up must be a **fixed size whatever
  it holds, and that is the page's job**: a river growing into its space walks the hand down the
  screen, and a hand that moves under the pointer is a hand you misclick.

**Session panel** (docked from `lg` via `WIDE_QUERY`, drawer below that):

- **Both halves override `--tile-w-base`, not `--tile-w` alone**, so a nested override composes with
  the panel's 0.6 instead of ignoring it (`UkeireTiles` drew _larger_ than the tiles above it until
  it did).
- **`UkeireTiles` wraps per suit, never inside one**: it groups its tiles by suit and each group is
  one non-wrapping flex item, so a break falls between suits. Shared with the lab and the session
  panel — the grouping is in the component, not in whoever renders it.
- **`onLogOpen` (the clock pause) is derived from _drawer_ open, not panel open** — a docked panel
  hides nothing — and is reported from an effect on that one derived flag, so a resize, Escape or
  the scrim each resume exactly once and never lift a pause the reader pressed themselves.
- The drawer is the **stage's** child, not the board area's, so it covers the hand strip too.

**`LogList` is the feedback surface**, not a transcript beside one — the full breakdown of any turn
is a tap on its own row.

- **A row with no `severity` is a separate case from `'ok'` and must not fall back to it**
  (`NO_VERDICT`). A rewind, a replayed discard, the tenpai note and every lab row are not graded
  decisions, and a green spine segment beside one claims a verdict nobody gave. Spine width carries
  the signal alongside colour, for a colour-blind reader.
- **A `LogDetail` is an i18n key plus params and tiles, never text** — a language switch has to
  re-translate it. `folding.equallySafe` is logged unconditionally and gated **at render**, so the
  toggle reaches rows already on the record.
- **A detail line's three optional fields say what it _is_, and each has one owner.** `header`
  makes it the muted label above a list — it is a claim that a list follows, so it is written only
  when one does, and it **draws no tiles**. `tone: 'error'` is decided where the wrong-answer
  _phrasing_ is decided (`fieldDetail`), never derived a second time. `seam` splits the line's
  tiles: the subject tile leads, the evidence follows past the rule — so a tier whose evidence
  _is_ the subject (genbutsu) must drop it rather than draw it twice. A row has no such field;
  only a detail line does.
- **Ordinals are assigned before filtering**, so `log.rewound`'s "Rewound to entry {{number}}" stays
  honest.
- **`log.dealt`/`log.dealtHand` carry no tiles** — a hand is drawn on exactly one row, the one that
  grades it.
- **A tile is drawn once per row, and the sentence draws its own.** `splitTileCodes`
  (`formatLogEntry.ts`) tokenizes the **already-translated** sentence and `LogSentence` draws every
  tenhou code where it stood, so all four locales are fixed without touching the JSON
  ([ADR-0018](docs/adr/0018-beginner-defaults-advanced-depth.md)). Two consequences: `LogEntry.tiles`
  carries only what the sentence **cannot** name — the tenpai row's waits, the shanten hand, the
  rinshan tile a kan drew — and a locale string must never contain a bare code (`0p`, `4z`) of its
  own, or it silently becomes a tile. `formatLogEntry.test.ts` walks the four JSONs and fails if one
  ever does.
- **Its rewind/share buttons are the one sharing surface a trainer has** — no page-level copy-link.
- The `All | Mistakes` filter is component-local `useState`: a way of reading the list now, not a
  persisted preference.

**Feedback is one line, everywhere.** `status` (score/accuracy/clock) is **not** panel content — a
clock behind a drawer tap goes unread — so it is a HUD strip above the board at every viewport,
panel open or shut, **except held sideways** (`short:`), where it floats in the board area's right
gutter; only the panel's **drawer** shape hides it. **`status` is not `pointer-events-none` as a
whole**: efficiency's ukeire line carries a live `GlossaryTerm` trigger, so only the wrapper is
inert. The verdict chip is **top-centre, transient, `pointer-events-none` in every shape** — it
briefly covers tiles rather than parking in a gutter. **Severity is derived at display level from
the existing grade/partial credit, never a new grading concept** (`efficiencyVerdictSeverity` in
`grade.ts`, red only on an actual shanten regression; `foldingVerdictSeverity` banding the partial
credit `useSessionStats` already averages).

**Chrome row**: back, `InfoButton`, the page's `TrainerToggles`, the `wall` slot, the log toggle,
settings **last** (`BoardStage` renders `SettingsButton` itself rather than each page choosing).
Board pages pass no `wall` until they have dealt, so the button is absent rather than empty. Held
sideways the row moves to the left gutter. Names appear beside icons behind the `labelled:` variant
(one query rather than `xl:` plus a `short:` override, since a wide but shallow window is both), and
**the visible text is the same string the `aria-label` already used**, so the accessible name never
depends on the viewport.

**The settings dialog's own title never changes** — always `t('settings.button')` ("Settings"),
portalled to `<body>` the same as before. What used to vary the title (the trainer's translated
name) instead heads its own section, shown only when the page passes `settings` rows; `BoardStage`'s
`app?: TableApp` prop gates a second section, Table, resolved against that app's own override layer
rather than a hardcoded stand-in — present iff the trainer draws a `<Table>`. Two sections render
unconditionally on every screen, including home: Ruleset (number of players, Kiriage mangan, red
fives) and UI (theme, tile size, language, tile-number overlay, glossary-on-click); Misc holds the
Advanced switch alone, since flipping it changes what the other sections show
([ADR-0033](docs/adr/0033-settings-sections.md)).

**Fullscreen is not a mode with a button or a store.** `useMobileFullscreen` asks on phone-sized
viewports only, on the reader's **first `pointerdown`** — `requestFullscreen` is rejected outside a
real user gesture — and never again once they have left it (module-level session flag, not
persisted). iOS Safari has no element fullscreen at all; its bars go only by installing the PWA,
which `IOSInstallHint.tsx` points at — dismissible, persisted, **home page only**, never over the
board it is talking about. `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the chrome
row, the board-reservation strip and the hand strip keeps the layout clear of those bars; the chrome
row's padding side flips with orientation, since `env()` tracks whichever edge is currently "left".

**Tiles and assets.** Tiles are `<use>` references into a build-time sprite (`npm run tiles`
regenerates; output committed); components scale locally by overriding `--tile-w`. Tailwind 4, dark
mode a `dark` class on `<html>`, routing on `basename: import.meta.env.BASE_URL` (GitHub Pages), PWA
via `vite-plugin-pwa`. The two app icons are hand-built SVGs, **not** produced by the sprite script:
both transparent with **no corner radius of their own** (iOS's squircle and Android's adaptive shape
crop them; a rounded source leaves white corners) and deliberately **`purpose: 'any'`, never
`'maskable'`** — a maskable crop would clip a tile that runs the square's full height.

**Mobile-first is a project goal**: touch targets ≥44px (`min-h-11`), layouts work at phone widths.

**Audience: technical depth for advanced players, defaults a beginner can still use** — both, not
one. Keep adding the precise feature, but ship it behind a setting whose default reads plainly to
someone who has never scored a hand. **A new option must never be something a beginner has to find
and change before the screen makes sense.** Two surfaces built on that: the `intro: TrainerIntro`
behind each trainer's `Info` button, and the glossary.

Glossary rules (`features/i18n/glossary.ts`, marked inline with `<GlossaryTerm id="…">`):

- **Never derive the wiki URL from the term id** — a naming-convention guess drifts the moment the
  wiki's slugs don't match. Hand-check each.
- Terms a player is assumed to know (riichi, ippatsu) are deliberately absent.
- **A term mid-sentence in a translated string is wrapped `<term>…</term>` in the locale JSON and
  rendered via `Trans` + `components={{ term: <GlossaryTerm id="…" /> }}`** — this keeps word order
  correct per language and the term appearing exactly once. **Do not hand-split a translation string
  into prefix/suffix keys to fake it.**
- Pass `iconOnly` only when the surrounding label already spells the term out, or the trigger
  repeats its own name beside it.
- A furiten seat's felt mark uses `InfoPopover` **directly**, not `GlossaryTerm`: the plate is
  rotated with its seat, so an inline hover card hangs sideways off the corner and the word draws at
  the page's 16px instead of the board's `cqw` scale. It keeps the affordance — dotted underline and
  question mark, both sized in `cqw`.

**Why:** [ADR-0025](docs/adr/0025-one-interface.md), [ADR-0026](docs/adr/0026-stats-on-the-board.md), [ADR-0027](docs/adr/0027-the-log-is-the-feedback.md), [ADR-0029](docs/adr/0029-calls-on-the-hand-ring.md), [ADR-0030](docs/adr/0030-the-felt-sizes-itself.md), [ADR-0019](docs/adr/0019-mobile-first-board.md), [ADR-0018](docs/adr/0018-beginner-defaults-advanced-depth.md), [ADR-0014](docs/adr/0014-table-is-a-pure-view.md), [ADR-0033](docs/adr/0033-settings-sections.md)
