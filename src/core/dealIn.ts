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
  const unseen = new Uint8Array(NUM_TILE_TYPES)
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    unseen[id] = inTileSet(id, sanma) ? Math.max(0, TILES_PER_KIND - visible[id]) : 0
  }

  // one furiten rule, and it is what produces both tiers people learn separately: if the tile
  // itself is in the set every hypothesis containing it dies (genbutsu), and if the far end of one
  // ryanmen is in the set only that hypothesis dies (suji) — which is exactly why a suji tile is
  // a few percent rather than zero, and why no tier below genbutsu may ever read as "safe"
  const furiten = new Set([...threat.discards, ...threat.passed])

  const terms: DealInTerm[] = []
  let live = 0
  for (const hypothesis of HYPOTHESES) {
    const term = build(hypothesis, threat.seat, unseen, furiten, prior)
    terms.push(term)
    live += term.weight
  }
  // kokushi's weight is a share of everything else rather than a bucket of its own, so the one
  // stated constant means the same thing under either prior
  const kokushi = build(KOKUSHI, threat.seat, unseen, furiten, prior, KOKUSHI_SHARE * live)
  terms.push(kokushi)
  live += kokushi.weight

  const risks: DealInRisk[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) risks.push({ tile: id, probability: 0, terms: [] })
  for (const term of terms) {
    term.probability = live > 0 ? term.weight / live : 0
    for (const tile of term.waits) {
      risks[tile].terms.push(term)
      risks[tile].probability += term.probability
    }
  }
  // total order: live before dead, then by weight, then by shape and lowest held tile so that two
  // equal-weight hypotheses never depend on enumeration order
  for (const risk of risks) {
    risk.terms.sort(
      (a, b) =>
        Number(a.dead !== undefined) - Number(b.dead !== undefined) ||
        b.weight - a.weight ||
        a.shape.localeCompare(b.shape) ||
        a.holds[0] - b.holds[0],
    )
  }
  return risks
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
 * The honest form enumerates hypotheses jointly and is affordable for two threats (~15k
 * compatible-pair checks); it is not built. Read this as the approximation it is.
 */
export function combineThreats(risks: DealInRisk[][]): DealInRisk[] {
  if (risks.length === 0) return []
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

/** Expected number of distinct tile kinds the threat is waiting on, implied by a set of risks.
 *  With nothing visible and no discards this reproduces the source data's own wait width, which is
 *  the one check that catches an availability term counted twice. */
export function impliedWaitWidth(risks: DealInRisk[]): number {
  return risks.reduce((sum, risk) => sum + risk.probability, 0)
}
