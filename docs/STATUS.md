# Status

_Last synthesised: 2026-08-15, against the git history through `098b5e8`._

This file churns. It is the one place recording what is done, what is running, and what is known
to be broken. Decisions live in `docs/adr/`; behaviour lives in `CLAUDE.md`.

## Shipped

Six trainers, each its own route ([ADR-0013](adr/0013-efficiency-split.md)):

| Route              | State                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `/shanten`         | Stable. Continuous hand stream, works well on phone and desktop          |
| `/efficiency-solo` | Stable. One seat, boardless                                              |
| `/efficiency`      | Stable. Board, opponents, graded per discard                             |
| `/folding`         | Stable. Ordinal danger, full betaori grading, partial credit             |
| `/scoring`         | **Alpha** — yaku detection still being verified                          |
| `/lab`             | Free play, no grading. Wall authoring exists; the flow is still thin     |

Also shipped: situation URLs, i18n (en/ja/zh/it), glossary popovers, beginner/advanced split,
dark mode, PWA + GitHub Pages deploy, sanma throughout, per-seat algorithms with a live decision
seam, mobile fullscreen on every trainer.

The **table-architecture centralization** work is complete: explicit walls, `core/table.ts`,
`useTableRound`, folding's own hook, the efficiency split, the table-settings schema, the lab.

**Three waves landed after it:**

1. **Seat algorithms** (`PLAN-seat-algorithms.md`, T0–T5, commits `4b39b28`…`d658a28`) — the
   `humans`/`policy` merge, live algorithm changes, the `ALGORITHMS` decision seam, efficiency's
   riichi removal, docs. ADRs [0007](adr/0007-every-seat-is-a-player.md)–[0011](adr/0011-at-least-one-manual-seat.md).
2. **A follow-up wave** (commits `07569cc`…`116095d`), whose plan file is not in the tree: the
   drawn tile moved onto `Hand` (`MatchState.drawn` deleted), `SeatView.dealer`,
   `Algorithm.discard` returning `{ tile, fromDrawn }`, and a fourth algorithm — `tsumogiri` —
   added as pure seam input with zero engine edits.
3. **The full action log** (`PLAN-action-log.md`, uncommitted, T0–T9) — `MatchState.log`,
   `replayLog` (consults no algorithm at all), `core/actionLog.ts`'s codec, and every wall-based
   trainer's link (`Situation.log`, `FoldingUrl.log`) switched over. Scoring's wall link and
   shanten's seed+hand format are untouched — nothing decision-shaped to log in either. mjai export
   deferred as its own small follow-up. [ADR-0021](adr/0021-action-log-replay.md).

## In flight

- **`PLAN-seat-algorithms.md`** — root, uncommitted. All six tasks appear committed; confirm with
  the parallel session before deleting it.
- **`UX-TESTS-BUG.md`** — root, uncommitted, **not started**. Adds a browser-test framework and
  fixes the mobile layout bugs listed below. Explicitly marked "DO NOT COMMIT".
- `UX-SPECS.md` was consumed and deleted by the parallel session; nothing references it now.

Two sessions run concurrently on `main` in this repo. Commits are rebased and GPG-signed
separately, so **do not push**.

## Known defects

### Mobile layout — the highest-value cluster

From `UX-TESTS-BUG.md`, none fixed. This is the area the project cares most about and tests least
([ADR-0019](adr/0019-mobile-first-board.md)):

- **The board is not square** on phones, in either orientation, fullscreen or not. It must always
  be square, shrinking if necessary.
- **Fullscreen must fit the whole square board on screen** — concealed hand tiles and seat strips
  included. If an explicit tile size (e.g. XL) does not fit, override it downward rather than
  overflowing.
- **Efficiency solo, fullscreen:** your own river is not visible.
- **Efficiency solo, fullscreen:** the log drawer renders under the hand; it should be over it.

### Engine and hooks

Both re-verified present in the current tree:

- **`useTableRound` deals the round twice on every mount** (`useTableRound.ts:278` lazy
  `useState(() => buildRound())` and the mount effect at `:281`). With an empty wall — every
  "fresh round, no shared link" mount of efficiency, efficiency-solo and the lab — `completeWall`
  runs twice with two independently random fills; the first deal is rendered, then thrown away.
  Wasted work on the app's hottest entry point, and the hand can visibly change under the player
  on load. No test catches it: every test asserts on state after the effect has settled.
  _Fix:_ make the initializer cheap and let the effect be the sole builder, or thread a stable
  per-mount `fillSeed` (the pattern `useShantenRound` already uses) so both calls agree.
- **`wallWithHand` silently eats the promised red five** (`core/wall.ts:154-170`). It filters
  padding by id only, and since `completeWall` marks the *first* occurrence of each red-eligible
  kind red, a plain 5m/5p/5s in `hand` strips the padding's red copy. `aka: true` with a hand
  holding a plain five yields a wall with no red for that suit. Not reachable today — the one
  production call site (`LabPage`) always passes `hand: []` — but it is a trap for exactly the
  next obvious lab feature (seeding a wall from a pasted hand).
  _Fix:_ filter `hand`'s copies out first, mark red among the survivors, mirroring
  `completeWall`'s own `prefixReds` handling.

### Maintenance notes

- **`useEfficiencyRound.ts` and `useEfficiencySoloRound.ts` are ~150 near-verbatim duplicate
  lines** (`recordChoice`, `writeRows`, `logReplay`, both effects, the `finished`/`tenpai`
  derivation, the return object) differing only in `players`/`calls`/`riichi`. Deliberate for now
  ([ADR-0013](adr/0013-efficiency-split.md)). Nothing asserts the two stay in lockstep, so a fix
  applied to one and not the other goes unnoticed. Factor only if a third consumer appears.
- **ja/zh omit ~75 keys en/it have** (glossary entries, `*Translated` yaku tables, `intro` copy,
  `_one` plurals). Believed intentional — those terms already read as their own words — but
  nothing distinguishes "deliberately locale-specific" from "someone forgot", so a genuinely new
  shared key could land in en/it only with nothing failing.
- **Source comments cite ADRs by number** since `0e224dc` (they used to cite the phase and plan
  documents' D-numbers). When an ADR is superseded, grep `src/` for its number — a comment pointing
  at a withdrawn decision is the same staleness one level down.

### CI

`.github/workflows/deploy.yml` runs `npm run build` and deploys. **It runs neither `npm run lint`
nor `npm test`.** `UX-TESTS-BUG.md` asks for lint, unit tests and a new browser-test job running
in parallel before release; the first two are a few lines and are worth doing regardless of when
the browser suite arrives.

## Open questions

Not decided, deliberately not guessed:

- **Do the four match-wide permission flags need a per-algorithm split?**
  ([ADR-0010](adr/0010-match-wide-permissions.md)) A trainer that wants no manual riichi has to
  turn it off for the AI too. Known coarseness; no forcing case yet.
- **Zero-manual boards** — watching a hand play itself out. Deferred to the lab with its own
  step/autoplay controls ([ADR-0011](adr/0011-at-least-one-manual-seat.md)).
- **Which browser-test framework** — Playwright, Cypress, Puppeteer, Selenium. `UX-TESTS-BUG.md`
  says pick one and stick to it. Lab tests are explicitly out of scope until the lab's design
  settles.

## Out of scope, on purpose

Recorded so they stop being re-proposed:

- **EV, deal-in probabilities, win-rate modelling, push/fold grading** —
  [ADR-0004](adr/0004-ordinal-danger.md).
- **Points, honba, riichi sticks, placement** — not modelled anywhere in the engine, and no
  placeholder fields ([ADR-0009](adr/0009-decision-seam.md)).
- **Backward compatibility** for old links or persisted keys while pre-release —
  [ADR-0020](adr/0020-no-back-compat-pre-release.md).
- **Restructuring the scoring trainer** — it generates a frozen result and renders `<Table>`
  presentationally; no shape change needed.
- **Grading an algorithm's own discards** ("watch it play, with feedback") — a new drill, not a
  side effect of the seat refactor.
