import type { SeatView } from './algorithm'
import { combineThreats, dealInRisk, type DealInRisk } from './dealIn'
import { evaluateDiscards } from './efficiency'
import { tileCount } from './hand'
import { STATISTICAL, type BoardCost, type EvModel, type ThreatCost } from './evModel'
import { discardOutlooks, handOutlook, type Outlook, type ScoringContext } from './probability'
import type { ScoringRules } from './score'
import { HONOR, inTileSet, NUM_TILE_TYPES, type TileId } from './tiles'
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
 * **Three ceilings, all of them stated rather than hidden.** The push side prices its own later
 * turns by assuming the hand keeps throwing tiles about as dangerous as this one — the honest
 * version re-solves the hand every turn, which is `plans/EV-3` §5's unbuilt multi-turn recursion.
 * A folding hand's safe tiles are spent cheapest-first and never replenished, so a long fold is
 * priced pessimistically. And the win value comes from an advance-only DP that understates
 * (`plans/EV-1` §6), which biases the whole comparison toward folding.
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

  // and the turns after it, at what a hand that keeps pushing actually throws — not at this
  // tile's own danger, which would make a hand that spends one genbutsu look safe for the rest of
  // the hand it has not yet played
  const perTurn = pushingDanger(view, combined)
  const later = laterDanger(perTurn, board, threats, model, honba)
  if (later !== 0) {
    terms.push({
      kind: 'danger',
      probability: perTurn,
      value: later / Math.max(perTurn, Number.EPSILON),
      points: later,
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
 * How dangerous a turn is for a hand that keeps pushing: the average over every tile it holds.
 *
 * Not the tile being thrown right now, which is the trap — a hand that happens to have one
 * genbutsu would otherwise price its whole remaining life at zero, and a pushing hand spends that
 * genbutsu once and then throws whatever its shape needs. Averaging over the hand is the cheap
 * stand-in for "what will this hand be throwing three turns from now", and it is the half
 * `plans/EV-3` §5 wants replaced by a real recursion.
 */
function pushingDanger(view: SeatView, combined: DealInRisk[]): number {
  const held = heldTiles(view)
  if (held.length === 0) return 0
  let total = 0
  for (const tile of held) total += combined[tile].probability
  return total / held.length
}

/**
 * What the turns after this one cost, at that level of danger.
 *
 * Each later turn is discounted by the chance the hand is still going: a threat that tsumos, or a
 * deal-in that has already happened, ends it.
 */
function laterDanger(
  perTurn: number,
  board: BoardCost,
  threats: readonly ThreatCost[],
  model: EvModel,
  honba: number,
): number {
  if (threats.length === 0 || perTurn === 0) return 0
  let cost = 0
  for (const threat of threats) cost += model.dealInCost(threat, board) + honba
  cost /= threats.length

  let total = 0
  let alive = 1 - perTurn
  for (let turn = 1; turn < board.drawsLeft; turn++) {
    alive *= 1 - board.tsumoChance
    total -= alive * perTurn * cost
    alive *= 1 - perTurn
  }
  return total
}

/**
 * The fold branch: give up on the hand and spend the safe tiles, cheapest first.
 *
 * A folding hand does not throw one tile, it throws every tile it has left, so the price is the
 * whole sequence — which is the question a player actually faces (`plans/EV-3` §5: not "is this
 * tile safe" but "can I stay safe for the rest of the hand"). Safe tiles are never replenished
 * here, and a real hand draws more of them, so a long fold is priced pessimistically.
 */
export function foldEv(view: SeatView, opts: EvOptions = {}): DiscardEv {
  const model = opts.model ?? STATISTICAL
  const { board, threats, combined } = context(view, model)
  const honba = view.match.honba * 300

  const safest = heldTiles(view).sort(
    (a, b) => combined[a].probability - combined[b].probability || a - b,
  )
  let cost = 0
  for (const threat of threats) cost += model.dealInCost(threat, board) + honba
  cost /= Math.max(threats.length, 1)

  const terms: EvTerm[] = []
  let alive = 1
  for (let turn = 0; turn < board.drawsLeft; turn++) {
    // out of safe tiles: keep throwing the least bad one still named
    const tile = safest[Math.min(turn, safest.length - 1)]
    if (tile === undefined) break
    const probability = combined[tile].probability
    const points = -alive * probability * cost
    if (points !== 0) {
      terms.push({ kind: 'dealIn', probability: alive * probability, value: -cost, points })
    }
    alive *= (1 - probability) * (1 - board.tsumoChance)
  }
  const notWinning = model.giveUpCost(threats, board)
  terms.push({ kind: 'notWinning', probability: 1, value: notWinning, points: notWinning })

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
      dora: view.doraIndicators.map((indicator) => nextTile(indicator.id)),
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

/** The dora an indicator points at: the next tile in its own cycle, wrapping inside the suit, the
 *  four winds and the three dragons. */
function nextTile(indicator: TileId): TileId {
  if (indicator < HONOR) {
    const suit = Math.floor(indicator / 9) * 9
    return suit + ((indicator - suit + 1) % 9)
  }
  const winds = HONOR + 4
  if (indicator < winds) return HONOR + ((indicator - HONOR + 1) % 4)
  return winds + ((indicator - winds + 1) % 3)
}
