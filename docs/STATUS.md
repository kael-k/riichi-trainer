# Status

_Last synthesised: 2026-08-18, against the git history through the one-interface run._

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
seam, and — since the one-interface wave ([ADR-0025](adr/0025-one-interface.md)) — a single
board-first layout on every trainer at every viewport.

The **table-architecture centralization** work is complete: explicit walls, `core/table.ts`,
`useRound`, the efficiency split, the table-settings schema, the lab.

**Six waves landed after it:**

1. **Seat algorithms** — the `humans`/`policy` merge, live algorithm changes, the `ALGORITHMS`
   decision seam, efficiency's riichi removal. ADRs
   [0007](adr/0007-every-seat-is-a-player.md)–[0011](adr/0011-at-least-one-manual-seat.md).
2. **A follow-up wave** — the drawn tile moved onto `Hand` (later onto `PlayerState.drawn`, wave
   4), `SeatView.dealer`, `Algorithm.discard` returning `{ tile, fromDrawn }`, and a fourth
   algorithm — `tsumogiri` — added as pure seam input with zero engine edits.
3. **The full action log** — `RoundState.log`, `replayLog` (consults no algorithm at all),
   `core/actionLog.ts`'s codec, and every wall-based trainer's link (`Situation.log`,
   `FoldingUrl.log`) switched over. Scoring's wall link and shanten's seed+hand format are
   untouched — nothing decision-shaped to log in either. mjai export deferred as its own small
   follow-up. [ADR-0021](adr/0021-action-log-replay.md).
4. **Match context + stored redness** — the round/match rename cascade, `PlayerState.concealed`
   replacing `PlayerState.reds` and `Hand.drawn`, a real `core/match.ts` (`MatchState`,
   `createMatch`), that state plumbed through options/state/`SeatView`/snapshot/link, riichi
   deducting 1000 and adding a stick, and the board showing round number and per-seat points.
   [ADR-0022](adr/0022-stored-redness.md), [ADR-0023](adr/0023-round-inside-match.md).
5. **The board's table-layout pass** — calls off the felt and beside the hand they belong to (the
   reader's own under the board, with `HandDisplay`), the per-seat read (wind, algorithm, full
   wait list) on one line in the seat's left corner with its waits above, points pinned to the
   centre panel's edge by a rotating square overlay, a plain-language round line, and a sectioned
   wall reveal with the perspective seat's own dealt tiles highlighted. Real 4/4/4+1 dealing
   ([ADR-0024](adr/0024-real-dealing-order.md)) shipped ahead of it, since the wall reveal draws
   that block back to the reader.
6. **One interface** ([ADR-0025](adr/0025-one-interface.md)) — the inline layout and the fullscreen
   toggle deleted, `BoardStage` promoted to the trainer page, `TrainerLayout` removed, and a
   session panel (score, full feedback, wall reveal, share link, log) docked beside the board from
   `lg` up and a drawer below that. Real fullscreen shrank to a phone-only first-tap request
   (`useMobileFullscreen`); the `mobileFullscreen` setting went with the toggle. The size setting
   now scales the felt as well as the tiles (`BOARD_SCALES`/`--board-scale`), and the chrome row's
   buttons carry their names on a wide screen (`labelled:`).

## In flight

- Nothing. `PLAN-match-context.md` went with T7 and `UX-TABLE.md` with the pass above, per
  `docs/README.md`'s one-plan-file rule. `PLAN-seat-algorithms.md`, `UX-TESTS-BUG.md` and
  `UX-SPECS.md` are all gone from root too; the mobile-layout items `UX-TESTS-BUG.md` carried are
  recorded under known defects below, and the CI gap under CI.

Two sessions run concurrently on `main` in this repo. Commits are rebased and GPG-signed
separately, so **do not push**.

## Known defects

### Mobile layout — the highest-value cluster

Originally from `UX-TESTS-BUG.md` (no longer in the tree), none fixed. This is the area the
project cares most about and tests least
([ADR-0019](adr/0019-mobile-first-board.md)):

- **The board is not square** on phones, in either orientation. It must always be square,
  shrinking if necessary.
- **The whole square board must fit on screen** — concealed hand tiles and seat strips included.
  If an explicit tile size (e.g. XL) does not fit, override it downward rather than overflowing.
- **Efficiency solo:** your own river is not visible.
- **Efficiency solo:** the log drawer renders under the hand; it should be over it.

  (All four now have passing e2e coverage in `e2e/board.spec.ts` — squareness on three viewports,
  board-plus-hand fitting, solo's river, and the drawer over the hand — so re-check whether any is
  still reproducible by hand before treating it as open.)

### Engine and hooks

Both re-verified present in the current tree:

- ~~**`useTableRound` deals the round twice on every mount**~~ — fixed by
  [ADR-0012](adr/0012-shared-table-layer.md)'s rewrite. `useRound` builds once, during the render
  that first needs a board, and the mount effect reuses it (`ensureBuilt`, keyed on wall identity
  and restart count). Replayed events are queued by the build and drained by the effect, so
  nothing grades or logs mid-render.
- **`wallWithHands`/`wallWithHand` silently eat the promised red five** (`core/wall.ts:187-226`). It filters
  padding by id only, and since `completeWall` marks the *first* occurrence of each red-eligible
  kind red, a plain 5m/5p/5s in `hand` strips the padding's red copy. `aka: true` with a hand
  holding a plain five yields a wall with no red for that suit. Not reachable today — the one
  production call site (`LabPage`) always passes `hand: []` — but it is a trap for exactly the
  next obvious lab feature (seeding a wall from a pasted hand).
  _Fix:_ filter `hand`'s copies out first, mark red among the survivors, mirroring
  `completeWall`'s own `prefixReds` handling.

### Maintenance notes

- **`useFoldingRound.test.ts`'s "next() deals a different hand" is flaky** — seen failing roughly
  once in six full runs, green on ~10 consecutive runs of the file alone. `loading` is
  `!failed && (searching || …)`, so a generation that exhausts its attempt budget clears `loading`
  while leaving the *previous* round in state; the test's `waitFor(loading === false)` then
  compares an unchanged hand against itself. The product path is fine — `FoldingPage` renders
  `folding.noHand` on `failed` — so this is a test that reads one signal for two states, not a bug
  in the trainer. Fix by asserting on `failed` as well, if it becomes annoying.
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
  [ADR-0004](adr/0004-ordinal-danger.md). Unblocked by the match state below, deliberately not
  adopted with it.
- **Round sequencing** — `nextRound()`, dealer rotation, honba/repeat increment, payout settlement,
  the winner collecting riichi sticks, end-of-match detection. `MatchState` is carry-in context
  plus the one within-round mutation (riichi); nothing steps between rounds
  ([ADR-0023](adr/0023-round-inside-match.md)).
- **Placement/uma/oka** — a function of settled points, so it waits on sequencing too.
- **Backward compatibility** for old links or persisted keys while pre-release —
  [ADR-0020](adr/0020-no-back-compat-pre-release.md).
- **Restructuring the scoring trainer** — it generates a frozen result and renders `<Table>`
  presentationally; no shape change needed.
- **Grading an algorithm's own discards** ("watch it play, with feedback") — a new drill, not a
  side effect of the seat refactor.
