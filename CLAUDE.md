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

One deterministic hand of mahjong drives every trainer. `createMatch` deals (the pinned wall prefix goes in front _after_ the deal — it names what gets drawn next, not what lands in a starting hand), then `beginTurn` (draw) and `finishTurn` (discard, then everyone else's ron and calls) step it; `playMatch` loops both, and a `stop` predicate ends it early. That predicate is the only thing trainers differ by: `findMatch`/`findMatchAsync` replay `seed`, `seed#1`, `seed#2`… until an `accept` callback takes one, so scoring asks for "first win by any seat". (Folding needs a turn-boundary stop rather than an event one and drives `beginTurn`/`finishTurn` itself — see its section.) `MatchOptions.humans?: readonly number[]` names the seats the engine draws for but never decides for — no auto-kita, no auto-riichi (riichi locks every later discard to tsumogiri, so it must stay the player's choice), and no auto-pon/chi (a call opens a hand its player never chose to open) — checked everywhere through the exported predicate `isHuman(options, seat)`, never by comparing `seat` to a single index. `wins: false` lets opponents play without ending the drill.

More than one seat can be human at once — a table setting (`features/settings/tableSettings.ts`'s `SeatConfig`), not a per-trainer concept. `MatchOptions.policies?: readonly SeatPolicy[]` seeds each `PlayerState.policy`; `MatchOptions.claims?: boolean` (default **false**, so every existing graded drill's behaviour stays bit-for-bit unchanged) makes a human seat get _asked_ about another seat's discard instead of being silently skipped. While an answer is pending, `MatchState.claim?: PendingClaim` is set and `beginTurn`/`finishTurn` are no-ops — one guard in the shared functions rather than one in every caller that steps a match. `claimOptions(state, options, seat, tile, from)` lists what a seat may call; `answerClaim(state, options, answer)` resolves it through an internal **restartable** `resolveReactions` that runs from the top on every answer, reading replies out of `claim.answers` and suspending again on the first seat that hasn't replied yet. Three phases, in this order, and the order is the point: ask every human first, then resolve rons in seat order, then calls — that is what stops a pon answered early from outranking a ron the seat order says comes first. Everything it re-runs is idempotent (`tryWin`/`couldHaveWon` restore the hand they probe; `missedWin` only ever goes true). Daiminkan is deliberately not offered — the engine models no called kan at all, so offering it to one human alone would be the one call the AI seats can't answer. `canDeclareRiichi(state, options, seat)` gates a human's own riichi declaration, read by `finishTurn`'s 4th argument (`declareRiichi`, human seats only) and by `riichiTiles()` in the round hooks below.

`core/table.ts#actingSeat(core)` is "whose turn is this, right now": `core.seatIndex` in the ordinary single-manual-seat setup, some other manual seat once several are human, and `claim.seat` while a claim is suspended — every shared primitive (`seenBy`, `analysisOf`, `snapshotTable`) reads through it rather than `core.seatIndex` directly. `goRound(core)` plays every AI-decided seat and stops at the next human turn, a pending claim, or the hand's end; it is a no-op when it's already a human's turn. `core.seatIndex` itself stays purely "which seat the board is drawn from" — see the `SeatConfig`/orientation note in the trainer-pattern section.

`policy.ts` is the AI, pure and total — deterministic means every ranking needs an explicit tie-break, never sort stability. Calls happen only when they lower shanten **and** `hasYakuRoute` still holds; without that guard a shanten-chaser opens itself into hands that cannot legally win. Furiten is `waits()` (which is `improvingTiles` at tenpai) checked against your own river.

Each `PlayerState` carries a `policy: SeatPolicy` (`'efficiency' | 'defense'`), checked per seat and per discard rather than baked into `MatchOptions` — the folding trainer flips individual opponents mid-hand once its riichi target is reached, so it has to be a live field, not a match-wide setting. `'defense'` routes `finishTurn`'s discard through `chooseFold` (full betaori: `assessDiscards(...)[0].tile`, `policy.ts`) instead of `chooseDiscard`, and is also checked at the riichi gate, the call gate, and `tryWin` — a folding seat never declares, never calls, and never wins either; it is trying to leave the hand, not win it. `tryWin`'s gate excludes every seat `isHuman(options, seat)` names: a stray leftover `'defense'` from the folding handoff must never block a human seat's own win. A seat already in riichi is unaffected either way (`forcedTsumogiri` overrides both).

Win legality is free from existing code: `decompose()` non-empty is the shape, `scoreHand()` returning null is "no yaku". Guard both behind a single `shanten()` call — that gate fails for almost every seat on almost every discard and everything past it is far more expensive.

**Performance**: `standardShanten` decomposes each suit separately and merges (`groupTable`/`merge`), ~475x faster than searching all 34 kinds at once, because a draw probe only perturbs one suit and the other three come out of the cache. `referenceStandardShanten` is the old whole-hand search, kept solely as the specification the fast one is proved against over thousands of random hands in `shanten.test.ts` — change one, re-run that. Simulated players use `bestDiscards` (shanten only) and price ukeire just for the tiles already tied. A match is ~17ms; the census test in `match.test.ts` (every tile kind accounted for exactly four times) is what catches bookkeeping slips.

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
itself declared is switched to `policy: 'defense'` (`match.ts`'s `PlayerState.policy`) — otherwise
the opponents keep pushing for the rest of the hand, declaring further riichi and flooding the table
with genbutsu the drill never earned. Generation searches `seed`, `seed#1`… for a hand that is worth
drilling (not ended, the seat due to act is not itself in riichi, at least 1-shanten, enough wall
left, and the ranking holds both a genbutsu and something bare), and **falls back to fewer threats**
rather than failing, since three simultaneous riichi is too rare for any sane attempt budget. The
board is then handed over a seeded 0…`players-2` turns later, so you are not the declarer's shimocha
every single hand — the policy flip happens first, so those extra turns cannot add a threat the link
never promised. The attempt seed alone reproduces the board, round wind and seat included — both are
seeded off that same attempt seed, which is what makes the share link exact; everything else a seed
needs to deal the same board (`sanma`, `threats`, `wins`) travels with it as `BoardOptions`, and the
discards played since the handover ride along as `discards` so a mid-hand turn is shareable and
every log row rewindable.

Any seat can be manual, same as efficiency/lab — not only the drill's own generated seat
(`RoundCore.seatIndex`, the seat `worthwhile`/`handedOverAt`/`endOf` still anchor to). The seat
panel's raw config (`SeatConfig.modes`, never the resolved one) decides `MatchOptions.humans` at
generation time in `playToRiichi`: every seat marked `'manual'` joins `seatIndex` as human, and an
explicit per-seat choice there outranks the drill's own blanket "everyone who missed the riichi
target folds" flip. `advanceAfterDiscard`'s tail (`settleAfterClaim`, shared with `answer`) must not
`beginTurn` into a turn `match.claim` has suspended — folding drives `beginTurn`/`finishTurn`
directly rather than through `useTableRound`, so it re-derives that one guard rather than getting it
for free. Orientation (which seat `Table` draws at the bottom, `SeatConfig.orientation`) is a pure
viewing perspective, deliberately kept out of `useFoldingRound`'s own rebuild key (`seatKey` tracks
only `modes`/`claims`) — changing it must never re-search for a new hand, unlike a `modes`/`claims`
edit, which legitimately does. Because it can move, the felt hand `FoldingPage` omits is the one
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
runs. The per-discard feedback (`FoldFeedback.tsx`) names only
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
board-rendering trainer shares: `SeatConfig { orientation?, modes, claims }`, `SeatMode = SeatPolicy
| 'manual'`. `resolveSeatConfig(config, players, defaultOrientation, fallbackModes?)` fills every
seat, clamps orientation into the seat count, and guarantees at least one manual seat (with none,
nothing would ever stop `goRound`); `fallbackModes` overrides the generic `'efficiency'` default for
an unconfigured seat with what the board is _actually_ doing right now (folding's own live
`policies`, since it flips non-declarers to `'defense'` at handover — the panel must not show a mode
the board isn't really running). `seatMatchOptions` is the one place `SeatMode` becomes what the
engine reads (`{ seatIndex, humans, policies, claims }`). `useTableSettings(app)` adds
`seatsEnabled` (`advanced || app === 'lab'`), distinct from `seats === null` ("offered, nobody has
configured it yet") — when the panel isn't offered, `seats` is forced to `null` too, so a hidden
panel never leaves a live per-seat configuration running underneath.

`SeatButton` (`features/settings/SeatPanel.tsx`) is one button per seat — not one table-wide panel
— fed to `Table`'s `seatControl?: (seat: number) => ReactNode` prop, which draws them in the control
row above the board, in wind order rather than seating order (the board itself says where each seat
is, and a row that re-orders itself on every perspective change is one you re-find every time). They
sat on the centre panel beside each wind mark until four 44px targets on a panel barely wider than
that buried the round wind, the wall count and the dora row under them — hence the button carrying
its own wind label now, since nothing else beside it names the seat. Each opens a dialog scoped to
that seat: "watch from here" (orientation, off via `orientable={false}`
where the trainer's own board generation is keyed to a seat and moving it would mean a different
board), the efficiency/defend/manual row, and the claims checkbox (manual seats only). Every trainer
offers every mode on every seat uniformly — there is no baked-in "you vs opponents" distinction,
only orientation (perspective) and mode (who decides). `ManualControls`
(`features/table/ManualControls.tsx`) is the shared riichi-arm button, claim prompt (ron/pon/chi/
pass, caller's own tiles drawn on each button), and — once more than one seat is manual — a
"Playing {wind}" line; it renders nothing in the single-manual-seat, no-claim, no-riichi case, so
every trainer mounts it unconditionally.

### UI

`components/tiles/Table.tsx` is the shared board (efficiency with opponents on, scoring by default, folding always — reading the table _is_ the folding drill): a 3x3 grid measured in tile widths (4fr/6fr/4fr = 14 across), seats placed by `(seat - seatIndex + players) % players` and rotated `-90deg` per step so `seatIndex`'s seat is always at the bottom, melds/nuki in the corner cells. `seatIndex` is purely which seat the board is drawn from — a viewing perspective, not "the user's seat"; there is no on-board "(you)" label, only the bottom-seat rotation itself and (where a caller passes it) that seat's own styling. It sizes itself off container query units (`--tile-w: calc(100cqw/14)`), so the whole board scales from the one width on its outer div — put width there, never on the square, or a `w-full` child collapses when the board is a flex item. Tracks must stay `minmax(0,…)`: a seat block is measured before it rotates. Rivers carry `RiverTile` flags (`tsumogiri`, `riichi`) rather than parallel arrays; absence of `tsumogiri` means tedashi. The `short:` variant (`index.css`, max-height 520px — a phone held sideways) keys `--tile-w-raw` off `vh` instead of `vw`, since a square board is only ever limited by height; the hand stays _under_ the board at every size (a real client and a real table both put your tiles along your own edge of the felt), and the width left over becomes the gutters the fullscreen chrome and notices sit in. `controls?: ReactNode` (the fullscreen toggle) and `seatControl?: (seat: number) => ReactNode` (each seat's `SeatButton`) share the control row above the board, and both live _inside_ the width-capped outer box — it is the only element that knows the board's actual width, and a wrapper around it collapses the square. `--board-max-h` (default `calc(100svh-8rem)`) and `--board-controls` (the control row's share of that budget) let a caller resize the square's height budget without touching the component.

`components/tiles/BoardStage.tsx` is the shared layout around `Table` in its two shapes — inline (`board`, `hand`, `notice`, `end`, `children` stacked, at every viewport size) and fullscreen (an explicit toggle, not orientation-triggered, so it's reachable on any device): a fixed overlay sized by `--board-max-h`/`--table-max`, the notice floating `pointer-events-none` over the board (in the right-hand gutter instead once the viewport is `short:`, sized off `--board-max-h` so it cannot reach the square — feedback that covers the tiles it is talking about is feedback you have to wait out), `end` as a centred modal, and a log drawer whose open state is reported through `onLogOpen` so a graded trainer can pause its clock. Fullscreen is meant to be somewhere you stay, not somewhere you visit: back-to-home, the log drawer and the exit toggle are `BoardStage`'s own, and each page passes its settings dialog plus `TrainerToggles` (`TrainerControls.tsx`, the status bar's own start/pause and reset extracted so both surfaces draw the same pair) through the `chrome` prop. Held sideways that whole row stands in the left gutter instead — as does `Table`'s own control row (`short:` zeroes `--board-controls`), so the square's height budget is the viewport minus the hand alone. It is a real `requestFullscreen` where the browser has one, purely to drop the chrome — the fixed overlay is what actually lays the board out either way. `TrainerLayout`'s log `<ol>` is exported as `LogList` so the fullscreen drawer and the inline panel share one renderer.

Tiles render as `<use>` references into a build-time SVG sprite (`src/assets/tiles/sprite.svg`, generated by `scripts/build-tile-sprite.mjs` from FluffyStuff assets, injected raw in `AppShell`). Tile size flows through the CSS var `--tile-w`; components scale locally by overriding it (e.g. `[--tile-w:calc(var(--tile-w-base)*0.8)]`). Tailwind 4; dark mode is a `dark` class on `<html>` toggled by `AppShell` from the persisted theme setting. `TrainerLayout` provides the shared header, settings dialog, and log panel. Routing uses `basename: import.meta.env.BASE_URL` (GitHub Pages); pushes to `main` deploy via Actions, and the app is a PWA (`vite-plugin-pwa`, autoUpdate).

Mobile-first is a project goal: touch targets are ≥44px (`min-h-11`), layouts must work at phone widths.

Audience: technical depth for advanced players, defaults that a beginner can still use. Both, not one — keep adding the precise/advanced feature, but ship it behind a setting whose default reads plainly to someone who has never scored a hand (e.g. the fu/yaku breakdowns are opt-in, and yaku are named "Pure straight" rather than "Ittsuu" until the reader asks otherwise). A new option should never be something a beginner must find and change before the screen makes sense.

Two beginner-facing surfaces built on that principle:

- **Trainer info button**: each `TrainerLayout` (and each home-page card) takes an `intro: TrainerIntro` prop — a short explanation of what the drill teaches plus an optional riichi.wiki link — surfaced behind an `Info` icon button rather than permanent on-page text, so it costs nothing once a player already knows the trainer.
- **Glossary terms**: jargon the app uses without defining — `ukeire`, `tedashi`, `tsumogiri`, `shanten`, `genbutsu`, `suji`, `dora`, `ura dora` — is registered once in `features/i18n/glossary.ts` (label, description, hand-checked riichi.wiki URL; never derive the URL from the term id, a naming-convention guess drifts the moment the wiki's own slugs don't match) and marked inline with `<GlossaryTerm id="…">`. Basic terms a player is assumed to already know (riichi, ippatsu) are deliberately not in the glossary. When a term sits mid-sentence inside a translated string, wrap it with `<term>…</term>` in the locale JSON and render via `Trans` + `components={{ term: <GlossaryTerm id="…" /> }}` — this keeps word order correct per language and the term appearing exactly once; do not hand-split a translation string into prefix/suffix keys to fake the same effect. Pass `iconOnly` only when the surrounding label already spells the term out in plain text (e.g. a setting whose description already says the word) — otherwise the default trigger repeats the term's own name next to it, which reads as a duplicate. `GlossaryTerm` and the trainer info button both render through the shared `InfoPopover` (portalled, scrim-dismissed, Escape-closed, body-scroll-locked).
