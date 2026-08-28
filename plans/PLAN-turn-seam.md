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
| Loop in `beginTurn`, ask again in `finishTurn`          | Correct, but an `'ev'` seat evaluates `rankDiscards` **twice a turn**. Rejected on cost.                             |
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

## CHAT AFTER IMPLEMENTATION

What's follow is a copy paste of the chat with user and opus after implementing this plan

---

Committed a1bd93d (signed). 670 tests, lint 0, build clean.

Tests 1 & 2 — nukidora, sanma, 'ev' statistical. Both pass, and the reason the suushiihou case works is worth knowing: no yaku-aware logic is involved. 111z222z333z444z5z is tenpai for daisuushii; discarding a north drops it off tenpai, so north's evaluateDiscards entry can't tie the best discard and pullsNorth declines. The ordinary-tenpai case (123456789p1122s + drawn north) pulls, because all thirteen are committed and the north is spare by construction.

Tests 3 & 4 — daiminkan, yonma, efficiency + 'ev' under both models. Test 3 passes. Test 4 as you asked for it cannot exist, and that's the finding:

No AI seat can ever call an open kan, in any position. chooseCall never receives RoundOptions.calledKan, so availableCalls never returns a minkan to a bot (ADR-0041). Threading the flag through wouldn't help either — shantenAfterCall removes three tiles and adds a meld, so a hand holding a concealed triplet lands on the same shanten (the triplet was already a complete block), and the after >= current guard rejects it every time. That's the §1 finding your plan author flagged, and ADR-0043's stated rejection.

So I built your case anyway and pinned it as the gap: seat 1 pons a haku, ends open, yaku-ful, tenpai on a 5s/8s ryanmen with 111m concealed and idle. Kanning keeps the wait, flips a dora, draws a replacement — free by every reading. All three algorithms decline. A separate test asserts that board really is what I claim (open, tenpai, 111m intact, seat 2 about to throw the fourth 1m).

Every declining case is paired with the identical board run with the seat left 'manual', asserting claimOptions genuinely offers the minkan — otherwise the declines would pass on a board where no kan existed.

Two flaky tests to flag, both pre-existing and load-related (this box runs 45 files in parallel): useMatchRound's "nextRound deals a fresh board" hit its 20s budget once at 26.8s (3.4s in isolation), and useFoldingRound's "a mid-hand link replays the discards behind it" failed once. Both pass alone and on re-run; the full suite was green on the final run. The match one is nearer the edge now — 'ev' seats pay a second rankDiscards on any turn they kan.

If you want AI daiminkan for real, that's the call-gate pricing ADR-0043 defers — say the word and I'll scope it.

✻ Worked for 7m 42s · done 12:38 PM

❯ Can you explain me better the The §4 ceiling you flagged is sharper than the plan states, in a way that helps. problem (and the Test 4 as you asked for it cannot exist which I guess is related) this is a gap to me

Good question — they're related, but not in the way it looks. Let me verify the numbers before explaining, rather than assert from reading.

Ran 2 shell commands

They're related, but not as cause-and-effect — they're the same structural gap seen on two different surfaces. And verifying it just now showed my earlier "in a way that helps" was too generous. Let me take that first.

Correction: the second gate is weaker than I said

I told you an 'ev' seat only kans on a quiet board when the DP can price a win, so junk hands wouldn't kan-spam. That holds only on a pristine board. Measured just now:

hand shanten honba0 honba2 1 stick
111m456789m1122p 0 KAN KAN KAN
111m456m789m12p3s 1 KAN KAN KAN
111m456m78p1234s 1 KAN KAN KAN
111m258p258s347z 5 no KAN KAN ← the one I claimed was safe

Why: scaled sums the win/dealIn/danger terms. With nobody declared, dealIn and danger are zero. The win term is P(win) × value(hand value + honba×300 + sticks×1000). Above 2 shanten the collapsed chain leaves hand value at zero — but honba and sticks survive. So a 5-shanten hand kans the moment there's a repeat counter or a stick on the table, which in a real match is most of the time.

Worse, that's a defect in the rule as I wrote it, not just a surprise: the sign test is supposed to sum the terms a dora indicator multiplies. A dora doesn't multiply honba or riichi sticks — those are fixed collects. They shouldn't be in scaled at all.

So bestKan's committed doc comment ("above maxShanten… the sum is exactly zero and the kan is declined") is wrong as shipped, and so is the matching line in ADR-0043 and CLAUDE.md. One of the two has to move.

Now the actual gap, and why the two questions are one question

The engine has two decision surfaces, and only one of them is priced:

┌──────────────────────────┬─────────────────────────────────┬───────────────────────────────────────────────────────────────────────┐
│ │ own-turn (Algorithm.turn) │ claim-time (Algorithm.call) │
├──────────────────────────┼─────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ which kan │ ankan, kakan │ daiminkan │
├──────────────────────────┼─────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ who decides │ 'ev' prices it via rankDiscards │ chooseCall — a shanten heuristic — for every algorithm, 'ev' included │
├──────────────────────────┼─────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ what the decider can see │ probability × value │ shanten, and nothing else │
├──────────────────────────┼─────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ cost │ once per turn, one seat │ every seat, every discard │
└──────────────────────────┴─────────────────────────────────┴───────────────────────────────────────────────────────────────────────┘

Ankan and kakan got a price for one reason: they are turn actions, and turn already had a rankDiscards sitting in it for the discard. The kan rule was free to bolt on.

Daiminkan is a call action, and call has no price at all. ev.call does not price anything — it delegates to chooseCall and adds one guard on top (don't open into a hand that won't be tenpai when a threat is out). The ranking is still pure shanten.

And shanten structurally cannot see a kan. A concealed triplet is already a complete block, so melding it changes nothing:

111m222m333m444p5s shanten 0 -> 0 (the suuankou hand: after === current)
111m234p567p99s12s shanten 0 -> 1 (worse — the triplet was doing double duty)
111m345m678m22p34s shanten 0 -> 1
111m19m19p19s1234z shanten 2 -> 6

Six shapes probed, none lowered. chooseCall's only filter is if (after >= current) continue. So a daiminkan is rejected 100% of the time — not by policy, by arithmetic. A kan's actual value (one modraw, fu) lives entirely outside what shanten measures.

That's why there are two barriers, and why removing the shipped one doesn't help: chooseCall never receives calledKan so a minkan is never even a candidate (ADR-0041, deliberate — it keeps the gold flag through and you hit the shanten wall behind it.

So: same gap, two surfaces. The priced surface fails only at its edges — the cost side is a hard zero when nobody has declared, the benefit side a hard zero above 2 shanten. Both are the model refuzero. The unpriced surface fails everywhere, because it was never asked to speak.

Giving daiminkan a real price means running the sign rule on the call gate — which costs a rankDiscards (~460ms) for every seat on every discard, against ~460ms per turn today. That's a round going from half a second to minutes. It's ADR-0043's stated rejection, and it needs a cheap P(win) first.

> **Both numbers in that paragraph are wrong, and the conclusion with them.** The measured ~460ms is a whole _hand_, not a turn (`core/ev.bench.test.ts` settles it: ~35ms a turn, and `efficiency`'s paired ~40ms is a hand too). And the call gate is not asked on every discard — a seat has a legal call on ~2.4 of them a hand. Pricing every decision point measured **+23%** on a hand. See ADR-0044.

What I'd do about the scaled defect

One line in bestKan, no new constant:

// a sign test over a term the model declined to price is not a decision
if (best?.outlook?.score === undefined) return undefined

That makes the shipped documentation true, kills the honba/stick artefact, and states its own reason. It doesn't move EV_GOLDEN (golden-3 deals no quad, honba 0) or any golden hash, and my existing so they're unaffected.

The alternative is to keep the behaviour and rewrite the three doc sites to say "kans on any quiet board once there's honba or a stick, at any shanten" — honest, but it's documenting an artefact as

Want me to apply the one-liner?

---

## IMPLEMENTATION REPORT — closing the gap the chat above describes

_Written 2026-08-28, the session after the one that produced the chat. **This section supersedes
the chat above wherever they disagree**, and they disagree about two load-bearing facts. Everything
here is shipped: 699 tests, lint 0, `tsc -b` and `npm run build` clean. Decision record is
[ADR-0044](../docs/adr/0044-every-decision-is-priced.md)._

### 0. The two things the chat above got wrong

Both were the stated reasons not to do this work, and both are false.

**The cost is off by a factor of eighteen.** "That's a round going from half a second to minutes"
rests on `~460ms` being a _turn_. It is a whole **hand**. `core/ev.bench.test.ts` (new, gated on
`EV_BENCH`, never runs in CI) measures it directly:

```
efficiency        17.7 ms/hand
ev (statistical)  424.5 ms/hand over 12 own turns = 35.4 ms/turn
```

The paired `~40ms` quoted for `efficiency` in the same sentences settles it on its own — one
`evaluateDiscards` plus one `chooseDiscard` cannot be 40ms, and 40ms over ~12 turns is right. Four
doc sites said "hand" and seven said "a turn"; the seven were citation drift (`algorithm.ts:280`,
`:289`, `CLAUDE.md`, ADR-0043, `docs/STATUS.md`, and §3/§5 of this very file). All corrected.

The second half of the estimate was wrong too. The call gate is **not** priced on every discard: a
seat has a legal call on ~2.4 discards a hand, and `availableCalls` says so in pure counts
arithmetic before anything is priced. Measured after the change: **+23% on a hand**, 424 → 520ms.

**`chooseCall` does not reject a daiminkan for the reason everyone recorded.** "A hand holding a
concealed triplet lands on the _same_ shanten, so `after >= current` rejects it, always" is a
generalisation from the suuankou hand and is false in general. `shantenAfterCall` (`policy.ts:223`)
calls `bestDiscards`, which removes one more tile — correct for a pon or chi, whose post-call hand
is fourteen-equivalent and owes a throw, and **wrong for a minkan**, whose post-call hand is already
thirteen-equivalent and draws its replacement instead. So it was probing a twelve-tile hand and
usually answering `current + 1`. `shanten` is tile-count-blind, so nothing threw; the number was
just one too high — which is exactly enough to make any screen built on it reject every open kan.

**This was the prerequisite.** Ship the call pricing without fixing it and the screen silently eats
every daiminkan and the feature is a no-op that passes its own tests.

### 1. The root cause under all of it

`probability.ts#collapsed` runs above `maxShanten` (2) and **never reaches a leaf**, so
`Outlook.score` came back undefined and `ev.ts#conditionalWin` returned **zero**. One hole, three
stated ceilings:

- `bestKan` declined above 2 shanten "for a reason that has nothing to do with the kan";
- `abortWorthIt` abandoned nearly every kyuushu hand — they are 4+ shanten, so the zero _was_ the
  decision;
- any call priced early in a hand compared two branches that both carried no win value.

The chat's proposed one-liner (`if (best?.outlook?.score === undefined) return undefined`) was
**not** applied. It makes the documentation true by making the model refuse to answer, which is the
wrong direction — the fix is to give it something to say.

### 2. What landed, in dependency order

| #   | Change                                                                                                                         | Files                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 0   | `EV_BENCH`-gated benchmark: ms/hand vs ms/turn, per-decision-point ask counts, call-gate yield                                 | `core/ev.bench.test.ts` (new)                                          |
| 1   | `shantenAfterCall`'s minkan guard, and it is exported                                                                          | `core/policy.ts`                                                       |
| 2   | Drop the double honba from the win term                                                                                        | `core/ev.ts`                                                           |
| 3   | `EvModel.winValue` + `HandShape`; `HandScore.csv`'s five open columns extracted                                                | `core/evModel.ts`, `scripts/build-ev-models.mjs`, `core/hououPrior.ts` |
| 3b  | `hasYakuRoute` splits into `yakuRoute(): YakuRoute \| null`                                                                    | `core/policy.ts`                                                       |
| 4   | `conditionalWin(outlook, fallback)`; three ceiling comments rewritten                                                          | `core/ev.ts`, `core/algorithm.ts`                                      |
| 5   | `price` splits into `evTerms(tile: TileId \| null, …)`; `passEv`, `holdOutlook`, `branchEv`; `keepEv` dispatches on tile count | `core/ev.ts`                                                           |
| 6   | Win-check the daiminkan replacement                                                                                            | `core/round.ts`                                                        |
| 7   | `rankCalls`/`bestCall`/`CallEv`/`afterCall`/`KAN_DORA_UPLIFT`; `callReachesTenpai` deleted                                     | `core/ev.ts`, `core/algorithm.ts`                                      |
| 8   | `winWorthIt`                                                                                                                   | `core/ev.ts`, `core/algorithm.ts`                                      |
| 9   | `kitaWorthIt`; a declared seat pulls only a north it just **drew**                                                             | `core/ev.ts`, `core/algorithm.ts`                                      |

Steps 0-6 moved no golden value, which is the gate each one was run against.

### 3. Three findings worth not re-deriving

**`keepEv` must keep the fold on both branches.** A thirteen-tile branch priced as a pure push
understates what the seat's alternative is worth, and every comparison against it then leans toward
acting — calling more into a board it should be leaving. That matters because step 7 deletes
`callReachesTenpai`, which was the only thing guarding that today.

**`afterCall` uses `Object.create(view, …)`, never a spread.** A spread reads every own enumerable
property, which fires `seatView`'s three lazy getters — `furiten` alone is ~34 shanten probes — on
the hottest path in the engine. Prototype delegation leaves their memos on the original view, where
every branch of one decision shares them for free. `seen` is genuinely invariant under a pon or chi
(`round.ts:1197` removes the tiles, `:1207` adds the same ids to `state.visible`, and `seenBy` is
their sum); after a minkan it is not, which is a stated ceiling rather than a bug.

**A daiminkan needs its kan dora priced as a multiplier, or the model refuses a free kan.** The
indicator is `state.doraStack.shift()` — face down, unknowable from a `SeatView` — so the post-kan
hand cannot be shown holding it, and the branch lost its whole benefit while keeping its whole cost.
Measured before the fix on the free-kan board: `minkan=-282` against `pass=-213`. `KAN_DORA_UPLIFT`
is `2 ** (14/34) - 1` — one indicator, thirty-four kinds, fourteen tiles, a han doubles — the same
argument `STATISTICAL.riichiUplift` already makes about ura, applied to the same win/dealIn/danger
terms `bestKan` scales. It is arithmetic about the ruleset rather than a figure either model
measured, so both read it and the no-borrowing rule holds. `bestKan` needs no such constant because
a closed kan is a **binary** choice against the identical hand and the multiplier cancels; a
daiminkan ranked against a pon, a chi and a pass has to name the magnitude.

### 4. The decision, on the board this was built for

`78999m` open-hand shape, kamicha discards `9m`, `calledKan` on, nobody declared:

```
minkan=1949   pass=1500   pon=1425
```

Kan keeps the wait and flips an indicator; pon breaks the tenpai; pass does neither. Pinned in
`round.test.ts` (`'%s ranks that kan above both the pon and the pass'`) and in `ev.test.ts`
(`rankCalls` on a `78999m234p567p55z` view).

The haku pair in that test hand is load-bearing, not decoration: open, a hand holding a terminal in
two suits can never be tanyao or a flush, so `yakuRoute` correctly screens out all three calls and
the test measures nothing. First draft used `11s` and the ranking came back `['pass']`.

### 5. Golden protocol — what actually happened

- **`GOLDEN`'s forty hashes did not move.** `chooseCall` is untouched; `bestCall` reaches the minkan
  through `availableCalls(…, view.calledKan)` instead, which is the whole reason it is wired that
  way.
- **`EV_GOLDEN` did not move either**, which the plan expected it to. Verified by regenerating, not
  by the tests passing: `GENERATE_GOLDEN=1` prints the committed values back. It is a fact about
  `golden-3` — `calledKan` off, so no minkan is a candidate, and on that one wall every priced call
  answer matched `chooseCall`'s. Noted in the file beside the existing sanma note.
- **The placement-divergence pair re-scanned to `golden-2`/`golden-8`** (was `golden-2`/`golden-6`).
  Full twenty-seed sweep, not a hunt.

### 6. Tests that changed, and why

- `round.test.ts`'s `describe("daiminkan is never an AI seat's call")` → `'daiminkan is priced by an
ev seat and invisible to efficiency'`. The suuankou case keeps `it.each(AI_MODES)` — all three
  still decline, now for two different reasons — plus a new row asserting the `'ev'` seats were
  _shown_ the kan, so "priced and declined" is distinguishable from "never offered". The free-kan
  case splits: `efficiency` declines, `EV_MODES` take it.
- **`openTenpai` now runs `riichi: false`.** With a declared threat on that board the three
  concealed `1m` are genbutsu and kanning spends all three at once — a real cost an `'ev'` seat is
  right to weigh, and nothing to do with what the board was built to ask. The setup test now asserts
  `threatViews(state)` is empty rather than trusting the docblock's "free by every reading".
- **`'replays off the log…'` (kyuushu) takes its abort from a person now.** It was quietly a test of
  the old zero win term: with `abortWorthIt` fixed, the `'ev'` seat keeps that hand. The test is
  about `replayLog`, so hanging it on a model's judgement was wrong to begin with.
- `'an AI seat never calls minkan…'` renamed to name `efficiency`; the general claim is false now.
- Two budgets raised, both with the reason in the code. The suuankou board is `decompose`'s worst
  case — `111m222m333m` arranges as three triplets _and_ as three runs, so every leaf scores several
  arrangements and three call branches over it take ~2s against a turn's ~35ms. And
  `useMatchRound`'s two tests are the only ones that play a whole hand through React; they run ~1.7s
  in isolation and tens of seconds under a 45-file parallel run. Both guard against a hang, not
  against a regression — `ev.bench.test.ts` is what watches cost.

### 7. Ceilings shipped, each stated in the code

- A daiminkan is priced without knowing _which_ dora the indicator turns out to be, only what one is
  worth on average.
- A pon steals turns and that prices at **zero**: `drawsLeft` is identical on both branches.
- On a quiet board a call has no cost side at all (`dealIn.ts` refuses to speak about an undeclared
  seat), so an `'ev'` seat opens more in the first half of a hand than it should. Same refusal
  `bestKan` carries, and it lifts in the same place.
- Declining a **ron** is honestly priced only for a seat in riichi, where the furiten is permanent
  and the DP's tsumo-only `soloWin` _is_ the post-decline value. Elsewhere the decline is understated
  and the answer leans toward taking — safe direction, and it means `winWorthIt` returns `true` in
  nearly every real position. That is a proxy for `EV-3` §7's "the decline branch's EV prices that
  state", not a closure of it.
- `bestKan`'s `scaled` still carries the riichi sticks in its win term, which a dora does not
  multiply. One term of one row, always the same sign as the win term it rides on; correcting it
  needs the win value split out of a number the identity keeps whole.
- The kita replacement is modelled as an ordinary draw, so the tempo half of "the dora against the
  tempo" prices at zero.

### 8. Still open

- **`plans/EV-5` §2.13's backtest** and §2.7's memo-lifetime measurement, both unchanged.
- **Reading a silent tenpai** (`EV-5` §1.4) — it is what lifts the quiet-board ceiling above.
- **Chankan and rinshan kaihou the yaku** — still unmodelled. The rinshan _win_ is no longer dropped
  anywhere: the turn loop, `replayLog` and now `resolveReactions` all check it.
- **The call ranking has no UI.** `CallEv` carries its terms and the tests read them; `table.ts#evOf`
  stays a discard surface. Decided deliberately, recorded in ADR-0044's Rejected section.
- **`evModel.ts` now type-imports `YakuRoute` from `policy.ts`** — the only edge between them, in
  that direction alone, noted in `docs/STRUCTURE.md`. Worth watching if the layering is revisited.

### 9. Verification

```sh
EV_BENCH=1 npx vitest run src/core/ev.bench.test.ts --disable-console-intercept
npx vitest run src/core/round.golden.test.ts     # 40 GOLDEN + 2 EV_GOLDEN + the divergence pair
npx vitest run src/core/policy.test.ts src/core/evModel.test.ts src/core/ev.test.ts
npx vitest run src/core/round.test.ts src/core/algorithm.test.ts
npm test && npm run lint && npm run build
npm run build-ev-models && git diff --stat src/core/hououPrior.ts   # additive only
```

Then play `/match` with three `'ev'` seats and `calledKan` on: they open more in the first half of a
hand than they used to, take a free daiminkan on an open tenpai hand, and stop calling into a
declared threat.
