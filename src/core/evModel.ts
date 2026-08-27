import { UNIFORM_PRIOR, type ShapePrior } from './dealIn'
import { HOUOU_FOLD_COST, HOUOU_HAND_SCORE, HOUOU_PRIOR } from './hououPrior'
import { ronValue, type ScoringRules } from './score'
import { NUM_TILE_TYPES, type TileId } from './tiles'

/**
 * The swappable weight unit of the EV model: how a seat estimates the costs the push/fold identity
 * is built out of.
 *
 * Two of them ship, and the rule between them is that **neither may borrow a number from the
 * other**. `statistical` derives every figure from combinatorics a reader can check on paper;
 * `houou` reads every figure off measurements taken over the same database. A mixed answer — a
 * measured fold price against a derived deal-in cost — would be a third model nobody chose, and
 * its terms would not decompose into anything a lab could show side by side.
 *
 * What is *not* in here: probabilities. `dealIn.ts` and `probability.ts` compute those, and the
 * only weight either takes is `prior`. Table status is not in here either — points, placement and
 * honba are decision-layer input (`plans/EV-3` §8), so an evaluation does not change when the score
 * does, which is what keeps two models comparable on one board.
 */
export type EvModelName = 'statistical' | 'houou'

/** One declared seat, as the cost functions need it. */
export interface ThreatCost {
  /** Whether that seat is the dealer this hand — a dealer's hand pays half again as much. */
  dealer: boolean
  /** The turn they declared on, if it is known (`ThreatView.riichiTurn`). */
  riichiTurn?: number
}

/** Everything about the board a cost function may read. Deliberately not `SeatView`: a model
 *  prices costs, it does not make decisions, so it never sees a hand. */
export interface BoardCost {
  /** Whether the seat doing the deciding is the dealer. */
  dealer: boolean
  /** Turn now, on the same go-around counter `RoundState.turn` uses. */
  turn: number
  /** Draws this seat has left before the wall runs out. */
  drawsLeft: number
  rules: ScoringRules
  /** The unseen pool, 34 counts — what nobody at this seat can account for. */
  unseen: Uint8Array
  /** Dora *kinds* in play, indicators already resolved. */
  dora: readonly TileId[]
  /** P(some threat completes on their own draw, this turn). Board combinatorics rather than a
   *  model weight — `ev.ts` derives it the same way for both models, off each one's own risks. */
  tsumoChance: number
}

export interface EvModel {
  readonly name: EvModelName
  /** The wait-shape prior `dealInRisk` runs under. */
  readonly prior: ShapePrior
  /** Points a ron by this threat costs the discarder — `plans/EV-3` §4's `value_j`. */
  dealInCost(threat: ThreatCost, board: BoardCost): number
  /**
   * Points lost over the rest of the hand by giving up on it: opponents' tsumo payments plus the
   * noten penalty. **Deal-ins are not in here** — they are priced per turn against the tile
   * actually thrown, and adding them twice is the easiest mistake this interface can invite.
   * Negative, because it is a loss.
   */
  giveUpCost(threats: readonly ThreatCost[], board: BoardCost): number
  /**
   * Points declaring riichi adds to a hand already worth `handValue` when it wins — ippatsu, ura
   * and riichi's own han. The stick it costs is not in here: that is the decision layer's
   * arithmetic, and it is paid whether or not the hand wins.
   */
  riichiUplift(handValue: number, board: BoardCost): number
  /** `null` when the model may speak about this ruleset, else the reason it may not — which the UI
   *  must show rather than swapping models silently (`plans/EV-5` §2.11). */
  unsupported(sanma: boolean): string | null
}

/** Fu of a closed ron, stated rather than derived: fu needs the shape, and the defence model knows
 *  only the wait. 30 is the overwhelming mode for a riichi hand (20 base + 10 menzen ron), and it
 *  is here in one visible place so it is tuned here and never scattered — the `TIER_SCORE`
 *  precedent in `danger.ts`. */
const CLOSED_RON_FU = 30

/**
 * Han a closed tenpai hand carries beyond riichi itself, before dora and ura.
 *
 * **Stated, not derived, and it is the one place this model cannot be pure.** Hand value comes
 * from choices, not from tiles: a player declares riichi on a hand they built, so its yaku are
 * selected rather than sampled. Pricing an opponent's hand as fourteen tiles drawn at random from
 * the unseen pool says tanyao happens in 0.03% of hands, against the fifth or so of real ones —
 * combinatorics has no way to see a decision that was already taken.
 *
 * So one han is stated for it, on the reasoning that most closed tenpai hands carry exactly one of
 * pinfu, tanyao or a yakuhai. It is here beside the other stated constants rather than folded into
 * the arithmetic, and it is why the derived deal-in cost still lands **around half** what the
 * measured one does: real riichi hands also hold more dora than a random fourteen tiles would,
 * for exactly the same reason, and no constant this model is allowed to state can recover that.
 * The two models disagreeing about what a deal-in costs is a real difference between them, not a
 * bug in either — and the direction is known: the pure model prices opponents cheap, so it pushes
 * where the measured one folds.
 */
const TYPICAL_CLOSED_YAKU_HAN = 1

/** What a noten seat pays at an exhaustive draw. The real figure is 1000/1500/3000 by how many
 *  seats are tenpai; 1500 is the two-tenpai middle and the stated choice. */
const NOTEN_PENALTY = 1500

/** Below this many hands behind a measured cell, the houou model looks for a neighbouring turn
 *  instead. Some cells in the fold table hold two hands. */
const MIN_SAMPLES = 100

/** Tiles a threat's completed hand holds — thirteen plus the winning one. Used only to turn a
 *  per-tile dora probability into an expected count. */
const WINNING_HAND_SIZE = 14

/**
 * The pure model: every number derived from the tiles nobody has seen, with nothing measured and
 * nothing typed in beyond the two stated constants above.
 *
 * It is compatible with every ruleset by construction, which is the other half of why it is the
 * default: it has no domain to fall outside of.
 */
export const STATISTICAL: EvModel = {
  name: 'statistical',
  prior: UNIFORM_PRIOR,

  /**
   * A riichi hand priced from first principles: one han for the riichi itself, one stated han for
   * the yaku it was built around (`TYPICAL_CLOSED_YAKU_HAN`, and read that constant's note before
   * trusting this number), plus however many dora and ura the unseen pool says it is likely to be
   * holding, at a closed ron's 30 fu.
   *
   * The dora term is availability — a hand of fourteen tiles drawn from the unseen pool holds
   * `14 × (dora copies unseen / pool)` of them in expectation. The ura term is the same
   * calculation with the indicator unknown: an ura indicator points at one kind out of the
   * thirty-four with no reason to prefer any, so each tile in their hand is ura with probability
   * `1/34`.
   *
   * The expectation is taken over the **han distribution**, not over the mean han: the value of a
   * hand is convex in han (a mangan cap on one side, doubling on the other), so pricing the
   * average han would understate what an average hand costs.
   *
   * Not modelled, all of them pushing the real figure up: ippatsu, a second yaku, and any hand
   * whose shape is worth more than 30 fu.
   */
  dealInCost(threat, board) {
    let pool = 0
    for (let id = 0; id < NUM_TILE_TYPES; id++) pool += board.unseen[id]
    if (pool === 0) return 0
    let doraCopies = 0
    for (const tile of board.dora) doraCopies += board.unseen[tile]
    const perTile = doraCopies / pool + 1 / NUM_TILE_TYPES

    let value = 0
    for (let extra = 0; extra <= WINNING_HAND_SIZE; extra++) {
      const weight = binomial(WINNING_HAND_SIZE, extra, perTile)
      if (weight === 0) continue
      value +=
        weight *
        ronValue(
          1 + TYPICAL_CLOSED_YAKU_HAN + extra,
          CLOSED_RON_FU,
          threat.dealer,
          board.rules,
        )
    }
    return value
  },

  /**
   * What the rest of the hand costs a seat that has stopped trying to win: every turn somebody
   * else might draw their tile, and if nobody does, the hand ends and a noten seat pays.
   *
   * Both halves are combinatorics. `tsumoChance` is the chance a threat draws one of its own waits
   * this turn, derived by `ev.ts` from this model's own hypothesis weights; surviving `k` turns is
   * that chance not happening `k` times. What a tsumo costs is the same derived hand value split
   * the way the rules split it — a dealer's tsumo takes a third from each of us, a non-dealer's
   * takes a quarter from the two of us who are not the dealer and half from the one who is.
   */
  giveUpCost(threats, board) {
    if (threats.length === 0) return -NOTEN_PENALTY
    const perTurn = board.tsumoChance
    let cost = 0
    let alive = 1
    // one threat's tsumo ends the hand for everybody, so the average cost of the turn it happens
    // on is the average over who it might be
    let share = 0
    for (const threat of threats) {
      share += tsumoShare(this.dealInCost(threat, board), threat.dealer, board.dealer, board.rules)
    }
    share /= threats.length

    for (let turn = 0; turn < board.drawsLeft; turn++) {
      cost -= alive * perTurn * share
      alive *= 1 - perTurn
    }
    return cost - alive * NOTEN_PENALTY
  },

  /**
   * Riichi is worth its own han plus whatever the ura indicator turns out to say, and a hand's
   * value doubles per han — so declaring multiplies rather than adds.
   *
   * The ura term is the same argument the deal-in cost makes: the indicator points at one kind out
   * of the thirty-four with no reason to prefer any, so a fourteen-tile hand holds `14/34` of a han
   * in expectation. Ippatsu is **not** modelled, which understates: it needs the timing of the win
   * and this model has none.
   *
   * Doubling is exact below the limit brackets and too generous at them, since a hand already near
   * mangan cannot double. `handValue` arrives as an expectation over many completions rather than
   * one scored hand, so applying a bracket to it would be its own error — the multiplication is
   * the stated approximation of the two.
   */
  riichiUplift(handValue) {
    const han = 1 + WINNING_HAND_SIZE / NUM_TILE_TYPES
    return handValue * (2 ** han - 1)
  },

  unsupported: () => null,
}

/**
 * The measured model: every number read off Tenhou houou logs, from the tables
 * `scripts/build-ev-models.mjs` extracts.
 *
 * Its domain is those logs, so it declares one incompatibility: the database is four-player, and
 * there is no three-player wait distribution or fold cost in it (`plans/EV-5` §2.11).
 */
export const HOUOU: EvModel = {
  name: 'houou',
  prior: HOUOU_PRIOR,

  /**
   * What a riichi hand actually paid, by the turn it was declared on and by whether the declarer
   * was the dealer. Real wins off real logs, so ura, dora and ippatsu are already inside the
   * number rather than being modelled on top of it.
   *
   * A threat whose declaration turn is unknown is priced at the turn being asked about — later
   * than the truth, and the table rises with the turn, so that reading is the pessimistic one.
   */
  dealInCost(threat, board) {
    const table = threat.dealer ? HOUOU_HAND_SCORE.dealer : HOUOU_HAND_SCORE.nonDealer
    const turn = clamp(threat.riichiTurn ?? board.turn, 0, table.ron.length - 1)
    return nearestSample(table.ron, table.ronSamples, turn) ?? 0
  },

  /**
   * What giving up actually cost, measured: opponents' tsumo payments plus the noten penalty, over
   * the rest of the hand, for a seat that neither won nor dealt in.
   *
   * The matchup key is who is threatening whom — `D vs ND ND` is the dealer folding against two
   * non-dealer riichi. The table samples every second turn, and some of its cells hold a handful
   * of hands, so a thin cell falls back to the nearest turn that is not thin.
   */
  giveUpCost(threats, board) {
    if (threats.length === 0) return -NOTEN_PENALTY
    const key = matchupKey(board.dealer, threats)
    if (key === null) return -NOTEN_PENALTY
    const cost = HOUOU_FOLD_COST.cost[key]
    const samples = HOUOU_FOLD_COST.samples[key]
    const turns = HOUOU_FOLD_COST.turns
    let nearest = 0
    for (let i = 1; i < turns.length; i++) {
      if (Math.abs(turns[i] - board.turn) < Math.abs(turns[nearest] - board.turn)) nearest = i
    }
    return nearestSample(cost, samples, nearest) ?? -NOTEN_PENALTY
  },

  /**
   * What declaring was measured to be worth: the gap between a riichi hand's average win and a
   * dama hand's, at the same turn and dealership.
   *
   * It is an absolute number of points rather than a multiplier, and it is a **difference between
   * two populations, not the same hand priced twice** — a hand that stays dama needs a yaku of its
   * own, so the dama sample is pre-selected for value and the gap understates what declaring does
   * to a given hand. Read it as the measured answer to "how much better off is a seat that
   * declared", which is the question this table can actually answer.
   */
  riichiUplift(_handValue, board) {
    const table = board.dealer ? HOUOU_HAND_SCORE.dealer : HOUOU_HAND_SCORE.nonDealer
    const turn = clamp(board.turn, 0, table.ron.length - 1)
    const riichi = nearestSample(table.ron, table.ronSamples, turn)
    const dama = nearestSample(table.damaRon, table.damaRonSamples, turn)
    return riichi !== null && dama !== null ? Math.max(0, riichi - dama) : 0
  },

  unsupported: (sanma) =>
    sanma
      ? 'measured on four-player Tenhou houou games; no three-player wait or fold data exists'
      : null,
}

export const EV_MODELS: Record<EvModelName, EvModel> = {
  statistical: STATISTICAL,
  houou: HOUOU,
}

/** The matchups the measured fold table carries. */
type Matchup = keyof typeof HOUOU_FOLD_COST.cost

/** `me vs each threat`, dealer first among the threats — the shape `BetaoirCost.csv` labels its
 *  columns with. Only one seat is the dealer, so a dealer deciding never faces a dealer threat.
 *  `null` for a matchup the four-player table has no column for, which is every sanma one. */
function matchupKey(dealer: boolean, threats: readonly ThreatCost[]): Matchup | null {
  const others = threats
    .map((threat) => (threat.dealer ? 'D' : 'ND'))
    .sort((a, b) => a.localeCompare(b))
  const key = `${dealer ? 'D' : 'ND'} vs ${others.join(' ')}`
  return key in HOUOU_FOLD_COST.cost ? (key as Matchup) : null
}

/** The value at `index`, or the nearest one either side with enough hands behind it. `null` when
 *  the whole column is thin, which is a table saying it does not know. */
function nearestSample(
  values: readonly (number | null)[],
  samples: readonly number[],
  index: number,
): number | null {
  for (let step = 0; step < values.length; step++) {
    for (const at of [index - step, index + step]) {
      if (at < 0 || at >= values.length) continue
      if (values[at] !== null && samples[at] >= MIN_SAMPLES) return values[at]
    }
  }
  return null
}

/** What one seat pays when another tsumos: the rules' own split, not an average. */
function tsumoShare(
  value: number,
  winnerIsDealer: boolean,
  payerIsDealer: boolean,
  rules: ScoringRules,
): number {
  const players = rules.sanma ? 3 : 4
  if (winnerIsDealer) return value / (players - 1)
  // a non-dealer's tsumo is paid half by the dealer and a quarter by each other seat
  return payerIsDealer ? value / 2 : value / 4
}

function binomial(trials: number, hits: number, p: number): number {
  if (p <= 0) return hits === 0 ? 1 : 0
  if (p >= 1) return hits === trials ? 1 : 0
  let coefficient = 1
  for (let i = 0; i < hits; i++) coefficient = (coefficient * (trials - i)) / (i + 1)
  return coefficient * p ** hits * (1 - p) ** (trials - hits)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
