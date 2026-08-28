# PLAN — one turn, one decision: collapsing the turn-time seam and adding the kan

**Status: designed, not started.** Written 2026-08-28 at the end of the session that reviewed the
EV model (`plans/RECAP-REVIEW.md`), which is where the need surfaced. Nothing in this document is
implemented; the branch is otherwise green at 649 tests.

## Context

`plans/RECAP-REVIEW.md` §5 records that **no `Algorithm` decision point covers a kan at all** — not
ankan, not kakan, not daiminkan. No AI seat has ever declared one in this engine. `/match` shipped
`RoundOptions.calledKan` (ADR-0041), so a manual seat can now call kans that no bot can, and the
`'ev'` seat is the one seat with the machinery to price a kan and the only kind that structurally
cannot take one.

Adding it as a seventh boolean beside `kita` was the obvious move, and it exposed the real problem:
**a turn's actions compete, and six independent methods cannot rank them.** "Is pulling this north
worth more than kanning?" is a question the current seam cannot ask — the engine's own loop order
answers it instead, which makes loop order into policy.

**Decided this session, with the user:**

1. Collapse the turn-time self-actions — discard, kita, ankan, kakan — into **one** `Algorithm.turn`
   returning a `TurnAction`. Six methods become five.
2. Do **not** collapse further. Ron-beats-pon is a rule the engine enforces in `resolveReactions`,
   not a preference an algorithm may override, so `win` stays out of `call`. Claim time is already
   one ranked choice: `call` returns _which_ call, and `Call` already admits `'minkan'`.
3. The `'ev'` seat prices a kan by the **sign of the scaled terms** (see §4). No new constant.

This supersedes [ADR-0009](../docs/adr/0009-decision-seam.md) in the part that names six decision
points, and needs a new ADR saying so, in the same commit as the code.

## 1. What the next session must not re-derive

Seven findings from this session's reading. Each one costs an hour to rediscover.

- **`chooseCall`'s shanten rule structurally rejects a daiminkan.** `shantenAfterCall` removes the
  three tiles and adds a meld, so a hand that held a concealed triplet lands on the _same_ shanten —
  the triplet was already a complete block. `after >= current` then rejects it, always. So merely
  threading `options.calledKan` into `chooseCall` changes nothing, and daiminkan needs a price of
  its own rather than the shanten rule. **This is why `call` is left alone in this plan** (see §5).
- **`beginTurn`'s order today is: draw → kita loop → `tryWin` → kyuushu.** The `tryWin` runs on the
  _last replacement_, not on the tile that was drawn. So **a kita can currently destroy a tsumo**:
  `efficiency.kita` pulls whenever north's `evaluateDiscards` entry ties the best discard, which a
  complete hand can satisfy. Moving kita after the win check is a correctness fix, and it is the
  single thing in this plan that can move a golden hash (sanma only — see §6).
- **`callAnkan` and `callKakan` never check for a win themselves.** `round.ts`'s replay comment says
  so explicitly. Every new call site has to run `tryWin` on the replacement or a rinshan tsumo is
  silently dropped. (Rinshan kaihou the _yaku_ is still unimplemented — `docs/STATUS.md` — so the
  win is taken without it, exactly as a kita's replacement is today.)
- **`callKakan` does not touch `hand.melds`**; the pon it upgrades already counted as one block.
  `callAnkan` does. `callKakan` takes `options` (gated on `calledKan`); `callAnkan` deliberately
  takes none — ankan is legal under every ruleset this engine models.
- **`drawReplacement` sets `player.drawn`** and pushes to `concealed`, so after a kan the hand is
  back to `tileCount % 3 === 2` and `rankDiscards` is legal on it.
- **`KitaKanControls.tsx` derives its own kan legality** (`kakanEligible`, plus a hand+drawn count
  map). That is a second, drifting notion of the same rule and should be pointed at the shared
  helper this plan adds.
- **Chankan is not modelled** and this plan does not change that. A kakan by an AI seat exposes no
  tile to anyone's ron, same as a manual one.

## 2. The seam, as it should end up

```ts
// core/algorithm.ts
export type TurnAction =
  | { kind: 'discard'; tile: TileId; fromDrawn: boolean }
  | { kind: 'kita' }
  | { kind: 'ankan'; tile: TileId }
  | { kind: 'kakan'; tile: TileId }

export interface Algorithm {
  /** The whole of a seat's own turn, ranked in one place: throw something, pull a north, or
   *  declare a kan. Asked repeatedly until it answers with a discard — a turn may hold several
   *  kans and several kita, and each one draws a replacement the next answer sees. */
  turn(view: SeatView): TurnAction
  call(view: SeatView, tile: TileId, fromKamicha: boolean): Call | null
  riichi(view: SeatView): boolean
  win(view: SeatView, candidate: WinCandidate): boolean
  abort(view: SeatView): boolean
}
```

`discard` and `kita` are **deleted**, not kept alongside. `Algorithm.discard`'s `fromDrawn` note
carries over verbatim to the `'discard'` variant: it stays advisory, and `finishTurn` still
re-derives the river's real flag from the tile `pickTile` resolves.

`SeatView` gains **`calledKan: boolean`** — a rule of the match, the same shelf as `sanma` and the
`kiriageMangan` field the review added, so an algorithm can never propose a kakan the engine would
refuse. `round.ts#seatView` sets it from `options.calledKan ?? false`.

`policy.ts` gains the shared legality helper, so `round.ts`, the algorithms and `KitaKanControls`
read one notion of it:

```ts
/** Kans this seat could declare on its own turn, in tile order: a closed kan on any held quad,
 *  and — only under `calledKan` — an added kan on a pon it already holds the fourth copy of. */
export function kanOptions(
  hand: Hand,
  melds: readonly Meld[],
  calledKan: boolean,
): { kind: 'ankan' | 'kakan'; tile: TileId }[]
```

## 3. Where the loop lives — the one real design call

`turn` spans two engine entry points, and that is the whole difficulty. Three options were weighed;
take the third.

|                                                         |                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Loop in `beginTurn`, ask again in `finishTurn`          | Correct, but an `'ev'` seat evaluates `rankDiscards` **twice a turn** (~460ms each). Rejected on cost.               |
| Loop in `beginTurn`, stash the discard on `PlayerState` | New mutable state beside `drawn` that can drift, which is what the census test exists to catch. Rejected.            |
| **Loop in `finishTurn`**                                | **Take this.** The discard is already `finishTurn`'s job, so `turn` is asked exactly as many times as the seat acts. |

So:

- **`beginTurn` becomes**: draw → `tryWin(drawn)` → kyuushu. Its kita loop is deleted.
- **`finishTurn` gains the loop**, before its existing discard selection:

  ```
  while the seat is not manual and not in riichi:
      action = ALGORITHMS[player.algorithm].turn(view)
      if action.kind === 'discard': break with that tile
      apply it (callKita / callAnkan / callKakan), which draws a replacement
      tryWin(replacement) → if taken, end the hand here
  ```

  Guards the loop must keep, each of which is an existing rule:
  - **`isManual` short-circuits it.** A manual seat is drawn for but never decided for — no
    auto-kita, no auto-kan (ADR-0007/ADR-0011). Its kita and kans keep coming through
    `callKita`/`callAnkan`/`callKakan` from the UI, untouched.
  - **`forcedTsumogiri` short-circuits it too.** Riichi locks the turn to the drawn tile and it is
    already the _first_ branch of `finishTurn`'s tile choice; a riichi seat may ankan only under a
    wait-preserving rule this engine does not model, so it declares nothing.
  - **An illegal action is a no-op, not a throw** — validate against `kanOptions` and fall through
    to the discard. Same untrusted-caller posture `finishTurn` and `answerClaim` already hold.
  - **Bound the loop** (four kans plus four kita is the ceiling; a stuck algorithm must not hang the
    engine). One `for` with a cap, not a `while (true)`.

- **`finishTurn` can now end the hand** with a rinshan tsumo. Every caller already handles
  `state.ended` after it, since a ron could always end it there — verify `stepRound`, `playRound`,
  `goRound` and `replayLog` rather than assuming.

## 4. The four algorithms

Three of them must reproduce today's behaviour **exactly**, or the yonma hashes move.

- **`efficiency.turn`** — today's `kita` rule first (north's own `evaluateDiscards` entry tying
  `ranked[0]` under `isBestDiscard`), else today's `chooseDiscard`. It declares no kan: ukeire ranks
  the discards of whatever hand it is handed and has no opinion on whether to change the hand's
  shape. Same reasoning its `abort` already gives.
- **`defense.turn`** — `chooseFold`, no kita, no kan. A folding seat is leaving the hand.
- **`tsumogiri.turn`** — the drawn tile, or `lowestHeld`. Nothing else.
- **`ev.turn`** — `kanOptions` first; if any is worth it, return it, else the existing push/fold
  discard.

**The EV kan rule, and why it needs no constant.** A kan flips one more dora indicator, which
multiplies every hand at the table by the same expected han — yours and every threat's alike. So

```
EV(kan) − EV(no kan) = m × Σ(the terms whose value is a hand's worth),   m > 0
```

and a binary decision only needs the **sign**, so `m` cancels and nothing has to be estimated:

```ts
/** Kan iff the value-carrying terms already sum positive: a kan raises the stakes for everyone,
 *  so take it when the stakes are in your favour. */
const scaled =
  rankDiscards(view, opts)[0]
    ?.terms.filter((t) => t.kind === 'win' || t.kind === 'dealIn' || t.kind === 'danger')
    .reduce((sum, t) => sum + t.points, 0) ?? 0
```

`'notWinning'` is excluded on purpose and it is the stated approximation: `giveUpCost` is opponents'
tsumo payments (which scale) **plus** the noten penalty (which does not), and the interface cannot
split them. `'tenpai'` is excluded because the tenpai payment is a fixed rule amount.

Tie-break when several kans are legal: **kakan before ankan** (the fourth copy of a melded pon is a
dead tile; four concealed copies are not), then lowest tile id, stated as arbitrary because the
model sees no difference between two indicators.

**The ceiling to state in the code, loudly, the way `abortWorthIt` states its two:** with nobody in
riichi the cost side is _zero_ — the model refuses to read a silent tenpai (`plans/EV-2` §2) — so an
`'ev'` seat kans every legal kan on an undeclared board. Same shape as "an `'ev'` seat aborts nearly
every legal kyuushu hand" (`RECAP-6-7` §1): arithmetic under a stated refusal, not a judgement.

## 5. Explicitly out of scope

- **Daiminkan by an AI seat.** The seam exists (`call` returns a `Call`, `Call` admits `'minkan'`)
  and `resolveReactions` already applies one. What is missing is an algorithm willing to return it,
  and the §1 finding says `chooseCall` never will. Pricing it properly means running the §4 rule on
  the _call gate_, which builds a `SeatView` for every seat on every discard — and the §4 rule costs
  a `rankDiscards`. That is exactly the cost `RECAP-4-5` §6 gives for `call` being a stand-in.
  Revisit when there is a cheap `P(win)`.
- **Rinshan kaihou, chankan, the kan's replacement draw inside the DP.** All three stay unmodelled
  (`plans/EV-5` §1.10, `docs/STATUS.md`).
- **Riichi-time ankan.** No wait-preserving-kan rule is modelled, so a riichi seat declares nothing.

## 6. Golden-hash protocol — read before running the tests

- **Yonma `GOLDEN` must not move.** Nothing changes for `efficiency`/`defense`/`tsumogiri` there:
  no kita in yonma, and none of the three declares a kan.
- **Sanma `GOLDEN` may move, once, deliberately.** Moving the kita loop from before `tryWin` to
  after it means a tsumo now outranks a kita, which is the §1 correctness fix. If the hashes move,
  regenerate with `GENERATE_GOLDEN=1` **in the same commit**, say so in the message, and record it
  in the ADR — ADR-0016 makes that an act, not a side effect. If they do **not** move, say that too:
  it means no seeded sanma hand ever had a kita competing with a tsumo, which is worth knowing.
- **`EV_GOLDEN` is expected to move** and is built to (`round.golden.test.ts`'s own comment). An
  `'ev'` seat that now kans plays a different hand by construction.
- **The placement-divergence seed pair is a re-scan, not a constant.** If it fails, sweep all twenty
  seeds again the way `RECAP-REVIEW.md` §4 describes; never hunt for a seed that passes.

## 7. Tests to write

- `kanOptions` — a held quad is an ankan; the fourth copy of a pon is a kakan only under
  `calledKan`; four of a kind that are already a melded pon plus one is not also an ankan.
- **A manual seat is never auto-kanned**, the direct sibling of the existing auto-kita test.
- **A seat in riichi declares no kan** (`forcedTsumogiri` beats the loop).
- **A rinshan tsumo off an AI kan ends the hand** — the §1 finding, and the one a naive
  implementation drops silently.
- **An `'ev'` seat kans with no threats and declines into a riichi it is losing to** — the two ends
  of the §4 rule, and the ceiling written down beside them.
- `round.golden.test.ts` — per §6.
- The census test in `round.test.ts` already guards `concealed`/`counts`/`drawn` drift across the
  new mutation path; make sure the new loop is exercised by a seeded round it covers.

## 8. Verification

```sh
npx vitest run src/core/round.test.ts src/core/algorithm.test.ts src/core/ev.test.ts
npx vitest run src/core/round.golden.test.ts     # read §6 before believing a failure
npm test && npm run lint && npm run build
npx playwright test e2e/board.spec.ts            # KitaKanControls still offers what it offered
```

Then play a `/match` with three `'ev'` seats and `calledKan` on: they should kan freely on a quiet
board and stop once somebody declares. If they never kan at all, the loop is not being reached; if
they kan into a riichi with a hopeless hand, the term filter in §4 is wrong.

## 9. Documents to update in the same commit

- **A new ADR superseding [ADR-0009](../docs/adr/0009-decision-seam.md)** in the part naming six
  decision points — what the turn-time collapse buys, why claim time was left alone (ron-beats-pon
  is a rule), and any golden-hash movement under §6.
- `CLAUDE.md` — the decision-seam section (six points become five, `TurnAction`, `SeatView.calledKan`),
  and the EV section for the kan rule and its stated ceiling.
- `docs/STRUCTURE.md` if `policy.ts` gains `kanOptions`.
- `docs/STATUS.md` — a new numbered entry.
