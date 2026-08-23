# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Companion documents

This file is **how the code works today**. Three others carry what it deliberately doesn't:

- **`docs/adr/`** — *why* it works that way. One decision per file, superseded rather than edited.
  Read the relevant ADR before proposing to change a design; write a new one when a decision moves.
- **`docs/STRUCTURE.md`** — *where* things live: an annotated source map and the dependency rules.
- **`docs/STATUS.md`** — what is shipped, what is in flight, what is known broken, and what is out
  of scope on purpose. Read it before starting anything; update it when that changes.

`docs/README.md` explains the precedence between them and the working rules (one plan file, one
task per commit).

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
- `Hand` (`hand.ts`) is a `Uint8Array(34)` of counts plus a fixed-meld count, and nothing else — no redness, no drawn tile. Which physical copies a seat actually holds is **stored, not inferred** (ADR-0022, superseding ADR-0003): `PlayerState.concealed: ParsedTile[]` (`round.ts`) is the concealed hand as held, redness included, kept sorted except for its last element while `PlayerState.drawn?: ParsedTile` is set — that 14th tile is appended rather than sorted in, which is what lets a discard know tedashi from tsumogiri without inferring it. `drawn` is always `concealed.at(-1)` while set, and is cleared the moment the tile leaves the hand (discard, kita, ankan) — before any algorithm decision reads it, so a `SeatView` never sees a `drawn` naming a tile no longer held. Both are maintained beside `hand.counts` at every mutation site (`take`, `drawReplacement`, `finishTurn`, the pon/chi meld loop, `callAnkan`, `callKita`, the deal loop), so the two can drift: the census test (`round.test.ts`) is the guard, asserting per player that `concealed` tallies to `counts` per kind and that `drawn === concealed.at(-1)` whenever set. `pickTile` (`round.ts`) survives all of this because it is a *policy*, not an inference — given a plain and a red copy of one kind, throw the plain one — now an explicit prefer-`!red` find over `concealed` rather than something derived from `counts[id] === 1`.
- `shanten.ts`: per-suit 5-block decomposition for standard shanten (see the round engine section — it is the app's hottest function); closed-form chiitoitsu and kokushi; `shanten()` takes the minimum (skipping chiitoi/kokushi when melds exist).
- `ukeire.ts` / `efficiency.ts` probe by add-tile/remove-tile around `shanten()`. `ukeire(hand, visible)` computes remaining copies against a caller-supplied 34-length visibility array. `evaluateDiscards` ranks every discard (shanten asc, then ukeire desc); ties must be compared with `isBestDiscard` (shanten + ukeire count), never by tile id.
- Determinism: `rng.ts` (`mulberry32` seeded by string hash) + Fisher-Yates `shuffle`; `wall.ts` builds the 136-tile wall. Same seed string ⇒ same wall, which is what makes situations shareable. `wall.ts#deal` (seeded 13-tile deal, returns just the `Hand`) serves the shanten trainer; every other trainer goes through `round.ts#createRound`.

### Round and match: the naming model (ADR-0023)

A **round** is one deal (deal, draws, discards, a win or an exhaustive draw), a **match** is the game the rounds sit inside (why: ADR-0023). `core/round.ts` is the engine that plays a hand — `RoundState`, `RoundOptions`, `RoundEvent`, `createRound`, `playRound`, `stepRound` — and `core/match.ts` is a small, standalone, pure module holding what persists *across* rounds:

```ts
MatchState { prevalentWind, round, honba, dealerRepeat, dealer, riichiSticks, points }
createMatch(sanma, overrides?)   // East 1, zeros, dealer 0, 25000 yonma / 35000 sanma
```

`prevalentWind` is an honour tile id (`HONOR` = East) and pairs with `SeatView.seatWind`; `round` is which kyoku within it (East 1 is `1`). `honba` and `dealerRepeat` are separate fields — they diverge by ruleset — and are never collapsed into one.

It is **carry-in context, not a sequencer**: no `nextRound()`, no dealer rotation, no honba increment, no payout settlement, no end-of-match detection. The one in-round mutation is riichi — `finishTurn`'s declaring branch takes 1000 off `state.match.points[seat]` and adds a stick — so `createRound` takes a **copy** of `options.match`, never an alias: a round must never write through to caller-owned options. `MatchState` reaches `RoundState.match`, `SeatView.match`, `TableSnapshot.match` and the situation link from there.

Dealer is no longer assumed to be seat 0: `seatWind` is `HONOR + ((seat - dealer + players) % players)`, "am I dealer" is `seat === state.match.dealer`, and the turn counter increments on the dealer's seat. `RoundState.match.honba` feeds `ScoringRules.honba`'s existing 300/100 payout maths.

### The round engine (`core/round.ts` + `core/policy.ts`)

One deterministic hand of mahjong drives every trainer. `createRound(wall, players, options, fillSeed?)` deals straight off an **explicit wall in draw order** — the deal (`players * 13`), then the live draws, then the trailing 14 the dead wall is cut from (dora indicator first). That leading block is handed out the way a table deals (ADR-0024): `DEAL_CHUNKS = [4, 4, 4, 1]` (`wall.ts`), four tiles to each seat in index order, three times round, then one apiece — no seat's thirteen sit in the wall as a slab. `dealtSeat(index, players)`/`dealtIndices(seat, players)` are that same walk read each way, and everything mapping a wall index to a seat goes through them: `validateWall`'s error zones, `wallWithHand`/`wallWithHands` (a wall built around known hands — the only way to pin one now, and what the tests build their claim scenarios with), and the wall reveal's own perspective highlight. Seats are served in index order rather than from the dealer, which is wind order whenever the dealer is seat 0 and keeps `MatchState` out of every index-to-seat mapping. A short wall is a _prefix_: the tiles given are used in order and the remainder is completed at random from the copies they leave (`completeWall`, `wall.ts`), which is what makes partial hand-authoring in the lab usable — but a 13-tile prefix is the start of a *deal*, not one seat's hand. A solo round (`players: 1`) collapses the walk back to `wall[0..12]`, and `wall.ts#deal` (shanten) never sees it at all. Then `beginTurn` (draw) and `finishTurn` (discard, then everyone else's ron and calls) step it; `playRound` loops both, and a `stop` predicate ends it early. That predicate is the only thing trainers differ by.

A trainer that needs a *particular kind* of hand searches for one by rejection sampling: deal a fresh random wall, play it out, keep it if an `accept` callback takes it, else try again — capped attempts, yielding between them. Scoring's `findWall` ("first win by any seat") and folding's own module-private `findRound` ("a hand worth drilling") are each their own copy of that shape, because each accepts on something different. `findRound`/`findRoundAsync` in `round.ts` (same name, different module — the engine's are the seed-suffix ancestors of both) are now **used only by tests** — no production caller remains since walls stopped being named by a seed (ADR-0005). Both are plain loops rather than being driven through React, because rejection is judged at the handover point and running a hundred simulations through state would cost a render apiece (ADR-0012).

Every seat is a **player**, and a player has an **algorithm**: `PlayerState.algorithm: SeatAlgorithm` (`'efficiency' | 'defense' | 'tsumogiri' | 'manual'`, `core/policy.ts`). `'manual'` is not "a human" — it is the algorithm "ask, don't decide". It is **live**: flip it mid-hand and the next turn obeys, no redeal, no new round, no re-search — changing a player's algorithm must never change the hand. `isManual(state, seat)` is the one predicate that reads it; the word "human" has left the codebase. `RoundOptions.algorithms?: readonly SeatAlgorithm[]` only *seeds* each player at `createRound` — a seat with no entry starts on `'efficiency'` — the live value afterward lives on `PlayerState`, not on `RoundOptions`, and moves without touching options. A manual seat is one the engine draws for but never decides for: no auto-kita, no auto-riichi (riichi locks every later discard to tsumogiri, so it must stay the player's own choice), no auto-pon/chi (a call opens a hand its player never chose to open). More than one seat can be manual at once — board state each page owns (`SeatConfig`, `features/settings/tableSettings.ts`), never a persisted setting and not a per-trainer concept; four manual seats is one person playing the whole table. `wins: false` lets opponents play without ending the drill.

`RoundOptions.claims?: boolean` (default **false**, so every existing graded drill's behaviour stays bit-for-bit unchanged) makes a manual seat get _asked_ about another seat's discard instead of being silently skipped. While an answer is pending, `RoundState.claim?: PendingClaim` is set and `beginTurn`/`finishTurn` are no-ops — one guard in the shared functions rather than one in every caller that steps a round. `claimOptions(state, options, seat, tile, from)` lists what a seat may call; `answerClaim(state, options, answer)` resolves it through an internal **restartable** `resolveReactions` that runs from the top on every answer, reading replies out of `claim.answers` and suspending again on the first seat that hasn't replied yet. Three phases, in this order, and the order is the point: ask every manual seat first, then resolve rons in seat order, then calls — that is what stops a pon answered early from outranking a ron the seat order says comes first. Everything it re-runs is idempotent (`tryWin`/`couldHaveWon` restore the hand they probe; `missedWin` only ever goes true). Daiminkan is deliberately not offered — the engine models no called kan at all, so offering it to one manual seat alone would be the one call no algorithm can answer. `canDeclareRiichi(state, options, seat)` gates a manual seat's own riichi declaration, read by `finishTurn`'s 4th argument (`declareRiichi`, manual seats only) and by `riichiTiles()` in the round hooks below. When a seat stops being manual while its own claim answer is still pending, `reconsiderClaim(state, options)` re-enters `resolveReactions` from scratch through the exact same restartable path — it never invents a pass on the reader's behalf, since a pass sets `missedWin` and would poison the hand with furiten over a decision nobody made.

Call and win permissions live entirely in `RoundOptions`, never in `Table` — the board is a pure
view (see the `Table.tsx` note in the UI section) and has no concept of what a seat is allowed to
do. Four flags, each shared by every seat (why: ADR-0010):

| Flag     | Gates                                                                              |
| -------- | ----------------------------------------------------------------------------------- |
| `wins`   | `tryWin` itself — `false` blocks ron **and** tsumo for every seat and drops the ron entry from `claimOptions` |
| `calls`  | Whether an AI algorithm may pon/chi at all                                         |
| `riichi` | `canDeclareRiichi`, for AI and manual seats alike                                  |
| `claims` | Whether a **manual** seat is *asked* about another seat's discard                  |

Layering is legality (`RoundOptions`) → choice (the algorithm) → prompt (`claims`, manual seats
only) — with `wins: false` the engine never even asks an algorithm's `win`. `wins: false` is what
`opponentWins: false` (folding) and efficiency's hardcoded value reach (ending a per-turn drill on
someone else's tsumo would cut it short); efficiency also runs `riichi: false`, since it reads no
danger, so an opponent's riichi there was decoration, not signal. Daiminkan is never offered to
anyone — the engine models no called kan at all — and a manual seat's own tsumo is never an
explicit choice: `beginTurn` wins the instant the draw completes the hand. Whether these four need
a finer per-algorithm split is open, tracked in `docs/STATUS.md`.

`core/table.ts#actingSeat(core)` is "whose turn is this, right now": `round.seat`, except that a pending claim outranks the turn order (`claim.seat`). `TableCore` is `{ round, options }` and carries **no seat at all** — which seat a trainer grades and which seat a page draws at the bottom are both that consumer's business, and keeping them in one field is what made grading and perspective the same idea for as long as they were (ADR-0012). `seenBy(core, seat)` and `analysisOf(core, seat)` take the seat explicitly; `snapshotTable` is uniformly per-seat, exposing `seat` (whose turn) and `drawn: { seat, tile }` rather than one privileged `hand`/`drawn` pair. `goRound(core)` plays every AI-decided seat and stops at the next manual turn, a pending claim, or the hand's end — one line over `stepRound` with the manual check passed as `canAct`. With no manual seat at all it plays the hand out, which is the autoplay ADR-0011 had deferred.

`stepRound(state, options, canAct?)` (`round.ts`) is the one stepper: a generator yielding every `RoundEvent` as it happens, which a caller stops by not asking for the next one. `playFrom`/`playRound`/`playWall`/`goRound` all sit on it. It deliberately does **not** stop at a manual seat — `finishTurn` covers one by borrowing `'efficiency'`'s discard and `playRound` relies on that — so "stop where a person must decide" rides in through `canAct`, asked once per turn before anything is drawn. Its `player.drawn` guard is what makes it safe to resume into a turn someone else started (a live algorithm flip, a replayed log): `beginTurn` would otherwise draw a second tile on top.

`policy.ts` holds the pure, deterministic maths the AI algorithms are written in terms of — `chooseDiscard`, `chooseFold`, `chooseCall`, `hasYakuRoute`, `waits`, `isFuriten` — every ranking with an explicit tie-break, never sort stability. Calls happen only when they lower shanten **and** `hasYakuRoute` still holds; without that guard a shanten-chaser opens itself into hands that cannot legally win. Furiten is `waits()` (which is `improvingTiles` at tenpai) checked against your own river. `core/algorithm.ts` is where those functions become decisions — see the decision-seam paragraph below.

`PlayerState.algorithm` is a live per-seat field rather than a round-wide option because the folding trainer flips individual opponents mid-hand once its riichi target is reached. What each algorithm then *does* is the decision seam's business (below), never a set of `algorithm === …` conditionals in `round.ts`: `'defense'`, for one, discards by `chooseFold` (full betaori, `assessDiscards(...)[0].tile`) rather than `chooseDiscard`, and never declares, calls or wins — it is trying to leave the hand, not win it. A seat already in riichi is unaffected whatever it runs: `forcedTsumogiri` overrides every algorithm **and every explicit discard**, so it is the first branch in `finishTurn`'s choice of tile rather than the fallback one. It used to sit in the `else`, which meant it only ever reached the seats nobody was deciding for — a manual seat in riichi could hand in any tile it liked and the engine threw it. Replay is unaffected: a riichi seat's logged discard is its drawn tile already. The UI keeps its half of that bargain rather than offering a choice the engine will refuse: `HandDisplay`'s `lockedToDrawn` (passed by the three board pages as `round.riichi[round.acting]`) renders the thirteen tiles as plain tiles instead of buttons, leaving only the drawn one live.

Win legality is free from existing code: `decompose()` non-empty is the shape, `scoreHand()` returning null is "no yaku". Guard both behind a single `shanten()` call — that gate fails for almost every seat on almost every discard and everything past it is far more expensive.

**Performance**: `standardShanten` decomposes each suit separately and merges (`groupTable`/`merge`), ~475x faster than searching all 34 kinds at once, because a draw probe only perturbs one suit and the other three come out of the cache. `referenceStandardShanten` is the old whole-hand search, kept solely as the specification the fast one is proved against over thousands of random hands in `shanten.test.ts` — change one, re-run that. Simulated players use `bestDiscards` (shanten only) and price ukeire just for the tiles already tied. A round is ~17ms; the census test in `round.test.ts` (every tile kind accounted for exactly four times, plus `concealed`/`counts`/`drawn` agreeing per player) is what catches bookkeeping slips.

The rotated river tile is derived, not stored as a one-shot flag: `finishTurn` writes `entry.riichi` when `player.riichiAt === player.river.length`, which is true both for the declaration itself and again for the seat's next discard after a call popped the declaration tile out of the river. The mark says where a seat's river stopped being safe, so it has to survive being called away — and `riichiAt` needs no repair either, since a pop puts the river back to exactly the length it names and the next discard refills that slot. `state.discards` keeps the called copy (it is never popped), so `threatViews`' genbutsu-after-riichi cut still finds the real declaration point.

`finishTurn` takes an optional `beforeReactions` callback, run after the discard is on the river and any riichi is declared but before any seat reacts to it. It exists because "the moment a riichi lands" is otherwise not observable from outside the engine: by the time `finishTurn` returns, the pon/chi/ron made on that declaration tile have already happened. The folding drill's blanket fold is its only caller (see `playToRiichi` below).

Furiten invariant: ron legality lives in `tryWin` alone (own-river or `missedWin`), and `claimOptions` only ever offers `'ron'` when `tryWin` returns a record — so there is exactly one place that can offer a furiten seat a ron, and it never does. Covered by a regression test in `round.test.ts` rather than left to `seatRead`'s badge (`core/table.ts`) to imply correctness on its own.

The two kinds of furiten are stored differently and expire differently. Own-river furiten is **derived** (`isFuriten(waits, river)`), so it comes and goes with the hand and needs no bookkeeping. Temporary furiten is the stored half, `PlayerState.missedWin`, and it is lifted in `finishTurn` — on the seat's own **discard**, the end of the turn that clears it, rather than on the draw that opens that turn. Nothing is legal in between (nobody else discards while this seat holds its 14th), so the choice is a display one: the badge stays up while the reader is deciding and can still say why the ron was refused. It is `player.missedWin = player.riichiAt !== undefined && player.missedWin`, not a plain clear, because a seat that declines a win **while in riichi** stays furiten for the rest of the hand. Setting it stays inside `resolveReactions` and stays monotonic there, which is what keeps that function restartable.

`missedWin` is set for a seat that genuinely declined — an AI seat whose algorithm was asked, or a manual seat that pressed Pass. A manual seat with `claims: false` is skipped **without being asked**: `claimOptions` returns nothing for it, so it could not have declared a ron and cannot have declined one. Marking it furiten there would poison its hand over a decision nobody was given, the same rule `reconsiderClaim` follows when it refuses to invent a pass on the reader's behalf. `couldHaveWon` tests the hand's *shape* and nothing else, deliberately: furiten is a rule about your waits, not about whether the win would have scored, so a yakuless tenpai is furiten on its own waits exactly like any other.

### The decision seam (`core/algorithm.ts`)

Five decision points — discard, pon/chi, riichi declaration, take-a-win, kita — used to be five scattered conditionals inside `round.ts`, each hand-rolling its own `algorithm === 'defense'` check. They are now one dispatch table: `ALGORITHMS: Record<AIAlgorithm, Algorithm>` (`AIAlgorithm` is `SeatAlgorithm` minus `'manual'`, which is never a key here — `round.ts` short-circuits on `isManual` before ever reaching `ALGORITHMS`). `Algorithm.discard` returns `{ tile, fromDrawn }` rather than a bare tile — `fromDrawn` is the algorithm's own advisory read of tedashi vs tsumogiri (it decides at the kind level and never sees redness), and `finishTurn` still re-derives the river's actual flag from the tile `pickTile` really resolves, so the returned slot is not authoritative on its own. `round.ts`'s five call sites collapse to `ALGORITHMS[player.algorithm].<method>(view, …)`. Adding a new algorithm is one ~10-line object literal plus its own `AIAlgorithm` member; nothing in `round.ts` changes — `tsumogiri` (`core/algorithm.ts`, discards `view.drawn` every turn, never calls/declares/wins) is the proof: it shipped as pure seam input, zero engine edits. No base class, no `Partial` merge — `efficiency`, `defense` and `tsumogiri` are independent object literals.

What an algorithm is allowed to know is a curated `SeatView` (`core/algorithm.ts#seatView`), never raw `RoundState`. Public information only (every seat's river, melds, riichi, nuki) plus its own hand and the board; `seen` and `threats` are lazy getters (the `TableAnalysis` trick), since the call gate builds a `SeatView` for every seat on every discard. `win(view, candidate)` is the one method with a second argument: `WinCandidate { tile, from?, score }`, already priced by `tryWin` before it asks — `defense.win` is simply `() => false`. Purity is unchanged from `policy.ts`: same view ⇒ same choice, every ranking a total order. `SeatView.dealer` (`seatWind === HONOR`) rides along free off `seatWind`; `SeatView.concealed`/`drawn` name the tiles as actually held while `hand` stays counts-only for the maths. `SeatView.match` is the whole `MatchState` — points, honba, sticks, dealer, which round — the *same object* `RoundState.match` holds rather than a snapshot, so a mid-round riichi's 1000-point deduction is visible to whoever reads it next (ADR-0023 amends ADR-0009's rejection of this). Nothing reads it today. Still rejected: dora-in-hand stays a helper over `concealed` + `doraIndicators`, not a field; per-seat discard counts are already `players[i].river.length`.

Two behaviour changes rode in with the seam, not before: `defense.kita` is `false` (a folding player is leaving the hand, not chasing dora — every AI seat used to pull regardless), and declining a win is now expressible per algorithm (`win` receives the priced candidate) rather than a single hardcoded "defense never wins" in `tryWin`.

### The table layer (`core/table.ts` + `features/table/useRound.ts`)

Everything a board-rendering trainer needs from a running round, in one pure module and one React
owner (ADR-0012). Before it existed the efficiency and folding hooks had ten distinct duplications
between them, `seenBy` alone in three implementations.

**`core/table.ts` is pure** and works over a `TableCore` (`round`, `options`, and the
per-page bookkeeping around them): `actingSeat` (whose turn it is right now — see the round-engine
section), `goRound` (play every AI-decided seat, stop at the next manual turn, a pending claim, or
the hand's end), one canonical `seenBy`, `snapshotTable` (the render-ready `TableSnapshot`, with
`seatRead` per seat folded in and a **copy** of `MatchState` under one `match` field — points move
mid-round, so a snapshot must not shift under whoever holds it), `splitDrawn`, and `analysisOf`
returning a `TableAnalysis`. That analysis is **lazy getters, not eager fields** — solo never reads
danger, folding never reads ukeire, and `evaluateDiscards` costs ~476 shanten probes per turn.

**`useRound(input)`** is the React owner for every trainer built on a real round — efficiency (both
routes), folding and the lab. It **drives a round and reports what the engine did**; it has no
opinion about what any of it means (ADR-0012). One callback:

- `onEvent({ event, core, replaying, analysis, logLength })` — every `RoundEvent` the engine emits,
  in order, for every seat. The consumer decides which seat it grades, when the round is over, and
  whether the board is worth keeping.

A handler steers by what it **returns**: nothing to carry on, `{ stop: true }` to halt where the
board stands (a real action — the turn's draw is cleared so the hand reads as finished),
`{ restart: wall }` to abandon the deal for a fresh one. There is no `stopAtTenpai` flag and no
"your seat": efficiency derives tenpai with its own `shanten()` call and filters on
`event.seat === seatIndex`, which is what lets a second manual seat be *played* without being
*scored*.

Two things stay with this layer because only it can know them. `analysis` (on the draw that
completes a hand and the discard/kita/ankan that spend it) is captured at the draw and **copies the
hand**, so grading measures the pre-throw hand even though a discard is reported once the tile has
already gone — `analysisOf` copying is what turned "read these getters synchronously or else" into a
rule that cannot be broken. It carries `drawn` as its own field beside that copied `Hand` (the
drawn tile no longer lives on `Hand` at all), which is what the efficiency hooks grade tedashi
against. `logLength` is how long `round.log` was when the turn began: by report
time the whole turn including reactions is applied, so a rewind link has to slice back to it.

Replayed events are **reported, tagged `replaying: true`**, not suppressed — the board really did
reach that state, so a consumer rebuilding state treats them normally while grading and logging skip
them (ADR-0021). The round is built **once**, during the render that first needs a board, with the
mount effect reusing it (`ensureBuilt`); replayed events are queued by the build and drained by the
effect so nothing grades or logs mid-render.

**Folding uses this hook like everyone else.** Its generation stays a pure search; what that search
produces is a wall, the algorithms each seat ended on, the graded seat and generation's own log,
and `replayLog` rebuilds the handed-over board from exactly that. The mid-hand algorithm flip never
needs replaying, because replay puts every seat on manual and only the *starting* algorithms of live
play matter.

### The danger model (`core/danger.ts`) + the folding trainer

`assessDiscards(hand, threats, visible, sanma)` ranks every tile in hand into danger tiers against
the seats in riichi — **ordinal, never probabilistic** (why: ADR-0004). Judged on **public
information only**: what the threat actually holds is never consulted, so a correct-but-unlucky
choice still grades correct.

Tiers, safest first: `genbutsu`, `noChance`, `oneChance`, `doubleSuji`, `suji`, `honour`, `halfSuji`,
`nonSuji`. Two placements that are decisions, not accidents: `halfSuji` (4/5/6 with only one side
genbutsu) sits _inside_ the non-suji outer band rather than with real suji, because that tile is
still wide open to the other ryanmen; and `TIER_SCORE` is one table, deliberately, because it is the
calibration knob for the whole trainer — tune there, never scatter the numbers. Ranks are **dense**
over the score (equal score ⇒ equal rank), and grading is `rank === 0`, never list position.

The rules worth not re-deriving wrong: a shape `(a, a+1)` waits on `a-1` and `a+2`, so the ryanmen
that wait on `n` are `(n+1, n+2)` and `(n-2, n-1)` — each is furiten-blocked when its **far end** is
genbutsu, and a shape whose far end runs off the suit is a _penchan_, not a ryanmen (that is why 3p
is suji off 6p but never off 1p). Kabe checks all three run shapes including the kanchan `(n-1, n+1)`;
no surviving shape ⇒ `noChance`, every surviving shape down to one copy ⇒ `oneChance`. Sanma is free:
tiles failing `inTileSet` count as four visible, so 2m-8m wall off everything that would need them.
Several threats take the **worst** tier, with the per-threat verdicts kept in `against` so the UI can
say "genbutsu vs South, non-suji vs West".

Genbutsu has two sources and the second is the one people forget: the threat's own discards, and
anything anyone discarded after they declared without being ronned. Both are derived from
`RoundState.discards` (`round.ts`), not `player.river` — `finishTurn` pops a claimed discard out of
the river, and it is still a tile that seat threw, so `discards` is pushed alongside the river and
never popped. `threatViews(state)` builds the `ThreatView[]` from it and is exported from
`round.ts` itself, since `chooseFold` (the AI's own defensive discard, `policy.ts`) needs the exact
same view the folding trainer grades against.

`playToRiichi` steps `beginTurn`/`finishTurn` itself during generation. The moment its riichi target is reached, every seat that has not
itself declared and is not itself manual has its `algorithm` switched to `'defense'` — otherwise
the opponents keep pushing for the rest of the hand, declaring further riichi and flooding the table
with genbutsu the drill never earned. "The moment" is literal, and has to be: the flip rides in
through `finishTurn`'s `beforeReactions` seam rather than after the turn, because the declaration
tile is one every other seat gets to react to. Applied a moment later, a seat still on
`'efficiency'` pons or chis the very tile it is about to spend the rest of the hand defending
against, and the reader is handed a board whose folding seats carry fresh melds they would never
have called. Generation (`findRound`) searches **fresh random walls** for a
hand worth drilling (not ended, the seat due to act is not itself in riichi, at least 1-shanten,
enough wall left, and the ranking holds both a genbutsu and something bare), yielding between
attempts so the page stays responsive, and **falls back to fewer threats** rather than failing,
since three simultaneous riichi is too rare for any sane attempt budget. The board is then handed
over a seeded 0…`players-2` turns later, so you are not the declarer's shimocha every single hand —
the algorithm flip happens first, so those extra turns cannot add a threat the link never promised.

**The wall alone reproduces the board**, round wind and handover offset included: both are seeded
off `wallKey(wall)` (the wall serialised in draw order, `mulberry32`), which is what makes the share
link exact without carrying either. Everything else that shapes the same deal — `sanma`, `threats`,
`wins` — travels beside it as `BoardOptions`, and the decisions played since the handover ride along
in the situation's `log`, so a mid-hand turn is shareable and every log row rewindable. Generation
keys only on what shapes the hand, never on the per-seat algorithms: those are live board state
rather than search input (see the trainer-pattern section), so flipping one after generation applies
to the hand already found rather than triggering a new search.

Any seat can be manual, same as efficiency/lab — not only the drill's own generated seat
(`RoundCore.seatIndex`, the seat `worthwhile`/`handedOverAt`/`endOf` still anchor to). The seat
panel's raw config (`SeatConfig.modes`, never the resolved one) seeds `RoundOptions.algorithms` at
generation time in `playToRiichi`: every seat marked `'manual'` joins `seatIndex` as manual, and an
explicit per-seat choice there outranks the drill's own blanket "everyone who missed the riichi
target folds" flip. Past generation, a live algorithm flip goes through `useRound`'s own sync effect —
folding lays the seat panel's choices over the algorithms generation settled on and hands the result
in as `RoundOptions.algorithms`, so the hook writes them straight onto the running
`PlayerState.algorithm` and re-resolves a claim pending on a seat that just stopped being manual
(`reconsiderClaim`) — no redeal, no re-search (ADR-0008). The claim-suspension guard is
`useRound`'s now rather than something folding re-derives. Perspective (which seat `Table` draws at the bottom) never reaches this hook at all — it
is `FoldingPage`'s own `useState`, reset to `round.seatIndex` on every new hand and never persisted,
so rotating it cannot re-search for a new hand or pin itself onto the next one the way a stored
`orientation` field once did. Because it can move, the felt hand `FoldingPage` omits is the one
belonging to the seat the board is _drawn from_, never the drill's own graded seat: the bottom of
the felt is where `HandDisplay` already sits, so anything drawn there lands on top of it. The graded
seat, once the perspective has moved off it, is an ordinary seat on the felt — face-up, since
`boardHands` gives a seat somebody plays real tiles.

Two folding settings are about what the trainer says rather than what it deals, so neither touches
the link: `showEquallySafe` (off — naming the tiles that tied a correct answer hands over part of
next turn's reading) and `feedbackAtEnd` (off — holds the panel, the running score/accuracy _and_
the log rows until the hand is over, since those rows name each turn's safest tile). Alongside the
pass/fail score the session carries partial credit per throw, `(worst - yours) / worst` over
`dangerScore` (`danger.ts`) across the tiles that hand held — `useSessionStats.record` takes it as
an optional third argument and averages it into `averageQuality`.

Two rules the UI must keep: a _threat's_ hand is revealed once the hand is over **or** once
`showOpponentHands` is switched on (`boardHandsOf`, `useFoldingRound.ts`) — that setting is a
board-wide debug switch, not a narrower one that carves the drill's own answer key back out, so it
reveals the declarer exactly like it reveals every other seat, live, mid-hand. A non-threat
bystander was never gated on `finished` at all — it carries real tiles throughout and always
followed `showOpponentHands` live like any other trainer's opponents — and no tier below
`genbutsu` may ever read as "safe": suji only ever spoke about ryanmen, and a wall only about
runs.

`showSeatWaits` (`tableSettings.ts`) is the same reasoning again for tenpai/waits instead of hands:
board-wide, non-advanced, default off, reveals riichi threats live, and explicitly *not* carved
out for the folding drill's own answer key either. `core/table.ts#seatRead(state, seat, sanma)` is
what it gates — `waits()` (`policy.ts`) plus `TILES_PER_KIND - seenBy(state, player)[tile]` for
each wait's remaining copies, and `isFuriten(waits, river) || player.missedWin` for furiten.
`waits` costs ~34 shanten probes per seat, so it is computed inside the snapshot builders
(`snapshotTable`, and folding's own `snapshot`) rather than per render. What the setting gates is
the **wait tiles**; the `SeatRead` behind them is built for any seat whose tiles the reader can
already see, which `snapshotTable` reads as `showReads || round.ended || isManual(seat)` —
`showReads` being `showSeatWaits || showOpponentHands`, threaded through `useRound` under that
name because both halves mean the same thing to it. A furiten mark says nothing a visible hand
does not, so the rule is simply *tiles on screen ⇒ badge*: your own seat always, every seat once
the hand is over, every seat while the reveal switch is on. It is still never computed for a hand
the reader cannot see. The algorithm badge (`SeatStrip`) has no
such setting at all — every seat's mode is shown always, colour-coded (efficiency green, defense
blue, manual yellow), since reading who is running what is basic table awareness the same way
`showOpponentHands` is, not a jargon-gated extra. The per-discard feedback (`FoldFeedback.tsx`) names only
the tier (with a glossary popover on genbutsu/suji) — it does not spell out why in a sentence of its
own, trusting the glossary entry to carry that instead. By design (ADR-0004): fold-only — no push
control, since grading push/fold needs an EV model this codebase does not have — no danger markers
before the answer, threats configurable up to `players - 1`.

### Tenhou notation + situation URLs (the shared DSL)

Tenhou strings (`123m406p11z`, `0` = red five) are the interchange format everywhere: URL params, log copy buttons, tests. `serializeTenhou` sorts (hands); `serializeTenhouOrdered` preserves order (walls/rivers, where draw/discard order matters).

`urlCodec.ts` round-trips a `Situation` — `wall`, `log`, `round`/`seat`, the optional `deadWall`/`aka`/`sanma` rule overrides (`FLAGS`), the match context (`kyoku`, `honba`, `dealerRepeat`, `dealer`, `riichiSticks`, `points`), plus `seed`/`hand` — through query params. Every trainer page decodes it from `useSearchParams`, so a URL fully reproduces a drill. Semantics that matter:

- **`wall` is the deal itself**, not a prefix consumed on the next draw: the whole deal in dealing order (4/4/4+1 per seat, ADR-0024), then the live draws, then the last 14 as the dead wall. A short wall is completed at random from the copies it leaves. This is the **one codec in the repo that rejects rather than repairs** — `validateWall` sets `wallError` and empties `wall` instead, since a wall is positionally meaningful and a silent repair hands back a different board than the link claimed (contrast `parseTenhou`, which drops a malformed digit).
- **`log` is every seat's decisions** from the deal to the situation's decision point — `LogEntry` is `discard`/`call`/`kita`/`ankan`/`win` — replayed by `replayLog` (`round.ts`), which puts every seat on `'manual'` for the duration and so **consults no algorithm at all**. That is what makes a shared link reproduce the hand that was actually played rather than the hand today's algorithms would play. Nothing in it is an extra tile: everything named is already accounted for by `wall`.
- **`seed`/`hand` are the shanten trainer's alone** — it deals no wall, so it has nothing to share, and it stays on the seed-plus-pinned-hand format while every wall-based trainer (efficiency, folding, scoring, lab) shares a board through `wall`.
- The rule-override flags pin round behaviour regardless of the receiver's settings; `situationQuery()` produces such a dump.
- **The match context is carried key-by-key and omitted at its default**, so an unmodified link is exactly as short as it was before the fields existed (`kyoku` at `1`, the counters at `0`, `points` at the starting array for the ruleset). `matchOverrides(situation)` turns a decoded `Situation` into `Partial<MatchState>` one key at a time rather than by spreading — a present-but-`undefined` key would clobber `createMatch`'s own default through a shallow merge. `Situation.round` stays the prevalent-wind letter it has always been; `kyoku` is the number within it, which is why the two are not one field. What travels is the round's **starting** match (`input.options.match`, in `useRound#situation`), never the live `RoundState.match`: a riichi's 1000 is re-applied when the link's `log` replays that discard through `finishTurn`, so sharing the mutated state would deduct it twice. `scoringUrl.ts` is untouched: it round-trips a frozen `ScoringSituation`/`WinContext`, never a running `MatchState`, and already carries its own honba. Old links decode to defaults, no shims (ADR-0020).

### Trainer pattern (`src/features/*`)

Each trainer is a page component plus a `use*Round` hook — `useShantenRound`, `useEfficiencySoloRound`, `useEfficiencyRound`, `useFoldingRound`, `useScoringRound`, `useLabRound`. All but shanten sit on the shared table layer below. The hooks keep mutable round state in a `useRef` and mirror render-ready snapshots into `useState`; an unspecified seed stays random per mount, and restart/next-hand appends a counter suffix. The graded trainers (shanten, scoring, folding) get their session score, per-decision clock and random seed from `lib/useSessionStats.ts` — it also owns "clearing the log resets the session".

The shanten trainer is a continuous stream, not one graded hand at a time: `submit()` grades, then bumps `handIndex` while carrying `running` forward, so the next hand is dealt already revealed with the previous hand's feedback kept in `lastResult` (which holds its own tiles, since the on-screen hand has moved on). The stream starts revealed and on the clock (every other trainer puts a board up on load, so a first hand hidden behind a button reads as "not loaded yet" rather than as a gate). There is no next-hand button; the reveal/stop control is the only gate, and stop abandons the hand (fresh deal, timer back to zero) rather than pausing — a peeked hand can't be timed again. A link's pinned `hand` is honoured only at `handIndex === 0`, so a shared hand (or a rewind out of the log, which resets the index) is posed once and the stream carries on instead of serving it forever. Clearing the log clears the session it recorded: score and average reset with it.

The two efficiency trainers are **two routes, not a checkbox** (ADR-0013): `/efficiency-solo` is genuinely one seat (`createRound(wall, 1, …)`, dead wall and dora kept, no `<Table>`), `/efficiency` is a full table. Both grade inside their own `onEvent` on `kind === 'discard'` and run `wins: false` (a hand ending on someone else's tsumo would cut a per-turn drill short on a result the player did not cause), `riichi: false` (efficiency reads no danger, so an opponent's riichi there was decoration, not signal) and `calls: true`. Both return `{ stop: true }` from their handler when their own seat's discard reaches tenpai, leaving 13 tiles so it reads as finished — a trainer's stop condition, not a flag the table layer carries. The graded `seatIndex` comes from the link alone, never from the seat panel. `RoundState.visible` accumulates every face-up tile and feeds ukeire remaining counts. Player count is derived per round (`options.sanma ? 3 : 4`) — never hardcode 4/3. "finished" is derived (hand below 14 tiles), not stored. The two hooks are mirrored rather than shared, differing only in `players`/`calls`/`riichi`; nothing asserts they stay in lockstep, so a change to one wants checking against the other.

Sanma (`options.sanma`, mirrored by the global `sanma` setting and the `sanma` situation flag) drops 2m-8m from the tile set everywhere it's produced — `buildWall`/`deal` (`core/wall.ts`) skip those ids via `inTileSet` (`core/tiles.ts`), and `improvingTiles`/`ukeire`/`evaluateDiscards` (`core/ukeire.ts`, `core/efficiency.ts`) take a `sanma` flag so they never propose drawing a tile that isn't in the wall. `NUM_TILE_TYPES` stays 34 and the id layout is untouched — sanma is expressed purely as "these ids have zero copies," not a smaller id space. Kita (nukidora, `useEfficiencyRound.ts#kita`) is graded, not free: it reuses north's own `evaluateDiscards` entry (id `NORTH` = `HONOR + 3`) as "what pulling it costs," compared against the same round's `ranked[0]` with `isBestDiscard` — the exact function `discard()` uses. No special tie-break is needed: `ranked[0]` is already the global optimum, so north's entry only ties it when pulling really is as good as the best discard, and a north held as a pair's head shows up as worse shanten/ukeire in that same entry, correctly discouraging the pull. `TurnResult.kind` (`'discard' | 'kita'`) exists only so `DiscardFeedback` can label the row "Kita" instead of "Your discard"/"Best discard" — it carries no grading logic of its own.

State stores are zustand: `settingsStore.ts` (persisted; has a custom section-wise `merge` so adding fields to `scoring`/`folding` survives old persisted schemas — extend that merge when adding a new section. The `efficiency` and `shanten` sections are gone: their timer/shanten/ukeire toggles were display options nothing grades on, so those trainers now run the clock, the shanten line and the ukeire tiles unconditionally. The persist version stayed at 3 rather than bumping to drop the stale keys — a bump drops the whole blob, costing every reader their theme, language and scoring settings to clear two objects nothing reads) and `store/log.ts` (session-only action log; entries can carry inline tiles and a `copyText` for a tenhou copy button). Log entries are written imperatively from user-triggered actions (inside `discard()` / `submit()`), never from `useEffect`s watching round state — effect-based logging inverts entry order and duplicates under StrictMode. The one exception is the round-build effect itself (`logReplay` in both `useEfficiencyRound.ts` and `useFoldingRound.ts`, which puts a shared link's replayed discards on the log under the shared `log.replay` key): it deduplicates on the decoded situation/link object's identity, since that effect runs twice per mount and four times under StrictMode for one and the same round — which is also why those objects come from `useUrlData` (memoised per navigation) rather than being rebuilt per render, the same identity the trainers' "reset `handIndex` while rendering" pattern keys on. That row is also why `BoardStage` clears the log during its first render rather than from a mount effect — effects run children-first, so a page that logs as its round mounts would have those rows wiped by the stage around it a moment later.

Per-seat table configuration (`features/settings/tableSettings.ts`) is one schema every
board-rendering trainer shares: `SeatConfig { modes: SeatAlgorithm[] }`, plus `TableSettings.claims`
alongside it (see below). **`Table` itself has no concept of a "player"** — every seat, including
the one a trainer generated for the reader, is just a seat with an algorithm, and the only thing
that makes a seat the one you play is `'manual'`. "Your seat" is a trainer-level idea (the
generated seat `resolveSeatConfig` anchors its manual-seat guarantee to), not something `Table` or
its `SeatView` reads or needs to know. The one standing restriction on that uniformity is the
default it keeps: `resolveSeatConfig` still anchors one manual seat, but as a sensible default
rather than a load-bearing rule — `goRound` with none now plays the hand out, which is the autoplay
ADR-0011 deferred and ADR-0012 delivered for free. A step/pause surface on top of it is still
unbuilt.

**Seat algorithms are board state, not a preference, and are deliberately not persisted** (ADR-0015): a
board opened three days later coming up with opponents nobody remembers choosing is the same bug as
a stale perspective. `SeatConfig` lives as page state with the same lifetime as `viewSeat` — a
`useState` seeded from the link, reset on every new hand — in `EfficiencyPage`, `FoldingPage` and
`LabPage` alike; the settings store no longer holds a `modes` field at all. The one part of the old
seat panel that *is* a reader preference and stays persisted is `TableSettings.claims` — it answers
a question about the reader ("do I want to be offered pon/chi/ron"), not about the board (ADR-0015).

Perspective (which seat `Table` draws at the bottom) is deliberately not part of this schema at
all — it is its own ephemeral page state (each page's own `viewSeat` `useState`, defaulting to
`round.seatIndex` and reset on every new hand), never persisted, and view-only in every trainer
including efficiency and the lab: "watch from here" stops meaning "play here", which comes only
from a seat's `modes` entry being `'manual'`. The page's own `hand` slot (under the board, not on
the felt) follows perspective too, not the seat actually acting: rotating to another seat shows
*that* seat's hand there — face-down unless it is itself manual or hands are revealed, its 14th
tile split out separately the same way an opponent's is on the felt (`splitDrawn`/
`splitConcealedDrawn`, `core/table.ts` / `useFoldingRound.ts`) — and it is click-through only when
perspective and the seat actually mid-turn are the same seat.

Anywhere else it is a genuine spectate: `ManualControls` grows a "Watching {wind} / Back to your seat" line so a claim or a
riichi decision can never silently stall behind a view the reader can't act from. `SeatButton`'s
dialog reflects the same idea from the settings side — the seat you're already looking at gets no
"watch from here" row at all (dropped rather than left as an empty "your side" label), since there
is nothing left for that dialog to offer about perspective once you're already there.

`resolveSeatConfig(config, players, defaultSeat, fallbackModes?)` fills every seat and guarantees at least one manual seat, anchored on `defaultSeat`
(a link's `?seat=`, or the seat the trainer generated) rather than on perspective — with none,
nothing would hand the reader a turn; `fallbackModes` overrides the generic `'efficiency'` default for
an unconfigured seat with what the board is _actually_ doing right now (folding's own live
`algorithms`, read straight off `PlayerState.algorithm` for every seat, since it flips non-declarers
to `'defense'` at handover and the panel must not show an algorithm the board isn't really running).
Each page builds `RoundOptions.algorithms` straight off `resolveSeatConfig(...).modes` at round-build
time. The graded `seatIndex` itself is decided by the trainer (the link's `?seat=`, or the seat the
drill generated) and never by the seat panel — flipping that seat's own algorithm away from
`'manual'` cannot move which seat is graded, it only freezes grading in place (ADR-0008), so a second
manual seat never silently moves which seat a graded trainer scores.

Every patch a caller sends `onChange` is built off the _raw_ `SeatConfig`,
never the resolved one (`withSeatMode` copies just the array a click actually touches) — writing the
resolved fallback modes back on every edit is what used to make an unrelated change (like moving
perspective) look like a real `modes` edit and re-search folding for a new hand. `useTableSettings(app)`
adds `seatsEnabled` (`advanced || app === 'lab'`), which each page uses only to decide whether to
render the `SeatButton` panel at all — the underlying `seatConfig` state is page-local and starts at
`null` regardless, so there is nothing persisted for a hidden panel to leave running underneath.

`SeatButton` (`features/settings/SeatPanel.tsx`) is the dialog; `SeatStrip`
(`features/table/SeatStrip.tsx`) is the thin wrapper that places its trigger on the felt itself,
fed to `Table`'s `seatInfo?: (seat: number, wind: ReactNode) => ReactNode` prop — which hands a
node back the other way. The **whole corner cell on that seat's right** is the plate's (4 tile widths
square), and the strip lays it out as a column: the wait tiles on top, then a bottom line holding
the seat's wind, its settings trigger, its algorithm badge and its furiten badge — in that order
outward, so the two seat *settings* sit together at the corner and the two *hand reads* (furiten,
and the waits above it) together beyond them. Everything in that column hangs off
the seat's own outer edge — `items-end`, the bottom line `flex-row-reverse` so source order still
reads wind-first while the wind lands on the corner, and `flex-wrap-reverse` so a line that
overflows grows *inboard* rather than pushing the wind off the felt. The wind is `Table`'s own styled
node rather than the strip's, so a trainer that renders no strip still says which seat is which
(and the fallback is `||`, never `??`: a caller returning `seatsEnabled && <SeatStrip/>` hands back
`false`, which a nullish check reads as a node and drops the wind entirely) — it carries its own
`justify-end` for exactly that case, where it is the whole plate and stretches to the cell's width
instead of hugging the letter. Putting the wind on
that line rather than beside the strip is what lets the waits start at its outer edge and take the
cell's whole width: thirteen orphans then fit two rows instead of running out over the next seat's
river. A furiten seat's mark on that line is `InfoPopover` directly rather than `GlossaryTerm`: the
plate is rotated with its seat, and `GlossaryTerm`'s inline hover card hung sideways off the corner
while the word itself drew at the page's 16px instead of the board's `cqw` scale — the portalled
popover is upright wherever the seat is facing. It keeps `GlossaryTerm`'s *affordance* though —
dotted underline and a question mark, both sized in `cqw` — since a chip that explains itself on a
tap has to look like one. The seat's own rotation carries the corner round
with it, so every plate lands on its own outside corner.

**Nothing in that corner may be sized in pixels.** The cell is a track that scales with the board,
so everything in it scales too: the trigger is `8cqw` tall (a fixed `h-11` ran a phone-sized board's
plate clean off the felt) and its ≥44px touch target is kept by an `after:size-11` pseudo-element
instead — a real 44px hit area over a layout box that costs the corner only what it draws, which is
also why the box hugs its icon rather than carrying a `min-w`, whose empty sides read as gap. The
wind takes that same `8cqw` line height and centres in it, and the plate's `pl` makes up the same
`(8cqw - 3cqw) / 2` on the left so the letter sits the same distance from both felt edges. The
waits are `100cqw/32` with the strip at `w-full`: without a width to wrap against, a column that
sizes itself to its own content drew all thirteen in one line straight off the cell.

Two earlier homes failed and are recorded so they aren't retried: a centre-panel row (too narrow for
three 44px targets plus the round wind, wall count and dora row), and a ring **outboard** of the
seat's hand (its ring margin ran ~50px on a phone, overflowing the plate and hand row
onto the seat's third river row). That band survives the move at 10% of the square's edge, but is now the
revealed-hand ring alone (one row of tiles at `100cqw/16`, ~8.3cqw deep) and applies only while
`showsHands`. It is the felt's own `p-[10%]` and nothing else — the constant that used to name it
went with `--table-cap` (ADR-0025), since the board now sizes itself to the room it is given and
has no cap left to grow in compensation. The hand ring itself: `absolute inset-0` on the
*outer* square (the `relative` box the felt's own padding lives inside) — `display: contents` on the
per-seat grid wrapper generates no box, so the ring still resolves against that outer square
regardless of its own grid-item ancestry — and `items-end` lands it flush against the square's true
edge.

`Table` computes `seatInfoNodes` once per seat rather than calling `seatInfo` again per render — a
caller may offer `seatInfo` unconditionally and return nothing per seat while `seatsEnabled` is
false, and each corner cell has to know which it got (and hand it the wind itself instead). Each plate opens a
dialog scoped to that seat: "watch from here" (`onWatch`, offered on every seat but the one already
being watched, on every trainer now that perspective is view-only — there is no longer a trainer
where moving it would mean a different board), the efficiency/defend/manual row, and the claims
checkbox (manual seats only). Every trainer offers every mode on every seat uniformly — there is no
baked-in "you vs opponents" distinction, only perspective (view) and mode (who decides).
`ManualControls` (`features/table/ManualControls.tsx`) is the shared riichi-arm button, claim
prompt (ron/pon/chi/pass, caller's own tiles drawn on each button), and — once more than one seat is
manual — a "Playing {wind}" line; it renders nothing in the single-manual-seat, no-claim, no-riichi,
own-perspective case, so every trainer mounts it unconditionally. Watching a seat other than the one
that would otherwise act (`viewSeat`/`onReturn`) swaps every other line out for "Watching {wind} /
Back to your seat" instead — spectating suspends the whole control surface (a pending claim
included) rather than answering it against a hand that isn't on screen.

### UI

`components/tiles/Table.tsx` is the shared board — efficiency, folding and the lab always (reading the table _is_ the folding drill), scoring while its own `settings.table` is on. A 3x3 grid measured in tile widths (4fr/6fr/4fr = 14 across), seats placed by `(seat - seatIndex + players) % players` and rotated `-90deg` per step so `seatIndex`'s seat is always at the bottom, each seat's plate in the corner cell on its right.

Calls are **not** on the felt (ADR pending): a seat's melds and nuki ride at the right-hand end of its own hand ring — the band outside the felt that the square's own 10% padding pays for, at `100cqw/22` against the hand's `100cqw/16`, since four melds at hand size run past the felt's edge. They used to pile up in a corner cell, which is a real table seen from above, not a client. The seat the board is *drawn from* has no hand out there at all, so its calls go to `HandDisplay` under the board instead (`melds`/`nuki` props, same 0.75 proportion and 0.8-tile gap): every board page — scoring included — drops `melds`/`nuki` from that seat's `SeatView` and wraps the hand row in `justify-center`, since calls hanging off its right put an uncentred block under a centred board. `HandDisplay` carries a `justify-center` of its own for the case that wrapper cannot reach: a called hand is wider than the column under the board, so the calls drop to a second line and the tiles above them would otherwise sit flush left. Unwrapped that class does nothing, the box being sized to its own content. `showsHands` therefore counts melds and nuki as well as hands — a board where nobody's hand is drawn but somebody has called still has to pay for the ring, or those calls land across a river.

`seatIndex` is purely which seat the board is drawn from — a viewing perspective, not "the user's seat"; `SeatView` has no player field either, only `hand`/`drawn`/`concealed`, so a seat someone plays and a seat nobody does are drawn through the exact same props. There is no on-board "(you)" label, only the bottom-seat rotation itself and (where a caller passes it) that seat's own styling. `SeatView.drawn` (optional, alongside `hand`) draws that seat's 14th tile with a small gap after the rest — the same tedashi/tsumogiri read a real felt gives, honouring `concealed` exactly like `hand` does. Rivers carry `RiverTile` flags (`tsumogiri`, `riichi`) rather than parallel arrays; absence of `tsumogiri` means tedashi. `River`'s own `wide` lets its six-tile rows stand side by side instead of stacking — they wrap into whatever width the caller gives the box, which for solo efficiency is twelve tiles, halving the depth of a river read off the felt (eighteen rows by the time the wall is out) without touching the six-tile beat a player counts one by. The caller owns that width on purpose: a river that widens as it fills moves the hand under it.

The match context reaches the board as two plain props, ADR-0014 intact — values in, no game logic: `roundNumber?: number` prints beside the wind tile in the centre panel ("East 1"; omitted when not passed), and `SeatView.points?: number` prints on the centre panel's edge facing that seat, where a real table keeps the scores. Points are **board truth like `riichi`/`melds`, not `seatInfo`** — the render prop is the page's settings/algorithm/waits surface, and routing board state through it would make what the felt says depend on whether the seat panel is enabled. Same rule as the rest of the board: `cqw` only, never pixels (the points line is `2.6cqw`). Each score is pinned to the bottom edge of a **square overlay** that carries the seat's rotation, never positioned per seat and then turned: a transform doesn't move the box it was laid out in, so per-seat placement left the two side seats' scores half a text-width further in than the top and bottom ones. The round line above them (`table.roundLine`/`roundLineRepeat`, "East 1 · 0" spelled out rather than drawn as a wind tile) is `3.2cqw` against the panel's own `2.6cqw` — it is what the panel leads with. Passing `honba` also fixed a hardcoded `0` in the centre readout on efficiency/lab/folding, none of which had a real value before. Scoring stays untouched — it renders a frozen result, not a running round.

Sizing: container query units (`--tile-w: calc(100cqw/14)`), so the whole board scales from the one width on its outer div — put width there, never on the square, or a `w-full` child collapses when the board is a flex item. Tracks must stay `minmax(0,…)`: a seat block is measured before it rotates. The `short:` variant (`index.css`, max-height 520px — a phone held sideways) keys `--tile-w-raw` off `vh` instead of `vw`, since a square board is only ever limited by height; the hand stays _under_ the board at every size (a real client and a real table both put your tiles along your own edge of the felt), and the width left over becomes the gutters the chrome row and notices sit in. There is no control row above the board at all now: every seat's own info strip is on the felt (`seatInfo`, see the trainer-pattern section) and every command button is in the stage's chrome row. The square's cap is `calc(min(100%, 100cqh) * var(--board-scale, 1))` — the space it has, times the size setting. `100cqh` is what makes it *fit* rather than merely estimate: the stage's board area declares itself a size container, so that is the height genuinely left after the chrome row and the hand strip have taken theirs. Nothing estimates it any more — the old `--board-max-h` (`100svh` minus a nominal chrome and hand) sat inside the same `min()`, so whenever the guess came out tighter than the truth it was the guess that sized the board, and with no size container at all `cqh` falls back to the small viewport anyway. `--board-scale` is the global tile-size setting's board half (`BOARD_SCALES` in `settingsStore.ts`, paired with `TILE_SCALES` by index, XL = all of it) — one setting over the whole table, since felt tiles are derived from the felt's own width and would otherwise ignore it. **Both halves apply from tablet size up only** (`sizable:`, `(min-width: 768px) and (min-height: 521px)`, `index.css`): `BoardStage` always declares the reader's choice as `--board-scale-pref` and only that variant resolves it into `--board-scale`, which is otherwise 1. Below it the board always fills its room, and that is a board rule rather than a preference — the side seats' hand rows are `items-end` against the square's own edge, so a square smaller than its room pulls those hands off the screen edge by exactly the margin it leaves (39px on a 390px phone at the old S). The tile half is gated the same way and by the same variant (`--tile-scale`, defaulting to `DEFAULT_TILE_SCALE`), so a phone is always at M: every other step there is a lie the board cannot honour, and the settings dialog says so instead of offering four dead buttons — `SIZABLE_QUERY` (`settingsStore.ts`, the variant as a query, keep the two in step) disables that row below the gate and shows the size actually in force. The gate is its own variant rather than `roomy:` because the two mean opposite things: `roomy:` (1024) is where the layout *spends* room it has (the board area's margin, the HUD hung off the square), `sizable:` (768) is where the board has more room than it needs and the reader may take some back. Where the setting applies, it is a **ceiling on the hand rather than a width**: the hand strip is an inline-size container and the box inside it caps `--tile-w-base` at `(100cqw - 4.5rem)/14` (the 14 tile buttons' own `p-0.5`, the drawn tile's `ml-2`, and slack — an exact fit still wraps), so asking for bigger tiles can no longer wrap the hand onto a second row and take that row's height off the board. Below the gate nothing is capped: the board there is limited by width, so a second hand row costs it nothing and reads better than the sliver a cap would leave. There is no desktop "don't balloon" cap any more (`--table-max`/`--table-cap` are gone, ADR-0025): the board fills the stage, and on a screen with room to spare the scale says how much of it to take. The felt inside the square is `aspect-square w-full`, never `h-full`: a percentage height against a box that only gets its own height from `aspect-ratio` is indefinite in WebKit, so the height fell back to auto, the rows sized to content instead of to their fr shares, and the board came out 390x468 on an iPhone while Chrome drew it square. The felt is square by construction (a square with equal padding on all four sides — percentage padding resolves against the width), so asking for that directly is the one form both engines agree on. `e2e/board.spec.ts` asserts squareness on iPhone portrait, iPhone landscape and desktop; that bug class is invisible to Chrome/Firefox device emulation, which is why the UI suite runs a real WebKit.

`components/tiles/BoardStage.tsx` **is the trainer page** (ADR-0025) — there is no second layout and no `full` prop. Normal flow, `h-svh`, a chrome row (or, `short:`, a 44px left gutter), the board area, the hand strip, and the session panel beside them. It absorbed what `TrainerLayout` used to own: the `--tile-w-base`/`--tile-w` scale variables and the clear-the-log-on-first-render guard. It also renders `SettingsButton` itself from a `settings?: ReactNode` prop, so the gear is always **last** in the chrome row (back, info, the page's own `chrome` toggles, the log button, settings) rather than each page choosing. Everything else is slots: `board`, `hand`, `status`, `notice`/`noticeCompact`/`noticeKey`, `end` (a centred modal over the board), `panel`, `children`, `flow`, `onLogOpen`, `title`, `intro`. The board area is the stage's size container (`container-type: size`), which is what the square's `100cqh` cap resolves against. A **boardless** trainer's `children` render in that area rather than being dropped — solo's own river lives in there, and a table where you cannot see your discards is not a table — and so does a trainer with nothing dealt yet (folding searching, scoring dealing, the lab's empty state), which is why those no longer need a stripped-down page of their own.

The **session panel** is everything that is not the board or the hand: `notice` in full, `panel` (the lab's own rankings and wall authoring — every other trainer passes nothing now that the share link has moved, below), then the log header and `LogList`. One renderer, two placements: **docked** beside the board from `lg` up (`WIDE_QUERY`, read through `lib/useMediaQuery.ts` — `useSyncExternalStore`, so the first render already knows which shape it is drawing) and open by default, a **drawer** over the whole stage below that. Crossing the breakpoint resets it to that shape's own default, so a resize never leaves a drawer standing over tiles nobody asked to hide. Both halves of the panel are `flex-auto` rather than a fixed share: each is sized by its own content and only gives ground in proportion to it, so a long ukeire list gets the room an empty log is not using. Its tiles draw at `0.6` — they are read, not played, and at hand size one ukeire list filled the 320px column on its own.

`status` (the trainer's score/accuracy/clock lines) is not panel content (ADR-0026): a clock behind a drawer tap goes unread, so it floats instead as a small HUD inside the board area itself — the same box `noticeCompact` floats in, opposite it (bottom-left rather than top-centre, so the two never compete for the same strip), mirroring into the `short:` gutter the same way `noticeCompact` does. Always on screen at every viewport, panel open or shut. Not `pointer-events-none` as a whole: efficiency's ukeire line carries a live `GlossaryTerm` popover trigger, so only the wrapper is inert. Sharing the board itself is no longer a panel button either: every trainer's round-build effect now writes a `log.dealt`/`log.dealtHand` row the moment a board exists, and that row's own rewind/share buttons (`LogList.tsx`) are the one sharing surface a trainer has — the page-level `CopyLinkButton` pill is gone.

`onLogOpen` (the clock pause) is derived from **drawer** open, not panel open: a docked panel hides nothing, so it must not stop the clock. It is reported from an effect on that one derived flag rather than from the click handler, so every way it can change — a resize, Escape, the scrim — resumes exactly once and never lifts a pause the reader pressed themselves. The drawer is the *stage's* own child, not the board area's, so it spans the whole page and covers the hand strip too — stopping at the board's bottom edge left the tiles it is meant to be read over showing underneath it — and it is a dialog like every other one in the app: `z-50` over the chrome row's `z-40`, its own scrim, dismissed by Escape or a press outside. It owns the top safe-area inset, since it reaches the top of the page.

`board` is optional — the boardless trainers (shanten, solo efficiency) never pass one, and scoring passes one only while its own `settings.table` is on, falling into the exact same boardless shape the moment it's off; either way that content goes through the ordinary `hand`/`notice`/`children` slots.

`flow` is how a boardless trainer says its `children` are a document that grows rather than a block
to be posed: the content is anchored to the **top** of the board area and given the full width to
size itself off, and from `roomy:` up both the board area and the column holding it drop to
`flex-initial`, handing back the height they are not using so the hand strip rides up under the
content instead of standing at the bottom of an empty screen (both, because the column is what
actually reserves that height — shrinking the area alone moves nothing). Below that gate — a phone
either way up, a tablet — nothing moves: the hand keeps the bottom edge the way a felt gives it, and
the content scrolls in what is left. Solo efficiency is the only page that passes it, and its river
is why — the other boardless slots hold one line ("Dealing…"), which reads better centred. Two
details ride with it. The area drops to `container-type: inline-size`: size containment would make a
box that sizes itself to its own content collapse to nothing, and `100cqh` belongs to `Table`'s
square, which a flow page has not got. And its `pb-16` is a strip the content never reaches — the
gap between the last river row and the hand once the wall has run out, and where the floating
`noticeCompact` lands (`bottom-2` rather than `top-2`, since the top of a flow page is the wall
count and the dora indicator, which is exactly what a reader is looking at while deciding).

Content that rides up has to be a **fixed size whatever it holds**, and that is the page's job, not
the stage's: a river that grows into its space walks the hand down the screen a row at a time, and a
hand that moves under the pointer between turns is a hand you misclick. Solo's river box is
therefore twelve tiles wide always, and `roomy:` reserves the rows this round's own wall could ever
fill (`ceil(liveWallSnapshot.length / 12)`, passed in as `--river-rows`) — `liveWallSnapshot` being
constant across the round where `liveWall` is not, and the dead-wall setting being what moves it
(109 rows' worth of tiles with one, 123 without). Its tile size is
`min(<what this screen would draw>, (100cqw - gap) / 12)` off the block's own inline-size container:
on a phone the second half never binds, so the river spends the width it has instead of hugging one
edge of it; from `sizable:` up it draws at 0.8 of the hand's size, where a river off the felt
belongs.

Real browser fullscreen is no longer a mode with a button, a store and a `full` prop: `useMobileFullscreen` (`components/tiles/useFullscreenBoard.ts`'s replacement) asks for it on phone-sized viewports only (`MOBILE_QUERY` = `(max-width: 640px), (max-height: 520px)` — the height half is the same 520px `short:` keys on, a phone held sideways being the viewport with the least room of all), on the reader's first `pointerdown`, and never again once they have left it (a module-level session flag, not persisted). `requestFullscreen` is rejected outright outside a real user gesture, which is why it waits for that tap rather than firing at mount. It only ever removes the browser's *own* chrome on top of a layout that is already the whole page — worth having on Android, absent on iOS.

The chrome row holds everything a hand needs: back-to-home, `InfoButton` (`BoardStage.tsx`, which owns `TrainerIntro` too and is reused by the home page's trainer cards), each page's own `TrainerToggles` (`TrainerControls.tsx` — start/pause, undo, reset), the `wall` slot, the log toggle, and settings last. That `wall` slot is `WallDetails` (`Tile.tsx`), which is now its own chrome button plus an `InfoPopover` dialog rather than a `<details>` row in the session panel behind a setting — the `showWall` setting is gone entirely (with it, the last advanced-gated field in `useTableSettings`), since a deliberate peek at the wall wants a button, not a preference the reader has to find first. Every board trainer passes it; shanten deals no wall and passes nothing, and the board pages pass nothing until they have dealt one (`loaded`/`round.round`), so the button is absent rather than empty. Held sideways the whole row stands in the left gutter instead, so the square's height budget is the viewport minus the hand alone. Each button carries its own name beside its icon behind the `labelled:` variant (`index.css`, `(min-width: 1400px) and (min-height: 521px)`) — one media query rather than `xl:` with a `short:` override, since a wide but shallow window is both and there the row is a 44px gutter. The visible text is the same string the button's `aria-label` already used, so the accessible name never depends on the viewport; `CHROME_BUTTON`/`ChromeLabel` (`TrainerControls.tsx`) are what every button in that row, `SettingsButton` included, is drawn with. `LogList` lives in `components/LogList.tsx`; its `className` is how tall it may get (`min-h-0 flex-1` from the session panel, a `max-h-48` default for anyone else).

iOS Safari has no element fullscreen at all — the stage's own layout is everything a tab there ever gets, and Safari's own bars are removed only by installing the PWA to the Home Screen (`display: standalone`, `vite.config.ts`), which `IOSInstallHint.tsx` points at (dismissible, persisted, shown on the home page alone now — never on a trainer, since the whole point is not covering the board it is talking about). `viewport-fit=cover` (`index.html`) plus `env(safe-area-inset-*)` padding on the chrome row, the board-reservation strip beside it, and the hand strip below is what keeps the layout out from under Safari's bars and the home indicator — the chrome row's own padding side flips with it: `pt-*` in portrait, `pl-*`/`pt-*`/`pb-*` once `short:` moves it into the left gutter, since `env()` tracks whichever physical edge is currently "left" rather than a fixed side.

Two feedback densities, and which one you see is where the panel is: `notice` (full — `DiscardFeedback`/`FoldFeedback`, tile lists and ukeire counts included) is what the session panel holds, and `noticeCompact` (`features/table/Verdict.tsx` — one line, an icon, a colour and a short text, nothing else) floats over the board at every viewport, falling back to `notice` when a caller has nothing compact to say. The one thing that hides it is the panel in its **drawer** shape: that is over the top of the board, so a float under it is one nobody can see. A docked panel covers nothing and keeps it — the verdict repeating in two densities beside each other reads better than one only phones ever got. Severity is derived at display level from the existing grade/partial-credit, never a new grading concept: efficiency reads `TurnResult.grade` plus the shanten gap (`efficiencyVerdictSeverity`, `grade.ts` — green on `'ok'`, red only on an actual shanten regression, yellow for everything else `'error'`/`'warning'` catches); folding bands the same partial credit `useSessionStats` already averages into `averageQuality` (`foldingVerdictSeverity`, `useFoldingRound.ts` — green on `correct`, red below the halfway mark, yellow above it). The full breakdown stays one tap away in the log either way.

Tiles render as `<use>` references into a build-time SVG sprite (`src/assets/tiles/sprite.svg`, generated by `scripts/build-tile-sprite.mjs` from FluffyStuff assets, injected raw in `AppShell`). Tile size flows through the CSS var `--tile-w`; components scale locally by overriding it (e.g. `[--tile-w:calc(var(--tile-w-base)*0.8)]`). Tailwind 4; dark mode is a `dark` class on `<html>` toggled by `AppShell` from the persisted theme setting. `BoardStage` provides the chrome row, the settings dialog and the session panel — there is no separate page layout. Routing uses `basename: import.meta.env.BASE_URL` (GitHub Pages); pushes to `main` deploy via Actions, and the app is a PWA (`vite-plugin-pwa`, autoUpdate). Its icon is two hand-built SVGs (*not* produced by the sprite script), both transparent, no corner
radius of their own — iOS's squircle and Android's adaptive shape crop them, and a rounded source
leaves white corners behind. `public/favicon.svg` is the browser tab icon: its native `300x400`
tile shape, unstretched. `public/icon-square.svg` is the same tile art re-wrapped in a `400x400`
square (`translate(50 0)` over the same `<symbol>` defs, tile at full height) for every surface
that forces a square — `apple-touch-icon` (`index.html`) and the manifest's second `icons` entry
(`vite.config.ts`) — so a home-screen icon gets the square canvas it needs without stretching or
cropping the art. Deliberately `purpose: 'any'`, never `'maskable'`: a maskable safe-zone crop
(Android's adaptive circle) would clip the top and bottom off a tile that runs the square's full
height, so both icons render as plain squares/rects rather than opting into that crop.

Mobile-first is a project goal: touch targets are ≥44px (`min-h-11`), layouts must work at phone widths.

Scoring's answer form (`NumberField`, `ScoringPage.tsx`) puts each label *inside* its field as a hint that rides up to the top edge once the field has focus or a value (`peer-placeholder-shown`, no JS) rather than parking the word beside it. That is what buys the width for the whole form — han, fu, points and the submit button — to stand on one row from `sm:` up and on a phone held sideways (`short:`), stacking again only on a phone held upright.

Audience: technical depth for advanced players, defaults that a beginner can still use. Both, not one — keep adding the precise/advanced feature, but ship it behind a setting whose default reads plainly to someone who has never scored a hand (e.g. the fu/yaku breakdowns are opt-in, and yaku are named "Pure straight" rather than "Ittsuu" until the reader asks otherwise). A new option should never be something a beginner must find and change before the screen makes sense.

Two beginner-facing surfaces built on that principle:

- **Trainer info button**: each `BoardStage` (and each home-page card) takes an `intro: TrainerIntro` prop — a short explanation of what the drill teaches plus an optional riichi.wiki link — surfaced behind an `Info` icon button rather than permanent on-page text, so it costs nothing once a player already knows the trainer.
- **Glossary terms**: jargon the app uses without defining — `ukeire`, `tedashi`, `tsumogiri`, `shanten`, `genbutsu`, `suji`, `dora`, `ura dora` — is registered once in `features/i18n/glossary.ts` (label, description, hand-checked riichi.wiki URL; never derive the URL from the term id, a naming-convention guess drifts the moment the wiki's own slugs don't match) and marked inline with `<GlossaryTerm id="…">`. Basic terms a player is assumed to already know (riichi, ippatsu) are deliberately not in the glossary. When a term sits mid-sentence inside a translated string, wrap it with `<term>…</term>` in the locale JSON and render via `Trans` + `components={{ term: <GlossaryTerm id="…" /> }}` — this keeps word order correct per language and the term appearing exactly once; do not hand-split a translation string into prefix/suffix keys to fake the same effect. Pass `iconOnly` only when the surrounding label already spells the term out in plain text (e.g. a setting whose description already says the word) — otherwise the default trigger repeats the term's own name next to it, which reads as a duplicate. `GlossaryTerm` and the trainer info button both render through the shared `InfoPopover` (portalled, scrim-dismissed, Escape-closed, body-scroll-locked).
