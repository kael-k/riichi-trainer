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
 *  The two `'ev-*'` styles push or fold by expected points (`core/ev.ts`), and they are two keys
 *  rather than one style with a setting beside it because **the EV model is what they differ by**:
 *  `statistical` derives its prices from combinatorics, `houou` reads them off measured logs, and
 *  a seat runs one or the other the same way it runs one algorithm or another — flip it mid-hand
 *  and the next turn obeys. A separate per-seat field would buy nothing at two models; it earns
 *  itself when a second orthogonal switch (the objective, a posture) makes the union a cross
 *  product. */
export type SeatAlgorithm =
  | 'efficiency'
  | 'defense'
  | 'tsumogiri'
  | 'manual'
  | 'ev-statistical'
  | 'ev-houou'

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
export function hasYakuRoute(hand: Hand, melds: Meld[], round: TileId, seat: TileId): boolean {
  const counts = hand.counts
  const meldTiles = melds.flatMap((m) => m.tiles.map((t) => t.id))

  // yakuhai: a pair is enough, since it can still become the triplet
  for (let id = HONOR; id < HONOR + 7; id++) {
    if (!isValuableHonor(id, round, seat)) continue
    if (counts[id] >= 2) return true
    if (meldTiles.filter((t) => t === id).length >= 3) return true
  }

  const all: TileId[] = [...meldTiles]
  for (let id = 0; id < counts.length; id++) for (let k = 0; k < counts[id]; k++) all.push(id)

  // tanyao: nothing terminal or honour anywhere
  if (all.every((id) => !isTerminalOrHonor(id))) return true

  // honitsu / chinitsu: at most one numbered suit in play
  const suits = new Set(all.map(suitOf).filter((s) => s !== 'z'))
  if (suits.size <= 1) return true

  // toitoi: already sitting on enough triplets that going all-triplets is realistic
  let triplets = melds.filter((m) => m.kind !== 'chi').length
  for (let id = 0; id < counts.length; id++) if (counts[id] >= 3) triplets++
  return triplets >= 2
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

export interface Call {
  kind: 'pon' | 'chi'
  /** The caller's own tiles that join the discard, in ascending order. */
  from: TileId[]
}

/** Every pon/chi this hand could legally make on `tile`; chi only from the player to the left.
 *  Exported for the human claim prompt (`round.ts#claimOptions`), which offers exactly the calls
 *  the AI weighs here rather than deriving a second, drifting notion of what is legal. */
export function availableCalls(hand: Hand, tile: TileId, fromKamicha: boolean): Call[] {
  const calls: Call[] = []
  if (hand.counts[tile] >= 2) calls.push({ kind: 'pon', from: [tile, tile] })
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

/** Shanten this hand would reach by taking `call` and then discarding its best tile. Shanten
 *  only: whether to call never depends on the ukeire behind it, and pricing it would put the
 *  simulator's most expensive operation on a path walked by every opponent on every discard. */
function shantenAfterCall(hand: Hand, call: Call): number {
  for (const id of call.from) removeTile(hand, id)
  hand.melds++
  const { shanten: after } = bestDiscards(hand)
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
