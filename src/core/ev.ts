import type { SeatView } from './algorithm'
import { combineThreats, dealInRisk, type DealInRisk } from './dealIn'
import { evaluateDiscards } from './efficiency'
import { tileCount } from './hand'
import { STATISTICAL, type BoardCost, type EvModel, type ThreatCost } from './evModel'
import { discardOutlooks, handOutlook, type Outlook, type ScoringContext } from './probability'
import type { ScoringRules } from './score'
import { doraFromIndicator, inTileSet, NUM_TILE_TYPES, type TileId } from './tiles'
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
 * Everything here is points. Placement is a switch this layer is shaped for and does not yet
 * carry: the identity stays linear in a per-outcome value function, so swapping points for
 * placement utility is a substitution at one seam rather than a rewrite (`plans/EV-3` §8).
 */

/** One line of the arithmetic, in the shape a reader can check: how often, times how much. */
export interface EvTerm {
  kind: 'win' | 'dealIn' | 'danger' | 'notWinning'
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

export interface EvOptions {
  model?: EvModel
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
    price(tile, view, model, board, threats, risks, combined, outlooks.get(tile), notWinning),
  )
  // total order: expected points, then the safer tile, then the lower id — never sort stability
  priced.sort((a, b) => b.ev - a.ev || a.dealIn - b.dealIn || a.tile - b.tile)
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
  const { board } = context(view, model)
  // the thirteen-tile hand as it now stands: this is asked *after* the discard, so there is
  // nothing left to choose and nothing to rank — asking `rankDiscards` here would take a tile out
  // of a hand that has already thrown one, and a twelve-tile hand can never complete
  const outlook = handOutlook(view.hand, view.seen, view.sanma, board.drawsLeft, {
    objective: 'score',
    maxShanten: opts.maxShanten,
    scoring: scoringContext(view),
  })
  const value = outlook.score ?? 0
  return outlook.soloWin * (model.riichiUplift(value, board) + RIICHI_STICK) > RIICHI_STICK
}

/**
 * What playing this hand out is worth, both branches weighed: the better of the best push and the
 * fold. Exported because it is what an abort decision is made of, and a screen showing the decision
 * has to be able to show the number it compared.
 *
 * Needs the fourteen-tile hand, for `rankDiscards`' reason.
 */
export function keepEv(view: SeatView, opts: EvOptions = {}): number {
  const push = rankDiscards(view, opts)[0]
  const fold = foldEv(view, opts)
  return push ? Math.max(push.ev, fold.ev) : fold.ev
}

/**
 * Whether to take the abortive draw on a kyuushu kyuuhai hand, priced through the same identity.
 *
 * `EV(abort)` is **zero**. Under the ruleset this engine pins (Tenhou practice: a ryuukyoku with
 * honba +1 and the dealership rotating) nobody pays and nobody collects, so the whole decision is
 * whether playing the hand out is worth more than nothing.
 *
 * **Two ceilings, both stated rather than hidden.** A hand with nine distinct terminals and honours
 * is four or more shanten, which is above `probability.ts`' exact ceiling — the collapsed chain
 * runs and prices *no win value at all*, so `EV(keep)` is dominated by the give-up term and comes
 * out negative for almost every legal kyuushu hand. That is close to how the hand is really played,
 * but it is arithmetic rather than a judgement, and it stops being one only when the win side can
 * price a 4-shanten hand. And a dealer that aborts gives up a dealership the points objective
 * cannot price at all, because nothing in this engine sequences to a next round (ADR-0023).
 */
export function abortWorthIt(view: SeatView, opts: EvOptions = {}): boolean {
  return keepEv(view, opts) < 0
}

/** The tiles worth pricing: the fastest few, plus the safest few. Duplicates collapse, so a tile
 *  that is both is counted once and the union is usually smaller than the sum. */
function candidateUnion(view: SeatView, combined: DealInRisk[]): TileId[] {
  const held = heldTiles(view)
  const ranked = evaluateDiscards(view.hand, view.seen, view.sanma)
  const fast = ranked.slice(0, EV_FAST_CANDIDATES).map((option) => option.discard)
  const safe = [...held]
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

/** One candidate, with every term written down. */
function price(
  tile: TileId,
  view: SeatView,
  model: EvModel,
  board: BoardCost,
  threats: readonly ThreatCost[],
  risks: readonly DealInRisk[][],
  combined: DealInRisk[],
  outlook: Outlook | undefined,
  notWinning: number,
): DiscardEv {
  const terms: EvTerm[] = []
  const honba = view.match.honba * 300
  const win = outlook?.soloWin ?? 0
  const winValue = (outlook?.score ?? 0) + honba + view.match.riichiSticks * RIICHI_STICK
  if (outlook) {
    terms.push({ kind: 'win', probability: win, value: winValue, points: win * winValue })
  }

  // this turn's throw, per threat, so an explanation can name which seat each cost belongs to
  for (let j = 0; j < threats.length; j++) {
    const probability = risks[j][tile].probability
    if (probability === 0) continue
    const value = -(model.dealInCost(threats[j], board) + honba)
    terms.push({
      kind: 'dealIn',
      probability,
      value,
      points: probability * value,
      seat: view.threats[j].seat,
    })
  }

  // and the turns after it. This turn's own tile is already priced above, so the walk starts one
  // turn in, with the hand having survived the tile it just threw
  const cost = dealInPrice(model, threats, board, honba)
  const alive = (1 - combined[tile].probability) * (1 - board.tsumoChance)
  const later = laterCost(
    turnRisks('push', view, combined, board, board.drawsLeft - 1),
    board,
    cost,
    alive,
  )
  if (later.points !== 0) {
    terms.push({
      kind: 'danger',
      probability: later.probability,
      value: -cost,
      points: later.points,
    })
  }

  terms.push({
    kind: 'notWinning',
    probability: 1 - win,
    value: notWinning,
    points: (1 - win) * notWinning,
  })

  return {
    tile,
    ev: terms.reduce((sum, term) => sum + term.points, 0),
    dealIn: combined[tile].probability,
    outlook,
    terms,
  }
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
 * fold priced from this turn and less for a push whose own throw has already been charged.
 */
function laterCost(
  risks: readonly number[],
  board: BoardCost,
  cost: number,
  alive = 1,
): { probability: number; points: number; terms: EvTerm[] } {
  let probability = 0
  const terms: EvTerm[] = []
  for (const risk of risks) {
    const reached = alive * risk
    if (reached !== 0) {
      terms.push({ kind: 'dealIn', probability: reached, value: -cost, points: -reached * cost })
    }
    probability += reached
    alive *= (1 - risk) * (1 - board.tsumoChance)
  }
  return { probability, points: -probability * cost, terms }
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
  const { board, threats, combined } = context(view, model)
  const cost = dealInPrice(model, threats, board, view.match.honba * 300)

  const risks = turnRisks('safe', view, combined, board, board.drawsLeft)
  const { terms } = laterCost(risks, board, cost)

  const notWinning = model.giveUpCost(threats, board)
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
  return { kiriageMangan: false, honba: view.match.honba, sanma: view.sanma }
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
