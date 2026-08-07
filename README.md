# Riichi Trainer

Mobile-first riichi mahjong trainer: efficiency (discard/ukeire), shanten, scoring and folding drills, with reproducible, shareable training situations.

## Why

[Euophrys/Riichi-Trainer](https://github.com/Euophrys/Riichi-Trainer) is a good existing tool but unmaintained, and has concrete gaps this project targets:

1. Not responsive — hard to use on phone — _addressed: mobile-first layout_
2. Clunky settings UI — _addressed: per-trainer settings dialog_
3. Efficiency trainer can load a hand but not the wall/river, so specific situations aren't reproducible — _addressed: situation URLs pin hand, wall and rivers (see below)_
4. Ukeire is shown as a number, not as the actual improving tiles — _addressed: improving tiles shown with remaining counts_
5. Shanten trainer's number input doesn't submit on Enter — _addressed_
6. Shanten trainer timer starts on first guess instead of on reveal — _addressed: starts on reveal, millisecond precision, with a running average_
7. No integrated scoring trainer (cf. [scoringtrainer.konbamwa.net](https://scoringtrainer.konbamwa.net/)) — _addressed: han/fu/points drills with a timer and running average, an exact-fu grading option, opt-in yaku/fu breakdowns, open hands, sanma, and situation links (alpha — see below)_

## Modes

- **Efficiency trainer** (`/efficiency`) — 14-tile hand; tap a discard, get feedback: your shanten/ukeire vs. the best discard, with the actual improving tiles and their remaining counts. Draw, discard, repeat until the wall runs dry; cumulative "ukeire lost" scores the round. Optional (all on by default except the wall view): simulated opponents that tsumogiri every turn, a dead wall with visible dora indicators, red fives in the deal, and a face-up wall view. A "Kan" button appears for any tile held four times: it locks the quad as a closed meld, flips the next kan-dora indicator (dead wall permitting), and draws a replacement — graded like a discard by comparing the hand shape with that quad locked away against the true best discard, so a quad that was pulling double duty (e.g. `788889s`, where kanning the 8s strands the 7s/9s as a dead kanchan) is flagged rather than auto-recommended. In sanma (three-player, a global setting), a "Kita" button similarly pulls a held north out for a replacement draw. Feedback comes in two severities: a genuine efficiency loss (a discard, kita, or kan that costs shanten or ukeire) is an **error** (red); passing up a kan/kita that was free — tied the best discard, no ukeire lost — is a softer **warning** (amber), since only the extra draw and dora were left on the table, not raw efficiency. "Copy situation link" exports the current round mid-game as a URL (calls made so far are not replayed by the link, only the discard river).
- **Shanten trainer** (`/shanten`) — hand is dealt face-down; revealing starts the timer. Guess the shanten count (Enter or quick buttons); standard, chiitoitsu and kokushi are all considered. Guessing deals the next hand immediately, keeping the previous hand's feedback alongside; stop abandons the current hand for a fresh one. Score and average time reset when the log is cleared.
- **Scoring trainer** (`/scoring`, **alpha** — yaku detection is still being verified) — a complete winning hand (closed or open, standard/chiitoitsu/kokushi/yakuman) is generated and shown immediately; guess han, fu and points, then "Check answer" grades each field you have enabled and "New hand" deals the next one. A timer runs per hand with a running average, matching the shanten trainer. Settings: independently toggle testing han/fu/points (at least one must stay on), an exact-fu mode that grades the pre-rounding value instead of rounded-to-10, opt-in itemized yaku and fu breakdowns on reveal (off by default, so reveal shows just the correct numbers like the original app), kiriage mangan, honba sticks, "ignore fu on limit hands", open hands, and red fives. Non-dealer tsumo grades as two separate payments (what each non-dealer pays vs. the dealer); every other case is a single points field. Supports sanma (nukidora scored as bonus han, 2-payer tsumo split). "Copy situation link" dumps the exact hand, melds, dora/ura, and win conditions as a URL for sharing a specific case.
- **Folding trainer** (`/folding`) — someone declares riichi and you are not tenpai: which tile do you throw? A real hand is simulated up to the declaration, handed to you at the seat due to act, and **every discard from there to the end of the hand is graded** — safe tiles run out as the hand goes on, which is the whole lesson. Grading is on public information only (their discards, what has passed since, the walls you can count), so a correct choice that happens to deal in still grades correct; the panel says so. Tiles are ranked into ordinal tiers — genbutsu, no chance, one chance, double suji, suji, honour, half suji, non-suji — never invented deal-in percentages. Half suji is its own tier: a 4p with only 1p discarded is still wide open to the 5p6p ryanmen, so it plays like a bare 2p, not like a protected 1p. Whether _folding_ was right is deliberately not graded (that needs an expected-value model this engine does not have); the prompt says so on screen. When the hand ends, each threat's real hand and wait is revealed, along with whatever you threw into it. Settings: timer, and how many riichi to fold against (1 up to one fewer than the player count — generation falls back to fewer rather than failing).

Global settings (theme, tile size S-XL, yonma/sanma, language, tile numbers) also carry "translated yaku names": on by default, so yaku and win conditions read as "Pure straight" rather than "Ittsuu" — turn it off for the Japanese terms the scoring tables use. The row is hidden under Japanese and Chinese, where those already are the local names, and for the same reason tile-number overlays default on everywhere except those two languages. Tile size and tile numbers only take a default until you pick one; after that the choice sticks whatever the defaults become.

## Situation URLs

Trainers read their whole scenario from the query string, so one URL fully reproduces a drill. Tile lists use tenhou notation: `123m406p789s11z` (`m`/`p`/`s` = man/pin/sou, `z` = honors E,S,W,N,haku,hatsu,chun as 1–7, `0` = red five).

| param                                   | meaning                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed`                                  | deterministic shuffle of the remaining tile pool; omitted = fresh random round each load                                                            |
| `hand`                                  | starting hand; the efficiency trainer fills it to 14 tiles from the wall                                                                            |
| `wall`                                  | forced draw order, consumed by whoever draws next (opponents included); when exhausted, draws fall back to the seeded pool                          |
| `river`                                 | your own discards so far, replayed from the deal to rebuild a round mid-game (replay stops early if a discard reaches tenpai, which ends the round) |
| `round`, `seat`                         | round wind (display only) and your seat — opponents seated before you tsumogiri before your first draw                                              |
| `opponents`, `deadwall`, `aka`, `sanma` | `1`/`0` — pin the round rules into the link, overriding the receiver's settings so it reproduces exactly                                            |

Opponents' rivers are never specified: opponents always tsumogiri, so their discards are fully determined by the wall. Every tile pinned in `hand`/`wall` is removed from the seeded pool, so no tile can appear more than four times (the `river` is a replay of tiles already there, not extra copies). Example:

```
/efficiency?hand=19m19p19s1234567z&wall=9m&seed=kokushi-drill
```

The shanten trainer uses `hand` only when it is exactly 13 tiles; otherwise it deals fresh hands from `seed` — sanma (from `sanma` or the global setting) drops 2m-8m from that deal too.

The scoring trainer uses its own, unrelated param set — a graded hand has no wall/river/opponents, so extending `Situation` doesn't fit:

| param           | meaning                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `seed`          | generates the hand; ignored when `hand` is present                                                                      |
| `hand`          | concealed tiles, **including** the winning tile                                                                         |
| `melds`         | `-`-separated called sets: `<kind><tenhou>` — `c` chi, `p` pon, `k` open kan, `a` closed kan, e.g. `melds=p555p-a2222s` |
| `win`           | the winning tile, e.g. `win=3m`                                                                                         |
| `dora`, `ura`   | dora/ura indicator tiles                                                                                                |
| `round`, `seat` | round and seat winds                                                                                                    |
| `honba`, `nuki` | integers                                                                                                                |
| `flags`         | `-`-separated: any of `tsumo`, `riichi`, `doubleRiichi`, `ippatsu`, `haitei`, `houtei`, `rinshan`, `chankan`            |
| `sanma`         | `1`/`0`, pins the ruleset into the link                                                                                 |

"Copy situation link" always emits the explicit hand rather than a seed, so the link keeps reproducing the same round even if the generator changes later. A hand-crafted link whose hand has no legal win (incomplete, or complete but yakuless) falls back to a generated hand, with a notice on the page.

The folding trainer ships no tiles at all — a match replays from its seed, rivers and all:

| param     | meaning                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `seed`    | the accepted attempt seed; replayed verbatim, so the same board comes back                  |
| `sanma`   | `1`/`0`, pins the ruleset into the link                                                     |
| `threats` | how many seats were in riichi when the drill started — the search stops at that declaration |

Red fives, calls, the dead wall and opponent riichi are always on for this trainer, so they need no params. The round wind is derived from the seed itself rather than shared separately.

## Stack

React 19 + TypeScript + Vite, react-router, zustand (persisted settings), Tailwind 4, Vitest. Mahjong engine (`src/core/`) is pure TypeScript with no dependencies. Tiles render from a build-time SVG sprite generated from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) (CC0). Installable PWA with offline support. Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Development

Requires Node 26 (pinned via `.nvmrc`).

```sh
npm install
npm run dev       # dev server
npm test          # engine + component tests
npm run lint      # oxlint
npm run build     # typecheck + production build
npm run tiles     # regenerate the tile sprite from source SVGs
```
