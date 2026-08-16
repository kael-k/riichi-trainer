# Riichi Trainer

Mobile-first riichi mahjong trainer: efficiency, shanten, scoring and defensive folding drills, plus a free-play statistical lab — with reproducible, shareable training situations.

## Why

[Euophrys/Riichi-Trainer](https://github.com/Euophrys/Riichi-Trainer) is a good existing tool but unmaintained, and has concrete gaps this project targets:

1. Not responsive
2. Clunky settings UI
3. Efficiency trainer can load a hand but not the wall, so specific situations aren't reproducible
4. Ukeire is shown as a number, not as the actual improving tiles
5. Shanten trainer's number input doesn't submit on Enter
6. Shanten trainer timer starts on first guess instead of on reveal
7. No integrated scoring trainer (cf. [scoringtrainer.konbamwa.net](https://scoringtrainer.konbamwa.net/))

## Modes

Every mode is its own route — no setting silently changes which trainer you are using.

### Solitaire — just you and the wall

- **Shanten trainer** (`/shanten`) — a hand is dealt and revealed, and the timer starts with it. Guess the shanten count (Enter or the quick buttons); standard, chiitoitsu and kokushi are all considered. Guessing deals the next hand immediately and keeps the previous hand's feedback beside it, so it runs as a continuous stream rather than one hand at a time; stopping abandons the current hand for a fresh one rather than pausing, since a hand you have already looked at can't be timed again. Score and average time reset when the log is cleared.

- **Efficiency trainer — solo** (`/efficiency-solo`) — a 14-tile hand and nothing else to read. Tap a discard and get feedback: your shanten and ukeire against the best discard, with the actual improving tiles and how many of each remain. Draw, discard, repeat until the wall runs dry; cumulative "ukeire lost" scores the round. A **Kan** button appears for any tile held four times — it locks the quad as a closed meld, flips the next kan-dora indicator (dead wall permitting) and draws a replacement, graded like a discard by comparing the hand with that quad locked away against the true best discard, so a quad that was pulling double duty (e.g. `788889s`, where kanning the 8s strands the 7s/9s as a dead kanchan) is flagged rather than recommended. In sanma, a **Kita** button does the same for a held north.

  Feedback comes in two severities: a real efficiency loss (a discard, kan or kita that costs shanten or ukeire) is an **error**; passing up a kan or kita that was free — tied the best discard, no ukeire lost — is a softer **warning**, since only the extra draw and dora were left on the table, not raw efficiency.

### Table — a full board, with opponents playing themselves

- **Efficiency trainer — with opponents** (`/efficiency`) — the same drill at a real table. Opponents draw, discard, call and open their hands; you are graded on your own discards exactly as in solo. Nobody wins: a hand ending on someone else's tsumo would cut a per-turn drill short on a result you did not cause.

- **Folding trainer** (`/folding`) — someone declares riichi and you are not tenpai: which tile do you throw? A real hand is played up to the declaration, handed to you at the seat due to act, and **every discard from there to the end of the hand is graded** — safe tiles run out as the hand goes on, which is the whole lesson. Grading is on public information only (their discards, what has passed since, the walls you can count), so a correct choice that happens to deal in still grades correct, and the panel says so. Tiles are ranked into ordinal tiers — genbutsu, no chance, one chance, double suji, suji, honour, half suji, non-suji — never invented deal-in percentages. Half suji is its own tier: a 4p with only 1p discarded is still wide open to the 5p6p ryanmen, so it plays like a bare 2p, not like a protected 1p. Whether *folding* was right is deliberately not graded — that needs an expected-value model this engine does not have — and the prompt says so on screen. When the hand ends, each threat's real hand and wait is revealed, along with whatever you threw into it. Settings: timer, how many riichi to fold against (1 up to one fewer than the player count — generation falls back to fewer rather than failing), and whether opponents can win at all; turn that off and the same board plays to the wall, so a fold can be drilled without the hand ending on the first slip.

- **Scoring trainer** (`/scoring`, **alpha** — yaku detection is still being verified) — a complete winning hand (closed or open, standard/chiitoitsu/kokushi/yakuman) is generated and shown immediately; guess han, fu and points, then "Check answer" grades each field you have enabled and "New hand" deals the next. Settings: independently toggle testing han/fu/points (at least one must stay on), an exact-fu mode that grades the pre-rounding value instead of rounded-to-10, opt-in itemized yaku and fu breakdowns on reveal (off by default, so reveal shows just the correct numbers), kiriage mangan, honba sticks, "ignore fu on limit hands", open hands, and red fives. Non-dealer tsumo grades as two separate payments; every other case is a single points field. Supports sanma (nukidora scored as bonus han, 2-payer tsumo split). With the table on and a hand that was really played behind it, the win conditions carry no badges: riichi is the bet stick (and double riichi its declaration lying on the first discard), haitei/houtei is the wall count at zero, ippatsu is the win landing before the declarer's next discard — reading them off the board is the drill. A link-pinned or generated hand has no rivers to read, so there the badges stay.

- **Statistical lab** (`/lab`) — free play, nothing graded. Load a shared wall or build your own hand tile by tile, play only your own discards (opponents always play themselves), and see the full ranking: every discard's shanten and ukeire, and every tile's danger tier with the per-threat reasoning behind it — the same numbers the other trainers compute and only ever show you a sliver of.

Global settings (theme, tile size S–XL, yonma/sanma, language, tile numbers) also carry "translated yaku names": on by default, so yaku and win conditions read as "Pure straight" rather than "Ittsuu" — turn it off for the Japanese terms the scoring tables use. The row is hidden under Japanese and Chinese, where those already are the local names, and for the same reason tile-number overlays default on everywhere except those two languages. Tile size and tile numbers only take a default until you pick one; after that the choice sticks whatever the defaults become.

Turn on **Advanced** (and always, in the statistical lab) and each seat grows a small strip on the board showing which algorithm is playing it. Tapping it opens that seat's dialog: watch the board from there, or hand the seat to a different algorithm — efficiency, defence, tsumogiri, or **manual** (you play it). More than one seat can be manual at once, up to playing the whole table yourself. Changing an algorithm mid-hand never redeals — the board you were reading stays exactly as it was — and watching from another seat is view-only, never a swap of who you are playing.

## Situation URLs

Trainers read their whole scenario from the query string, so one URL fully reproduces a drill. Tile lists use tenhou notation: `123m406p789s11z` (`m`/`p`/`s` = man/pin/sou, `z` = honors E,S,W,N,haku,hatsu,chun as 1–7, `0` = red five).

| param                       | meaning                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `wall`                      | the whole deal in draw order: seat 0's 13 tiles, seat 1's 13, …, then the live draws, then the last 14 tiles as the dead wall (dora indicator first) |
| `log`                       | every seat's decisions from the deal to this point, replayed to land on a specific mid-hand turn                            |
| `round`, `seat`             | round wind and which seat is yours                                                                                         |
| `deadwall`, `aka`, `sanma`  | `1`/`0` — pin the round rules into the link, overriding the receiver's settings so it reproduces exactly                    |
| `kyoku`, `honba`, `dealerrepeat`, `dealer`, `riichisticks`, `points` | the match the round sits inside: which hand within the round wind (East **1**), the honba and dealer-repeat counters, the dealer's seat, sticks on the table, and every seat's score as a comma-separated list |

A **short wall is a prefix**: the tiles you give are dealt in order and the rest is completed at random from the copies they leave, so a link can pin a starting hand (the first 13 tiles for seat 0) and leave the remaining 123 to chance. A wall's length settles the ruleset on its own — 136 tiles is yonma, 108 is sanma — and a loaded wall wins over the receiver's setting.

Walls are validated on load and **rejected by name**, never silently repaired: over-count a tile kind, claim two red fives of one suit, include 2m–8m under sanma, or overrun the length, and the page tells you which zone and which tile is wrong. A wall is positionally meaningful, so quietly fixing one would hand back a different board than the link claimed to share.

The match params are all optional and each is left out when it is at its default (East 1, every counter zero, dealer at seat 0, 25000 points each in yonma and 35000 in sanma), so an ordinary link is exactly as short as it always was. They are context the round is played *in* — the board shows the round number and each seat's score, a riichi declaration there costs 1000 and puts a stick on the table, and honba is paid out in the score — but nothing advances between hands yet: no dealer rotation, no honba increment, no settlement.

`log` is what makes a mid-hand link exact. It records each seat's actual decisions — discards (with tedashi/tsumogiri and riichi marked), calls, kita, closed kans, the win — and replaying it consults **no algorithm at all**, so the hand comes back as it was really played rather than as today's algorithms would play it. Each replayed action is written to the log panel as it is fast-forwarded, so a shared link arrives with its turns already on the record.

```
/efficiency?wall=19m19p19s1234567z
```

That deals a kokushi start to seat 0 and fills the rest of the wall at random — the prefix is
consumed from the top of the deal, so pinning a hand for a later seat means padding the seats
before it.

The **shanten trainer** shares nothing else — it deals no wall — so it keeps its own pair:

| param  | meaning                                                                       |
| ------ | ------------------------------------------------------------------------------- |
| `seed` | deterministic hand stream; omitted = a fresh random stream each load           |
| `hand` | a 13-tile hand, posed as the first hand only — the stream carries on after it  |

The **folding trainer** adds what its generation needed, alongside the same `wall` and `log`:

| param     | meaning                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `threats` | how many seats were in riichi when the drill started                                                                        |
| `wins`    | `1`/`0` — whether the threats can ron/tsumo at all; a board where nobody wins plays on past what would have been a deal-in  |
| `sanma`   | `1`/`0`, pins the ruleset                                                                                                   |

Red fives, calls, the dead wall and opponent riichi are always on there, so they need no params, and the round wind and your seat are derived from the wall itself rather than shared separately.

The **scoring trainer** takes either a `wall` (with `sanma`, `aka`, `calls`, `honbaOn`) to play a board out to its win, or an explicit finished hand — a graded hand has no wall to read, so it gets its own params:

| param           | meaning                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `hand`          | concealed tiles, **including** the winning tile                                                                         |
| `melds`         | `-`-separated called sets: `<kind><tenhou>` — `c` chi, `p` pon, `k` open kan, `a` closed kan, e.g. `melds=p555p-a2222s` |
| `win`           | the winning tile, e.g. `win=3m`                                                                                         |
| `dora`, `ura`   | dora/ura indicator tiles                                                                                                |
| `round`, `seat` | round and seat winds                                                                                                    |
| `honba`, `nuki` | integers                                                                                                                |
| `flags`         | `-`-separated: any of `tsumo`, `riichi`, `doubleRiichi`, `ippatsu`, `haitei`, `houtei`, `rinshan`, `chankan`            |
| `sanma`         | `1`/`0`, pins the ruleset into the link                                                                                 |

"Copy situation link" always emits the explicit hand rather than a seed, so the link keeps reproducing the same round even if the generator changes later. A hand-crafted link whose hand has no legal win (incomplete, or complete but yakuless) falls back to a generated hand, with a notice on the page.

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

Architecture notes live in `CLAUDE.md`; the decisions behind them are in [`docs/adr/`](docs/adr/), with a source map in [`docs/STRUCTURE.md`](docs/STRUCTURE.md) and current state in [`docs/STATUS.md`](docs/STATUS.md).
