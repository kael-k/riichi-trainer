import type { Meld } from './agari'
import { bestDiscards } from './efficiency'
import { addTile, removeTile, type Hand } from './hand'
import { scoreHand, type ScoringRules } from './score'
import { shanten } from './shanten'
import { inTileSet, NUM_TILE_TYPES, type ParsedTile, type TileId } from './tiles'
import { improvingTiles, totalRemaining, ukeire } from './ukeire'
import { TILES_PER_KIND } from './wall'

/**
 * How often a hand finishes, and what it pays when it does — the offensive half of the EV model.
 *
 * Pretend nobody else is at the table. You hold thirteen tiles, some number of tiles you have not
 * seen, and a certain number of draws left. Work backwards from the end of the hand: on the last
 * draw the chance of winning is just how many of your winning tiles are left out of how many you
 * cannot see; on the draw before that it is that, plus the chance you draw something that improves
 * you and then win from there. Swap "chance of winning" for "points if I win" in the same
 * recursion and it returns the hand's value instead, priced by the real scorer — which is what
 * lets it say *this discard wins less often but pays enough more to be worth it*, and what makes
 * EV mean expected **points** rather than expected wins.
 *
 * Everything hard about it is that the tree is large; everything useful about it is that each step
 * is a fraction you can read out loud.
 *
 * **What it is not.** `soloWin` is not the riichi win rate you read in a table. Two corrections
 * stand between them — a hazard curve (the hand can end before your draws run out) and a ron
 * uplift (this model counts only self-draws) — and neither exists yet. They are individually much
 * larger than their difference, and they happen to nearly cancel around turn 9, which is a
 * coincidence of magnitudes rather than an identity: the raw number runs ~11% below the published
 * rate at turn 3 and ~20% above it at turn 12. **Never show it with a percent sign on it.** It is
 * nonetheless the right ordering signal for a discard choice, because both corrections depend
 * almost entirely on the turn and the board rather than on which tile you throw.
 *
 * Purity: same inputs, same output, no Monte Carlo — which ADR-0009 makes a hard rule and which is
 * also what makes the model explainable.
 */

export interface Outlook {
  /** P(the hand completes by self-draw within `draws`), exact under this model's assumptions. */
  soloWin: number
  /** P(the hand reaches tenpai at some point within `draws`). */
  soloTenpai: number
  /** Expected points from holding this hand — the EV itself. Undefined without `scoring`, and in
   *  collapsed mode, where no leaf is ever reached to price. */
  score?: number
  /** P(the hand completes and pays at least this much), per entry of `opts.thresholds`. What lets
   *  a decider re-weight a high-value tail under placement utility without the DP knowing the
   *  table status. Undefined wherever `score` is. */
  winAtLeast?: number[]
  /** False when the collapsed chain ran instead of the DP — see `OutlookOptions.maxShanten`. */
  exact: boolean
}

/** Everything the leaf scorer needs to price a completed hand. Without it the DP still ranks by
 *  win or tenpai probability, it just cannot say what a win is worth. */
export interface ScoringContext {
  round: TileId
  seat: TileId
  doraIndicators: TileId[]
  rules: ScoringRules
  /** The already-called melds, which must match `Hand.melds` in number. */
  melds?: Meld[]
  kita?: number
}

export interface OutlookOptions {
  /**
   * What the choice at each fourteen-tile node maximises. This is not a presentation detail: the
   * three objectives name different discards — win probability prefers cheap fast shapes, tenpai
   * probability prefers width and cares about the noten penalty rather than the win, expected
   * score will hold a dora pair through a narrower wait — and every figure in the `Outlook` is
   * reported *under the chosen policy*, not under its own. Whatever consumes this must say on
   * screen which objective it optimised, or a grader feels arbitrary at exactly the moments it is
   * most right.
   *
   * Defaults to `'score'`: points EV is the model's default currency.
   */
  objective?: 'win' | 'tenpai' | 'score'
  /** Above this, the exact DP is replaced by the collapsed chain. Defaults to **2**: a fourteen-way
   *  ranking is ~0.7ms at tenpai, ~12ms at 1-shanten, ~84ms at 2-shanten and ~1.8s at 3-shanten. */
  maxShanten?: number
  /** Point thresholds for `Outlook.winAtLeast`, ascending. Empty by default, and it costs nothing
   *  when empty. */
  thresholds?: readonly number[]
  /** Which discards `discardOutlooks` prices, when the caller has already narrowed them. Everything
   *  held, by default. A decider that has prefiltered its candidates passes them here rather than
   *  calling `handOutlook` per candidate: the `HandCaches` are shared across a whole ranking and
   *  they are where the shanten probes are, so five separate calls cost more than one ranking of
   *  fourteen. */
  candidates?: readonly TileId[]
  scoring?: ScoringContext
}

/** What one node of the DP is worth. Every field is carried under the same policy — the `max` is
 *  taken on `objective` alone, and the rest ride along with whichever branch won it. */
interface Value {
  win: number
  tenpai: number
  score: number
  atLeast: number[] | null
}

/**
 * The outlook for one thirteen-tile hand.
 *
 * `seen` is the usual 34-length count of every copy already accounted for — your own hand
 * included, since a tile you hold is not one you can draw. Draws come from that *unseen* pool
 * rather than from the live wall: from your seat a tile in an opponent's hand and a tile in the
 * wall are indistinguishable, so treating them as one pool is the maximum-entropy choice given
 * what you know, and it is why the model never needs to know how the wall was shuffled.
 */
export function handOutlook(
  hand: Hand,
  seen: Uint8Array,
  sanma: boolean,
  draws: number,
  opts: OutlookOptions = {},
): Outlook {
  return solve(hand, seen, sanma, draws, opts, freshCaches())
}

/**
 * Everything that depends on the hand alone and not on what is left in the pool: which draws
 * improve it, which discards keep it at its lowest shanten, and what it pays if it is complete.
 *
 * These are the parts of the notebook that can safely be kept — across the levels of one search,
 * where the same hand recurs at every remaining-draw count, and across all fourteen candidates of a
 * ranking, where the same hand is reached by different routes. They are also the expensive parts:
 * `improvingTiles` is 35 shanten probes and `bestDiscards` is 14, against a handful of arithmetic
 * for the node value itself.
 */
interface HandCaches {
  improving: Map<string, TileId[]>
  discards: Map<string, TileId[]>
  scores: Map<string, number | null>
}

function freshCaches(): HandCaches {
  return { improving: new Map(), discards: new Map(), scores: new Map() }
}

/** A hand as a key: two base-5 packs of the 34 counts, which never exceed four. Cheaper than
 *  stringifying the array, and the search asks for it once per node. */
function handKey(hand: Hand): string {
  let low = 0
  let high = 0
  for (let i = 16; i >= 0; i--) low = low * 5 + hand.counts[i]
  for (let i = NUM_TILE_TYPES - 1; i >= 17; i--) high = high * 5 + hand.counts[i]
  return `${low},${high},${hand.melds}`
}

/**
 * The outlook for every distinct discard from a fourteen-tile hand.
 *
 * Each candidate gets its own **node** memo, and they share the `HandCaches`. The node values
 * cannot be shared: a node is worth what it is worth given which tiles have left the unseen pool,
 * and two candidates that discarded different tiles reach the same hand having drawn different
 * things to get there. Sharing them would let whichever candidate ran first answer for the rest,
 * which is a real error rather than a rounding one. What is shared instead is everything that
 * depends on the hand alone, which is also where the shanten probes are.
 */
export function discardOutlooks(
  hand: Hand,
  seen: Uint8Array,
  sanma: boolean,
  draws: number,
  opts: OutlookOptions = {},
): Map<TileId, Outlook> {
  const caches = freshCaches()
  const outlooks = new Map<TileId, Outlook>()
  const wanted = opts.candidates ? new Set(opts.candidates) : null
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (hand.counts[id] === 0) continue
    if (wanted && !wanted.has(id)) continue
    removeTile(hand, id)
    outlooks.set(id, solve(hand, seen, sanma, draws, opts, caches))
    addTile(hand, id)
  }
  return outlooks
}

function solve(
  hand: Hand,
  seen: Uint8Array,
  sanma: boolean,
  draws: number,
  opts: OutlookOptions,
  caches: HandCaches,
): Outlook {
  const maxShanten = opts.maxShanten ?? 2
  const thresholds = opts.thresholds ?? []
  if (shanten(hand) > maxShanten) return collapsed(hand, seen, sanma, draws)

  const unseen = new Uint8Array(NUM_TILE_TYPES)
  let pool = 0
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    unseen[id] = inTileSet(id, sanma) ? Math.max(0, TILES_PER_KIND - seen[id]) : 0
    pool += unseen[id]
  }

  // points EV is the default currency, but a score objective with nothing to score by would rank
  // every discard 0 and pick whichever came first
  const objective = opts.objective ?? (opts.scoring ? 'score' : 'win')
  const rank = (value: Value): number =>
    objective === 'win' ? value.win : objective === 'tenpai' ? value.tenpai : value.score

  // node values, per hand and then per remaining draw: one string key per node instead of two
  const memo = new Map<string, (Value | undefined)[]>()
  const zero = (): Value => ({
    win: 0,
    tenpai: 0,
    score: 0,
    atLeast: thresholds.length > 0 ? thresholds.map(() => 0) : null,
  })

  /** The pool at a node is fixed by how many draws are left, because every branch — improving or
   *  not — consumes exactly one tile. Nothing here has to track it separately. */
  const poolAt = (left: number) => pool - draws + left

  /** A thirteen-tile node: nothing to do but draw. */
  function draw(left: number): Value {
    const key = handKey(hand)
    let row = memo.get(key)
    if (row?.[left]) return row[left]

    const isTenpai = shanten(hand) <= 0 ? 1 : 0
    if (left === 0) {
      const value = zero()
      value.tenpai = isTenpai
      return value
    }

    let improving = caches.improving.get(key)
    if (improving === undefined) {
      improving = improvingTiles(hand, sanma)
      caches.improving.set(key, improving)
    }

    const total = poolAt(left)
    const value = zero()
    let taken = 0
    // Advance-only: follow a draw only when it strictly reduces shanten. This is the model
    // implicit in ukeire theory, and it is the only affordable one — also following draws that
    // keep shanten but widen the wait needs an `ukeire` call per candidate discard per node, ~1150
    // shanten probes instead of ~34, and measures at 1.4s for a single 1-shanten root. It makes
    // the model exact about a slightly smaller game than mahjong, one where hands never improve
    // sideways, so it **understates** win probability — uniformly enough across candidate discards
    // that the ranking survives it.
    for (const tile of improving) {
      if (unseen[tile] === 0) continue
      const p = unseen[tile] / total
      unseen[tile]--
      addTile(hand, tile)
      const child = choose(tile, left)
      removeTile(hand, tile)
      unseen[tile]++
      blend(value, child, p)
      taken += p
    }
    // Every other draw was useless and went straight back out: the hand is unchanged and one draw
    // is gone. The pool shrinks by one without any single kind being named, which is exactly what
    // makes the single-wait case collapse to the hypergeometric closed form.
    if (taken < 1) blend(value, draw(left - 1), 1 - taken)
    value.tenpai = Math.max(value.tenpai, isTenpai)

    if (!row) {
      row = []
      memo.set(key, row)
    }
    row[left] = value
    return value
  }

  /** A fourteen-tile node: choose a discard, or take the win. */
  function choose(drawn: TileId, left: number): Value {
    if (shanten(hand) === -1) {
      const points = priceWin(hand, drawn, opts.scoring, caches.scores)
      // legality is the same two-part test `round.ts` applies: `decompose()` non-empty is the
      // shape, `scoreHand` returning null is "no yaku". Without a scoring context the model can
      // only see the shape, and says so by leaving `score` undefined
      if (points !== null) {
        const value: Value = {
          win: 1,
          tenpai: 1,
          score: points,
          atLeast: thresholds.length > 0 ? thresholds.map((t) => (points >= t ? 1 : 0)) : null,
        }
        return value
      }
    }
    // only discards that keep the improvement: anything else is the sideways move this DP does not
    // follow. `bestDiscards` prices shanten alone, which is all the restriction needs
    const key = handKey(hand)
    let candidates = caches.discards.get(key)
    if (candidates === undefined) {
      candidates = bestDiscards(hand).discards
      caches.discards.set(key, candidates)
    }
    let best: Value | null = null
    for (const discard of candidates) {
      removeTile(hand, discard)
      const child = draw(left - 1)
      addTile(hand, discard)
      if (best === null || rank(child) > rank(best)) best = child
    }
    return best ?? zero()
  }

  function blend(into: Value, child: Value, p: number): void {
    into.win += p * child.win
    into.tenpai += p * child.tenpai
    into.score += p * child.score
    if (into.atLeast && child.atLeast) {
      for (let i = 0; i < into.atLeast.length; i++) into.atLeast[i] += p * child.atLeast[i]
    }
  }

  const root = draw(draws)
  const priced = opts.scoring !== undefined
  return {
    soloWin: root.win,
    soloTenpai: root.tenpai,
    ...(priced ? { score: root.score } : {}),
    ...(priced && root.atLeast ? { winAtLeast: root.atLeast } : {}),
    exact: true,
  }
}

/** What a completed hand pays, cached on the hand and the tile that finished it — a leaf value
 *  does not depend on the unseen pool, so it is worth keeping across a whole ranking. */
function priceWin(
  hand: Hand,
  winTile: TileId,
  scoring: ScoringContext | undefined,
  cache: Map<string, number | null>,
): number | null {
  if (!scoring) return 0
  const key = `${winTile}:${handKey(hand)}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const concealed: ParsedTile[] = []
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    // the DP draws at kind level and never sees redness, so expected score comes out slightly low
    for (let n = 0; n < hand.counts[id]; n++) concealed.push({ id, red: false })
  }
  const result = scoreHand({
    concealed,
    melds: scoring.melds ?? [],
    // the one-player model has no ron in it at all, so every win it prices is a tsumo
    ctx: {
      round: scoring.round,
      seat: scoring.seat,
      tsumo: true,
      riichi: false,
      doubleRiichi: false,
      ippatsu: false,
      haitei: false,
      houtei: false,
      rinshan: false,
      chankan: false,
      winTile,
    },
    doraIndicators: scoring.doraIndicators,
    // ura is hidden until the win and ippatsu depends on timing the DP does not track, so a riichi
    // hand's expected score is understated by both
    uraIndicators: [],
    kita: scoring.kita ?? 0,
    rules: scoring.rules,
  })
  const points = result === null ? null : result.payments.total
  cache.set(key, points)
  return points
}

/**
 * Beyond `maxShanten` the DP is replaced by a chain over "how many more advances do I need".
 *
 * The hand is walked forward one shanten at a time and its ukeire measured at each level; those
 * widths then drive a small `(advances left, draws left)` recursion. It is an approximation and
 * reports itself as one, but every number in it is read off the hand rather than looked up, so
 * there is no typed-in table to drift out of date.
 *
 * The walk takes an **availability-weighted average** of where each improving draw would leave the
 * hand, not the best one. Taking the best is the obvious shortcut and it is badly optimistic: it
 * overstates a 2-shanten win probability by about three times against the exact DP, because the
 * width it reports for the last step is the width of the widest tenpai the hand could reach rather
 * than the one it will typically reach.
 *
 * **How wrong the average is, measured against the exact DP** on random 13-tile hands over 12
 * draws (`collapsed / exact` win probability, min/p25/median/p75/max):
 *
 * ```
 * 2-shanten  n=8   0.79 / 0.92 / 1.00 / 1.15 / 1.32
 * 3-shanten  n=32  0.59 / 0.83 / 1.00 / 1.08 / 1.35
 * 4-shanten  n=30  0.36 / 0.64 / 0.88 / 1.00 / 1.35
 * 5-shanten  n=10  0.40 / 0.47 / 0.63 / 0.78 / 1.00
 * ```
 *
 * So it is **unbiased at the boundary it actually runs at and scattered rather than skewed** — the
 * default `maxShanten` is 2, so the first collapsed level is 3-shanten, where the median is 1.00
 * and the quartiles are 0.83-1.08. Below that it turns into a systematic *under*statement, ~12% at
 * 4-shanten and ~37% at 5, because one representative path cannot see that a hand missing its best
 * draws early lands on a materially worse chain. Read a deep hand's number as a floor.
 *
 * (An earlier note here read "the average by 9-31%" alongside the best-draw walk's 190%, which
 * reads as a systematic overstatement. The measurement above does not support that; what it
 * supports is scatter of that order at the boundary, and understatement below it.)
 *
 * The other thing it still gets wrong: no leaf is ever reached, so it cannot price a win at all —
 * `Outlook.score` comes back undefined and `ev.ts#conditionalWin` falls through to
 * `EvModel.winValue` for it.
 */
function collapsed(hand: Hand, seen: Uint8Array, sanma: boolean, draws: number): Outlook {
  const start = shanten(hand)
  const probe: Hand = { counts: hand.counts.slice(), melds: hand.melds }
  // widths[i] is the ukeire of the hand at shanten `start - i`, so index 0 is the root's own
  const widths: number[] = [totalRemaining(ukeire(probe, seen, sanma))]
  for (let level = start; level > 0; level--) widths.push(advance(probe, seen, sanma))

  let pool = 0
  for (let id = 0; id < NUM_TILE_TYPES; id++) {
    if (inTileSet(id, sanma)) pool += Math.max(0, TILES_PER_KIND - seen[id])
  }

  // reach(a, d) = P(making `a` more advances within `d` draws). Winning from shanten s needs s + 1
  // of them; reaching tenpai needs s. With `a` still to make, the hand sits at shanten a - 1.
  const reach = (advances: number, remaining: number): number => {
    let row: number[] = Array.from({ length: advances + 1 }, (_, a) => (a === 0 ? 1 : 0))
    for (let step = 0; step < remaining; step++) {
      const total = pool - step
      if (total <= 0) break
      const next = row.slice()
      for (let a = 1; a <= advances; a++) {
        const p = Math.min(1, widths[Math.min(widths.length - 1, advances - a)] / total)
        next[a] = p * row[a - 1] + (1 - p) * row[a]
      }
      row = next
    }
    return row[advances]
  }

  return {
    soloWin: reach(start + 1, draws),
    soloTenpai: start <= 0 ? 1 : reach(start, draws),
    exact: false,
  }
}

/**
 * One step forward along the chain. Mutates `hand` into a representative hand one shanten better
 * and returns that hand's ukeire.
 *
 * "Representative" is the availability-weighted mean of where the improving draws would leave it —
 * a draw with three copies left is three times as likely to be the one that arrives — and the hand
 * actually walked to is whichever draw lands nearest that mean. Ties break on the lowest tile id,
 * never on enumeration order.
 */
function advance(hand: Hand, seen: Uint8Array, sanma: boolean): number {
  const options: { tile: TileId; discard: TileId; width: number; copies: number }[] = []
  let weighted = 0
  let copies = 0
  for (const tile of improvingTiles(hand, sanma)) {
    const left = Math.max(0, TILES_PER_KIND - seen[tile])
    if (left === 0) continue
    addTile(hand, tile)
    const discard = bestDiscards(hand).discards[0]
    removeTile(hand, discard)
    const width = totalRemaining(ukeire(hand, seen, sanma))
    addTile(hand, discard)
    removeTile(hand, tile)
    options.push({ tile, discard, width, copies: left })
    weighted += width * left
    copies += left
  }
  if (options.length === 0) return 0
  const mean = weighted / copies
  let best = options[0]
  for (const option of options) {
    if (Math.abs(option.width - mean) < Math.abs(best.width - mean)) best = option
  }
  addTile(hand, best.tile)
  removeTile(hand, best.discard)
  return mean
}
