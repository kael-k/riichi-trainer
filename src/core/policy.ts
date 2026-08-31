import type { Meld } from './agari'
import { assessDiscards, type ThreatView } from './danger'
import { bestDiscards, type DiscardOption } from './efficiency'
import { addTile, removeTile, type Hand } from './hand'
import { shanten } from './shanten'
import { improvingTiles, totalRemaining, ukeire } from './ukeire'
import { HONOR, isDragon, isTerminalOrHonor, suitOf, type RiverTile, type TileId } from './tiles'

/** How the engine plays a seat. `'defense'` is full betaori — the folding trainer switches every
 *  seat that missed its riichi target into this once the target is reached. `'tsumogiri'`
 *  discards whatever it drew, every turn, no hand management at all. `'manual'` is not an AI
 *  style at all but the absence of one: the engine stops deciding for that seat and asks
 *  instead. The dispatch itself (`ALGORITHMS`, one object per AI style) lives in
 *  `core/algorithm.ts`, built on the pure functions below.
 *
 *  `'ev'` pushes or folds by expected value (`core/ev.ts`), and **how** it prices is not part of
 *  this union: an EV seat carries an `EvSeat` beside its algorithm (`PlayerState.ev`) naming the
 *  model and the objective. That was two keys, `'ev-statistical'` and `'ev-houou'`, while the model
 *  was the only thing an EV seat could differ by — the objective made it a cross product, which is
 *  the trigger for moving it
 *  off the union, and the placement objective is that trigger: two models times two objectives is a
 *  cross product, and a cross product is a record, not four names. */
export type SeatAlgorithm = 'efficiency' | 'defense' | 'tsumogiri' | 'manual' | 'ev'

/**
 * The moves `core/algorithm.ts`'s `AIAlgorithm`s are written in terms of. Every function here
 * is pure and total: the same inputs always produce the same output, which is what lets a whole
 * match be reproduced from its seed. That rules out anything probabilistic, and it means every
 * ranking needs a **total** order — ties broken explicitly rather than left to sort stability.
 */

/** Winds that are worth a yaku to this player: the round wind, their seat wind, and dragons. */
function isValuableHonor(id: TileId, round: TileId, seat: TileId): boolean {
  return isDragon(id) || id === round || id === seat
}

/**
 * Whether an *open* hand of this shape could still finish with a yaku. The guard that matters
 * when deciding to call: without it a shanten-chasing caller happily opens itself into a hand
 * that is fast, tenpai, and cannot legally win.
 *
 * Deliberately a coarse over-approximation — it asks "is some yaku still on the table", not
 * "will this hand get there". A false positive costs one questionable call; a false negative
 * would make the AI refuse calls it should obviously take.
 */
/** The yaku an unfinished hand could still be built around. Deliberately the column set
 *  `HOUOU_HAND_SCORE.open` measures, so a route is a price rather than only a label. */
export type YakuRoute = 'tanyao' | 'yakuhai' | 'honitsu' | 'chinitsu' | 'other'

export function hasYakuRoute(hand: Hand, melds: Meld[], round: TileId, seat: TileId): boolean {
  return yakuRoute(hand, melds, round, seat) !== null
}

/**
 * *Which* yaku the hand could still be built around, or `null` for none — the same judgement
 * `hasYakuRoute` makes, kept as one function so the two can never drift apart.
 *
 * The five answers are not an arbitrary carve-up: they are the columns
 * `hououPrior.ts#HOUOU_HAND_SCORE.open` publishes, so a route names a measured win value
 * directly. `'other'` is the analyzer's own remainder bucket, which is where toitoi lands.
 *
 * Order matters where a hand qualifies twice, and it is the order below: a hand that is both
 * flush and yakuhai is priced as the flush, because that is the bigger hand and the one it will
 * actually be built into.
 */
export function yakuRoute(
  hand: Hand,
  melds: Meld[],
  round: TileId,
  seat: TileId,
): YakuRoute | null {
  const counts = hand.counts
  const meldTiles = melds.flatMap((m) => m.tiles.map((t) => t.id))

  const all: TileId[] = [...meldTiles]
  for (let id = 0; id < counts.length; id++) for (let k = 0; k < counts[id]; k++) all.push(id)

  // honitsu / chinitsu: at most one numbered suit in play
  const suits = new Set(all.map(suitOf).filter((s) => s !== 'z'))
  if (suits.size <= 1) return all.some((id) => id >= HONOR) ? 'honitsu' : 'chinitsu'

  // yakuhai: a pair is enough, since it can still become the triplet
  for (let id = HONOR; id < HONOR + 7; id++) {
    if (!isValuableHonor(id, round, seat)) continue
    if (counts[id] >= 2) return 'yakuhai'
    if (meldTiles.filter((t) => t === id).length >= 3) return 'yakuhai'
  }

  // tanyao: nothing terminal or honour anywhere
  if (all.every((id) => !isTerminalOrHonor(id))) return 'tanyao'

  // toitoi: already sitting on enough triplets that going all-triplets is realistic
  let triplets = melds.filter((m) => m.kind !== 'chi').length
  for (let id = 0; id < counts.length; id++) if (counts[id] >= 3) triplets++
  return triplets >= 2 ? 'other' : null
}

/**
 * The discard to play from a 14-tile hand: lowest resulting shanten, then highest ukeire, then a
 * fixed tie-break so the choice never depends on sort stability — shed the tile held in fewest
 * copies first, then terminals and honours ahead of simples, then the lowest id.
 */
export function chooseDiscard(hand: Hand, seen: Uint8Array, sanma: boolean): DiscardOption {
  const { shanten: best, discards } = bestDiscards(hand)
  let choice: DiscardOption | null = null
  for (const id of discards) {
    removeTile(hand, id)
    const tiles = ukeire(hand, seen, sanma)
    addTile(hand, id)
    const option: DiscardOption = {
      discard: id,
      shanten: best,
      ukeireTiles: tiles,
      ukeireCount: totalRemaining(tiles),
    }
    if (
      !choice ||
      option.ukeireCount > choice.ukeireCount ||
      (option.ukeireCount === choice.ukeireCount && preferDiscard(id, choice.discard, hand))
    ) {
      choice = option
    }
  }
  return choice!
}

/** Full betaori: the safest tile in hand against every seat in `threats`. `assessDiscards` is
 *  already a total order (tier score, then tile id), so this needs no tie-break of its own, and
 *  it stays total with no threats — the ranking falls back to wall and shape alone. */
export function chooseFold(
  hand: Hand,
  threats: readonly ThreatView[],
  seen: Uint8Array,
  sanma: boolean,
): TileId {
  return assessDiscards(hand, threats, seen, sanma)[0].tile
}

function preferDiscard(a: TileId, b: TileId, hand: Hand): boolean {
  if (hand.counts[a] !== hand.counts[b]) return hand.counts[a] < hand.counts[b]
  const outerA = isTerminalOrHonor(a)
  const outerB = isTerminalOrHonor(b)
  if (outerA !== outerB) return outerA
  return a < b
}

/** Tiles that complete this 13-tile hand; empty unless it is tenpai. Shape only — a wait still
 *  needs a yaku to be a legal win, which `scoreHand` decides. */
export function waits(hand: Hand, sanma: boolean): TileId[] {
  return shanten(hand) === 0 ? improvingTiles(hand, sanma) : []
}

/** Furiten: one of your own discards would have won the hand, so you may no longer ron (tsumo
 *  stays legal). Callers add temporary furiten — passing on a winning discard — on top. */
export function isFuriten(waitTiles: TileId[], river: RiverTile[]): boolean {
  return river.some((t) => waitTiles.includes(t.id))
}

/** Distinct terminals and honours held — the count kyuushu kyuuhai is measured in. Kinds, not
 *  copies: three 1m in the opening hand is one of the nine, which is the whole reason the rule
 *  needs a helper rather than a `reduce` at the call site. */
export function kyuushuKinds(hand: Hand): number {
  let kinds = 0
  for (let id = 0; id < hand.counts.length; id++) {
    if (hand.counts[id] > 0 && isTerminalOrHonor(id)) kinds++
  }
  return kinds
}

/** How many of them make the hand abortable. Nine is the rule everywhere this project models; it
 *  is here rather than inline so `round.ts` and any UI that explains the offer read one number. */
export const KYUUSHU_KINDS = 9

export interface Call {
  kind: 'pon' | 'chi' | 'minkan'
  /** The caller's own tiles that join the discard, in ascending order — three of the same kind
   *  for a `'minkan'`, same as `'pon'` doubled. */
  from: TileId[]
}

/** Every pon/chi (and, with `calledKan` on, minkan) this hand could legally make on `tile`; chi
 *  only from the player to the left, minkan from anyone including on an honour. Exported for the
 *  human claim prompt (`round.ts#claimOptions`), which offers exactly the calls the AI weighs
 *  here rather than deriving a second, drifting notion of what is legal.
 *
 *  `calledKan` defaults `false` and `chooseCall` below never passes it — daiminkan is a
 *  match-only ruleset switch (`RoundOptions.calledKan`), and the bot never seeing the option at
 *  all is what keeps every golden hash pinned regardless of the flag. */
export function availableCalls(
  hand: Hand,
  tile: TileId,
  fromKamicha: boolean,
  calledKan = false,
): Call[] {
  const calls: Call[] = []
  if (hand.counts[tile] >= 2) calls.push({ kind: 'pon', from: [tile, tile] })
  if (calledKan && hand.counts[tile] >= 3) {
    calls.push({ kind: 'minkan', from: [tile, tile, tile] })
  }
  if (!fromKamicha || tile >= HONOR) return calls

  const rank = tile % 9
  const pairs: [number, number][] = [
    [-2, -1],
    [-1, 1],
    [1, 2],
  ]
  for (const [a, b] of pairs) {
    if (rank + a < 0 || rank + b > 8 || rank + a > 8 || rank + b < 0) continue
    if (hand.counts[tile + a] > 0 && hand.counts[tile + b] > 0) {
      calls.push({ kind: 'chi', from: [tile + a, tile + b].sort((x, y) => x - y) })
    }
  }
  return calls
}

/** One own-turn kan this seat could declare. A discriminated pair rather than one object with a
 *  union discriminant, so it drops straight into `TurnAction` (`core/algorithm.ts`) unchanged. */
export type KanOption = { kind: 'ankan'; tile: TileId } | { kind: 'kakan'; tile: TileId }

/**
 * Kans this seat could declare on its own turn, in tile order: a closed kan on any held quad,
 * and — only under `calledKan` — an added kan on a pon it already holds the fourth copy of.
 *
 * One notion of the rule for three readers: `round.ts`'s own turn loop, the `'ev'` algorithm that
 * prices them, and `KitaKanControls`, which drew its own before this existed. The two kinds are
 * mutually exclusive per kind, and not by a rule that needs stating: a melded pon's three copies
 * are not in `hand.counts` at all, so a kind held four times concealed can never also be a pon
 * this seat holds the fourth of.
 *
 * Daiminkan is deliberately absent — it is a claim on somebody else's discard (`availableCalls`
 * above), not an own-turn action.
 */
export function kanOptions(hand: Hand, melds: readonly Meld[], calledKan: boolean): KanOption[] {
  const options: KanOption[] = []
  const ponned = new Set(melds.filter((m) => m.kind === 'pon').map((m) => m.tiles[0].id))
  for (let id = 0; id < hand.counts.length; id++) {
    if (hand.counts[id] === 4) options.push({ kind: 'ankan', tile: id })
    else if (calledKan && hand.counts[id] >= 1 && ponned.has(id)) {
      options.push({ kind: 'kakan', tile: id })
    }
  }
  return options
}

/**
 * Shanten this hand would reach by taking `call` and then discarding its best tile. Shanten
 * only: whether to call never depends on the ukeire behind it, and pricing it would put the
 * simulator's most expensive operation on a path walked by every opponent on every discard.
 *
 * **A minkan is the one call that leaves no discard to take.** Pon and chi spend two tiles for a
 * meld and leave a fourteen-tile hand, so `bestDiscards` is the right question. A minkan spends
 * three and leaves a thirteen-tile one, drawing its replacement from the dead wall instead — ask
 * `bestDiscards` there and it probes a twelve-tile hand, reporting the shanten of a hand with a
 * tile missing. `shanten` is tile-count-blind, so nothing throws; the number is just wrong, and
 * it is wrong upward, which is what makes a screen built on it reject every open kan.
 */
export function shantenAfterCall(hand: Hand, call: Call): number {
  for (const id of call.from) removeTile(hand, id)
  hand.melds++
  const after = call.kind === 'minkan' ? shanten(hand) : bestDiscards(hand).shanten
  hand.melds--
  for (const id of call.from) addTile(hand, id)
  return after
}

/**
 * Whether to call on a discard, and with what. Calls only when the meld strictly lowers shanten
 * *and* the opened hand still has a yaku route — that pairing is the whole policy. Ties between
 * eligible calls go to the one leaving the lowest shanten, then pon over chi, then lowest tiles.
 */
export function chooseCall(
  hand: Hand,
  melds: readonly Meld[],
  tile: TileId,
  fromKamicha: boolean,
  round: TileId,
  seat: TileId,
): Call | null {
  const current = shanten(hand)
  let best: { call: Call; shanten: number } | null = null

  for (const call of availableCalls(hand, tile, fromKamicha)) {
    const after = shantenAfterCall(hand, call)
    if (after >= current) continue

    // the yaku route is judged on the hand as it would stand once opened
    for (const id of call.from) removeTile(hand, id)
    const meldTiles = [tile, ...call.from].map((id) => ({ id, red: false }))
    const opened: Meld[] = [...melds, { kind: call.kind, tiles: meldTiles }]
    const viable = hasYakuRoute(hand, opened, round, seat)
    for (const id of call.from) addTile(hand, id)
    if (!viable) continue

    if (!best || after < best.shanten || (after === best.shanten && preferCall(call, best.call))) {
      best = { call, shanten: after }
    }
  }
  return best?.call ?? null
}

function preferCall(a: Call, b: Call): boolean {
  if (a.kind !== b.kind) return a.kind === 'pon'
  return a.from[0] < b.from[0]
}
