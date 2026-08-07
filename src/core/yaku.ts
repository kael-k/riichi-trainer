import type { Arrangement, Block, Meld } from './agari'
import {
  HONOR,
  isDragon,
  isHonor,
  isTerminal,
  isTerminalOrHonor,
  isWind,
  type TileId,
} from './tiles'

export type YakuName =
  | 'riichi'
  | 'doubleRiichi'
  | 'ippatsu'
  | 'menzenTsumo'
  | 'tanyao'
  | 'pinfu'
  | 'iipeikou'
  | 'yakuhaiHaku'
  | 'yakuhaiHatsu'
  | 'yakuhaiChun'
  | 'yakuhaiSeatWind'
  | 'yakuhaiRoundWind'
  | 'haitei'
  | 'houtei'
  | 'rinshan'
  | 'chankan'
  | 'chiitoitsu'
  | 'sanshokuDoujun'
  | 'ittsuu'
  | 'chanta'
  | 'toitoi'
  | 'sanankou'
  | 'sankantsu'
  | 'sanshokuDoukou'
  | 'honroutou'
  | 'shousangen'
  | 'ryanpeikou'
  | 'honitsu'
  | 'junchan'
  | 'chinitsu'

export type YakumanName =
  | 'kokushi'
  | 'suuankou'
  | 'daisangen'
  | 'shousuushii'
  | 'daisuushii'
  | 'tsuuiisou'
  | 'chinroutou'
  | 'ryuuiisou'
  | 'chuuren'
  | 'suukantsu'

export interface YakuHit {
  name: YakuName
  han: number
}

export interface WinContext {
  /** Round/seat wind tiles, e.g. `HONOR` for East. */
  round: TileId
  seat: TileId
  tsumo: boolean
  riichi: boolean
  doubleRiichi: boolean
  ippatsu: boolean
  haitei: boolean
  houtei: boolean
  rinshan: boolean
  chankan: boolean
  winTile: TileId
}

/** True when the hand has no calls at all — the strict pinfu/iipeikou requirement (stricter
 *  than "closed", which still allows a closed kan). */
export function isFullyConcealed(melds: Meld[]): boolean {
  return melds.length === 0
}

/** True when the hand has no *open* calls — closed kans don't break menzen (riichi, tsumo,
 *  the closed-ron fu bonus). */
export function isMenzen(melds: Meld[]): boolean {
  return melds.every((m) => m.kind === 'ankan')
}

/** True when `block` counts as a closed triplet (ankou) for fu/sanankou purposes. A concealed
 *  triplet completed by RON on the winning block counts as open (minkou) instead — the tile
 *  came from a discard, same as if it had been called. */
export function isClosedTripletBlock(
  block: Block,
  isWinningBlock: boolean,
  tsumo: boolean,
): boolean {
  if (block.kind !== 'triplet') return false
  if (block.meld) return block.meld.kind === 'ankan'
  return !(isWinningBlock && !tsumo)
}

/** Which wait shape produced `winTile` in this run/triplet/pair block, given it's the block
 *  that supplied the winning tile. Only meaningful for a concealed (non-meld) block. */
export type WaitShape = 'ryanmen' | 'kanchan' | 'penchan' | 'tanki' | 'shanpon'

export function waitShape(block: Block, winTile: TileId): WaitShape {
  if (block.kind === 'pair') return 'tanki'
  if (block.kind === 'triplet') return 'shanpon'
  const offset = winTile - block.tile
  const rank = block.tile % 9 // 0-indexed rank of the run's lowest tile
  if (offset === 1) return 'kanchan'
  if (offset === 2 && rank === 0) return 'penchan' // held 1-2, won on 3
  if (offset === 0 && rank === 6) return 'penchan' // held 8-9, won on 7
  return 'ryanmen'
}

function suitsUsed(tileIds: TileId[]): Set<'m' | 'p' | 's' | 'z'> {
  const suits = new Set<'m' | 'p' | 's' | 'z'>()
  for (const id of tileIds) suits.add(id >= HONOR ? 'z' : id < 9 ? 'm' : id < 18 ? 'p' : 's')
  return suits
}

/** Every physical tile id in a block (kans repeat the tile 4 times, others 2-3). */
function blockTileIds(b: Block): TileId[] {
  if (b.meld) return b.meld.tiles.map((t) => t.id)
  if (b.kind === 'run') return [b.tile, b.tile + 1, b.tile + 2]
  return b.kind === 'triplet' ? [b.tile, b.tile, b.tile] : [b.tile, b.tile]
}

/** Detects yaku for one (arrangement, winning-block) reading. `winningBlockIndex` names the
 *  concealed block credited with supplying `ctx.winTile` — every other triplet/kan block is
 *  necessarily pre-existing (closed) since its tiles were already in hand before the win. */
export function detectYaku(
  arrangement: Arrangement,
  melds: Meld[],
  ctx: WinContext,
  winningBlockIndex?: number,
): { yaku: YakuHit[]; yakuman: YakumanName[] } {
  if (arrangement.kind === 'kokushi') return { yaku: [], yakuman: ['kokushi'] }

  if (arrangement.kind === 'chiitoi') {
    const yaku: YakuHit[] = [{ name: 'chiitoitsu', han: 2 }]
    pushRiichiTsumoEdge(yaku, ctx, true)
    if (arrangement.pairs.every((t) => !isTerminalOrHonor(t))) yaku.push({ name: 'tanyao', han: 1 })
    const suits = suitsUsed(arrangement.pairs)
    if (suits.size === 1 && !suits.has('z')) yaku.push({ name: 'chinitsu', han: 6 })
    else if (suits.size === 2 && suits.has('z')) yaku.push({ name: 'honitsu', han: 3 })
    if (arrangement.pairs.every((t) => isTerminal(t) || isHonor(t))) {
      // honroutou already implies tanyao is false; chiitoi + all-terminal/honor pairs is itself
      // an honroutou reading worth the same as the standard-hand yaku
      yaku.push({ name: 'honroutou', han: 2 })
    }
    return { yaku, yakuman: [] }
  }

  const blocks = arrangement.blocks
  const menzen = isMenzen(melds)
  const fullyConcealed = isFullyConcealed(melds)
  const win = winningBlockIndex !== undefined ? blocks[winningBlockIndex] : undefined
  const winShape = win ? waitShape(win, ctx.winTile) : undefined

  const yakuman: YakumanName[] = []
  const allIds = blocks.flatMap(blockTileIds)
  const suits = suitsUsed(allIds)

  const closedTripletCount = blocks.filter((b, i) =>
    isClosedTripletBlock(b, i === winningBlockIndex, ctx.tsumo),
  ).length
  if (closedTripletCount === 4) yakuman.push('suuankou')

  const dragonTriplets = blocks.filter((b) => b.kind === 'triplet' && isDragon(b.tile)).length
  const dragonPair = blocks.find((b) => b.kind === 'pair' && isDragon(b.tile))
  if (dragonTriplets === 3) yakuman.push('daisangen')

  const windTriplets = blocks.filter((b) => b.kind === 'triplet' && isWind(b.tile)).length
  const windPair = blocks.find((b) => b.kind === 'pair' && isWind(b.tile))
  if (windTriplets === 4) yakuman.push('daisuushii')
  else if (windTriplets === 3 && windPair) yakuman.push('shousuushii')

  if (allIds.every((id) => isHonor(id))) yakuman.push('tsuuiisou')
  if (allIds.every((id) => isTerminal(id))) yakuman.push('chinroutou')
  const GREEN_TILES = new Set([19, 20, 21, 23, 25, HONOR + 5]) // 2s3s4s6s8s + hatsu
  if (allIds.every((id) => GREEN_TILES.has(id))) yakuman.push('ryuuiisou')

  const kanBlocks = blocks.filter((b) => b.meld?.kind === 'ankan' || b.meld?.kind === 'minkan')
  if (kanBlocks.length === 4) yakuman.push('suukantsu')

  if (fullyConcealed && suits.size === 1 && !suits.has('z')) {
    const suitId = allIds.find((id) => id < HONOR)!
    const suitBase = suitId - (suitId % 9)
    const counts = new Array(9).fill(0)
    for (const id of allIds) if (id >= suitBase && id < suitBase + 9) counts[id - suitBase]++
    // chuuren: 1112345678999 of one suit plus any 14th tile of that suit
    const isChuuren =
      counts[0] >= 3 &&
      counts[8] >= 3 &&
      counts.slice(1, 8).every((c) => c >= 1) &&
      counts.reduce((a, b) => a + b, 0) === 14
    if (isChuuren) yakuman.push('chuuren')
  }

  if (yakuman.length > 0) return { yaku: [], yakuman }

  const yaku: YakuHit[] = []
  pushRiichiTsumoEdge(yaku, ctx, menzen)
  if (ctx.haitei) yaku.push({ name: ctx.tsumo ? 'haitei' : 'houtei', han: 1 })
  if (ctx.rinshan) yaku.push({ name: 'rinshan', han: 1 })
  if (ctx.chankan) yaku.push({ name: 'chankan', han: 1 })

  if (allIds.every((id) => !isTerminalOrHonor(id))) yaku.push({ name: 'tanyao', han: 1 })

  const pair = blocks.find((b) => b.kind === 'pair')
  if (
    fullyConcealed &&
    winShape === 'ryanmen' &&
    blocks.every((b) => b.kind !== 'triplet') && // every set must be a run, kans included
    pair &&
    !isDragon(pair.tile) &&
    pair.tile !== ctx.seat &&
    pair.tile !== ctx.round
  ) {
    yaku.push({ name: 'pinfu', han: 1 })
  }

  const runs = blocks.filter((b) => b.kind === 'run' && !b.meld)
  const runKey = (b: Block) => `${b.tile % 9}`
  const runsBySuitRank = new Map<string, number>()
  for (const r of runs) {
    const key = `${r.tile < 9 ? 'm' : r.tile < 18 ? 'p' : 's'}${runKey(r)}`
    runsBySuitRank.set(key, (runsBySuitRank.get(key) ?? 0) + 1)
  }
  const iipeikouPairs = [...runsBySuitRank.values()].filter((n) => n >= 2).length
  if (fullyConcealed && iipeikouPairs >= 2) yaku.push({ name: 'ryanpeikou', han: 3 })
  else if (fullyConcealed && iipeikouPairs >= 1) yaku.push({ name: 'iipeikou', han: 1 })

  const tripletBlocks = blocks.filter((b) => b.kind === 'triplet')
  for (const b of tripletBlocks) {
    if (b.tile === HONOR + 4) yaku.push({ name: 'yakuhaiHaku', han: 1 })
    if (b.tile === HONOR + 5) yaku.push({ name: 'yakuhaiHatsu', han: 1 })
    if (b.tile === HONOR + 6) yaku.push({ name: 'yakuhaiChun', han: 1 })
    if (b.tile === ctx.seat) yaku.push({ name: 'yakuhaiSeatWind', han: 1 })
    if (b.tile === ctx.round) yaku.push({ name: 'yakuhaiRoundWind', han: 1 })
  }

  const allRuns = blocks.filter((b) => b.kind === 'run')
  const ranksBySuit = new Map<'m' | 'p' | 's', Set<number>>()
  for (const r of allRuns) {
    const suit = r.tile < 9 ? 'm' : r.tile < 18 ? 'p' : 's'
    if (!ranksBySuit.has(suit)) ranksBySuit.set(suit, new Set())
    ranksBySuit.get(suit)!.add(r.tile % 9)
  }
  const rankSets = new Map<number, Set<'m' | 'p' | 's'>>()
  for (const [suit, ranks] of ranksBySuit) {
    for (const rank of ranks) {
      if (!rankSets.has(rank)) rankSets.set(rank, new Set())
      rankSets.get(rank)!.add(suit)
    }
  }
  const sanshokuDoujun = [...rankSets.values()].some((s) => s.size === 3)
  if (sanshokuDoujun) yaku.push({ name: 'sanshokuDoujun', han: menzen ? 2 : 1 })

  for (const [, ranks] of ranksBySuit) {
    if (ranks.has(0) && ranks.has(3) && ranks.has(6)) {
      yaku.push({ name: 'ittsuu', han: menzen ? 2 : 1 })
      break
    }
  }

  if (blocks.every((b) => b.kind !== 'run')) yaku.push({ name: 'toitoi', han: 2 })

  if (closedTripletCount === 3) yaku.push({ name: 'sanankou', han: 2 })
  if (kanBlocks.length === 3) yaku.push({ name: 'sankantsu', han: 2 })

  const suitedTripletsByRank = new Map<number, Set<'m' | 'p' | 's'>>()
  for (const b of tripletBlocks) {
    if (b.tile >= HONOR) continue
    const suit = b.tile < 9 ? 'm' : b.tile < 18 ? 'p' : 's'
    const rank = b.tile % 9
    if (!suitedTripletsByRank.has(rank)) suitedTripletsByRank.set(rank, new Set())
    suitedTripletsByRank.get(rank)!.add(suit)
  }
  if ([...suitedTripletsByRank.values()].some((s) => s.size === 3)) {
    yaku.push({ name: 'sanshokuDoukou', han: 2 })
  }

  if (allIds.every((id) => isTerminal(id) || isHonor(id))) yaku.push({ name: 'honroutou', han: 2 })
  if (dragonTriplets === 2 && dragonPair) yaku.push({ name: 'shousangen', han: 2 })

  // chanta/junchan: every block (including the pair) touches a terminal or honor, and at
  // least one run is present (otherwise it's honroutou/toitoi territory, not chanta)
  if (allRuns.length > 0) {
    const junchanShape = blocks.every((b) => {
      const ids = blockTileIds(b)
      if (b.kind === 'run') return ids[0] % 9 === 0 || ids[0] % 9 === 6
      return isTerminalOrHonor(ids[0])
    })
    if (junchanShape) {
      // junchan is chanta with no honor tiles anywhere — the blocks still only need to
      // *touch* a terminal, not be made entirely of them (a run's middle tiles are simples)
      const noHonors = allIds.every((id) => !isHonor(id))
      yaku.push({
        name: noHonors ? 'junchan' : 'chanta',
        han: noHonors ? (menzen ? 3 : 2) : menzen ? 2 : 1,
      })
    }
  }

  if (suits.size === 1 && !suits.has('z')) yaku.push({ name: 'chinitsu', han: menzen ? 6 : 5 })
  else if (suits.size === 2 && suits.has('z')) yaku.push({ name: 'honitsu', han: menzen ? 3 : 2 })

  return { yaku, yakuman: [] }
}

function pushRiichiTsumoEdge(yaku: YakuHit[], ctx: WinContext, menzen: boolean): void {
  if (menzen && ctx.doubleRiichi) yaku.push({ name: 'doubleRiichi', han: 2 })
  else if (menzen && ctx.riichi) yaku.push({ name: 'riichi', han: 1 })
  if (menzen && ctx.riichi && ctx.ippatsu) yaku.push({ name: 'ippatsu', han: 1 })
  if (menzen && ctx.tsumo) yaku.push({ name: 'menzenTsumo', han: 1 })
}
