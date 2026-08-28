import type { ThreatView } from './danger'
import { HOUOU_PRIOR } from './hououPrior'
import { HONOR, inTileSet, isHonor, isTerminalOrHonor, NUM_TILE_TYPES, type TileId } from './tiles'
import { TILES_PER_KIND } from './wall'

/**
 * How likely each tile is to deal into a seat that has declared riichi — the probabilistic
 * sibling of `danger.ts`'s tiers, and the defensive half of the EV model.
 *
 * The method is hypothesis enumeration. A threat waits on *something*; list every shape that could
 * be waiting on each tile, weight each by how common that shape is and by how many ways the threat
 * could physically be holding it out of the tiles nobody has seen, cross out the ones their own
 * discards make impossible, and normalise. The chance a tile deals in is the mass of the shapes
 * that contain it — and the terms are the explanation, which is the whole reason this exists
 * beside a tier model that is cheaper and already good enough for ranking.
 *
 * Judged on **public information only**, the same discipline `danger.ts` holds to: what the threat
 * actually holds is never consulted, so a correct-but-unlucky discard still grades correct. Pure
 * and total, every ranking tie broken explicitly. Cost is a few hundred integer operations per
 * threat.
 *
 * **It refuses to speak about a seat that has not declared.** Reading a silent tenpai is a much
 * weaker inference and a number nobody should trust; `ThreatView` is only ever built for a
 * declared seat.
 */

export type WaitShape =
  /** `(n+1, n+2)` or `(n-2, n-1)`: waits on this tile and on its far end three ranks away. */
  | 'ryanmen'
  /** `(n+1, n+2, n+4, n+5)`: three waits, the widest simple shape. */
  | 'sanmenchan'
  /** `(n-1, n+1)`: one wait, and no amount of suji says anything about it. */
  | 'kanchan'
  /** `1,2` or `8,9`: one wait, off the end of the suit, which is why it is not a ryanmen. */
  | 'penchan'
  /** A lone tile waiting to pair up. */
  | 'tanki'
  /** Two pairs, waiting to make either into a triplet — so it waits on two kinds at once. */
  | 'shanpon'
  /** Thirteen orphans, modelled as the thirteen-sided wait. */
  | 'kokushi'

/**
 * How common each wait shape is, before the board is looked at.
 *
 * Arrays are indexed 0 for honours and 1-9 by rank within a numbered suit, and every shape is
 * indexed by the **lowest tile it waits on** — the convention `WaitDistribution.csv` uses, so
 * ryanmen is nonzero only at ranks 1-6 and sanmenchan only at 1-3. `shanpon` is a wait-**pair**
 * matrix, `shanpon[low][high]`, because a shanpon waits on two kinds at once and collapsing it to
 * a per-rank column loses the width.
 *
 * `kind` says how the numbers are read, and the two modes are not interchangeable:
 *
 * - `'measured'` — counts aggregated over the kinds sharing a bucket (three suits, or seven
 *   honours), so a bucket is divided by the number of hypotheses in it. Availability then enters
 *   as a **ratio to its own neutral value**, never as an absolute: the counts were measured over
 *   real boards and so already integrate typical availability, and multiplying by an absolute
 *   count of ways-to-hold counts it twice — hardest for the shapes with the most tiles in them.
 *   With nothing visible the ratio is 1 and the model reproduces the measured marginals exactly.
 * - `'uniform'` — one weight per hypothesis and availability enters raw. There is no measured
 *   level for it to preserve, and its whole point is to show what pure combinatorics says on its
 *   own, derivable from first principles by a reader with no data at all.
 */
export interface ShapePrior {
  name: string
  kind: 'measured' | 'uniform'
  weights: Record<Exclude<WaitShape, 'shanpon' | 'kokushi'>, readonly number[]>
  /** `shanpon[low][high]`, both indexed 0 for honours. Only the upper triangle is populated. */
  shanpon: readonly (readonly number[])[]
}

export interface DealInTerm {
  shape: WaitShape
  /** Which threat this hypothesis belongs to. */
  seat: number
  /** Tiles the threat would be holding — what an explanation draws. */
  holds: TileId[]
  /** Every tile this hypothesis waits on, not only the one being asked about. */
  waits: TileId[]
  /** Ways to hold `holds` out of the unseen tiles. Zero means the shape is walled off. */
  ways: number
  /** Prior times availability, unnormalised. Zero for a dead hypothesis. */
  weight: number
  /** `weight` as a share of every live hypothesis on the board. */
  probability: number
  /** Why this hypothesis is ruled out. `genbutsu` — every tile it waits on is in their discards
   *  or has passed them since they declared. `furiten` — one of its *other* waits is, which for a
   *  ryanmen is exactly what suji means, and which is why a suji tile is a few percent rather than
   *  zero: kanchan, tanki and shanpon are untouched by a suji argument. `kabe` — the tiles it
   *  needs are all face up. */
  dead?: 'genbutsu' | 'furiten' | 'kabe'
}

export interface DealInRisk {
  tile: TileId
  /** Probability this tile is in the threat's waits, given everything publicly visible. */
  probability: number
  /** Every hypothesis that waits on this tile, live ones first by weight. Dead ones are kept:
   *  "1p is a tanki or a shanpon and nothing else, because the 3p wall killed every run" is the
   *  sentence this model exists to produce, and it needs the crossed-out terms to say it. */
  terms: DealInTerm[]
}

/**
 * Share of riichi tenpai hands on a thirteen-sided kokushi wait.
 *
 * **Stated, not measured.** `WaitDistribution.csv`'s analyzer does not enumerate kokushi — it
 * lands in that file's `complex waits` bucket alongside nobetan and the rest, and nothing splits
 * them out. It is here rather than in the generated table so that a reader can see it is a chosen
 * number, and in one visible place so it is tuned here and never scattered (the `TIER_SCORE`
 * precedent in `danger.ts`).
 *
 * The single-wait kokushi — twelve kinds plus a pair — is not modelled at all: it is rarer still,
 * and folding it into the thirteen-sided shape would overstate every terminal.
 */
export const KOKUSHI_SHARE = 0.001

/** Every shape class weight 1, so the number is availability alone. */
export const UNIFORM_PRIOR: ShapePrior = {
  name: 'uniform',
  kind: 'uniform',
  weights: {
    sanmenchan: ones(),
    ryanmen: ones(),
    penchan: ones(),
    kanchan: ones(),
    tanki: ones(),
  },
  shanpon: ones().map(() => ones()),
}

function ones(): number[] {
  return Array.from({ length: 10 }, () => 1)
}

/** Ways to hold a shape when nothing at all is visible, by shape. Availability is read as a ratio
 *  to these under a measured prior — see `ShapePrior.kind`. */
const NEUTRAL_WAYS: Record<WaitShape, number> = {
  ryanmen: TILES_PER_KIND ** 2,
  penchan: TILES_PER_KIND ** 2,
  kanchan: TILES_PER_KIND ** 2,
  sanmenchan: TILES_PER_KIND ** 4,
  tanki: TILES_PER_KIND,
  shanpon: pairs(TILES_PER_KIND) ** 2,
  // a kokushi needs one of each of thirteen kinds, so availability barely moves. Held flat rather
  // than as a thirteen-way product, which would swing wildly on a single walled terminal
  kokushi: 1,
}

function pairs(copies: number): number {
  return (copies * (copies - 1)) / 2
}

/** Which bucket of a prior array a tile falls in: 0 for honours, else its rank. */
function bucketOf(id: TileId): number {
  return isHonor(id) ? 0 : (id % 9) + 1
}

/** How many hypotheses share one bucket of a measured prior — three suits for a numbered rank,
 *  seven kinds for the honour bucket. Dividing by it turns an aggregated count into the weight of
 *  one hypothesis. */
function bucketSize(bucket: number): number {
  return bucket === 0 ? 7 : 3
}

/** The same, for a shanpon pair bucket. Two ranks pick one kind each; a pair inside one bucket
 *  must still be two distinct kinds, so it is a combination rather than a product. */
function shanponBucketSize(low: number, high: number): number {
  if (low === high) return pairs(bucketSize(low))
  return bucketSize(low) * bucketSize(high)
}

interface Hypothesis {
  shape: WaitShape
  holds: TileId[]
  waits: TileId[]
}

/**
 * Every shape a threat could be tenpai on, enumerated by what they **hold** rather than by what
 * they wait on, so each hypothesis is produced exactly once.
 *
 * Two things worth not re-deriving wrong, both of which `danger.ts` already states in prose: a
 * shape `(a, a+1)` waits on `a-1` and `a+2`, so the ryanmen that wait on `n` are `(n+1, n+2)` and
 * `(n-2, n-1)` and each also waits on its far end three ranks away — that far end is the entire
 * content of suji. And a two-tile run whose far end runs off the suit is a **penchan**, not a
 * ryanmen, which is why 3p is suji off 6p but never off 1p.
 */
function enumerate(): Hypothesis[] {
  const list: Hypothesis[] = []
  for (const base of [0, 9, 18]) {
    const tile = (rank: number) => base + rank - 1
    for (let a = 1; a <= 8; a++) {
      if (a === 1) list.push({ shape: 'penchan', holds: [tile(1), tile(2)], waits: [tile(3)] })
      else if (a === 8) list.push({ shape: 'penchan', holds: [tile(8), tile(9)], waits: [tile(7)] })
      else {
        list.push({
          shape: 'ryanmen',
          holds: [tile(a), tile(a + 1)],
          waits: [tile(a - 1), tile(a + 2)],
        })
      }
    }
    for (let a = 1; a <= 7; a++) {
      list.push({ shape: 'kanchan', holds: [tile(a), tile(a + 2)], waits: [tile(a + 1)] })
    }
    for (let a = 2; a <= 4; a++) {
      list.push({
        shape: 'sanmenchan',
        holds: [tile(a), tile(a + 1), tile(a + 3), tile(a + 4)],
        waits: [tile(a - 1), tile(a + 2), tile(a + 5)],
      })
    }
    for (let a = 1; a <= 9; a++) list.push({ shape: 'tanki', holds: [tile(a)], waits: [tile(a)] })
  }
  for (let id = HONOR; id < NUM_TILE_TYPES; id++) {
    list.push({ shape: 'tanki', holds: [id], waits: [id] })
  }
  for (let low = 0; low < NUM_TILE_TYPES; low++) {
    for (let high = low + 1; high < NUM_TILE_TYPES; high++) {
      list.push({ shape: 'shanpon', holds: [low, low, high, high], waits: [low, high] })
    }
  }
  return list
}

/** Built once: the shape list is the same on every board, and only the weights move. */
const HYPOTHESES = enumerate()

/** Kept apart from the rest because its weight is a share of them (`KOKUSHI_SHARE`) rather than a
 *  bucket of its own, and because the thirteen-sided wait dies to any one terminal or honour in
 *  the threat's river — which is a real and very common way for it to be ruled out. */
const KOKUSHI: Hypothesis = (() => {
  const orphans: TileId[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) if (isTerminalOrHonor(id)) orphans.push(id)
  return { shape: 'kokushi', holds: orphans, waits: orphans }
})()

/** Every hypothesis in the order `threatTerms` weighs them, kokushi last. The joint path indexes
 *  two threats' term lists in step against this. */
const ALL_HYPOTHESES: Hypothesis[] = [...HYPOTHESES, KOKUSHI]

/** Prior weight of one hypothesis, before availability. Kokushi never arrives here: its weight is
 *  a share of every other hypothesis rather than a bucket of its own, so it is passed in. */
function priorWeight(hypothesis: Hypothesis, prior: ShapePrior): number {
  if (prior.kind === 'uniform' || hypothesis.shape === 'kokushi') return 1
  if (hypothesis.shape === 'shanpon') {
    const [low, high] = [bucketOf(hypothesis.waits[0]), bucketOf(hypothesis.waits[1])].sort(
      (a, b) => a - b,
    )
    return prior.shanpon[low][high] / shanponBucketSize(low, high)
  }
  // indexed by the lowest tile the shape waits on, which is `waits[0]` by construction
  const bucket = bucketOf(hypothesis.waits[0])
  return prior.weights[hypothesis.shape][bucket] / bucketSize(bucket)
}

/**
 * Deal-in probability for every tile kind against one declared seat, in tile order.
 *
 * `visible` is the usual 34-length count of every copy already accounted for — every river, meld
 * and dora indicator, plus your own hand — so a tile you are holding is one the threat is not.
 * Sanma reuses `inTileSet` the way `assessDiscards` does: a tile outside the set counts as fully
 * visible, so every shape needing it is dead.
 */
export function dealInRisk(
  threat: ThreatView,
  visible: Uint8Array,
  sanma: boolean,
  prior: ShapePrior = HOUOU_PRIOR,
): DealInRisk[] {
  const unseen = unseenFrom(visible, sanma)
  const { terms, total } = threatTerms(threat, unseen, prior)

  const risks = emptyRisks()
  for (const term of terms) {
    term.probability = total > 0 ? term.weight / total : 0
    for (const tile of term.waits) {
      risks[tile].terms.push(term)
      risks[tile].probability += term.probability
    }
  }
  for (const risk of risks) sortTerms(risk)
  return risks
}

/** The unseen pool as the threat could be holding it: four copies of every kind less what is
 *  already accounted for. Sanma reuses `inTileSet` the way `assessDiscards` does — a tile outside
 *  the set counts as fully visible, so every shape needing it is dead. */
function unseenFrom(visible: Uint8Array, sanma: boolean): Uint8Array {
  const unseen = new Uint8Array(NUM_TILE_TYPES)
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    unseen[id] = inTileSet(id, sanma) ? Math.max(0, TILES_PER_KIND - visible[id]) : 0
  }
  return unseen
}

/** Every hypothesis weighed against one threat's own river, unnormalised. `terms` is aligned with
 *  `ALL_HYPOTHESES`, which is what lets the joint path index the two threats' terms in step. */
function threatTerms(
  threat: ThreatView,
  unseen: Uint8Array,
  prior: ShapePrior,
): { terms: DealInTerm[]; total: number } {
  // one furiten rule, and it is what produces both tiers people learn separately: if the tile
  // itself is in the set every hypothesis containing it dies (genbutsu), and if the far end of one
  // ryanmen is in the set only that hypothesis dies (suji) — which is exactly why a suji tile is
  // a few percent rather than zero, and why no tier below genbutsu may ever read as "safe"
  const furiten = new Set([...threat.discards, ...threat.passed])

  const terms: DealInTerm[] = []
  let total = 0
  for (const hypothesis of HYPOTHESES) {
    const term = build(hypothesis, threat.seat, unseen, furiten, prior)
    terms.push(term)
    total += term.weight
  }
  // kokushi's weight is a share of everything else rather than a bucket of its own, so the one
  // stated constant means the same thing under either prior
  const kokushi = build(KOKUSHI, threat.seat, unseen, furiten, prior, KOKUSHI_SHARE * total)
  terms.push(kokushi)
  total += kokushi.weight
  return { terms, total }
}

function emptyRisks(): DealInRisk[] {
  const risks: DealInRisk[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) risks.push({ tile: id, probability: 0, terms: [] })
  return risks
}

/** Total order: live before dead, then by weight, then by shape and lowest held tile so that two
 *  equal-weight hypotheses never depend on enumeration order. */
function sortTerms(risk: DealInRisk): void {
  risk.terms.sort(
    (a, b) =>
      Number(a.dead !== undefined) - Number(b.dead !== undefined) ||
      b.weight - a.weight ||
      a.shape.localeCompare(b.shape) ||
      a.holds[0] - b.holds[0] ||
      a.seat - b.seat,
  )
}

function build(
  hypothesis: Hypothesis,
  seat: number,
  unseen: Uint8Array,
  furiten: Set<TileId>,
  prior: ShapePrior,
  weightOverride?: number,
): DealInTerm {
  const ways = waysToHold(hypothesis, unseen)
  const term: DealInTerm = {
    shape: hypothesis.shape,
    seat,
    holds: hypothesis.holds,
    waits: hypothesis.waits,
    ways,
    weight: 0,
    probability: 0,
  }
  const blocked = hypothesis.waits.filter((tile) => furiten.has(tile))
  if (blocked.length > 0) {
    // genbutsu and suji are one rule read from two ends. A term does not know which of its waits
    // the caller is asking about, so it records whether *all* of them are furiten or only some
    term.dead = blocked.length === hypothesis.waits.length ? 'genbutsu' : 'furiten'
    return term
  }
  if (ways === 0) {
    term.dead = 'kabe'
    return term
  }
  const base = weightOverride ?? priorWeight(hypothesis, prior)
  term.weight =
    prior.kind === 'uniform' ? base * ways : base * (ways / NEUTRAL_WAYS[hypothesis.shape])
  return term
}

function waysToHold(hypothesis: Hypothesis, unseen: Uint8Array): number {
  if (hypothesis.shape === 'kokushi') {
    return hypothesis.holds.every((tile) => unseen[tile] > 0) ? 1 : 0
  }
  if (hypothesis.shape === 'shanpon') {
    const [low, , high] = hypothesis.holds
    return pairs(unseen[low]) * pairs(unseen[high])
  }
  let ways = 1
  for (const tile of hypothesis.holds) ways *= unseen[tile]
  return ways
}

/**
 * Deal-in probability against several threats at once: the union, `1 - Π(1 - p_j)`, which is where
 * this model differs materially from `assessDiscards` — that one takes the worst tier across
 * threats and says in its own comment that the real risk is the union.
 *
 * The product assumes the threats are independent and they are not: two seats hold shapes out of
 * one shared pool, so they cannot hold the same copies and their waits are negatively correlated.
 * The honest form is `combinedDealInRisk` below — built, measured and off by default, because it
 * costs 46ms against this function's 2.5ms to move the answer by at most 0.09pp. The correlation
 * raises `P(A ∪ B)` rather than lowering it (`P(both)` falls faster than the independent product
 * does), so read this as the slight *under*statement it is, not the overstatement it looks like.
 */
export function combineThreats(risks: DealInRisk[][]): DealInRisk[] {
  // 34 entries in tile order whatever it is given, so a caller can always index by `TileId` — a
  // board with nobody in riichi is a board where every tile is safe, not one with no tiles on it
  if (risks.length === 0) return emptyRisks()
  if (risks.length === 1) return risks[0]
  const combined: DealInRisk[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    let safe = 1
    const terms: DealInTerm[] = []
    for (const perThreat of risks) {
      safe *= 1 - perThreat[id].probability
      terms.push(...perThreat[id].terms)
    }
    combined.push({ tile: id, probability: 1 - safe, terms })
  }
  return combined
}

/**
 * Deal-in probability against every declared threat at once.
 *
 * Two threats do not draw from separate walls. They hold their shapes out of one shared pool, so
 * they cannot hold the same copies and their waits are correlated — which `combineThreats`' product
 * ignores. `joint` enumerates compatible pairs of hypotheses instead: the second threat's
 * ways-to-hold are counted against the pool the first one has already taken from, an incompatible
 * pair weighs zero, and the distribution is normalised over what survives. `P(t)` is then read off
 * it as `P(A waits t) + P(B waits t) − P(both wait t)`, the inclusion-exclusion the product only
 * approximates, and each term's `probability` comes back as its **joint marginal** so an
 * explanation drawn from these terms is consistent with the total.
 *
 * **It is off by default, and the measurement is why.** `plans/EV-2` §5 expected the joint path to
 * be sub-millisecond and the product to overstate. Both are wrong: the hypothesis space is ~650 per
 * threat rather than the ~140 that estimate assumed (shanpon is a wait-pair matrix, not a
 * marginalised column), so the pair loop is ~422k pairs at **46ms against the product's 2.5ms** —
 * and the product comes out *below* the joint answer on 26 of 34 tiles, by at most **0.09pp** with
 * a full pool and **0.83pp** against a heavily depleted one. Negative correlation raises
 * `P(A ∪ B)` rather than lowering it, because `P(both)` falls faster than the independent product
 * does. So the product is a slight **under**statement of about a tenth of a point, bought for a
 * twentieth of the cost: it is the right default for anything deciding, and the joint path is for
 * a reader who asked.
 *
 * Three or more threats always take the product: the pair loop is quadratic in the hypotheses, so
 * a third one is a cube nobody is waiting for. Dead terms come back from every threat either way —
 * they are the explanation.
 */
export function combinedDealInRisk(
  threats: readonly ThreatView[],
  visible: Uint8Array,
  sanma: boolean,
  prior: ShapePrior = HOUOU_PRIOR,
  joint = false,
): DealInRisk[] {
  if (threats.length === 0) return emptyRisks()
  if (threats.length === 1) return dealInRisk(threats[0], visible, sanma, prior)
  if (!joint || threats.length > 2) {
    return combineThreats(threats.map((threat) => dealInRisk(threat, visible, sanma, prior)))
  }

  const unseen = unseenFrom(visible, sanma)
  const [a, b] = threats.map((threat) => threatTerms(threat, unseen, prior))
  const liveA = liveIndices(a.terms)
  const liveB = liveIndices(b.terms)

  const marginalA = new Float64Array(a.terms.length)
  const marginalB = new Float64Array(b.terms.length)
  const both = new Float64Array(NUM_TILE_TYPES)
  let total = 0

  for (const i of liveA) {
    const hypothesisA = ALL_HYPOTHESES[i]
    // availability is already in `weight`, under whichever convention the prior reads it by; the
    // second factor re-counts the same way against what this hypothesis has taken from the pool
    const weightA = a.terms[i].weight
    for (const j of liveB) {
      const hypothesisB = ALL_HYPOTHESES[j]
      const waysB = waysToHoldAfter(hypothesisB, unseen, hypothesisA.holds)
      if (waysB === 0) continue
      // the joint weight is A's, times B's re-priced for the copies A is holding: its own weight
      // scaled by how much of its availability survives A
      const weight = weightA * b.terms[j].weight * (waysB / b.terms[j].ways)
      if (weight === 0) continue
      total += weight
      marginalA[i] += weight
      marginalB[j] += weight
      for (const tile of hypothesisA.waits) {
        if (hypothesisB.waits.includes(tile)) both[tile] += weight
      }
    }
  }

  const risks = emptyRisks()
  if (total === 0) return risks
  for (const [terms, marginal] of [
    [a.terms, marginalA],
    [b.terms, marginalB],
  ] as const) {
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]
      term.probability = marginal[i] / total
      for (const tile of term.waits) {
        risks[tile].terms.push(term)
        risks[tile].probability += term.probability
      }
    }
  }
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    risks[id].probability -= both[id] / total
    sortTerms(risks[id])
  }
  return risks
}

function liveIndices(terms: readonly DealInTerm[]): number[] {
  const live: number[] = []
  for (let i = 0; i < terms.length; i++) if (terms[i].weight > 0) live.push(i)
  return live
}

/** Ways to hold a shape out of the pool another hypothesis has already taken its own tiles from.
 *  `taken` may repeat a kind (a shanpon holds two of each), so copies come off one at a time. */
function waysToHoldAfter(
  hypothesis: Hypothesis,
  unseen: Uint8Array,
  taken: readonly TileId[],
): number {
  const left = (id: TileId) => {
    let n = unseen[id]
    for (const tile of taken) if (tile === id) n--
    return n
  }
  if (hypothesis.shape === 'kokushi') {
    return hypothesis.holds.every((tile) => left(tile) > 0) ? 1 : 0
  }
  if (hypothesis.shape === 'shanpon') {
    const [low, , high] = hypothesis.holds
    return pairs(left(low)) * pairs(left(high))
  }
  let ways = 1
  for (const tile of hypothesis.holds) ways *= left(tile)
  return Math.max(0, ways)
}

/** Expected number of distinct tile kinds the threat is waiting on, implied by a set of risks.
 *  With nothing visible and no discards this reproduces the source data's own wait width, which is
 *  the one check that catches an availability term counted twice. */
export function impliedWaitWidth(risks: DealInRisk[]): number {
  return risks.reduce((sum, risk) => sum + risk.probability, 0)
}
