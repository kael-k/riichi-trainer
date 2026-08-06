import { KOKUSHI_TILES, type Meld, type MeldKind } from './agari'
import { mulberry32, type Rng } from './rng'
import { scoreHand } from './score'
import { HONOR, inTileSet, MAN, NUM_TILE_TYPES, parseTenhou, PIN, SOU, type ParsedTile, type TileId } from './tiles'
import type { WinContext } from './yaku'

export interface GenOptions {
  sanma: boolean
  aka: boolean
  openHands: boolean
  honba: boolean
}

/** A complete winning hand, ready to hand to `scoreHand` — everything the scoring trainer
 *  needs to render and grade one round. */
export interface ScoringSituation {
  /** Concealed tiles, including the winning tile. */
  concealed: ParsedTile[]
  melds: Meld[]
  ctx: WinContext
  doraIndicators: TileId[]
  uraIndicators: TileId[]
  /** Nukidora count (sanma). */
  kita: number
  honba: number
}

const SUIT_BASES = [MAN, PIN, SOU]

function randomTileId(rng: Rng, sanma: boolean): TileId {
  let id: TileId
  do {
    id = Math.floor(rng() * NUM_TILE_TYPES)
  } while (!inTileSet(id, sanma))
  return id
}

function reserve(used: Uint8Array, id: TileId, count: number): boolean {
  if (used[id] + count > 4) return false
  used[id] += count
  return true
}

/** Picks a tile id still under budget — for dora indicators, which draw from the same
 *  136-tile set as the hand and so can't exceed 4 copies of a kind either. */
function pickAvailable(rng: Rng, sanma: boolean, used: Uint8Array): TileId | null {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = randomTileId(rng, sanma)
    if (reserve(used, id, 1)) return id
  }
  return null
}

/** Tries to place one concealed set (run or triplet), pushing its tile(s) onto `concealedIds`
 *  and reserving them in `used`. Returns whether it succeeded within a bounded number of
 *  random attempts — callers abandon the whole hand and retry on failure. */
function placeSet(rng: Rng, sanma: boolean, used: Uint8Array, concealedIds: TileId[]): boolean {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (rng() < 0.65) {
      const base = SUIT_BASES[Math.floor(rng() * 3)]
      const start = base + Math.floor(rng() * 7)
      const ids = [start, start + 1, start + 2]
      if (ids.every((id) => inTileSet(id, sanma) && used[id] < 4)) {
        for (const id of ids) used[id]++
        concealedIds.push(...ids)
        return true
      }
    } else {
      const id = randomTileId(rng, sanma)
      if (reserve(used, id, 3)) {
        concealedIds.push(id, id, id)
        return true
      }
    }
  }
  return false
}

function placePair(rng: Rng, sanma: boolean, used: Uint8Array, concealedIds: TileId[]): boolean {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = randomTileId(rng, sanma)
    if (reserve(used, id, 2)) {
      concealedIds.push(id, id)
      return true
    }
  }
  return false
}

/** Tries to place one called meld, respecting `openHands` (false forces every meld to be an
 *  ankan, since that's the only call that doesn't break a closed hand). */
function placeMeld(rng: Rng, sanma: boolean, used: Uint8Array, openHands: boolean): Meld | null {
  const kind: MeldKind = !openHands
    ? 'ankan'
    : rng() < 0.4
      ? 'chi'
      : rng() < 0.78
        ? 'pon'
        : rng() < 0.5
          ? 'minkan'
          : 'ankan'

  for (let attempt = 0; attempt < 50; attempt++) {
    if (kind === 'chi') {
      const base = SUIT_BASES[Math.floor(rng() * 3)]
      const start = base + Math.floor(rng() * 7)
      const ids = [start, start + 1, start + 2]
      if (ids.every((id) => inTileSet(id, sanma) && used[id] < 4)) {
        for (const id of ids) used[id]++
        return { kind, tiles: ids.map((id) => ({ id, red: false })) }
      }
    } else {
      const count = kind === 'ankan' || kind === 'minkan' ? 4 : 3
      const id = randomTileId(rng, sanma)
      if (reserve(used, id, count)) {
        return { kind, tiles: Array.from({ length: count }, () => ({ id, red: false })) }
      }
    }
  }
  return null
}

function pickMeldCount(rng: Rng, openHands: boolean): number {
  const r = rng()
  // even without open calls, a closed hand can still show an occasional ankan
  if (!openHands) return r < 0.75 ? 0 : 1
  if (r < 0.5) return 0
  if (r < 0.75) return 1
  if (r < 0.9) return 2
  if (r < 0.97) return 3
  return 4
}

/** Marks red fives among the given ids in-place (at most one per suit, matching the rest of
 *  the app's "one aka per suit" convention), returning the resulting tile list. */
function markAka(rng: Rng, ids: TileId[]): ParsedTile[] {
  const fives = new Set([MAN + 4, PIN + 4, SOU + 4])
  const redSuits = new Set<TileId>()
  const tiles: ParsedTile[] = []
  for (const id of ids) {
    const canBeRed = fives.has(id) && !redSuits.has(id) && rng() < 0.4
    tiles.push({ id, red: canBeRed })
    if (canBeRed) redSuits.add(id)
  }
  return tiles
}

interface Attempt {
  concealedIds: TileId[]
  melds: Meld[]
  winTile: TileId
  closed: boolean
}

function attemptStandard(rng: Rng, sanma: boolean, openHands: boolean): Attempt | null {
  const used = new Uint8Array(NUM_TILE_TYPES)
  const melds: Meld[] = []
  const meldCount = pickMeldCount(rng, openHands)
  for (let i = 0; i < meldCount; i++) {
    const meld = placeMeld(rng, sanma, used, openHands)
    if (!meld) return null
    melds.push(meld)
  }

  const concealedIds: TileId[] = []
  const setsNeeded = 4 - melds.length
  for (let i = 0; i < setsNeeded; i++) {
    if (!placeSet(rng, sanma, used, concealedIds)) return null
  }
  if (!placePair(rng, sanma, used, concealedIds)) return null

  const winTile = concealedIds[Math.floor(rng() * concealedIds.length)]
  return { concealedIds, melds, winTile, closed: melds.every((m) => m.kind === 'ankan') }
}

function attemptChiitoi(rng: Rng, sanma: boolean): Attempt | null {
  const used = new Uint8Array(NUM_TILE_TYPES)
  const concealedIds: TileId[] = []
  for (let i = 0; i < 7; i++) {
    if (!placePair(rng, sanma, used, concealedIds)) return null
  }
  const winTile = concealedIds[Math.floor(rng() * concealedIds.length)]
  return { concealedIds, melds: [], winTile, closed: true }
}

function attemptKokushi(rng: Rng): Attempt {
  const concealedIds = [...KOKUSHI_TILES]
  const pairTile = KOKUSHI_TILES[Math.floor(rng() * KOKUSHI_TILES.length)]
  concealedIds.push(pairTile)
  return { concealedIds, melds: [], winTile: pairTile, closed: true }
}

function buildContext(rng: Rng, closed: boolean, hasKan: boolean, winTile: TileId, sanma: boolean): WinContext {
  const round = HONOR + Math.floor(rng() * 4)
  const seat = HONOR + Math.floor(rng() * (sanma ? 3 : 4))
  const tsumo = rng() < 0.45

  let riichi = false
  let doubleRiichi = false
  let ippatsu = false
  if (closed) {
    const r = rng()
    if (r < 0.35) riichi = true
    else if (r < 0.4) doubleRiichi = true
    if ((riichi || doubleRiichi) && rng() < 0.3) ippatsu = true
  }

  let haitei = false
  let houtei = false
  let rinshan = false
  let chankan = false
  const special = rng()
  if (special < 0.02 && hasKan && tsumo) rinshan = true
  else if (special < 0.04 && tsumo) haitei = true
  else if (special < 0.06 && !tsumo) houtei = true
  else if (special < 0.08 && !tsumo) chankan = true

  return {
    round,
    seat,
    tsumo,
    riichi,
    doubleRiichi,
    ippatsu,
    haitei,
    houtei,
    rinshan,
    chankan,
    winTile,
  }
}

function fallbackSituation(): ScoringSituation {
  // guaranteed-valid closed menzen-tsumo hand — pin/sou only, so it's legal under sanma too
  return {
    concealed: parseTenhou('23456799p234678s'),
    melds: [],
    ctx: {
      round: HONOR,
      seat: HONOR + 1,
      tsumo: true,
      riichi: false,
      doubleRiichi: false,
      ippatsu: false,
      haitei: false,
      houtei: false,
      rinshan: false,
      chankan: false,
      winTile: PIN + 1,
    },
    doraIndicators: [],
    uraIndicators: [],
    kita: 0,
    honba: 0,
  }
}

/**
 * Builds a deterministic, seeded, complete winning hand — the scoring-trainer analogue of
 * `deal()`: same seed always produces the same hand, which is what makes situation links
 * shareable. Constructive rather than rejection-sampled from a wall (a random 14-tile hand is
 * essentially never a winning one): picks a shape, fills its blocks against a 4-per-kind
 * budget, then re-rolls (bounded) if the result happens to have no legal yaku. A closed
 * menzen-tsumo fallback guarantees termination even if every attempt above comes up empty.
 */
export function generateHand(seed: string, options: GenOptions): ScoringSituation {
  const rng = mulberry32(seed)

  for (let i = 0; i < 300; i++) {
    const shapeRoll = rng()
    const attempt =
      shapeRoll < 0.9
        ? attemptStandard(rng, options.sanma, options.openHands)
        : shapeRoll < 0.97
          ? attemptChiitoi(rng, options.sanma)
          : attemptKokushi(rng)
    if (!attempt) continue

    const hasKan = attempt.melds.some((m) => m.kind === 'ankan' || m.kind === 'minkan')
    const ctx = buildContext(rng, attempt.closed, hasKan, attempt.winTile, options.sanma)

    const used = new Uint8Array(NUM_TILE_TYPES)
    for (const id of attempt.concealedIds) used[id]++
    for (const m of attempt.melds) for (const t of m.tiles) used[t.id]++

    const doraCount = 1 + attempt.melds.filter((m) => m.kind === 'ankan' || m.kind === 'minkan').length
    const doraIndicators: TileId[] = []
    for (let d = 0; d < doraCount; d++) {
      const id = pickAvailable(rng, options.sanma, used)
      if (id !== null) doraIndicators.push(id)
    }
    const uraIndicators: TileId[] = []
    if (ctx.riichi || ctx.doubleRiichi) {
      for (let d = 0; d < doraCount; d++) {
        const id = pickAvailable(rng, options.sanma, used)
        if (id !== null) uraIndicators.push(id)
      }
    }

    const concealed = options.aka ? markAka(rng, attempt.concealedIds) : attempt.concealedIds.map((id) => ({ id, red: false }))
    const kita = options.sanma && rng() < 0.25 ? Math.floor(rng() * 3) + 1 : 0
    const honba = options.honba && rng() < 0.3 ? Math.floor(rng() * 3) + 1 : 0

    const situation: ScoringSituation = {
      concealed,
      melds: attempt.melds,
      ctx,
      doraIndicators,
      uraIndicators,
      kita,
      honba,
    }

    const scored = scoreHand({
      concealed: situation.concealed,
      melds: situation.melds,
      ctx: situation.ctx,
      doraIndicators: situation.doraIndicators,
      uraIndicators: situation.uraIndicators,
      kita: situation.kita,
      rules: { kiriageMangan: false, honba: situation.honba, sanma: options.sanma },
    })
    if (scored) return situation
  }

  return fallbackSituation()
}
