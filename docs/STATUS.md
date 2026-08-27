# Status

_Last synthesised: 2026-08-27, against the git history through the second EV-model wave
(`plans/PLAN-ev-model.md`)._

This file churns. It is the one place recording what is done, what is running, and what is known
to be broken. Decisions live in `docs/adr/`; behaviour lives in `CLAUDE.md`.

## Shipped

Six trainers, each its own route ([ADR-0013](adr/0013-efficiency-split.md)):

| Route              | State                                                                |
| ------------------ | -------------------------------------------------------------------- |
| `/shanten`         | Stable. Continuous hand stream, works well on phone and desktop      |
| `/efficiency-solo` | Stable. One seat, boardless                                          |
| `/efficiency`      | Stable. Board, opponents, graded per discard                         |
| `/folding`         | Stable. Ordinal danger, full betaori grading, partial credit         |
| `/scoring`         | Stable. Han/fu/points grading, full breakdown in the log             |
| `/lab`             | Free play, no grading. Wall authoring exists; the flow is still thin |

Also shipped: situation URLs, i18n (en/ja/zh/it), glossary popovers, beginner/advanced split,
dark mode, PWA + GitHub Pages deploy, sanma throughout, per-seat algorithms with a live decision
seam, and — since the one-interface wave ([ADR-0025](adr/0025-one-interface.md)) — a single
board-first layout on every trainer at every viewport.

The **table-architecture centralization** work is complete: explicit walls, `core/table.ts`,
`useRound`, the efficiency split, the table-settings schema, the lab.

**Eight waves landed after it:**

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
   session panel (score, full feedback, share link, log) docked beside the board from
   `lg` up and a drawer below that. Real fullscreen shrank to a phone-only first-tap request
   (`useMobileFullscreen`); the `mobileFullscreen` setting went with the toggle. The size setting
   now scales the felt as well as the tiles (`BOARD_SCALES`/`--board-scale`) from tablet size up
   (`sizable:`) and is disabled below that: a phone's board always fills its room, since a smaller
   square pulls the side seats' hands off the screen edge, and its tiles stay at the default. Where
   the setting applies the hand is capped to the strip under the board, so a bigger tile can no
   longer wrap the hand and take that row's height off the felt. The chrome row's
   buttons carry their names on a wide screen (`labelled:`). The wall reveal followed the same
   move: it is a chrome-row button and dialog of its own (`WallDetails`, `BoardStage`'s `wall`
   slot) on every trainer that deals a wall, and the `showWall` setting — the last advanced-gated
   field in `useTableSettings` — is deleted rather than defaulted on.
7. **Stats on the board** ([ADR-0026](adr/0026-stats-on-the-board.md)) — session stats
   (score/accuracy/clock) moved out of the session panel's top box into a small HUD floating in
   the board area's own corner, always on screen at every viewport rather than behind a drawer tap.
   Every trainer's round-build effect now writes a `log.dealt`/`log.dealtHand` row the moment a
   board exists, so the log's own rewind/share buttons cover the board as freshly dealt too; the
   page-level `CopyLinkButton` share pill is deleted. The session panel is left holding full
   feedback, the lab's own rankings/wall authoring, and the log.
8. **The log is the feedback** — the session
   panel's feedback half is deleted (`DiscardFeedback`, `FoldFeedback`, shanten's inline card,
   `BoardStage`'s `notice` prop) and what it uniquely carried moves into the log rows themselves,
   behind a chevron, for every turn of the session rather than the last one. `LogEntry` gains
   `severity`, `detail` (i18n keys, never text) and `seam`; rows lead with tiles, carry a verdict
   spine read as the session's accuracy record, and the header grows an `All | Mistakes` filter. Folding's
   `feedbackAtEnd` end card no longer repeats each turn — those are the log rows `flushLog` writes.
   One feedback density is left: the float.

   A follow-up pass sized the column for the reading it now asks for
   ([ADR-0027](adr/0027-the-log-is-the-feedback.md), which also records wave 8 itself — the
   decision the wave shipped without): the row gives its whole width to the tiles (the ordinal
   leads the sentence, the action cluster follows it), the verdict spine becomes a rail on the
   panel's own border, the tiles shrink to fit rather than wrap so a full hand reads on one line,
   and the docked panel grows from a fixed 320px to `clamp(20rem,26vw,28rem)`. Two bugs went with
   it: a local "New hand" wrote no deal row at all (the dedup keyed on the link, which a restart
   never moves), and shanten drew its thirteen tiles twice per hand.

9. **The dead wall is seven stacks** ([ADR-0028](adr/0028-dead-wall-stacks.md)) — `createRound`
   cut the trailing 14 into a block of indicators, a block of ura and the rinshan tiles, so a
   riichi win's ura dora came off tiles that were never under the indicators showing. It is now
   read as real stacks: an indicator over its own ura, the deal's own indicator the third stack
   from the rinshan end, kan dora walking back toward the live wall. A `?wall=` link's flipped
   indicator is the 9th of those 14 rather than the 1st.

10. **Settings sections are named for what a setting is about**
    ([ADR-0033](adr/0033-settings-sections.md)) — the dialog's own title is now constant
    ("Settings") instead of templated per trainer; the trainer name instead heads its own
    app-specific section, shown only when the page has rows for it. `BoardStage`/`SettingsButton`
    gain an `app?: TableApp` prop that gates a real Table section (resolved against that app's own
    override layer, replacing a hardcoded `'efficiency'`) and is present on every board-rendering
    trainer including `/efficiency-solo`, absent on `/shanten` and home. What used to be "Global"
    split into Ruleset (number of players, Kiriage mangan, red fives), UI (theme, tile size,
    language, tile numbers, glossary-on-click) and Misc (the Advanced switch alone). Kiriage
    mangan is now a real `RoundOptions` field the round engine honours for every win it prices
    (lab, scoring), not a scoring-trainer-only display toggle — not threaded into the efficiency
    trainers (`wins: false` there always) or folding (never prices a win).

11. **Expanded log rows are grouped, not a flat list** (`PLAN-ux-1`) — `LogDetail` gains three
    optional fields (`header`, `tone`, `seam`) and `DetailLine` renders them, so the three
    trainers that write detail lines can say what a line _is_. Scoring leads with the graded
    fields (a wrong one in the error colour), then `Yaku`, then `Fu` ending in the rounding as
    its own line ("26 → 30 fu"); a yakuman gets no header. Efficiency puts the ukeire total on
    each label and closes the block with one legend for the numbers under the tiles, and
    `UkeireTiles` groups per suit so a wrap never falls mid-suit (the lab and the session panel
    get that for free). Folding's lines name their own subject — "Your tile — Suji" with the tile
    leading and the suji partner past the seam — replacing the bare tier names that restated the
    row above them. `log.folding.reason` and `folding.safestDiscard` are gone.

12. **The scoring question stands where the felt would be** (`PLAN-ux-2`) — with `settings.table`
    off, the invalid-link notice, the context bar and the hand move into `BoardStage`'s `children`
    (centred in the board area) and the strip keeps the answer alone, packed two-up below `sm:`
    and at 3rem where the screen is only as tall as a phone. Measured on WebKit at 375×667,
    390×844, 844×390, 820×1180 and 1440×900: nothing scrolls in either the strip or the board
    area and "Check answer" is above the fold at every one. The `settings.table` on path is
    structurally unchanged.

13. **The small-fixes bundle** (`PLAN-ux-3`) — the chrome row drops its inter-button gap below
    400px (8 × 44px targets + 16px padding = 368px, an iPhone SE's 375px holds it, and the touch
    target never shrinks); folding returns an empty `riichiTiles()` so the fold-only drill stops
    offering the reader a declaration, engine legality untouched; the board area takes `short:py-1`
    so the felt held sideways is not flush on the screen's top edge (`e2e/board.spec.ts` measures
    the area's content box, so the square gives the 8px back rather than overflowing); the home
    footer shows the short SHA with the whole one in `title`; `InfoPopover` has no default header
    icon, the 16px hollow `Info` circle having read as a loading spinner.

14. **Log prose draws the tiles it names** (`PLAN-ux-4`) — `splitTileCodes` tokenizes the
    already-translated sentence and `LogSentence` draws each tenhou code where it stood, so `0p`
    and `4z` are gone from every locale at once without touching the JSON. The follow-up that
    landed with it: a tile is now drawn **once** per row, so the graded discard rows dropped the
    strip that was repeating what their own sentence said, and `LogEntry.seam` went with it
    (`LogDetail.seam` stays). `LogEntry.tiles` is left to what a sentence cannot name — the tenpai
    row's waits, the shanten hand, a kan's rinshan replacement. A test walks the four locale JSONs
    and fails if one ever contains a bare tile code of its own.

15. **The HUD is a strip above the board; the chip is top-centre** (`PLAN-ux-5`) — the desktop
    HUD's left-gutter float (four cramped lines on a laptop window) is gone: every viewport but
    `short:` takes the portrait shape, a full-width strip above the board (`StatusCard`'s `strip`
    layout), at ~5-7% of the height-limited square. Held sideways the HUD floats in the _right_
    gutter, the slot the verdict chip vacated — the chip is top-centre and transient in every
    shape now. `--stage-max` lost the 6rem HUD-gutter term. Measured on WebKit at the audit's
    eight viewports plus 667×375: one line everywhere but a portrait phone, chip and landscape
    HUD clear each other at every width.

16. **The end card reads `drillOver`, not the tile count** — the efficiency "Round complete"
    card raced a pending claim: `finished` (holding 13 tiles) is true for the whole window
    between the seat's discard and its next draw, and a claim holds that window open with the
    card up over the prompt. `useEfficiencyDrill` now derives `drillOver` — the tenpai stop or
    the round's genuine end (`snapshot.ended`), exact rather than latched, since no claim can
    pend on a seat whose discard just stopped the drill — and both efficiency pages point their
    `end=` at it. Solo is claims-free, so the two are the same fact there. Folding's end card
    gains the defensive `!round.claim` gate; the lab has no end-state UI. Regression tests pin a
    wall where an opponent's 5m prompts the graded seat: no card while pending, none after a
    pass, card once a taken pon leads to the tenpai discard, and a replayed link into the
    drill's last turn still reaches it. Verified live at 1440×900 and 390×844 against a
    wall+log link reproducing the audit scenario (the card shows pre-fix, never post).

17. **A reader now acts from the seat the board is drawn from, and the felt says who owes a
    decision** ([ADR-0034](adr/0034-you-act-from-where-you-watch.md)). Fixes the freeze
    `plans/NOTE-efficiency-multi-manual-freeze.md` found: `useEfficiencyDrill` gained
    `actingPlayable` (the _acting_ seat's own tile-count check) so `EfficiencyPage`'s `canAct`
    stops reading `finished` (anchored to the graded seat, which stayed true for a second manual
    seat's whole turn). `Table` gained `activeSeat` — an amber pulse on the felt's edge nearest
    whoever owes the decision — and `SeatView.claiming` displaces a claimable discard out of its
    river row and rings it. `ManualControls` now gates on `viewSeat === acting` rather than
    `viewSeat === seatIndex`: watching any other seat collapses to a "Go to {wind}" rotate button.
    The claim prompt was rebuilt (each call drawn as the meld it would make, `Ron` emphatic,
    `Pass` a ghost button, no restated "X discarded" caption). `TableSettings.claims` (the
    "ask me to call" checkbox) is gone — efficiency and lab always ask, folding never does.
    "Watch from here" moved from `SeatButton`'s dialog onto the seat's own plate as an eye icon,
    which pushed `SeatStrip` to a three-line plate (waits, then algorithm+furiten, then
    eye+gear+wind) so the icon's 44px target has room that doesn't overlap the gear's. New hook
    test (`useEfficiencyRound.test.ts`) pins the two-manual-seat freeze directly; `Table.test.tsx`
    pins all four of the turn mark's rotations, and `ManualControls.test.tsx` pins that a pending
    claim still gets its prompt once `ended` is set (that gate deadlocked the board outright until
    it was narrowed to `ended && !claim` — see the ADR).
    Verified live at 390×844 and 1440×900, both themes and `prefers-reduced-motion: reduce`: the
    mark follows the turn through all four rotations, the eye and gear each own a clean 45px hit
    box with the plate not wrapping, and a forced pon showed the displaced ringed river tile, the
    meld previews, and `Pass` as the quiet option.

18. **Efficiency asks for no calls; transient controls float instead of resizing the board**
    ([ADR-0035](adr/0035-efficiency-asks-for-no-calls.md), amending item 17/ADR-0034). Item 17's
    "efficiency and lab always ask" was a regression nobody had weighed against what the drill
    actually grades: `useEfficiencyDrill` scores discard/kita/closed-kan only, so a pon/chi offer
    there answered a question the trainer isn't about. `useEfficiencyRound.ts` drops its hardcoded
    `claims: true`; `calls: true` (opponents may still call each other) is untouched. Fixing it
    live surfaced the layout bug the reported link also showed: `ManualControls` and the kita/kan
    row lived in `BoardStage`'s hand strip, a `shrink-0` sibling of the `100cqh`-sized board area,
    so a claim prompt or a Kan button appearing mid-hand resized the felt and, sitting above
    `HandDisplay`, walked the hand under the reader's finger. `BoardStage` gained a `controls`
    slot — an `absolute` overlay bottom-centred in the board area, the translucent card
    `noticeCompact` already uses — and every board-rendering trainer moved its transient controls
    into it. `ManualControls` exports `manualControlsVisible` so a page can tell "nothing to show"
    from "a node that renders empty" and pass `undefined` rather than float a `pointer-events-auto`
    dead zone over the felt; efficiency and solo's kita/kan row switched from `options.sanma`
    (true the whole game) to precise eligibility for the same reason.
    New coverage: `e2e/board.spec.ts` gains a regression test with two seats set manual live
    through the seat panel, one discard shaped to be pon-, chi- and daiminkan-eligible at once,
    asserting no prompt ever appears (daiminkan is never offered to anyone regardless — the engine
    models no called kan at all); and a sanma fixture giving one seat a closed kan and a kita
    together, its two rinshan replacements pinned, asserting the board and hand-strip boxes never
    move across all three states, on every viewport project. `ManualControls.test.tsx` gains direct
    cases for `manualControlsVisible`; `useEfficiencyRound.test.ts`'s two claim-pending tests, now
    unreachable in efficiency, are deleted, and its multi-manual-seat freeze test is kept,
    decoupled from claims (it was never really about them).

19. **The EV model's two halves exist, and read nothing**
    ([ADR-0036](adr/0036-probability-beside-the-tiers.md), amending
    [ADR-0004](adr/0004-ordinal-danger.md)). `core/dealIn.ts` gives deal-in probability per tile
    against a declared seat by enumerating every wait shape it could hold, weighting each by how
    common it is and by how many ways it could physically be held out of the unseen tiles, and
    crossing out what their own discards rule out — returning the crossed-out terms too, since the
    decomposition is the whole reason it exists beside `danger.ts`'s tiers. `core/probability.ts`
    gives win probability and expected score from a one-player DP over the unseen pool, priced at
    every winning leaf by `scoreHand` itself. `npm run build-ev-models` fetches
    `chienshyong/houou-statistics` at a pinned commit and emits the committed `core/hououPrior.ts`,
    so the empirical tables are a reproducible artifact rather than hand-copied numbers; the ~8 GB
    log database behind those CSVs is deliberately not a build input.

    **Wave 1 was purely additive; wave 2 (item 20) added the decider that reads them.**

    Four findings that revise the plan's own specification, all recorded in the ADR: the shanpon
    prior must stay a wait-pair matrix (marginalising it reproduces the source's wait width as 1.61
    kinds against its true 1.78); one memo shared across a ranking's candidates is unsound, and the
    sound sharing — everything depending on the hand alone — is worth 5.4x rather than the 30% the
    plan expected; the DP's node counts in the plan were of a weaker DP that follows one discard
    instead of maximising over all shanten-minimal ones; and the collapsed chain has to walk an
    availability-weighted average rather than the best draw, which cuts a 190% overstatement to
    9-31%. Calibration is against `DorasobaDanger.csv`, a _different_ analyzer over the same
    database, which the model matches within 10% for ranks 1-8.

20. **The EV seat decides** ([ADR-0037](adr/0037-the-ev-seat-decides.md)). `core/evModel.ts` is the
    swappable price unit — `statistical` derives every figure from combinatorics, `houou` reads
    every figure off the measured tables — under one rule: **neither may borrow a number from the
    other**, or the answer is a third model nobody chose. `core/ev.ts` is `plans/EV-3`'s push/fold
    identity over both probability halves, with folding as the same expression at `P(win) = 0`
    rather than a second code path, and every discard carrying its own terms. Two new
    `SeatAlgorithm` members, `'ev-statistical'` and `'ev-houou'`, are the only consumers; the seat
    panel and all four locales carry them. **Nothing defaults to either**, so the golden hashes
    stay frozen — and three new golden cases prove the seat genuinely decides rather than falling
    through to `efficiency`.

    Two more measured tables extracted the same reproducible way: `BetaoirCost.csv` (what giving
    up costs, units pinned at extraction — the analyzer's Tenhou score deltas are hundreds of
    points, and its sample excludes every seat that dealt in, so it is the complement of the
    deal-in term and never a whole fold price) and `HandScore.csv` (what a riichi hand pays, by
    declaration turn and dealership — 5554 points non-dealer at turn 9, against the 5-6k rule of
    thumb).

    Findings worth not re-deriving: the pure model **cannot** price an opponent's hand, because
    hand value comes from choices rather than tiles — one stated han covers it and the derived cost
    still lands at half the measured one, in a known direction; the joint two-threat enumeration
    costs 46ms against the product's 2.5ms and moves the answer by under a tenth of a point,
    _upward_ rather than down as `plans/EV-2` §5 predicted, so it ships off by default; and
    `HOUOU_OPEN_PRIOR` is unreachable by construction rather than merely unwired, since riichi
    needs a closed hand and a `ThreatView` is only built for a declared seat.

    Still unbuilt from the plan: `plans/EV-3` §5's multi-turn safety recursion (both branches are
    priced over the rest of the hand, but roughly), the per-seat EV-model _field_ (deferred with
    its reasoning in the ADR), kyuushu kyuuhai, the placement objective, and any trainer surface.

## In flight

- Nothing. All six `plans/UX-AUDIT.md` plans have landed, and the multi-manual freeze the
  UX-AUDIT session flagged (`plans/NOTE-efficiency-multi-manual-freeze.md`) is fixed — see item 17.
- `PLAN-match-context.md` went with T7 and `UX-TABLE.md` with the pass above, per
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
  padding by id only, and since `completeWall` marks the _first_ occurrence of each red-eligible
  kind red, a plain 5m/5p/5s in `hand` strips the padding's red copy. `aka: true` with a hand
  holding a plain five yields a wall with no red for that suit. Not reachable today — the one
  production call site (`LabPage`) always passes `hand: []` — but it is a trap for exactly the
  next obvious lab feature (seeding a wall from a pasted hand).
  _Fix:_ filter `hand`'s copies out first, mark red among the survivors, mirroring
  `completeWall`'s own `prefixReds` handling.
- **A declined claim does not survive a link round-trip.** `LogEntry` only has
  `discard`/`call`/`kita`/`ankan`/`win` — no `'pass'` kind — so a manual seat's "no thanks" on a
  ron/pon/chi offer leaves no trace in `round.log`. Sharing the current situation (or a rewind)
  from a point just past a declined claim, then opening that link, replays up to the same
  discard and the live seam re-offers the identical claim rather than landing past it — the reader
  answers the same question twice. Pre-existing (the lab already ran `claims: true` by default,
  ADR-0034 just widened it to efficiency/lab always), surfaced while chasing test flakiness for
  that ADR — two tests in `useEfficiencyRound.test.ts` had to move off unseeded walls specifically
  to avoid tripping it. Low blast radius (only reachable right after declining a claim, and
  answering it again costs nothing but a repeat tap) but a real gap if `LogEntry` is ever extended.
  _Fix direction:_ a `'pass'` `LogEntry` kind, or fold declines into the existing kinds' shape.
- **A link replayed to a tenpai discard opens with the end card up, then takes it back.**
  `useEfficiencyDrill`'s `drillOver` is `tenpai || snapshot.ended`, and `tenpai` rides on
  `finished` — a tile count, true for the whole window between the graded seat's discard and its
  next draw. A shared link whose last replayed entry reached tenpai therefore lands inside that
  window with the card already up (documented and intended, ADR-0032/PLAN-ux-6), but live play is
  still running behind it, so the card disappears again the moment that seat draws. Cosmetic only
  since ADR-0034 narrowed `ManualControls`' `ended` gate to `ended && !claim` — before that, a
  claim arriving in the same window had no prompt and froze the board.
  _Fix direction:_ if it is worth fixing at all, `drillOver` would have to latch rather than derive.

### Maintenance notes

- **`useFoldingRound.test.ts`'s "next() deals a different hand" is flaky** — seen failing roughly
  once in six full runs, green on ~10 consecutive runs of the file alone. `loading` is
  `!failed && (searching || …)`, so a generation that exhausts its attempt budget clears `loading`
  while leaving the _previous_ round in state; the test's `waitFor(loading === false)` then
  compares an unchanged hand against itself. The product path is fine — `FoldingPage` renders
  `folding.noHand` on `failed` — so this is a test that reads one signal for two states, not a bug
  in the trainer. Fix by asserting on `failed` as well, if it becomes annoying.
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
- **Two benchmark/validation sessions the EV work owes**, both deliberately out of scope of the
  wave that shipped item 19: the memo-lifetime measurement (`plans/EV-5` §2.7 — fresh per ranking
  is the shipped default and the lean) and the backtest against real houou logs (§2.13), which is
  the only thing that would turn "is the model any good" from an opinion into a number.
- **Which browser-test framework** — Playwright, Cypress, Puppeteer, Selenium. `UX-TESTS-BUG.md`
  says pick one and stick to it. Lab tests are explicitly out of scope until the lab's design
  settles.

## Out of scope, on purpose

Recorded so they stop being re-proposed:

- **Push/fold grading, and an `'ev'` seat algorithm.** The two probability layers now exist
  (shipped item 19), but nothing decides with them. Items 4-7 of `plans/PLAN-ev-model.md`'s
  next-wave list are deliberately not started: the `'ev'` `SeatAlgorithm`, the per-seat EV-model
  registry, kyuushu kyuuhai engine support, and the trainer surfaces. `plans/EV-3` states the
  gate — push and fold cannot honestly be compared until folding is priced over the rest of the
  hand rather than one turn, which is the largest unbuilt piece in the design.
- **Reading a silent tenpai.** `dealIn.ts` refuses to speak about a seat that has not declared, and
  should keep refusing until the much weaker inference behind it is built (`plans/EV-5` §1.4).
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
