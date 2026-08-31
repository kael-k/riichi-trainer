import type { Meld } from './agari'
import type { SeatView, WinCandidate } from './algorithm'
import { combineThreats, dealInRisk, type DealInRisk } from './dealIn'
import { evaluateDiscards } from './efficiency'
import { tileCount } from './hand'
import {
  NOTEN_PENALTY,
  STATISTICAL,
  type BoardCost,
  type EvModel,
  type EvModelName,
  WINNING_HAND_SIZE,
  type HandShape,
  type ThreatCost,
} from './evModel'
import { expectedResult, ranks, roundIndex } from './placement'
import { availableCalls, shantenAfterCall, yakuRoute, type Call } from './policy'
import { discardOutlooks, handOutlook, type Outlook, type ScoringContext } from './probability'
import type { ScoringRules } from './score'
import { isMenzen } from './yaku'
import { shanten } from './shanten'
import { doraFromIndicator, HONOR, inTileSet, NUM_TILE_TYPES, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

/**
 * The decision layer: `plans/EV-3`'s push/fold identity, evaluated over the two probability models
 * beside it (`probability.ts` for what a hand wins, `dealIn.ts` for what a tile costs) with an
 * `EvModel` supplying the prices.
 *
 * ```
 * EV(push t) =   P(win)          × (win value + sticks + honba)
 *              − Σ_j P(deal in with t, j) × (their hand + honba)
 *              − danger over the rest of the hand, throwing tiles like this one
 *              + (1 − P(win))    × the cost of not winning
 *              + P(tenpai, didn't win) × the noten penalty, collected instead of paid
 *
 * EV(fold)   = − danger over the rest of the hand, spending the safe tiles in hand
 *              + the cost of not winning
 * ```
 *
 * Folding is not a second code path. It is the same expression with `P(win)` set to zero and the
 * tiles drawn from the safe end of the hand instead of the useful end, which is what stops the two
 * branches from ever disagreeing about a term they share.
 *
 * **Both branches are integrated over the rest of the hand, turn by turn** (`plans/EV-3` §5).
 * `turnRisks` produces the sequence of per-turn risks each policy faces and `laterCost` discounts
 * it by the chance the hand is still going, so the question the trainer is actually about — *is
 * this tile more dangerous than the safest tile I will still be holding in three turns* — is one
 * the model can answer. A folding hand's safe tiles are replenished out of the unseen pool, which
 * is what stops a long fold being priced as a hand that runs out of genbutsu and then throws its
 * worst tile every turn to the end.
 *
 * **Two ceilings remain, both stated rather than hidden.** A pushing hand may not change its mind:
 * the sequence it is priced against is "keep throwing what the shape needs" for every turn left,
 * where a real hand folds the moment folding is cheaper. Letting it switch needs the win
 * probability *from turn t onward*, and `Outlook` carries one scalar for the whole hand rather
 * than a per-draw curve (`plans/RECAP-IMPLEMENTATION-1-3.md` §2.6). And the win value comes from
 * an advance-only DP that understates (`plans/EV-1` §6), which biases the comparison toward
 * folding.
 *
 * **The currency is a switch, and it is one substitution rather than a second identity.** Every
 * term is a probability times a *value*, and `valuer` is what a value means: under `'points'` a
 * point swing is worth itself, under `'placement'` it is worth the change in expected Tenhou
 * result it buys (`core/placement.ts`). Nothing below this layer knows which — that is what keeps
 * two models comparable on one board (`plans/EV-3` §8), and it is why the identity has to stay
 * linear in the value function.
 *
 * A consumer of these numbers must say which objective produced them. They are not the same
 * quantity in different units: eight thousand points is eight result points to a comfortable seat
 * and nearly ten to a last-place seat in South 4, which is the whole reason the switch exists.
 */

/**
 * This tile's deal-in risk split across the threats it could land on, **scaled so the shares sum
 * to the union rather than past it**.
 *
 * The terms are kept per seat because the placement objective needs to know who the points go to —
 * dealing into the seat above you and the seat below you are not the same decision. But summing
 * the raw per-threat probabilities double-counts the boards where more than one seat is waiting on
 * the same tile, and a discard can only deal into one of them. Measured against two threats on an
 * open pool: up to **0.88pp** of over-charge on a single tile (5m at 18.72% summed against the
 * union's 17.85%), and it rides on the honba too, since each term adds the repeat counter itself.
 *
 * With one threat `combineThreats` returns that threat's own array, so the scale is exactly 1 and
 * nothing moves — which is what keeps every single-threat golden hash where it was.
 */
function dealInShares(
  tile: TileId,
  threats: readonly ThreatCost[],
  risks: readonly DealInRisk[][],
  combined: DealInRisk[],
): number[] {
  const raw = threats.map((_, j) => risks[j][tile].probability)
  const sum = raw.reduce((total, p) => total + p, 0)
  if (sum === 0) return raw
  const scale = combined[tile].probability / sum
  return raw.map((p) => p * scale)
}

/** One line of the arithmetic, in the shape a reader can check: how often, times how much. */
export interface EvTerm {
  kind: 'win' | 'dealIn' | 'danger' | 'notWinning' | 'tenpai'
  probability: number
  /** Points the outcome is worth — negative for a cost. */
  value: number
  /** `probability × value`, which is what actually goes into the total. */
  points: number
  /** Which threat a deal-in term belongs to. */
  seat?: number
}

export interface DiscardEv {
  tile: TileId
  /** Expected points from throwing this tile, over the rest of the hand. */
  ev: number
  /** P(this tile deals in, this turn), the union across threats. */
  dealIn: number
  /** What the hand does if it keeps going — absent for a tile priced as a pure fold. */
  outlook?: Outlook
  terms: EvTerm[]
}

/** What a seat is playing for. `'points'` maximises the score; `'placement'` maximises the Tenhou
 *  result the score is likely to end at, which is the currency most real riichi argument happens
 *  in — and the one that makes a hopeless hand in South 4 worth pushing. */
export type EvObjective = 'points' | 'placement'

/** How a seat prices: which model supplies the costs, and what it is trying to maximise. Two
 *  orthogonal switches, which is exactly why they are a per-seat record rather than more members
 *  of `SeatAlgorithm` — the union would be their cross product (ADR-0037). */
export interface EvSeat {
  model: EvModelName
  objective: EvObjective
}

/** What a seat runs on unless something says otherwise: the model that can explain itself from
 *  first principles (ADR-0018), playing for placement — the currency the trainer is actually
 *  about. `EvOptions.objective`'s own fallback stays `'points'` (see its doc comment below) — a
 *  bare call with no seat behind it, like a test or the lab's manual price check, still means
 *  points unless asked otherwise; only the seat's live default moved. */
export const DEFAULT_EV_SEAT: EvSeat = { model: 'statistical', objective: 'placement' }

export interface EvOptions {
  model?: EvModel
  /** Default `'points'`. */
  objective?: EvObjective
  /** Above this shanten the win side runs the collapsed chain — `probability.ts`' own default. */
  maxShanten?: number
  /** Price every held tile rather than the candidate union. Off by default: the union is what
   *  makes an `'ev'` seat affordable at all. */
  exhaustive?: boolean
}

/**
 * How many tiles reach the DP, and where they come from. **Changing either number changes which
 * discards an `'ev'` seat makes**, so they are versioned with the algorithm and the golden tests
 * rather than tuned casually (`plans/EV-5` §1.9).
 *
 * The set is a union, deliberately: the fastest tiles by shanten and ukeire, *plus* the safest
 * tiles against the board. A push/fold decision that never prices the fold option is not a
 * decision, and the efficiency prefilter alone would never surface a genbutsu that keeps the hand
 * alive.
 *
 * This union is the whole of the cheap path `plans/EV-5` §1.9 asks for, and it is enough: an
 * `'ev'` seat plays a measured **~460ms hand** against `efficiency`'s ~40ms, with the DP left
 * exact to 2-shanten as `plans/EV-1` §6's boundary intends. Capping the look-ahead and collapsing
 * 2-shanten as well was tried and taken back out — it bought 2.5x for a real loss of accuracy in
 * the middle of the hand, where the interesting decisions are.
 */
export const EV_FAST_CANDIDATES = 3
export const EV_SAFE_CANDIDATES = 2

/** Riichi's own stick, which the declaration pays whether or not the hand wins. */
const RIICHI_STICK = 1000

/** The north wind, which sanma plays as a pullable dora rather than as an ordinary honour. */
const NORTH = HONOR + 3

/**
 * Every candidate discard, priced, best first.
 *
 * The hand must be the fourteen-tile one — this is asked in the middle of a turn, with the drawn
 * tile still held.
 */
export function rankDiscards(view: SeatView, opts: EvOptions = {}): DiscardEv[] {
  // a thirteen-tile hand has nothing to choose between, and taking a tile out of one leaves a
  // twelve-tile hand the DP can never complete — it would explore every future to no end
  if (tileCount(view.hand) % 3 !== 2) {
    throw new Error(`rankDiscards: needs the hand mid-turn, got ${tileCount(view.hand)} tiles`)
  }
  const model = opts.model ?? STATISTICAL
  const value = valuer(view, model, opts.objective ?? 'points')
  const { board, threats, risks, combined } = context(view, model)
  const notWinning = model.giveUpCost(threats, board)

  const candidates = opts.exhaustive ? heldTiles(view) : candidateUnion(view, combined)

  const outlooks = discardOutlooks(view.hand, view.seen, view.sanma, board.drawsLeft, {
    objective: 'score',
    maxShanten: opts.maxShanten,
    scoring: scoringContext(view),
    candidates,
  })

  const priced = candidates.map((tile) =>
    price(
      tile,
      view,
      model,
      value,
      board,
      threats,
      risks,
      combined,
      outlooks.get(tile),
      notWinning,
    ),
  )
  // a total order, never sort stability — see `byValue`
  priced.sort(byValue(board.dora))
  return priced
}

/**
 * Whether declaring riichi is worth its stick, priced through the same identity.
 *
 * Declaring pays 1000 now and returns two things when the hand wins: the stick itself, and
 * whatever the declaration adds to the hand — ippatsu, ura and riichi's own han, which each model
 * prices from its own source. It says nothing about the cost of the discards riichi takes away
 * from you, which is real and unmodelled: a declared hand cannot fold.
 */
export function riichiWorthIt(view: SeatView, opts: EvOptions = {}): boolean {
  const model = opts.model ?? STATISTICAL
  const value = valuer(view, model, opts.objective ?? 'points')
  const { board } = context(view, model)
  // the thirteen-tile hand as it now stands: this is asked *after* the discard, so there is
  // nothing left to choose and nothing to rank — asking `rankDiscards` here would take a tile out
  // of a hand that has already thrown one, and a twelve-tile hand can never complete
  const outlook = holdOutlook(view, board, opts)
  const won = conditionalWin(outlook, model.winValue(handShape(view), board))
  // the stick is paid whether or not the hand wins, and under placement the two halves are not
  // each other's negative — a thousand points off a comfortable lead is not what a thousand
  // points onto a desperate one is worth
  const gained = value(model.riichiUplift(won, board) + RIICHI_STICK)
  return outlook.soloWin * gained + value(-RIICHI_STICK) > 0
}

/**
 * What playing this hand out is worth, both branches weighed: the better of pushing and folding.
 * Exported because it is what an abort decision is made of, and a screen showing the decision has
 * to be able to show the number it compared.
 *
 * **Takes the hand at either size, and which one it got decides what "pushing" means.** With
 * fourteen tiles the seat owes a discard, so the push branch is the best of `rankDiscards`. With
 * thirteen it owes nothing and the push branch is `passEv` — the hand held as it stands. That is
 * what lets one function price a call against a pass, and a ron against declining it: a pon leaves
 * eleven concealed tiles and a new meld, which is fourteen-equivalent and owes a throw; a minkan
 * leaves ten and a meld, which is thirteen-equivalent and draws instead.
 *
 * The fold is on **both** branches, and that is not decoration. A thirteen-tile branch priced as a
 * pure push would understate what the seat's alternative is worth, and every comparison against it
 * would then lean toward acting — calling more into a board it should be leaving.
 */
export function keepEv(view: SeatView, opts: EvOptions = {}): number {
  return branchEv(view, opts).ev
}

/** Whichever branch this hand should take, and the arithmetic behind it. `keepEv` is its `ev`;
 *  everything that has to *show* the comparison wants the terms too. */
function branchEv(view: SeatView, opts: EvOptions): Omit<CallEv, 'call'> {
  const fold = foldEv(view, opts)
  const push =
    tileCount(view.hand) % 3 === 1
      ? passEv(view, opts)
      : (rankDiscards(view, opts)[0] as
          { ev: number; terms: EvTerm[]; outlook?: Outlook } | undefined)
  if (push && push.ev >= fold.ev) return { ev: push.ev, terms: push.terms, outlook: push.outlook }
  return { ev: fold.ev, terms: fold.terms, outlook: fold.outlook }
}

/** One branch of a claim, priced: a call this seat could make, or the pass every call is measured
 *  against. `call: null` is that pass — a first-class row rather than an absence, so a reader can
 *  see the number the decision turned on rather than only the winner. */
export interface CallEv {
  call: Call | null
  ev: number
  terms: EvTerm[]
  outlook?: Outlook
}

/**
 * Every branch open to this seat on somebody else's discard, priced through the same identity as
 * a discard, best first — with the pass among them.
 *
 * `EV(pass)` is the thirteen-tile hand held as it stands. `EV(call)` is the hand the call would
 * leave, and which shape that is depends on the call: a pon or a chi spends two tiles for a meld
 * and leaves a fourteen-equivalent hand that owes a throw, so it is ranked by `rankDiscards`; a
 * minkan spends three and draws its replacement, leaving a thirteen-equivalent hand, so it is
 * priced by `passEv`. `keepEv` dispatches on exactly that, which is why one function covers both.
 *
 * The screen in front of the pricing is `chooseCall`'s own two rules with one deliberately
 * loosened. A candidate is dropped when it *raises* shanten, or when the opened hand would have no
 * yaku route at all — both cheap, and neither decides anything, they only spare the DP a run it
 * would waste. What is loosened is `chooseCall`'s demand that a call *lower* shanten: every
 * daiminkan is shanten-neutral by construction (a concealed triplet is already a complete block),
 * and so is a pon taken for value or for tempo, so a strict rule is exactly the rule that can
 * never say yes to the calls this function exists to weigh.
 *
 * **Three ceilings, stated the way `bestKan` states its own.**
 *
 * A **daiminkan is priced without its kan dora**. The indicator is `state.doraStack.shift()` —
 * hidden until the kan completes and so unknowable from a `SeatView` — so the single largest
 * reason to declare one is absent from the benefit side while the whole cost (menzen gone, the
 * hand's decompositions frozen) is charged. This decider therefore under-prices every open kan,
 * and the direction is known. It is exactly why `bestKan` prices a *closed* kan by the sign of the
 * scaled terms instead of by a comparison like this one.
 *
 * **A pon steals turns, and that prices at zero.** `board.drawsLeft` is `wallLeft / players` and is
 * identical on both branches, so the classic reason to pon from toimen — arriving at your own turn
 * two seats early — is invisible here. Understates every call, again in a known direction.
 *
 * **On a quiet board a call has no cost side at all.** `dealIn.ts` refuses to speak about a seat
 * that has not declared, so opening is priced at zero risk and this seat will open more in the
 * first half of a hand than it should. Same stated refusal `bestKan` carries, and it lifts in the
 * same place: when the model can read a silent tenpai.
 */
export function rankCalls(
  view: SeatView,
  tile: TileId,
  fromKamicha: boolean,
  opts: EvOptions = {},
): CallEv[] {
  const calls = availableCalls(view.hand, tile, fromKamicha, view.calledKan)
  // nothing to weigh, and no reason to pay for a pass nobody asked about
  if (calls.length === 0) return []

  const current = shanten(view.hand)
  const priced: CallEv[] = [{ call: null, ...branchEv(view, opts) }]
  for (const call of calls) {
    if (shantenAfterCall(view.hand, call) > current) continue
    const after = afterCall(view, call, tile)
    if (yakuRoute(after.hand, [...after.melds], view.prevalentWind, view.seatWind) === null)
      continue
    const branch = branchEv(after, opts)
    // a kan flips one more indicator, which the post-kan hand cannot be shown holding — the
    // indicator is still face down. Priced as the multiplier it is instead of left at zero
    priced.push({ call, ...(call.kind === 'minkan' ? withKanDora(branch) : branch) })
  }
  // a total order, never sort stability: expected points, then the call that commits least of the
  // hand, then the lowest tile. The last two are stated as arbitrary — at equal EV the model sees
  // no difference between them
  priced.sort((a, b) => b.ev - a.ev || callRank(a.call) - callRank(b.call) || first(a) - first(b))
  return priced
}

/** Which call to take on another seat's discard, or `null` to pass — the whole of `ALGORITHMS.ev`'s
 *  claim-time decision. A call must *beat* the pass rather than tie it: opening a hand cannot be
 *  taken back, so a branch worth exactly as much is not worth the commitment. */
export function bestCall(
  view: SeatView,
  tile: TileId,
  fromKamicha: boolean,
  opts: EvOptions = {},
): Call | null {
  const ranked = rankCalls(view, tile, fromKamicha, opts)
  const pass = ranked.find((row) => row.call === null)
  const best = ranked[0]
  if (!best || !pass || best.call === null || best.ev <= pass.ev) return null
  return best.call
}

/**
 * What one more dora indicator is worth, as a multiplier on every hand at the table.
 *
 * A kan flips an indicator, and an indicator points at one kind out of the thirty-four with no
 * reason to prefer any, so each of a winning hand's fourteen tiles carries `1/34` of a han — and a
 * han doubles. That is `STATISTICAL.riichiUplift`'s ura argument applied to the other indicator,
 * and it is arithmetic about the **ruleset** rather than a figure either model measured, so both
 * read it (`NOTEN_PENALTY` is shared on the same grounds).
 *
 * `bestKan` needs no such constant, and the difference is worth understanding rather than reading
 * as an inconsistency: a closed kan is a *binary* choice against the identical hand, so the
 * multiplier cancels and only the sign of the scaled terms matters. A daiminkan is not — it is
 * ranked against a pon, a chi and a pass, all of which leave different hands — so the magnitude
 * has to be named. Without it the kan branch loses its whole benefit while keeping its whole cost,
 * and the model would refuse a free kan for a reason that has nothing to do with the kan.
 *
 * Which terms it scales, and why the other two are excluded, is `bestKan`'s list exactly: a dora
 * multiplies what a *hand* is worth — yours and every threat's alike — and neither the noten
 * penalty nor the tenpai payment is a hand.
 *
 * Doubling is exact below the limit brackets and too generous at them, the stated approximation
 * `riichiUplift` already carries for the same reason.
 */
const KAN_DORA_UPLIFT = 2 ** (WINNING_HAND_SIZE / NUM_TILE_TYPES) - 1

/** The branch as a kan leaves it: the same terms, with everything a dora multiplies scaled up. */
function withKanDora(branch: Omit<CallEv, 'call'>): Omit<CallEv, 'call'> {
  const scalable = branch.terms
    .filter((t) => t.kind === 'win' || t.kind === 'dealIn' || t.kind === 'danger')
    .reduce((sum, t) => sum + t.points, 0)
  return { ...branch, ev: branch.ev + KAN_DORA_UPLIFT * scalable }
}

/** `minkan` 0, `pon` 1, `chi` 2, the pass last: the order a tie is broken in. */
function callRank(call: Call | null): number {
  if (call === null) return 3
  return call.kind === 'minkan' ? 0 : call.kind === 'pon' ? 1 : 2
}

function first(row: CallEv): number {
  return row.call?.from[0] ?? -1
}

/**
 * The same board, seen with the hand a call would leave behind.
 *
 * **Prototype delegation, not a spread.** `seatView`'s `seen`, `threats` and `furiten` are lazy
 * getters precisely because the call gate builds a view per seat per discard, and `furiten` alone
 * is ~34 shanten probes; spreading reads every own enumerable property and so would force all
 * three on the hottest path in the engine. Delegating leaves their memos on the original view,
 * where every branch of one decision shares them for free.
 *
 * `seen` is genuinely the same set after a pon or a chi: `resolveReactions` takes the tiles out of
 * the hand and adds the same ids to `state.visible`, and `seenBy` is their sum. After a minkan it
 * is not — a kan flips an indicator nobody can see yet — which is the first ceiling `rankCalls`
 * states.
 *
 * `red: false` on the meld is correct rather than lazy: the DP draws at kind level and never sees
 * redness on the pass branch either (`probability.ts#priceWin`), so both sides stay comparable.
 */
function afterCall(view: SeatView, call: Call, tile: TileId): SeatView {
  const counts = Uint8Array.from(view.hand.counts)
  for (const id of call.from) counts[id]--
  const tiles = [tile, ...call.from].map((id) => ({ id, red: false }))
  const meld: Meld = { kind: call.kind, tiles }
  return Object.create(view, {
    hand: { value: { counts, melds: view.hand.melds + 1 }, enumerable: true },
    melds: { value: [...view.melds, meld], enumerable: true },
    drawn: { value: undefined, enumerable: true },
  }) as SeatView
}

/**
 * Whether pulling a north is worth more than the best thing this hand could throw instead — the
 * last of the five decision points to stop being `efficiency`'s ukeire comparison.
 *
 * The two branches are not the same shape, and that asymmetry is the decision. Throwing leaves a
 * thirteen-tile hand and passes the turn on; pulling leaves a thirteen-tile hand *and draws a
 * replacement*, so the seat is still mid-turn and still owes a throw. What the pull buys is a dora
 * that follows the hand wherever it goes, and what it costs is whatever the north was still doing
 * in the shape — which for a hand that needs it is a great deal, and for a spare fourth honour is
 * nothing at all.
 *
 * `ScoringContext.kita` already reaches the DP's leaf, so the extra dora is priced by the same
 * scorer that prices every other one rather than by a constant here.
 *
 * **One ceiling, shared with every kan.** The replacement draw is modelled as an ordinary draw
 * from the unseen pool — `probability.ts`' DP has no notion of a dead wall (`plans/EV-5` §1.10) —
 * so the pull neither gains a free draw nor spends one, and the tempo half of `plans/EV-3` §7's
 * "the dora against the tempo" is priced at zero. Understates the pull, in a known direction.
 */
export function kitaWorthIt(view: SeatView, opts: EvOptions = {}): boolean {
  if (!view.sanma || view.hand.counts[NORTH] === 0) return false
  const counts = Uint8Array.from(view.hand.counts)
  counts[NORTH]--
  const pulled = Object.create(view, {
    hand: { value: { counts, melds: view.hand.melds }, enumerable: true },
    nuki: { value: view.nuki + 1, enumerable: true },
    drawn: { value: undefined, enumerable: true },
  }) as SeatView
  return keepEv(pulled, opts) > keepEv(view, opts)
}

/**
 * Whether to take a win that is being offered, priced against playing the hand on instead.
 *
 * The take side is the one exact figure in the whole model — the hand is complete and
 * `tryWin` has already scored it, so `payments.total` is what it really pays, honba folded in by
 * `score.ts#computePayments`. The riichi sticks on the table are added here because nothing in
 * `score.ts` knows about them.
 *
 * The decline side is `keepEv`, and which shape it gets is decided by what is being declined:
 * `tryWin` takes the ron tile back out of the hand before it asks, so a ron is weighed from
 * thirteen tiles and a tsumo from fourteen. One expression covers both.
 *
 * **Why declining a ron is honestly priced and declining a tsumo is not.** `Outlook.soloWin` counts
 * self-draws only, which is exactly what a hand has left once it is furiten — so for a seat in
 * riichi, where the furiten is permanent, `keepEv` *is* the post-decline value. For a seat not in
 * riichi the furiten lifts on its own next discard, so the decline is worth more than this says and
 * the answer leans toward taking the win. That lean is the safe direction and it is deliberate:
 * `plans/EV-3` §7 wants the decline branch to price the furiten state itself, and this prices a
 * proxy for it. Expect `true` in nearly every real position; the cases where it is not are what
 * the placement objective was built to see — a cheap win that locks a seat out of a place it could
 * still have reached.
 */
export function winWorthIt(view: SeatView, candidate: WinCandidate, opts: EvOptions = {}): boolean {
  const model = opts.model ?? STATISTICAL
  const value = valuer(view, model, opts.objective ?? 'points')
  // no `to`: a tsumo is paid by every other seat and `valuer`'s second argument names one, so both
  // sides of this comparison stay seat-blind, exactly as `price`'s own win term does
  const taken = value(candidate.score.payments.total + view.match.riichiSticks * RIICHI_STICK)
  return taken >= keepEv(view, opts)
}

/**
 * Whether to take the abortive draw on a kyuushu kyuuhai hand, priced through the same identity.
 *
 * `EV(abort)` is **zero**. Under the ruleset this engine pins (Tenhou practice: a ryuukyoku with
 * honba +1 and the dealership rotating) nobody pays and nobody collects, so the whole decision is
 * whether playing the hand out is worth more than nothing.
 *
 * **One ceiling now, where there were two.** A hand with nine distinct terminals and honours is
 * four or more shanten, above `probability.ts`' exact ceiling, so the collapsed chain runs — and it
 * used to price *no win value at all*, which left `EV(keep)` dominated by the give-up term and
 * negative for almost every legal kyuushu hand. That was arithmetic rather than a judgement, and it
 * is gone: `conditionalWin` now falls back to `EvModel.winValue` exactly where the DP declined to
 * reach a leaf, so what a kyuushu hand is worth is a real figure and the decision turns on it.
 * The remaining ceiling is unchanged: a dealer that aborts gives up a dealership the points
 * objective cannot price at all, because nothing in this engine sequences to a next round
 * (ADR-0023).
 */
export function abortWorthIt(view: SeatView, opts: EvOptions = {}): boolean {
  return keepEv(view, opts) < 0
}

/**
 * What this hand pays **when it wins** — `plans/EV-1` §4's `S_solo / P_solo`.
 *
 * `Outlook.score` is the *unconditional* expectation, `P(win) × E[value | win]`, and every term of
 * the identity is a probability times a value. Pairing `soloWin` with `score` counts `P(win)`
 * twice, which shrinks the push branch quadratically and biases the whole decider toward folding —
 * hardest at 1- and 2-shanten, where the interesting decisions are. Zero when the hand cannot win,
 * and when the collapsed chain ran and priced no leaf to divide.
 */
function conditionalWin(outlook: Outlook | undefined, fallback: number): number {
  if (!outlook || outlook.soloWin <= 0) return 0
  // the DP is exact wherever it ran; the fallback speaks only where it declined to reach a leaf
  return outlook.score === undefined ? fallback : outlook.score / outlook.soloWin
}

/**
 * The hand as a price sees it — four facts, no tiles (`EvModel.HandShape`).
 *
 * Dora are counted at *kind* level, off `hand.counts` plus the melds plus the kita pile, which is
 * the same blindness the DP's own leaf has (`probability.ts` never sees redness), so the two halves
 * of the win term stay comparable rather than one of them being quietly richer.
 */
function handShape(view: SeatView): HandShape {
  const dora = view.doraIndicators.map((indicator) => doraFromIndicator(indicator.id))
  let held = 0
  for (const id of dora) {
    held += view.hand.counts[id]
    for (const meld of view.melds) held += meld.tiles.filter((t) => t.id === id).length
  }
  // a pulled north is a dora of its own in sanma, whatever the indicators say
  return {
    dora: held + view.nuki,
    // `isMenzen`, not "no melds": a closed kan leaves the hand closed and so does a kita pull, and
    // `closed` here means exactly what it means to `canDeclareRiichi` — still able to declare, and
    // still collecting menzen tsumo and ura when it wins
    closed: isMenzen([...view.melds]),
    riichi: view.riichi,
    route: yakuRoute(view.hand, [...view.melds], view.prevalentWind, view.seatWind),
  }
}

/**
 * The tiles worth pricing: the fastest few, plus the safest few. Duplicates collapse, so a tile
 * that is both is counted once and the union is usually smaller than the sum.
 *
 * **With nobody declared there is no safe half at all**, and that is not an optimisation. Every
 * entry of `combined` is zero on a quiet board, so the sort falls straight through to its `a - b`
 * tie-break and the "safest" tiles are simply the two lowest ids in the hand — measured at 216 of
 * 216 quiet boards. That spends two of five slots on nothing, and it spends them at the manzu end
 * of the hand, which is where a dora is as likely to be as anywhere. A board with no threats on it
 * is one where the fastest tiles are the only candidates there are.
 */
function candidateUnion(view: SeatView, combined: DealInRisk[]): TileId[] {
  const held = heldTiles(view)
  const ranked = evaluateDiscards(view.hand, view.seen, view.sanma)
  const fast = ranked.slice(0, EV_FAST_CANDIDATES).map((option) => option.discard)
  const safe =
    view.threats.length === 0
      ? []
      : [...held]
          .sort((a, b) => combined[a].probability - combined[b].probability || a - b)
          .slice(0, EV_SAFE_CANDIDATES)
  const union = new Set([...fast, ...safe])
  // `evaluateDiscards` ranks by kind, so everything it names is held; the safe list came from the
  // hand itself. A hand with fewer distinct kinds than the union asks for just returns fewer.
  return held.filter((tile) => union.has(tile))
}

function heldTiles(view: SeatView): TileId[] {
  const held: TileId[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) if (view.hand.counts[id] > 0) held.push(id)
  return held
}

/**
 * The total order both rankings sort by: expected points, then the safer tile, **then the tile
 * that is not a dora**, then the lowest id.
 *
 * The dora step is not a preference the identity failed to price — it is what to do when the
 * identity has priced nothing at all. At the end of a hand that cannot reach tenpai, every term is
 * the same for every candidate: `soloWin` and `soloTenpai` are zero, `notWinning` is a constant,
 * and with nobody declared every deal-in term is zero too. Measured over 287 priced turns, **1.7%
 * end in an exact tie across every candidate** — and `a.tile - b.tile` then throws whatever sits
 * furthest toward 1m, which is how an `'ev'` seat came to hand a dora to a tenpai opponent on the
 * last discard of a hand it had already given up on.
 *
 * A dora is the right thing to keep on that tie for the reason the tie exists: the model has run
 * out of things to say, and holding the tile that is worth a han if the hand is somehow still
 * alive costs nothing when it isn't. It reads redness nowhere — the ranking is per kind, and
 * `round.ts#pickTile` already throws the plain copy of a pair first.
 *
 * `board.dora` is the indicators already resolved, so this is a set membership and not a scan.
 */
function byValue(dora: readonly TileId[]): (a: DiscardEv, b: DiscardEv) => number {
  const isDora = new Set(dora)
  return (a, b) =>
    b.ev - a.ev ||
    a.dealIn - b.dealIn ||
    Number(isDora.has(a.tile)) - Number(isDora.has(b.tile)) ||
    a.tile - b.tile
}

/**
 * Every term of the identity, for a hand that throws `tile` this turn — or, with `null`, throws
 * nothing at all and simply waits for its next draw.
 *
 * The `null` shape is what a decision that is not a discard is made of: passing on a call, and
 * declining a ron. Two differences, and no others. There is no immediate per-threat `'dealIn'`
 * term, because nothing was thrown. And the later-turn walk starts a turn earlier, from a hand
 * that has survived nothing yet rather than one that has survived the tile it just threw.
 *
 * **Both shapes cover exactly `board.drawsLeft` turns**, and it is worth writing down because it
 * reads like an off-by-one and is not. With a tile: one turn priced directly, then `drawsLeft − 1`
 * in the walk. Without: none priced directly, then `drawsLeft` in the walk, starting at an `alive`
 * already discounted by the board's tsumo chance. Same horizon; only the phase of the first hazard
 * differs, which is the honest difference between throwing now and not.
 *
 * The `'tenpai'` term is identical either way on purpose: its `(1 − tsumoChance) ** drawsLeft` is
 * how likely the *hand* reaches the exhaustive draw, a property of the board and not of what this
 * seat does with its turn.
 */
function evTerms(
  tile: TileId | null,
  view: SeatView,
  model: EvModel,
  value: Value,
  board: BoardCost,
  threats: readonly ThreatCost[],
  risks: readonly DealInRisk[][],
  combined: DealInRisk[],
  outlook: Outlook | undefined,
  notWinning: number,
): EvTerm[] {
  const terms: EvTerm[] = []
  const honba = view.match.honba * 300
  const win = outlook?.soloWin ?? 0
  // honba is *not* added here: `scoringRules` hands `view.match.honba` to the DP's own leaf and
  // `score.ts#computePayments` folds it into `payments.total`, so `Outlook.score` already carries
  // it. Adding it again paid the repeat counter twice — invisible until a hand is played at
  // honba > 0, which no seeded test ever was. Riichi sticks are the other way round: nothing in
  // `score.ts` knows about them, so they are collected exactly once, here.
  const winValue = value(
    conditionalWin(outlook, model.winValue(handShape(view), board)) +
      view.match.riichiSticks * RIICHI_STICK,
  )
  if (outlook) {
    terms.push({ kind: 'win', probability: win, value: winValue, points: win * winValue })
  }

  // this turn's throw, per threat, so an explanation can name which seat each cost belongs to
  const shares = tile === null ? [] : dealInShares(tile, threats, risks, combined)
  for (let j = 0; tile !== null && j < threats.length; j++) {
    const probability = shares[j]
    if (probability === 0) continue
    // the points go *to* that seat, which is worth naming under the placement objective: dealing
    // into the seat above you and dealing into the seat below you are the same points and are not
    // remotely the same decision
    const seat = view.threats[j].seat
    const cost = value(-(model.dealInCost(threats[j], board) + honba), seat)
    terms.push({ kind: 'dealIn', probability, value: cost, points: probability * cost, seat })
  }

  // and the turns after it. This turn's own tile is already priced above, so the walk starts one
  // turn in, with the hand having survived the tile it just threw
  // averaged over the threats, so no one seat is the recipient — the later turns are priced as a
  // loss to this seat and nothing more
  const loss = value(-dealInPrice(model, threats, board, honba))
  const alive =
    tile === null
      ? 1 - board.tsumoChance
      : (1 - combined[tile].probability) * (1 - board.tsumoChance)
  const later = laterCost(
    turnRisks('push', view, combined, board, board.drawsLeft - (tile === null ? 0 : 1)),
    board,
    loss,
    alive,
  )
  if (later.points !== 0) {
    terms.push({
      kind: 'danger',
      probability: later.probability,
      value: loss,
      points: later.points,
    })
  }

  const givenUp = value(notWinning)
  terms.push({
    kind: 'notWinning',
    probability: 1 - win,
    value: givenUp,
    points: (1 - win) * givenUp,
  })

  // `giveUpCost` ends on the noten penalty, which is right for the branch it is named after: a
  // hand that has stopped trying is noten by construction. A *pushing* hand that does not win may
  // still be tenpai when the wall runs out, and then it collects the penalty rather than paying
  // it — so the swing is the penalty twice over. This is `plans/EV-3` §2's
  // `P_exhaustive × tenpai_payment`, the one term of that identity the give-up price cannot carry.
  // `soloTenpai` is free off the same DP traversal `soloWin` comes from, and under advance-only a
  // hand that reaches tenpai stays there, so `soloTenpai − soloWin` is "tenpai at the end, having
  // not won". `reachesDraw` is `giveUpCost`'s own survival factor, restated so the two agree about
  // how likely the hand is to get to the draw at all.
  const stillTenpai = Math.max(0, (outlook?.soloTenpai ?? 0) - win)
  if (stillTenpai > 0) {
    const reachesDraw = (1 - board.tsumoChance) ** board.drawsLeft
    const swing = value(2 * NOTEN_PENALTY)
    const probability = stillTenpai * reachesDraw
    terms.push({ kind: 'tenpai', probability, value: swing, points: probability * swing })
  }

  return terms
}

/** One candidate discard, with every term written down. */
function price(
  tile: TileId,
  view: SeatView,
  model: EvModel,
  value: Value,
  board: BoardCost,
  threats: readonly ThreatCost[],
  risks: readonly DealInRisk[][],
  combined: DealInRisk[],
  outlook: Outlook | undefined,
  notWinning: number,
): DiscardEv {
  const terms = evTerms(
    tile,
    view,
    model,
    value,
    board,
    threats,
    risks,
    combined,
    outlook,
    notWinning,
  )
  return {
    tile,
    ev: terms.reduce((sum, term) => sum + term.points, 0),
    dealIn: combined[tile].probability,
    outlook,
    terms,
  }
}

/**
 * What this hand is worth *without acting on it* — the thirteen-tile branch: no tile leaves, the
 * seat simply waits for its next draw.
 *
 * It is the baseline every decision that is not a discard is measured against. Passing on a call
 * is this; declining a ron is this. `rankDiscards` cannot answer it — it needs the hand mid-turn,
 * and taking a tile out of thirteen leaves a twelve-tile hand the DP can never complete.
 */
function passEv(
  view: SeatView,
  opts: EvOptions,
): { ev: number; terms: EvTerm[]; outlook: Outlook } {
  const model = opts.model ?? STATISTICAL
  const value = valuer(view, model, opts.objective ?? 'points')
  const { board, threats, risks, combined } = context(view, model)
  const outlook = holdOutlook(view, board, opts)
  const terms = evTerms(
    null,
    view,
    model,
    value,
    board,
    threats,
    risks,
    combined,
    outlook,
    model.giveUpCost(threats, board),
  )
  return { ev: terms.reduce((sum, term) => sum + term.points, 0), terms, outlook }
}

/** The outlook for the thirteen-tile hand as it now stands. One call, shared by everything that
 *  prices a hand nobody is about to throw from. */
function holdOutlook(view: SeatView, board: BoardCost, opts: EvOptions): Outlook {
  return handOutlook(view.hand, view.seen, view.sanma, board.drawsLeft, {
    objective: 'score',
    maxShanten: opts.maxShanten,
    scoring: scoringContext(view),
  })
}

/**
 * The risk the hand faces on each of the turns still to come, under one of two policies — the
 * recursion `plans/EV-3` §5 asks for, and the reason it asks: the question a player has is not
 * "is this tile dangerous" but "is it more dangerous than the safest tile I will still be holding
 * in three turns", and only a *sequence* can answer that.
 *
 * `'push'` throws what the shape needs, priced at the average over the tiles the hand holds.
 * Pricing it at the tile going now is the trap — a hand that happens to have one genbutsu would
 * price its whole remaining life at zero, and a pushing hand spends that genbutsu once and then
 * throws whatever it has to.
 *
 * `'safe'` throws the safest tile available: the safest still in hand, or the one just drawn when
 * that is safer. The draw is what **replenishes** a folding hand, and it is why a held safe tile
 * is spent fractionally rather than one per turn — it goes only on the turns it is genuinely the
 * cheaper of the two. The sequence it produces is free while the genbutsu last and then settles at
 * whatever the unseen pool can keep supplying, which is where the published betaori figures
 * (3-5% a turn, `plans/EV-3` §5) come from and roughly where this lands.
 *
 * The one approximation inside it: the count of safe tiles left is carried as an expectation and
 * indexed by its floor, rather than the model branching on which tile was actually thrown. That
 * would be a tree with a node per turn per tile, for a distinction the sorted profile already
 * smooths over.
 */
function turnRisks(
  policy: 'push' | 'safe',
  view: SeatView,
  combined: DealInRisk[],
  board: BoardCost,
  turns: number,
): number[] {
  const held = heldTiles(view)
  if (held.length === 0 || turns <= 0) return []

  if (policy === 'push') {
    let total = 0
    for (const tile of held) total += combined[tile].probability
    return Array<number>(turns).fill(total / held.length)
  }

  const profile = held.map((tile) => combined[tile].probability).sort((a, b) => a - b)
  let pool = 0
  for (let id = 0; id < NUM_TILE_TYPES; id++) pool += board.unseen[id]

  const risks: number[] = []
  let spent = 0
  for (let turn = 0; turn < turns; turn++) {
    const inHand = profile[Math.min(Math.floor(spent), profile.length - 1)]
    if (pool === 0) {
      risks.push(inHand)
      spent++
      continue
    }
    let thrown = 0
    let spends = 0
    for (let id = 0; id < NUM_TILE_TYPES; id++) {
      const copies = board.unseen[id]
      if (copies === 0) continue
      const share = copies / pool
      const drawn = combined[id].probability
      thrown += share * Math.min(inHand, drawn)
      if (drawn >= inHand) spends += share
    }
    risks.push(thrown)
    spent += spends
  }
  return risks
}

/**
 * What a sequence of per-turn risks costs, discounted by the chance the hand is still going: a
 * threat that tsumos, or a deal-in that has already happened, ends it.
 *
 * `alive` is how likely the hand is to reach the first turn of the sequence, which is 1 for a
 * fold priced from this turn and less for a push whose own throw has already been charged. `loss`
 * arrives already valued under the objective — negative, because it is a loss.
 */
function laterCost(
  risks: readonly number[],
  board: BoardCost,
  loss: number,
  alive = 1,
): { probability: number; points: number; terms: EvTerm[] } {
  let probability = 0
  const terms: EvTerm[] = []
  for (const risk of risks) {
    const reached = alive * risk
    if (reached !== 0) {
      terms.push({ kind: 'dealIn', probability: reached, value: loss, points: reached * loss })
    }
    probability += reached
    alive *= (1 - risk) * (1 - board.tsumoChance)
  }
  return { probability, points: probability * loss, terms }
}

/** What one deal-in costs, averaged over the threats on the board, honba included. Shared by both
 *  branches on purpose: a push and a fold that disagreed about what dealing in costs would not be
 *  comparable at all. */
function dealInPrice(
  model: EvModel,
  threats: readonly ThreatCost[],
  board: BoardCost,
  honba: number,
): number {
  if (threats.length === 0) return 0
  let cost = 0
  for (const threat of threats) cost += model.dealInCost(threat, board) + honba
  return cost / threats.length
}

/**
 * Every held tile's fold price: throw this one now, then betaori for the rest of the hand.
 *
 * `foldEv` below prices the fold *policy* and returns one `DiscardEv` for whichever tile happens to
 * be safest — enough for the push/fold comparison, which only ever needs the branch's own value.
 * A grader needs the branch priced **per candidate**, which this is: the same per-threat immediate
 * term `evTerms` prices for the push branch (naming which seat each cost belongs to), then the same
 * later-turn walk `foldEv` runs — `laterCost` over `turnRisks('safe', …)` — starting one turn in
 * with the hand already discounted by *this* tile's own risk, exactly the push branch's `alive`.
 *
 * **No win term and no `'tenpai'` term.** A hand that has folded is noten by construction — that is
 * exactly what `giveUpCost` already prices — so no DP runs and this is milliseconds, not the DP's
 * cost per candidate `rankDiscards` pays.
 *
 * **Stated ceiling: the later-turn walk is the same for every candidate.** `turnRisks` is handed
 * `view` unchanged, so the sequence it produces is the profile of the *whole* hand rather than of
 * the hand minus the tile about to leave it; the candidates differ only through `alive`, which is
 * this tile's own survival. That makes "will I still have a safe tile in three turns" — the
 * question this module's own header says the turn-by-turn integration exists to answer —
 * invisible to a grader reading these numbers. Spending the hand's last genbutsu now and spending
 * its most dangerous tile now leave the same priced future.
 *
 * Fixing it means re-running `turnRisks` per candidate against the thirteen tiles left, which is
 * cheap (no DP) but moves every fold grade, so it wants its own change and its own re-measured
 * `FOLD_EV_BANDS`. Until then this understates the cost of throwing a scarce safe tile early.
 *
 * This is the number the folding trainer grades against (`plans/EV-5` §2.5/§2.8): the drill's own
 * context is full fold, so the fold branch is the whole answer, and reading it from here rather
 * than writing a second formula is what keeps a model change move the trainer's grades with it —
 * `houou`'s empirical tables have no closed form a trainer could otherwise approximate.
 */
export function foldRanking(view: SeatView, opts: EvOptions = {}): DiscardEv[] {
  const model = opts.model ?? STATISTICAL
  const value = valuer(view, model, opts.objective ?? 'points')
  const { board, threats, risks, combined } = context(view, model)
  const honba = view.match.honba * 300
  const notWinning = value(model.giveUpCost(threats, board))
  const loss = value(-dealInPrice(model, threats, board, honba))

  const priced = heldTiles(view).map((tile) => {
    const terms: EvTerm[] = []
    const shares = dealInShares(tile, threats, risks, combined)
    for (let j = 0; j < threats.length; j++) {
      const probability = shares[j]
      if (probability === 0) continue
      const seat = view.threats[j].seat
      const cost = value(-(model.dealInCost(threats[j], board) + honba), seat)
      terms.push({ kind: 'dealIn', probability, value: cost, points: probability * cost, seat })
    }

    const alive = (1 - combined[tile].probability) * (1 - board.tsumoChance)
    const later = laterCost(
      turnRisks('safe', view, combined, board, board.drawsLeft - 1),
      board,
      loss,
      alive,
    )
    if (later.points !== 0) {
      terms.push({
        kind: 'danger',
        probability: later.probability,
        value: loss,
        points: later.points,
      })
    }

    terms.push({ kind: 'notWinning', probability: 1, value: notWinning, points: notWinning })

    return {
      tile,
      ev: terms.reduce((sum, term) => sum + term.points, 0),
      dealIn: combined[tile].probability,
      terms,
    }
  })

  // same total order `rankDiscards` sorts by — never sort stability
  priced.sort(byValue(board.dora))
  return priced
}

/**
 * The fold branch: give up on the hand and stay safe for the rest of it.
 *
 * A folding hand does not throw one tile, it throws every tile it has left and every tile it draws
 * on the way, so the price is the whole sequence — `turnRisks('safe')` walks it, spending the
 * hand's own safe tiles only on the turns they beat the draw. That replenishment is the half
 * `plans/EV-3` §5 named as the largest unbuilt piece of this design; without it a long fold was
 * priced as a hand that runs out of genbutsu and then throws its worst tile every turn to the end.
 *
 * The turn-by-turn terms are kept rather than collapsed into one: "these turns are free and then
 * it costs about this much each" is the shape of the answer, not a footnote to it.
 */
export function foldEv(view: SeatView, opts: EvOptions = {}): DiscardEv {
  const model = opts.model ?? STATISTICAL
  const value = valuer(view, model, opts.objective ?? 'points')
  const { board, threats, combined } = context(view, model)
  const loss = value(-dealInPrice(model, threats, board, view.match.honba * 300))

  const risks = turnRisks('safe', view, combined, board, board.drawsLeft)
  const { terms } = laterCost(risks, board, loss)

  const notWinning = value(model.giveUpCost(threats, board))
  terms.push({ kind: 'notWinning', probability: 1, value: notWinning, points: notWinning })

  // the tile it throws *now* is still the safest one in hand: the sequence above says what the
  // rest of the fold costs, not which tile leads it
  const safest = heldTiles(view).sort(
    (a, b) => combined[a].probability - combined[b].probability || a - b,
  )
  const tile = safest[0] ?? 0
  return {
    tile,
    ev: terms.reduce((sum, term) => sum + term.points, 0),
    dealIn: combined[tile]?.probability ?? 0,
    terms,
  }
}

/** What a swing of `delta` points is worth to the deciding seat. `to` names the seat the points
 *  move *to*, when there is one — under placement that is half the answer, and under points it
 *  makes no difference at all. */
type Value = (delta: number, to?: number) => number

/**
 * The one place the objective enters, and the reason it is one place: every term of the identity
 * is a probability times a value, so a different currency is a different `Value` and nothing else.
 *
 * `'points'` is the identity function. `'placement'` asks the model how much every seat's score
 * still has to move (`EvModel.swing`), integrates the seats against each other for rank odds, and
 * returns the change in expected Tenhou result the swing buys (`core/placement.ts`). That is
 * non-linear in a way points is not: the same eight thousand points is worth more to a seat that
 * is one hand short of third than to one already comfortable, which is what makes a placement seat
 * push a hand a points seat folds.
 *
 * The integral is rebuilt per call rather than cached against `delta`, because a swing big enough
 * to matter is usually a swing big enough to move somebody's rank, and the model's own table is
 * indexed by rank.
 */
function valuer(view: SeatView, model: EvModel, objective: EvObjective): Value {
  if (objective === 'points') return (delta) => delta

  const scores = view.match.points
  const round = roundIndex(view.match, view.sanma)
  const rules = scoringRules(view)
  const resultAt = (points: readonly number[]): number => {
    const rank = ranks(points)
    const swings = points.map((_, seat) => model.swing(rank[seat], round, rules))
    return expectedResult(points, swings, view.seat, view.sanma)
  }

  const base = resultAt(scores)
  return (delta, to) => {
    const next = [...scores]
    next[view.seat] += delta
    if (to !== undefined && to !== view.seat && next[to] !== undefined) next[to] -= delta
    return resultAt(next) - base
  }
}

/** Everything a decision reads off the board, computed once: the deal-in risks under this model's
 *  own prior, their union, and the cost context the model prices against. */
function context(
  view: SeatView,
  model: EvModel,
): { board: BoardCost; threats: ThreatCost[]; risks: DealInRisk[][]; combined: DealInRisk[] } {
  const players = view.sanma ? 3 : 4
  const unseen = new Uint8Array(NUM_TILE_TYPES)
  let pool = 0
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    unseen[id] = inTileSet(id, view.sanma) ? Math.max(0, TILES_PER_KIND - view.seen[id]) : 0
    pool += unseen[id]
  }
  const risks = view.threats.map((threat) => dealInRisk(threat, view.seen, view.sanma, model.prior))
  return {
    board: {
      dealer: view.dealer,
      turn: view.turn,
      drawsLeft: Math.floor(view.wallLeft / players),
      rules: scoringRules(view),
      unseen,
      dora: view.doraIndicators.map((indicator) => doraFromIndicator(indicator.id)),
      tsumoChance: tsumoChance(risks, unseen, pool),
    },
    threats: threatCosts(view),
    risks,
    combined: combineThreats(risks),
  }
}

/**
 * P(some threat draws one of its own waits, this turn).
 *
 * Derived from the same hypothesis weights the deal-in model runs on, rather than looked up: the
 * expected number of unseen copies of a threat's waits is `Σ_t P(t is a wait) × unseen[t]`, and
 * the chance their next draw is one of them is that over the pool. Threats are combined as a union.
 */
export function tsumoChance(
  risks: readonly DealInRisk[][],
  unseen: Uint8Array,
  pool: number,
): number {
  if (pool === 0) return 0
  let safe = 1
  for (const perThreat of risks) {
    let copies = 0
    for (let id = 0; id < NUM_TILE_TYPES; id++) copies += perThreat[id].probability * unseen[id]
    safe *= 1 - Math.min(1, copies / pool)
  }
  return 1 - safe
}

function threatCosts(view: SeatView): ThreatCost[] {
  return view.threats.map((threat) => ({
    dealer: threat.seat === view.match.dealer,
    riichiTurn: threat.riichiTurn,
  }))
}

function scoringRules(view: SeatView): ScoringRules {
  return { kiriageMangan: view.kiriageMangan, honba: view.match.honba, sanma: view.sanma }
}

function scoringContext(view: SeatView): ScoringContext {
  return {
    round: view.prevalentWind,
    seat: view.seatWind,
    doraIndicators: view.doraIndicators.map((tile) => tile.id),
    rules: scoringRules(view),
    melds: [...view.melds],
    kita: view.nuki,
  }
}
