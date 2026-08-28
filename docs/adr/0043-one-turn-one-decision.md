# ADR-0043 — One turn, one decision: `Algorithm.turn` replaces `discard` and `kita`

**Status:** Accepted, amended by [ADR-0044](0044-every-decision-is-priced.md) (which prices the
claim gate this one deferred, on a cost estimate that turned out to be off by a factor of
eighteen) · **Date:** 2026-08-28
**Amends:** [ADR-0009](0009-decision-seam.md) in the part naming the decision points — six become
five, and `discard`/`kita` are gone as separate methods.
**Source:** `core/algorithm.ts#TurnAction`, `core/round.ts#takeTurn`, `core/policy.ts#kanOptions`,
`plans/PLAN-turn-seam.md`

## Context

`plans/RECAP-REVIEW.md` §5 recorded that **no decision point covered a kan at all** — not ankan,
not kakan, not daiminkan. No AI seat had ever declared one. ADR-0041 then shipped
`RoundOptions.calledKan`, so a manual seat could call kans that no bot could, and the `'ev'` seat —
the one seat with the machinery to price a kan — was the one kind that structurally could not take
one.

Adding a seventh boolean beside `kita` was the obvious move, and it exposed the real problem:
**a turn's actions compete, and independent methods cannot rank them.** "Is pulling this north
worth more than kanning?" is a question the old seam could not ask. The engine's own loop order
answered it instead, which made loop order into policy — and that loop order was demonstrably
wrong in one place: `beginTurn` ran its kita loop _before_ `tryWin`, and `tryWin` fired on the last
replacement rather than on the tile drawn, so **a kita could destroy a tsumo**.

## Decision

**The turn-time self-actions collapse into one method.**

```ts
type TurnAction =
  | { kind: 'discard'; tile: TileId; fromDrawn: boolean }
  | { kind: 'kita' }
  | { kind: 'ankan'; tile: TileId }
  | { kind: 'kakan'; tile: TileId }

turn(view: SeatView): TurnAction
```

Asked repeatedly until it answers with a discard: a turn may hold several kans and several kita,
and each draws a replacement the next answer sees. `SeatView` gains **`calledKan`**, a rule of the
match on the same shelf as `sanma` and `kiriageMangan`, so an algorithm can never propose a kakan
the engine would refuse. `policy.ts#kanOptions(hand, melds, calledKan)` is the one notion of
own-turn kan legality, read by the engine, by `'ev'`, and by `KitaKanControls` — which drew its
own before it existed.

**Claim time is deliberately left alone.** Ron-beats-pon is a rule `resolveReactions` enforces in
seat order, not a preference an algorithm may override, so `win` stays out of `call`; and claim
time is already one ranked choice, since `call` returns _which_ call and `Call` already admits
`'minkan'`. Six methods become five, not three.

**The loop lives in `finishTurn`, not `beginTurn`.** Two alternatives were weighed and rejected:
asking `turn` from both entry points would make an `'ev'` seat evaluate `rankDiscards` twice a
turn, doubling the ~35ms it costs; stashing a chosen discard on `PlayerState` between them would
add mutable state beside `drawn` that can drift, which is exactly what the census test exists to
catch. The discard is already `finishTurn`'s job, so `turn` is asked exactly as many times as the
seat acts.

`beginTurn` therefore becomes **draw → `tryWin` on the drawn tile → kyuushu**, and that is the
correctness fix: a tsumo is now priced before anything can spend the tile that completed the hand.

**Every replacement is win-checked by the loop**, because `callAnkan`/`callKakan`/`callKita` never
do it themselves — without this a rinshan tsumo off an AI kan vanishes silently. (Rinshan kaihou the
_yaku_ stays unimplemented, so the win is taken without it, exactly as a kita's replacement always
was.)

**An `'ev'` seat prices a kan by the sign of the scaled terms, and needs no constant.** A kan flips
one more dora indicator, multiplying every hand at the table by the same expected han — yours and
every threat's alike — so `EV(kan) − EV(no kan) = m × Σ(the value-carrying terms)` for some `m > 0`,
and a binary decision needs only the sign. `'notWinning'` is excluded as a stated approximation
(`giveUpCost` mixes tsumo payments, which scale, with the noten penalty, which does not, and the
interface cannot split them); `'tenpai'` is excluded because the tenpai payment is a fixed rule
amount. Tie-break: kakan before ankan, then lowest tile id, stated as arbitrary.

## The three guards the loop keeps

- **A manual seat never reaches it.** Drawn for, never decided for (ADR-0007/ADR-0011): its kita and
  kans still come in through `callKita`/`callAnkan`/`callKakan` from the UI.
- **A seat in riichi may pull a north and nothing else.** Nukidora is legal under a declared hand and
  leaves the wait where it was; a kan does not, and no wait-preserving-kan rule is modelled here.
  `plans/PLAN-turn-seam.md` §3 said a declared seat "declares nothing", which would have dropped
  nukidora-under-riichi — a rule the engine already had. The loop therefore runs _before_
  `finishTurn` reads `forcedTsumogiri`, since a pull replaces the tile the seat is locked to.
- **An illegal action is a no-op, not a throw.** `callKita`/`callAnkan`/`callKakan` each check their
  own legality and return no events, which is the loop's signal to stop asking and fall through to a
  discard — the same untrusted-caller posture `finishTurn` and `answerClaim` already hold. The loop
  is bounded (four kans plus four kita), not a `while (true)`.

## Consequences

**The yonma golden hashes do not move. The sanma column moves once, and not for a decision.**
All forty seeded rounds play exactly the tiles they played before; what changed is that an AI seat's
own kita now goes through `callKita` and so raises the `'kita'` event a manual seat's pull always
did. That event was invisible to the golden hash until `serialize` learned to spell it — and
invisible to every board consumer too, which is the second thing this fixes. The correctness fix
above (tsumo before kita) fired on **none** of the twenty walls: no seeded sanma hand ever had a kita
competing with a tsumo, which is worth knowing.

`EV_GOLDEN` did not move either, and that is a fact about one wall rather than about the kan rule:
`golden-3` deals no seat a concealed quad and the yonma options leave `calledKan` off, so there was
never a legal kan to price.

**Two ceilings, stated where they live.** With nobody in riichi the cost side is zero — `dealIn.ts`
refuses to speak about a seat that has not declared — so an `'ev'` seat kans every legal kan on an
undeclared board _whose win the DP can price at all_. Above `maxShanten` the collapsed chain prices
no win, the sum is exactly zero, and the kan is declined for a reason that has nothing to do with
the kan. Both are arithmetic under a stated refusal, the same shape as this algorithm aborting nearly
every legal kyuushu hand, and both stop being ceilings when the model can read a silent tenpai.

## Rejected

- **Daiminkan by an AI seat.** The seam exists (`Call` admits `'minkan'`, `resolveReactions` applies
  one) but `chooseCall` structurally cannot return it: `shantenAfterCall` removes three tiles and
  adds a meld, so a hand holding a concealed triplet lands on the _same_ shanten — the triplet was
  already a complete block — and the `after >= current` guard rejects it, always. Threading
  `calledKan` into `chooseCall` would change nothing; a daiminkan needs a price of its own. Pricing
  it properly means running the sign rule on the _call gate_, which builds a `SeatView` for every
  seat on every discard and would cost a `rankDiscards` there. Revisit when there is a cheap
  `P(win)`.
- **Collapsing further, into one `act` per moment.** Ron-beats-pon is the engine's rule to enforce;
  handing it to an algorithm would let one seat's preference outrank another seat's priority.
- **Riichi-time ankan.** No wait-preserving-kan rule is modelled.
