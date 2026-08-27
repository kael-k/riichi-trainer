import { decompose, type Block, type Meld } from './agari'
import {
  doraFromIndicator,
  HONOR,
  isDragon,
  isTerminalOrHonor,
  NUM_TILE_TYPES,
  type ParsedTile,
  type TileId,
} from './tiles'
import {
  detectYaku,
  isClosedTripletBlock,
  isMenzen,
  waitShape,
  type WinContext,
  type YakuHit,
  type YakumanName,
} from './yaku'

export type FuReason = 'base' | 'tsumo' | 'closedRon' | 'meld' | 'pair' | 'wait'

export interface FuItem {
  reason: FuReason
  fu: number
  tile?: TileId
}

export interface Payments {
  /** Ron: what the discarder pays, honba included. Tsumo: what each non-dealer pays. */
  main: number
  /** Non-dealer tsumo only: what the dealer pays. */
  fromDealer?: number
  total: number
}

export interface ScoringRules {
  kiriageMangan: boolean
  honba: number
  /** Three-player rules: only 2 other seats, so non-dealer tsumo splits dealer 2x / one
   *  other non-dealer 1x instead of dealer 2x / two others 1x each. */
  sanma: boolean
}

export type LimitName = 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'kazoe' | 'yakuman'

export interface ScoreResult {
  /** For a yakuman result this is a nominal 13 * (number of stacked yakuman) — yakuman payouts
   *  don't actually depend on a han count, but quizzing a real number keeps the field consistent
   *  with the kazoe-yakuman bracket it lines up with. */
  han: number
  yaku: YakuHit[]
  yakuman: YakumanName[]
  dora: { dora: number; aka: number; ura: number; kita: number }
  fu: number
  fuExact: number
  fuItems: FuItem[]
  limit?: LimitName
  payments: Payments
}

export interface ScoreInput {
  /** Concealed tiles, including the winning tile. */
  concealed: ParsedTile[]
  melds: Meld[]
  ctx: WinContext
  doraIndicators: TileId[]
  uraIndicators: TileId[]
  /** Nukidora count (sanma) — each pulled north is worth 1 han, like a dora. */
  kita: number
  rules: ScoringRules
}

function countMatches(tiles: ParsedTile[], targets: TileId[]): number {
  let n = 0
  for (const t of tiles) for (const target of targets) if (t.id === target) n++
  return n
}

function blockContainsTile(b: Block, tile: TileId): boolean {
  if (b.kind === 'run') return tile >= b.tile && tile <= b.tile + 2
  return b.tile === tile
}

function meldFu(tileId: TileId, kan: boolean, closed: boolean): number {
  const base = kan ? 8 : 2
  return base * (isTerminalOrHonor(tileId) ? 2 : 1) * (closed ? 2 : 1)
}

function computeFu(
  blocks: Block[],
  melds: Meld[],
  ctx: WinContext,
  winningBlockIndex: number,
  pinfu: boolean,
): { fu: number; fuExact: number; items: FuItem[] } {
  // Pinfu's two fixed values, stated as the rule rather than left to emerge from the sum below.
  // Tsumo (20) has to be special-cased: the generic path would add the 2 self-draw fu and round
  // 22 up to 30. Ron (30) is what the generic path already computes today — 20 base + 10 closed
  // ron, with pinfu's own conditions zeroing every other source (all sets runs ⇒ no meld fu;
  // pair never dragon/seat/round ⇒ no pair fu; ryanmen ⇒ no wait fu) — so this arm is
  // deliberately redundant, NOT dead code: it pins 30 fu if that arithmetic ever stops holding
  // (a looser pinfu reading, an open-pinfu variant, a ruleset with different wait fu). Drifting
  // silently would be worse than most bugs here, since `isBetter` ranks readings by fu and would
  // pick the inflated one. The "exactly 30 fu" test in score.test.ts pins the value; it passes
  // through either path, so it guards the number, not this branch's existence.
  if (pinfu) {
    return ctx.tsumo
      ? { fu: 20, fuExact: 20, items: [{ reason: 'base', fu: 20 }] }
      : {
          fu: 30,
          fuExact: 30,
          items: [
            { reason: 'base', fu: 20 },
            { reason: 'closedRon', fu: 10 },
          ],
        }
  }

  const items: FuItem[] = [{ reason: 'base', fu: 20 }]
  const menzen = isMenzen(melds)
  if (ctx.tsumo) items.push({ reason: 'tsumo', fu: 2 })
  else if (menzen) items.push({ reason: 'closedRon', fu: 10 })

  blocks.forEach((b, i) => {
    if (b.kind === 'triplet') {
      const kan = b.meld?.kind === 'ankan' || b.meld?.kind === 'minkan'
      const closed = isClosedTripletBlock(b, i === winningBlockIndex, ctx.tsumo)
      items.push({ reason: 'meld', fu: meldFu(b.tile, kan, closed), tile: b.tile })
    } else if (b.kind === 'pair') {
      let pairFu = 0
      if (isDragon(b.tile)) pairFu += 2
      if (b.tile === ctx.seat) pairFu += 2
      if (b.tile === ctx.round) pairFu += 2
      if (pairFu > 0) items.push({ reason: 'pair', fu: pairFu, tile: b.tile })
    }
  })

  const shape = waitShape(blocks[winningBlockIndex], ctx.winTile)
  if (shape === 'tanki' || shape === 'kanchan' || shape === 'penchan') {
    items.push({ reason: 'wait', fu: 2 })
  }

  const fuExact = items.reduce((sum, it) => sum + it.fu, 0)
  return { fu: Math.ceil(fuExact / 10) * 10, fuExact, items }
}

const MANGAN_BASIC = 2000

/** Basic points (before the ron/tsumo multiplier). Han >= 6 is a flat lookup by bracket,
 *  independent of fu; below that it's the `fu * 2^(2+han)` formula, capped at mangan once it
 *  would exceed 2000 — which is also how 3han/70fu and 4han/40fu naturally land on mangan
 *  without special-casing. Kiriage mangan only has to cover the two combos that fall just
 *  short of that cap: 4han/30fu and 3han/60fu, both worth 1920 uncapped. */
function basicPoints(
  han: number,
  fu: number,
  kiriageMangan: boolean,
): { basic: number; limit?: LimitName } {
  if (han >= 13) return { basic: 8000, limit: 'kazoe' }
  if (han >= 11) return { basic: 6000, limit: 'sanbaiman' }
  if (han >= 8) return { basic: 4000, limit: 'baiman' }
  if (han >= 6) return { basic: 3000, limit: 'haneman' }
  const raw = fu * 2 ** (2 + han)
  if (raw >= MANGAN_BASIC) return { basic: MANGAN_BASIC, limit: 'mangan' }
  if (kiriageMangan && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) {
    return { basic: MANGAN_BASIC, limit: 'mangan' }
  }
  return { basic: raw }
}

/**
 * What a closed ron of this han and fu pays, without a hand to score.
 *
 * `scoreHand` prices a hand you can see; this prices one you cannot — the EV model's derived
 * deal-in cost, where han comes out of a combinatorial expectation rather than off a yaku list.
 * Same limit brackets and the same rounding as a real win, so the two never disagree about what
 * 4 han 30 fu is worth.
 */
export function ronValue(
  han: number,
  fu: number,
  dealer: boolean,
  rules: ScoringRules,
): number {
  const { basic } = basicPoints(han, fu, rules.kiriageMangan)
  return roundUp100((dealer ? 6 : 4) * basic)
}

function roundUp100(n: number): number {
  return Math.ceil(n / 100) * 100
}

function computePayments(
  basic: number,
  dealer: boolean,
  ctx: WinContext,
  rules: ScoringRules,
): Payments {
  const players = rules.sanma ? 3 : 4
  const honbaTotal = rules.honba * 300
  const honbaPerPayer = rules.honba * 100

  if (ctx.tsumo) {
    if (dealer) {
      const each = roundUp100(2 * basic + honbaPerPayer)
      return { main: each, total: each * (players - 1) }
    }
    const fromDealer = roundUp100(2 * basic + honbaPerPayer)
    const fromOthers = roundUp100(basic + honbaPerPayer)
    const otherPayers = players - 2 // seats that are neither the dealer nor the winner
    return { main: fromOthers, fromDealer, total: fromDealer + fromOthers * otherPayers }
  }
  const total = roundUp100((dealer ? 6 : 4) * basic) + honbaTotal
  return { main: total, total }
}

function isBetter(a: ScoreResult, b: ScoreResult): boolean {
  if (a.payments.total !== b.payments.total) return a.payments.total > b.payments.total
  if (a.han !== b.han) return a.han > b.han
  if (a.fu !== b.fu) return a.fu > b.fu
  // two readings that pay the same can still differ before rounding (e.g. 26 vs 28 fu, both
  // 30) — the exact-fu drill grades that number, so pick by rule instead of by enumeration order
  return a.fuExact > b.fuExact
}

/**
 * Scores a complete winning hand. Enumerates every decomposition (`decompose`) and, for each,
 * every concealed block the winning tile could plausibly have completed — the same hand can
 * read as e.g. a shanpon wait into one triplet or a different, better-scoring split — and
 * returns the highest-scoring reading, same rule the original scoringtrainer states. Returns
 * `null` when the hand has no legal winning reading at all (no yaku on any reading).
 */
export function scoreHand(input: ScoreInput): ScoreResult | null {
  const { concealed, melds, ctx, doraIndicators, uraIndicators, kita, rules } = input
  const counts = new Uint8Array(NUM_TILE_TYPES)
  for (const t of concealed) counts[t.id]++

  const arrangements = decompose(counts, melds)
  if (arrangements.length === 0) return null

  const allPhysicalTiles = [...concealed, ...melds.flatMap((m) => m.tiles)]
  const doraCount = countMatches(allPhysicalTiles, doraIndicators.map(doraFromIndicator))
  const uraCount =
    ctx.riichi || ctx.doubleRiichi
      ? countMatches(allPhysicalTiles, uraIndicators.map(doraFromIndicator))
      : 0
  const akaCount = allPhysicalTiles.filter((t) => t.red).length
  const dealer = ctx.seat === HONOR

  let best: ScoreResult | null = null
  for (const arrangement of arrangements) {
    const winningBlockIndices: (number | undefined)[] =
      arrangement.kind === 'standard'
        ? arrangement.blocks
            .map((b, i) => (!b.meld && blockContainsTile(b, ctx.winTile) ? i : -1))
            .filter((i) => i >= 0)
        : [undefined]

    for (const winningBlockIndex of winningBlockIndices) {
      const { yaku, yakuman } = detectYaku(arrangement, melds, ctx, winningBlockIndex)
      if (yaku.length === 0 && yakuman.length === 0) continue // not a legal win on this reading

      const isYakuman = yakuman.length > 0
      const bonusHan = isYakuman ? 0 : doraCount + uraCount + akaCount + kita
      const han = isYakuman ? 13 * yakuman.length : yaku.reduce((s, y) => s + y.han, 0) + bonusHan
      const pinfu = yaku.some((y) => y.name === 'pinfu')

      let fu = 0
      let fuExact = 0
      let fuItems: FuItem[] = []
      if (arrangement.kind === 'standard' && winningBlockIndex !== undefined) {
        ;({
          fu,
          fuExact,
          items: fuItems,
        } = computeFu(arrangement.blocks, melds, ctx, winningBlockIndex, pinfu))
      } else if (arrangement.kind === 'chiitoi') {
        fu = 25
        fuExact = 25
        fuItems = [{ reason: 'base', fu: 25 }]
      }

      const { basic, limit } = isYakuman
        ? { basic: 8000 * yakuman.length, limit: 'yakuman' as const }
        : basicPoints(han, fu, rules.kiriageMangan)

      const result: ScoreResult = {
        han,
        yaku,
        yakuman,
        dora: { dora: doraCount, aka: akaCount, ura: uraCount, kita },
        fu,
        fuExact,
        fuItems,
        limit,
        payments: computePayments(basic, dealer, ctx, rules),
      }
      if (!best || isBetter(result, best)) best = result
    }
  }
  return best
}
