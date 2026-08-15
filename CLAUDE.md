# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `Hand` (`hand.ts`) is a `Uint8Array(34)` of counts plus a fixed-meld count. It deliberately does **not** track red fives — `ParsedTile { id, red }` carries redness at parse/display level, and the efficiency hook tracks which red copies are held in a separate `reds` set alongside the `Hand`.
- `shanten.ts`: per-suit 5-block decomposition for standard shanten (see the match engine section — it is the app's hottest function); closed-form chiitoitsu and kokushi; `shanten()` takes the minimum (skipping chiitoi/kokushi when melds exist).
- `ukeire.ts` / `efficiency.ts` probe by add-tile/remove-tile around `shanten()`. `ukeire(hand, visible)` computes remaining copies against a caller-supplied 34-length visibility array. `evaluateDiscards` ranks every discard (shanten asc, then ukeire desc); ties must be compared with `isBestDiscard` (shanten + ukeire count), never by tile id.
- Determinism: `rng.ts` (`mulberry32` seeded by string hash) + Fisher-Yates `shuffle`; `wall.ts` builds the 136-tile wall. Same seed string ⇒ same wall, which is what makes situations shareable. `wall.ts#deal` (seeded 13-tile deal, returns just the `Hand`) serves the shanten trainer; every other trainer goes through `match.ts#createMatch`.

### The match engine (`core/match.ts` + `core/policy.ts`)

One deterministic hand of mahjong drives every trainer. `createMatch` deals (the pinned wall prefix goes in front _after_ the deal — it names what gets drawn next, not what lands in a starting hand), then `beginTurn` (draw) and `finishTurn` (discard, then everyone else's ron and calls) step it; `playMatch` loops both, and a `stop` predicate ends it early. That predicate is the only thing trainers differ by: `findMatch`/`findMatchAsync` replay `seed`, `seed#1`, `seed#2`… until an `accept` callback takes one, so scoring asks for "first win by any seat". (Folding needs a turn-boundary stop rather than an event one and drives `beginTurn`/`finishTurn` itself — see its section.)

Every seat is a **player**, and a player has an **algorithm**: `PlayerState.algorithm: SeatAlgorithm` (`'efficiency' | 'defense' | 'manual'`, `core/policy.ts`). `'manual'` is not "a human" — it is the algorithm "ask, don't decide". It is **live**: flip it mid-hand and the next turn obeys, no redeal, no new match, no re-search — changing a player's algorithm must never change the hand. `isManual(state, seat)` is the one predicate that reads it; the word "human" has left the codebase. `MatchOptions.algorithms?: readonly SeatAlgorithm[]` only *seeds* each player at `createMatch` — a seat with no entry starts on `'efficiency'` — the live value afterward lives on `PlayerState`, not on `MatchOptions`, and moves without touching options. A manual seat is one the engine draws for but never decides for: no auto-kita, no auto-riichi (riichi locks every later discard to tsumogiri, so it must stay the player's own choice), no auto-pon/chi (a call opens a hand its player never chose to open). More than one seat can be manual at once — a table setting (`features/settings/tableSettings.ts`'s `SeatConfig`), not a per-trainer concept; four manual seats is one person playing the whole table. `wins: false` lets opponents play without ending the drill.

`MatchOptions.claims?: boolean` (default **false**, so every existing graded drill's behaviour stays bit-for-bit unchanged) makes a manual seat get _asked_ about another seat's discard instead of being silently skipped. While an answer is pending, `MatchState.claim?: PendingClaim` is set and `beginTurn`/`finishTurn` are no-ops — one guard in the shared functions rather than one in every caller that steps a match. `claimOptions(state, options, seat, tile, from)` lists what a seat may call; `answerClaim(state, options, answer)` resolves it through an internal **restartable** `resolveReactions` that runs from the top on every answer, reading replies out of `claim.answers` and suspending again on the first seat that hasn't replied yet. Three phases, in this order, and the order is the point: ask every manual seat first, then resolve rons in seat order, then calls — that is what stops a pon answered early from outranking a ron the seat order says comes first. Everything it re-runs is idempotent (`tryWin`/`couldHaveWon` restore the hand they probe; `missedWin` only ever goes true). Daiminkan is deliberately not offered — the engine models no called kan at all, so offering it to one manual seat alone would be the one call no algorithm can answer. `canDeclareRiichi(state, options, seat)` gates a manual seat's own riichi declaration, read by `finishTurn`'s 4th argument (`declareRiichi`, manual seats only) and by `riichiTiles()` in the round hooks below. When a seat stops being manual while its own claim answer is still pending, `reconsiderClaim(state, options)` re-enters `resolveReactions` from scratch through the exact same restartable path — it never invents a pass on the reader's behalf, since a pass sets `missedWin` and would poison the hand with furiten over a decision nobody made.

Call and win permissions live entirely in `MatchOptions`, never in `Table` — the board is a pure
view (see the `Table.tsx` note in the UI section) and has no concept of what a seat is allowed to
do. Four flags, each shared by every seat rather than split by algorithm: `wins` gates `tryWin`
itself (`match.ts`'s sole win evaluator), so `wins: false` blocks ron **and** tsumo for every seat
and drops the ron entry from `claimOptions` outright — this is what `opponentWins: false` (folding)
and the hardcoded `wins: false` (efficiency, since ending a per-turn drill on someone else's tsumo
would cut it short) actually reach. `calls` and `claims` are two different gates on pon/chi: `calls`
lets an AI algorithm call at all, `claims` is whether a manual seat gets *asked* about one (§ above).
`riichi` gates `canDeclareRiichi` for AI and manual seats alike — there is no algorithm-only variant
today, so a trainer that wants no manual riichi (`useEfficiencySoloRound.ts`) turns it off for the
AI too, and the efficiency trainer does the same for a different reason: it reads no danger, so an
opponent's riichi there was decoration, not signal (`useEfficiencyRound.ts`). Layering is legality
(`MatchOptions`) → choice (the algorithm) → prompt (`claims`, manual seats only) — with `wins: false`
the engine never even asks an algorithm's `win`. Per-seat call permissions were considered and
rejected: an algorithm that "can't pon" expresses that in its own logic (`defense.call` always
returns `null`), not in a per-seat permission set `Table` would have to learn about. Daiminkan is
never offered to anyone (§ above); a manual seat's own tsumo is never an explicit choice —
`beginTurn` wins the instant the draw completes the hand. Whether these four need finer, per-algorithm
split control (a call permissions review, not a `Table` prop) is open and tracked outside this file.

`core/table.ts#actingSeat(core)` is "whose turn is this, right now": `core.seatIndex` in the ordinary single-manual-seat setup, some other manual seat once several are manual, and `claim.seat` while a claim is suspended — every shared primitive (`seenBy`, `analysisOf`, `snapshotTable`) reads through it rather than `core.seatIndex` directly. `goRound(core)` plays every AI-decided seat and stops at the next manual turn, a pending claim, or the hand's end; it is a no-op when it's already a manual seat's turn. `core.seatIndex` is the seat the engine grades — decided at generation time and never moved by a later algorithm flip (flipping your own graded seat to an algorithm simply freezes grading where it stood, since only a manual seat's turn ever reaches the interactive `discard()` path) — and it is not the same thing as which seat `Table` draws at the bottom, a page-local viewing perspective the engine never sees at all (see the `SeatConfig` note in the trainer-pattern section).

`policy.ts` holds the pure, deterministic maths the two AI algorithms are written in terms of — `chooseDiscard`, `chooseFold`, `chooseCall`, `hasYakuRoute`, `waits`, `isFuriten` — every ranking with an explicit tie-break, never sort stability. Calls happen only when they lower shanten **and** `hasYakuRoute` still holds; without that guard a shanten-chaser opens itself into hands that cannot legally win. Furiten is `waits()` (which is `improvingTiles` at tenpai) checked against your own river. `core/algorithm.ts` is where those functions become decisions — see the decision-seam paragraph below.

`PlayerState.algorithm` is checked per seat rather than baked into `MatchOptions` because the folding trainer flips individual opponents mid-hand once its riichi target is reached, so it has to be a live field, not a match-wide setting. `'defense'` routes the discard decision through `chooseFold` (full betaori: `assessDiscards(...)[0].tile`, `policy.ts`) instead of `chooseDiscard`, and is also checked at the riichi gate, the call gate, and `tryWin` — a folding seat never declares, never calls, and never wins either; it is trying to leave the hand, not win it. A seat already in riichi is unaffected either way (`forcedTsumogiri` overrides both).

Win legality is free from existing code: `decompose()` non-empty is the shape, `scoreHand()` returning null is "no yaku". Guard both behind a single `shanten()` call — that gate fails for almost every seat on almost every discard and everything past it is far more expensive.

**Performance**: `standardShanten` decomposes each suit separately and merges (`groupTable`/`merge`), ~475x faster than searching all 34 kinds at once, because a draw probe only perturbs one suit and the other three come out of the cache. `referenceStandardShanten` is the old whole-hand search, kept solely as the specification the fast one is proved against over thousands of random hands in `shanten.test.ts` — change one, re-run that. Simulated players use `bestDiscards` (shanten only) and price ukeire just for the tiles already tied. A match is ~17ms; the census test in `match.test.ts` (every tile kind accounted for exactly four times) is what catches bookkeeping slips.

Furiten invariant: ron legality lives in `tryWin` alone (own-river or `missedWin`), and `claimOptions` only ever offers `'ron'` when `tryWin` returns a record — so there is exactly one place that can offer a furiten seat a ron, and it never does. Covered by a regression test in `match.test.ts` rather than left to `seatRead`'s badge (`core/table.ts`) to imply correctness on its own.

### The decision seam (`core/algorithm.ts`)

Five decision points — discard, pon/chi, riichi declaration, take-a-win, kita — used to be five scattered conditionals inside `match.ts`, each hand-rolling its own `algorithm === 'defense'` check. They are now one dispatch table: `ALGORITHMS: Record<AIAlgorithm, Algorithm>` (`AIAlgorithm` is `SeatAlgorithm` minus `'manual'`, which is never a key here — `match.ts` short-circuits on `isManual` before ever reaching `ALGORITHMS`). `Algorithm` is five methods — `discard`, `call`, `riichi`, `win`, `kita` — and `match.ts`'s five call sites collapse to `ALGORITHMS[player.algorithm].<method>(view, …)`. Adding a third algorithm is one ~10-line object literal plus its own `AIAlgorithm` member; nothing in `match.ts` changes. No base class, no `Partial` merge — `efficiency` and `defense` are independent object literals.

What an algorithm is allowed to know is a curated `SeatView` (`core/algorithm.ts#seatView`), never raw `MatchState` — a live view would let an algorithm read concealed hands. Public information only (every seat's river, melds, riichi, nuki) plus its own hand and the board; `seen` and `threats` are lazy getters, the same trick `TableAnalysis` uses, since the call gate builds a `SeatView` for every seat on every discard and both cost real work (`seenBy`, `threatViews`) an algorithm that never reads them shouldn't pay for. `win(view, candidate)` is the one method with a second argument: `WinCandidate { tile, from?, score }`, already priced by `tryWin` before it asks — an algorithm that can't see what it declines can't price it, which is what makes `defense.win` an honest `() => false` rather than a blanket carve-out in `tryWin` itself. Purity is unchanged from `policy.ts`: same view ⇒ same choice, every ranking a total order, which is what lets a whole match reproduce from its seed.

Two behaviour changes rode in with the seam, not before: `defense.kita` is `false` (a folding player is leaving the hand, not chasing dora — every AI seat used to pull regardless), and declining a win is now expressible per algorithm (`win` receives the priced candidate) rather than a single hardcoded "defense never wins" in `tryWin`.

### The danger model (`core/danger.ts`) + the folding trainer

`assessDiscards(hand, threats, visible, sanma)` ranks every tile in hand by how dangerous it is
against the seats in riichi. **Ordinal, never probabilistic** — published betaori tables exist, but a
number typed in from memory becomes a number the user learns, so tiles land in tiers and grading is
tier ordering. If real deal-in rates are ever wanted, measure them by simulation over the reachable
hand space; do not type them in. Judged on **public information only**: what the threat actually
holds is never consulted, which is what makes a correct-but-unlucky choice still correct.

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
`MatchState.discards` (`match.ts`), not `player.river` — `finishTurn` pops a claimed discard out of
the river, and it is still a tile that seat threw, so `discards` is pushed alongside the river and
never popped. `threatViews(state)` builds the `ThreatView[]` from it and is exported from
`match.ts` itself, since `chooseFold` (the AI's own defensive discard, `policy.ts`) needs the exact
same view the folding trainer grades against.

`useFoldingRound.ts` drives `beginTurn`/`finishTurn` directly rather than going through
`findMatch`: `playMatch`'s `stop` fires per event _after_ the whole turn has run, so stopping on the
riichi event would leave `match.discards` missing that turn's own discard and call while the rest of
the state already reflects them. The moment its riichi target is reached, every seat that has not
itself declared and is not itself manual has its `algorithm` switched to `'defense'` — otherwise
the opponents keep pushing for the rest of the hand, declaring further riichi and flooding the table
with genbutsu the drill never earned. Generation searches `seed`, `seed#1`… for a hand that is worth
drilling (not ended, the seat due to act is not itself in riichi, at least 1-shanten, enough wall
left, and the ranking holds both a genbutsu and something bare), and **falls back to fewer threats**
rather than failing, since three simultaneous riichi is too rare for any sane attempt budget. The
board is then handed over a seeded 0…`players-2` turns later, so you are not the declarer's shimocha
every single hand — the algorithm flip happens first, so those extra turns cannot add a threat the link
never promised. The attempt seed alone reproduces the board, round wind and seat included — both are
seeded off that same attempt seed, which is what makes the share link exact; everything else a seed
needs to deal the same board (`sanma`, `threats`, `wins`) travels with it as `BoardOptions`, and the
discards played since the handover ride along as `discards` so a mid-hand turn is shareable and
every log row rewindable. Generation's search key is only what shapes the hand — seed, `threats`,
`sanma`, `wins` — never the per-seat algorithms: those are live, board state rather than search
input (see the trainer-pattern section), so flipping one after generation applies to the hand
already found rather than triggering a new search.

Any seat can be manual, same as efficiency/lab — not only the drill's own generated seat
(`RoundCore.seatIndex`, the seat `worthwhile`/`handedOverAt`/`endOf` still anchor to). The seat
panel's raw config (`SeatConfig.modes`, never the resolved one) seeds `MatchOptions.algorithms` at
generation time in `playToRiichi`: every seat marked `'manual'` joins `seatIndex` as manual, and an
explicit per-seat choice there outranks the drill's own blanket "everyone who missed the riichi
target folds" flip. Past generation, a live algorithm flip (`useTableRound.ts`'s sync effect,
mirrored in `useFoldingRound.ts`) writes straight onto the running `PlayerState.algorithm` and, if a
claim was pending on the seat that just stopped being manual, re-resolves it through
`reconsiderClaim` — no redeal, no re-search, per D6. `advanceAfterDiscard`'s tail (`settleAfterClaim`, shared with `answer`) must not
`beginTurn` into a turn `match.claim` has suspended — folding drives `beginTurn`/`finishTurn`
directly rather than through `useTableRound`, so it re-derives that one guard rather than getting it
for free. Perspective (which seat `Table` draws at the bottom) never reaches this hook at all — it
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
(`snapshotTable`, and folding's own `snapshot`) rather than per render — and always for a seat the
reader plays regardless of the setting (their own furiten is legitimate information a real client
shows, and one more `waits` call is negligible next to the per-turn analysis that seat already
pays for), gated on `showSeatWaits` for every other seat. The algorithm badge (`SeatStrip`) has no
such setting at all — every seat's mode is shown always, colour-coded (efficiency green, defense
blue, manual yellow), since reading who is running what is basic table awareness the same way
`showOpponentHands` is, not a jargon-gated extra. The per-discard feedback (`FoldFeedback.tsx`) names only
the tier (with a glossary popover on genbutsu/suji) — it does not spell out why in a sentence of its
own, trusting the glossary entry to carry that instead. Per §8 decisions: fold-only (no push
control — grading push/fold needs an EV model this codebase does not have), no danger markers before
the answer, threats configurable up to `players - 1`.

### Tenhou notation + situation URLs (the shared DSL)

Tenhou strings (`123m406p11z`, `0` = red five) are the interchange format everywhere: URL params, log copy buttons, tests. `serializeTenhou` sorts (hands); `serializeTenhouOrdered` preserves order (walls/rivers, where draw/discard order matters).

`urlCodec.ts` round-trips a `Situation` (seed, hand, wall prefix, river, round/seat, and optional `opponents`/`deadWall`/`aka` rule overrides) through query params. Every trainer page decodes it from `useSearchParams`, so a URL fully reproduces a drill. Semantics that matter: the wall prefix is consumed by _whoever_ draws next (opponents included); `river` is the user's own past discards, **replayed** from the deal to fast-forward to a mid-round decision point — its tiles are not extra copies, so `allTiles` (the pool-exclusion + validation source) covers only hand + wall. The rule-override flags exist so a shared link pins round behavior regardless of the receiver's settings; `situationQuery()` in the hook produces such a dump (same seed unsuffixed on first load — that's why `startRound` only appends `:restartCount` after a restart).

### Trainer pattern (`src/features/*`)

Each trainer is a page component plus a `use*Round` hook (`useEfficiencyRound`, `useShantenRound`, `useScoringRound`, `useFoldingRound`). The hooks keep mutable round state in a `useRef` and mirror render-ready snapshots into `useState`; an unspecified seed stays random per mount, and restart/next-hand appends a counter suffix. The graded trainers (shanten, scoring, folding) get their session score, per-decision clock and random seed from `lib/useSessionStats.ts` — it also owns "clearing the log resets the session".

The shanten trainer is a continuous stream, not one graded hand at a time: `submit()` grades, then bumps `handIndex` while carrying `running` forward, so the next hand is dealt already revealed with the previous hand's feedback kept in `lastResult` (which holds its own tiles, since the on-screen hand has moved on). The stream starts revealed and on the clock (every other trainer puts a board up on load, so a first hand hidden behind a button reads as "not loaded yet" rather than as a gate). There is no next-hand button; the reveal/stop control is the only gate, and stop abandons the hand (fresh deal, timer back to zero) rather than pausing — a peeked hand can't be timed again. A link's pinned `hand` is honoured only at `handIndex === 0`, so a shared hand (or a rewind out of the log, which resets the index) is posed once and the stream carries on instead of serving it forever. Clearing the log clears the session it recorded: score and average reset with it.

The efficiency round lives in plain functions in `useEfficiencyRound.ts` so interactive play and URL-river replay share one code path: `createRound` (a real `createMatch` deal, seats before yours acting first, then the situation's river replayed) and `advanceAfterDiscard` (your discard → `runOpponents` plays every seat back round to you → your next draw; it stops right after the discard when the hand hits tenpai, leaving 13 tiles so the round reads as finished). Every seat gets a real hand whether or not opponents are on — with them off they simply never act, so the wall is 69 tiles, not 108. Opponents run with `wins: false`. `match.visible` accumulates every face-up tile and feeds ukeire remaining counts. Player count is derived per round (`options.sanma ? 3 : 4`) — never hardcode 4/3. "finished" is derived (hand below 14 tiles), not stored.

Sanma (`options.sanma`, mirrored by the global `sanma` setting and the `sanma` situation flag) drops 2m-8m from the tile set everywhere it's produced — `buildWall`/`deal` (`core/wall.ts`) skip those ids via `inTileSet` (`core/tiles.ts`), and `improvingTiles`/`ukeire`/`evaluateDiscards` (`core/ukeire.ts`, `core/efficiency.ts`) take a `sanma` flag so they never propose drawing a tile that isn't in the wall. `NUM_TILE_TYPES` stays 34 and the id layout is untouched — sanma is expressed purely as "these ids have zero copies," not a smaller id space. Kita (nukidora, `useEfficiencyRound.ts#kita`) is graded, not free: it reuses north's own `evaluateDiscards` entry (id `NORTH` = `HONOR + 3`) as "what pulling it costs," compared against the same round's `ranked[0]` with `isBestDiscard` — the exact function `discard()` uses. No special tie-break is needed: `ranked[0]` is already the global optimum, so north's entry only ties it when pulling really is as good as the best discard, and a north held as a pair's head shows up as worse shanten/ukeire in that same entry, correctly discouraging the pull. `TurnResult.kind` (`'discard' | 'kita'`) exists only so `DiscardFeedback` can label the row "Kita" instead of "Your discard"/"Best discard" — it carries no grading logic of its own.

State stores are zustand: `settingsStore.ts` (persisted; has a custom section-wise `merge` so adding fields to `efficiency`/`shanten` survives old persisted schemas — extend that merge when adding a new section) and `store/log.ts` (session-only action log; entries can carry inline tiles and a `copyText` for a tenhou copy button). Log entries are written imperatively from user-triggered actions (inside `discard()` / `submit()`), never from `useEffect`s watching round state — effect-based logging inverts entry order and duplicates under StrictMode. The one exception is the round-build effect itself (`logReplay` in both `useEfficiencyRound.ts` and `useFoldingRound.ts`, which puts a shared link's replayed discards on the log under the shared `log.replay` key): it deduplicates on the decoded situation/link object's identity, since that effect runs twice per mount and four times under StrictMode for one and the same round — which is also why those objects come from `useUrlData` (memoised per navigation) rather than being rebuilt per render, the same identity the trainers' "reset `handIndex` while rendering" pattern keys on. That row is also why `TrainerLayout` clears the log during its first render rather than from a mount effect — effects run children-first, so a page that logs as its round mounts would have those rows wiped by its own layout a moment later.

Per-seat table configuration (`features/settings/tableSettings.ts`) is one schema every
board-rendering trainer shares: `SeatConfig { modes: SeatAlgorithm[] }`, plus `TableSettings.claims`
alongside it (see below). **`Table` itself has no concept of a "player"** — every seat, including
the one a trainer generated for the reader, is just a seat with an algorithm, and the only thing
that makes a seat the one you play is `'manual'`. "Your seat" is a trainer-level idea (the
generated seat `resolveSeatConfig` anchors its manual-seat guarantee to), not something `Table` or
its `SeatView` reads or needs to know. The one standing restriction on that uniformity is the
guarantee itself: at least one seat must stay manual, because with none nothing would stop
`goRound` — so an advanced reader cannot yet put every seat, including their own, on an algorithm
and simply watch a hand play itself out. Lifting that is real work (an autoplay or step-by-step
path through every round hook), not a seat-panel tweak, and belongs with the call-permissions
review above rather than being done piecemeal here (D12).

**Seat algorithms are board state, not a preference, and are deliberately not persisted** (D15): a
board opened three days later coming up with opponents nobody remembers choosing is the same bug as
a stale perspective. `SeatConfig` lives as page state with the same lifetime as `viewSeat` — a
`useState` seeded from the link, reset on every new hand — in `EfficiencyPage`, `FoldingPage` and
`LabPage` alike; the settings store no longer holds a `modes` field at all. The one part of the old
seat panel that *is* a reader preference and stays persisted is `TableSettings.claims` — it answers
a question about the reader ("do I want to be offered pon/chi/ron"), not about the board (D14).

Perspective (which seat `Table` draws at the bottom) is deliberately not part of this schema at
all — it is its own ephemeral page state (each page's own `viewSeat` `useState`, defaulting to
`round.seatIndex` and reset on every new hand), never persisted, and view-only in every trainer
including efficiency and the lab: "watch from here" stops meaning "play here", which comes only
from a seat's `modes` entry being `'manual'`. The page's own `hand` slot (under the board, not on
the felt) follows perspective too, not the seat actually acting: rotating to another seat shows
*that* seat's hand there — face-down unless it is itself manual or hands are revealed, its 14th
tile split out separately the same way an opponent's is on the felt (`splitDrawn`/
`splitConcealedDrawn`, `core/table.ts` / `useFoldingRound.ts`) — and it is click-through only when
perspective and the seat actually mid-turn are the same seat. Anywhere else it is a genuine
spectate: `ManualControls` grows a "Watching {wind} / Back to your seat" line so a claim or a
riichi decision can never silently stall behind a view the reader can't act from. `SeatButton`'s
dialog reflects the same idea from the settings side — the seat you're already looking at gets no
"watch from here" row at all (dropped rather than left as an empty "your side" label), since there
is nothing left for that dialog to offer about perspective once you're already there.
`resolveSeatConfig(config, players, defaultSeat,
fallbackModes?)` fills every seat and guarantees at least one manual seat, anchored on `defaultSeat`
(a link's `?seat=`, or the seat the trainer generated) rather than on perspective — with none,
nothing would ever stop `goRound`; `fallbackModes` overrides the generic `'efficiency'` default for
an unconfigured seat with what the board is _actually_ doing right now (folding's own live
`algorithms`, read straight off `PlayerState.algorithm` for every seat, since it flips non-declarers
to `'defense'` at handover and the panel must not show an algorithm the board isn't really running).
Each page builds `MatchOptions.algorithms` straight off `resolveSeatConfig(...).modes` at round-build
time. The graded `seatIndex` itself is decided by the trainer (the link's `?seat=`, or the seat the
drill generated) and never by the seat panel — flipping that seat's own algorithm away from
`'manual'` cannot move which seat is graded, it only freezes grading in place (D13), so a second
manual seat never silently moves which seat a graded trainer scores. Every patch a caller sends `onChange` is built off the _raw_ `SeatConfig`,
never the resolved one (`withSeatMode` copies just the array a click actually touches) — writing the
resolved fallback modes back on every edit is what used to make an unrelated change (like moving
perspective) look like a real `modes` edit and re-search folding for a new hand. `useTableSettings(app)`
adds `seatsEnabled` (`advanced || app === 'lab'`), which each page uses only to decide whether to
render the `SeatButton` panel at all — the underlying `seatConfig` state is page-local and starts at
`null` regardless, so there is nothing persisted for a hidden panel to leave running underneath.

`SeatButton` (`features/settings/SeatPanel.tsx`) is the dialog; `SeatStrip`
(`features/table/SeatStrip.tsx`) is the thin wrapper that places its trigger on the felt itself,
fed to `Table`'s `seatInfo?: (seat: number) => ReactNode` prop. It draws one ring outboard of that
seat's own hand — radially, `centre │ river │ hand │ strip` — on every seat including the bottom
one, whose felt hand is omitted but whose strip still lands where that hand would have sat (the two
share one flex-col per seat; with no hand to show, the strip is simply the only child). That ring is
`absolute inset-0` on the *outer* square (the `relative` box the felt's own padding lives inside),
not a translate off the felt itself — `display: contents` on the per-seat grid wrapper doesn't
generate a box, so the absolutely positioned ring still resolves against that outer square
regardless of its own grid-item ancestry, and `items-end` lands it flush against the square's true
edge. It grows into the padding band it was given (`SEAT_RING_FRACTION`, one constant driving both
that padding and the `--table-cap` divisor that keeps the felt from shrinking when the band is
spent) rather than past the board's own boundary — the earlier translate-based version pushed a
fixed distance off the felt regardless of how tall the strip actually was, which is what let a
two-line strip (wait tiles wrapping under the algorithm badge) run the side seats off a phone
screen entirely. This is not a return to where the buttons sat before the control row either: they
lived on the centre panel beside each wind mark first, and four 44px targets on a panel barely wider
than that buried the round wind, the wall count and the dora row under them — the strip is neither
the centre panel nor the control row, it is the seat's own edge outside the felt, where there is
empty board margin and nothing to bury. `Table` computes `seatInfoNodes` once per seat (rather than
calling `seatInfo` again per render) so the felt's outboard padding can be sized off whether a strip
is *actually* showing on this board, not off whether the prop was merely passed — a caller may offer
`seatInfo` unconditionally and return nothing per seat while `seatsEnabled` is false. Each opens a
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

`components/tiles/Table.tsx` is the shared board (efficiency with opponents on, scoring by default, folding always — reading the table _is_ the folding drill): a 3x3 grid measured in tile widths (4fr/6fr/4fr = 14 across), seats placed by `(seat - seatIndex + players) % players` and rotated `-90deg` per step so `seatIndex`'s seat is always at the bottom, melds/nuki in the corner cells. `seatIndex` is purely which seat the board is drawn from — a viewing perspective, not "the user's seat"; `SeatView` has no player field either, only `hand`/`drawn`/`concealed`, so a seat someone plays and a seat nobody does are drawn through the exact same props. There is no on-board "(you)" label, only the bottom-seat rotation itself and (where a caller passes it) that seat's own styling. `SeatView.drawn` (optional, alongside `hand`) draws that seat's 14th tile with a small gap after the rest — the same tedashi/tsumogiri read a real felt gives, honouring `concealed` exactly like `hand` does. It sizes itself off container query units (`--tile-w: calc(100cqw/14)`), so the whole board scales from the one width on its outer div — put width there, never on the square, or a `w-full` child collapses when the board is a flex item. Tracks must stay `minmax(0,…)`: a seat block is measured before it rotates. Rivers carry `RiverTile` flags (`tsumogiri`, `riichi`) rather than parallel arrays; absence of `tsumogiri` means tedashi. The `short:` variant (`index.css`, max-height 520px — a phone held sideways) keys `--tile-w-raw` off `vh` instead of `vw`, since a square board is only ever limited by height; the hand stays _under_ the board at every size (a real client and a real table both put your tiles along your own edge of the felt), and the width left over becomes the gutters the fullscreen chrome and notices sit in. `controls?: ReactNode` (the fullscreen toggle) is the only thing left in the control row above the board now — each seat's own info strip moved onto the felt itself (`seatInfo`, see the trainer-pattern section) — and it lives _inside_ the width-capped outer box — it is the only element that knows the board's actual width, and a wrapper around it collapses the square. `--board-max-h` (default `calc(100svh-8rem)`) and `--board-controls` (the control row's share of that budget) let a caller resize the square's height budget without touching the component.

`components/tiles/BoardStage.tsx` is the shared layout around `Table` in its two shapes — inline (`board`, `hand`, `notice`, `end`, `children` stacked, at every viewport size) and fullscreen: a fixed overlay sized by `--board-max-h`/`--table-max`, the notice floating `pointer-events-none` over the board (in the right-hand gutter instead once the viewport is `short:`, sized off `--board-max-h` so it cannot reach the square — feedback that covers the tiles it is talking about is feedback you have to wait out), `end` as a centred modal, and a log drawer whose open state is reported through `onLogOpen` so a graded trainer can pause its clock. `board` is optional — the boardless trainers (shanten, solo efficiency) never pass one, and scoring passes one only while its own `settings.table` is on, falling into the exact same boardless shape the moment it's off; either way that content goes through the ordinary `hand`/`notice`/`children` slots, and the fullscreen toggle that would otherwise ride in through `board`'s own `controls` argument gets its own small row above `hand` instead. Fullscreen auto-enters on phone-sized viewports (`matchMedia('(max-width: 640px)')`) behind `mobileFullscreen`, a persisted setting that defaults on — every trainer, boardless included, comes up already filling the screen on a phone; the explicit toggle button still reaches it on any other viewport. Exiting it on a phone writes the setting false rather than just closing for that visit (the persisted opt-out), read back off the settings row. `requestFullscreen` only ever fires inside a real user gesture — a load-time call is rejected outright — so an auto-entered stage defers it to the reader's first `pointerdown` rather than trying at mount; the flag tracking "no gesture yet" is only cleared from inside that listener, never eagerly in the effect body, because StrictMode replays the effect (mount, cleanup, mount again) with no real gesture in between and an eager clear would have the synthetic second mount fire the real call anyway. Fullscreen is meant to be somewhere you stay, not somewhere you visit: back-to-home, the log drawer and the exit toggle are `BoardStage`'s own, an `intro?: TrainerIntro` prop renders `InfoButton` (`TrainerLayout.tsx`) in the chrome row since fullscreen hides `TrainerLayout`'s own header info button along with the rest of it, and each page passes its settings dialog plus `TrainerToggles` (`TrainerControls.tsx`, the status bar's own start/pause and reset extracted so both surfaces draw the same pair) through the `chrome` prop. Held sideways that whole row stands in the left gutter instead — as does `Table`'s own control row (`short:` zeroes `--board-controls`), so the square's height budget is the viewport minus the hand alone. The fixed overlay is what actually lays the board out either way; the real Fullscreen API only ever drops the browser chrome on top of it. `TrainerLayout`'s log `<ol>` is exported as `LogList` so the fullscreen drawer and the inline panel share one renderer. iOS Safari has no element fullscreen at all — the fixed overlay is everything a tab there ever gets, and Safari's own bars are removed only by installing the PWA to the Home Screen (`display: standalone`, `vite.config.ts`), which `IOSInstallHint.tsx` points at (dismissible, persisted, shown on `TrainerLayout` and the home page — never inside the fullscreen overlay itself, since the whole point is not covering the board it is talking about). `viewport-fit=cover` (`index.html`) plus `env(safe-area-inset-*)` padding on the fullscreen chrome row, the board-reservation strip beside it, and the hand strip below is what keeps the layout out from under Safari's bars and the home indicator — the chrome row's own padding side flips with it: `pt-*` in portrait, `pl-*`/`pt-*`/`pb-*` once `short:` moves it into the left gutter, since `env()` tracks whichever physical edge is currently "left" rather than a fixed side.

Two feedback densities share those same two shapes: `notice` (full — `DiscardFeedback`/`FoldFeedback`, tile lists and ukeire counts included) is what the inline layout keeps, and `noticeCompact` (`features/table/Verdict.tsx` — one line, an icon, a colour and a short text, nothing else) is what actually floats over the board in fullscreen instead, falling back to `notice` when a caller has nothing compact to say. Combined with `mobileFullscreen` this lands compact on phones and full on desktop with no JS media query of its own. Severity is derived at display level from the existing grade/partial-credit, never a new grading concept: efficiency reads `TurnResult.grade` plus the shanten gap (`efficiencyVerdictSeverity`, `grade.ts` — green on `'ok'`, red only on an actual shanten regression, yellow for everything else `'error'`/`'warning'` catches); folding bands the same partial credit `useSessionStats` already averages into `averageQuality` (`foldingVerdictSeverity`, `useFoldingRound.ts` — green on `correct`, red below the halfway mark, yellow above it). The full breakdown stays one tap away in the log either way.

Tiles render as `<use>` references into a build-time SVG sprite (`src/assets/tiles/sprite.svg`, generated by `scripts/build-tile-sprite.mjs` from FluffyStuff assets, injected raw in `AppShell`). Tile size flows through the CSS var `--tile-w`; components scale locally by overriding it (e.g. `[--tile-w:calc(var(--tile-w-base)*0.8)]`). Tailwind 4; dark mode is a `dark` class on `<html>` toggled by `AppShell` from the persisted theme setting. `TrainerLayout` provides the shared header, settings dialog, and log panel. Routing uses `basename: import.meta.env.BASE_URL` (GitHub Pages); pushes to `main` deploy via Actions, and the app is a PWA (`vite-plugin-pwa`, autoUpdate).

Mobile-first is a project goal: touch targets are ≥44px (`min-h-11`), layouts must work at phone widths.

Audience: technical depth for advanced players, defaults that a beginner can still use. Both, not one — keep adding the precise/advanced feature, but ship it behind a setting whose default reads plainly to someone who has never scored a hand (e.g. the fu/yaku breakdowns are opt-in, and yaku are named "Pure straight" rather than "Ittsuu" until the reader asks otherwise). A new option should never be something a beginner must find and change before the screen makes sense.

Two beginner-facing surfaces built on that principle:

- **Trainer info button**: each `TrainerLayout` (and each home-page card) takes an `intro: TrainerIntro` prop — a short explanation of what the drill teaches plus an optional riichi.wiki link — surfaced behind an `Info` icon button rather than permanent on-page text, so it costs nothing once a player already knows the trainer.
- **Glossary terms**: jargon the app uses without defining — `ukeire`, `tedashi`, `tsumogiri`, `shanten`, `genbutsu`, `suji`, `dora`, `ura dora` — is registered once in `features/i18n/glossary.ts` (label, description, hand-checked riichi.wiki URL; never derive the URL from the term id, a naming-convention guess drifts the moment the wiki's own slugs don't match) and marked inline with `<GlossaryTerm id="…">`. Basic terms a player is assumed to already know (riichi, ippatsu) are deliberately not in the glossary. When a term sits mid-sentence inside a translated string, wrap it with `<term>…</term>` in the locale JSON and render via `Trans` + `components={{ term: <GlossaryTerm id="…" /> }}` — this keeps word order correct per language and the term appearing exactly once; do not hand-split a translation string into prefix/suffix keys to fake the same effect. Pass `iconOnly` only when the surrounding label already spells the term out in plain text (e.g. a setting whose description already says the word) — otherwise the default trigger repeats the term's own name next to it, which reads as a duplicate. `GlossaryTerm` and the trainer info button both render through the shared `InfoPopover` (portalled, scrim-dismissed, Escape-closed, body-scroll-locked).
