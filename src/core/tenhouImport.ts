import { createMatch, settleRound, type MatchState } from './match'
import type { Call } from './policy'
import { createRound, replayLog, roundResult, type LogEntry, type RoundOptions } from './round'
import type { TenhouRules } from './tenhouLog'
import { HONOR, type ParsedTile, type TileId } from './tiles'
import {
  DEAD_WALL_SIZE,
  INITIAL_HAND_SIZE,
  dealtIndices,
  fullWallSize,
  validateWall,
  wallWithPinned,
} from './wall'

/**
 * Reads a tenhou.net/6 JSON log back into what `/match` plays: per round, the starting
 * `MatchState`, a full wall in draw order and the decision log `replayLog` drives — exactly
 * `core/tenhouLog.ts#buildKyoku`'s input, so this is that module's inverse and an imported round
 * re-exports to the record it came from.
 *
 * A record names actions, not wall positions, so the wall is rebuilt from where `createRound`
 * would have dealt each revealed tile: haipai at `dealtIndices`, the k-th live draw at `13P + k`,
 * replacements and dora indicators in the dead-wall chunk exactly as `drawReplacement` and
 * `createRound` read it. Every slot the record never reveals is filled at random — nothing in the
 * replay reads one.
 *
 * Every round is then replayed through the real engine, and **what the engine refuses is cut, not
 * repaired**: the log is truncated to what `replayLog` consumed and a notice says why. Endings the
 * engine does not model (double ron, chankan, nagashi mangan, the four abortive draws past
 * kyuushu) stop before the ending; a modelled ending whose settlement disagrees with the record's
 * is kept, with a notice.
 */

/** Endings the engine does not model — the round stops just before one. */
type Unmodelled =
  | 'doubleRon'
  | 'chankan'
  | 'nagashiMangan'
  | 'suufonRenda'
  | 'suuchaRiichi'
  | 'suukaikan'
  | 'sanchahou'

/** Why a round is not the record verbatim — a code (later an i18n key), never text. */
export type ImportNotice =
  /** `'stopped'`: the engine refused an action the record took; the log stops before it. */
  | { code: Unmodelled | 'stopped' }
  /** The round replayed to its end, but the engine settles it differently — a rule it plays its
   *  own way: kan-dora timing, pao, a riichi ronned on its own declaration tile, … */
  | { code: 'pays'; record: number[]; engine: number[] }

export interface ImportedRound {
  /** The round's **starting** match, as `TenhouRoundInput.match` means it. */
  match: MatchState
  wall: ParsedTile[]
  /** Truncated to what the engine replayed, and carrying no `pass` — replay infers those. */
  log: LogEntry[]
  /** `TenhouRoundInput.deltas`: the engine's own settlement where it reached the record's ending,
   *  the record's where it did not. */
  deltas: number[]
  notice?: ImportNotice
}

export interface ImportedGame {
  rules: TenhouRules
  names: string[]
  rounds: ImportedRound[]
}

/** `kyoku` is the index into the record's `log` of the round that failed. */
export type ImportError = { error: 'notTenhou' | 'tiles' | 'rules'; kyoku?: number }

class Malformed extends Error {
  code: ImportError['error']
  constructor(code: ImportError['error']) {
    super(code)
    this.code = code
  }
}

function fail(code: ImportError['error']): never {
  throw new Malformed(code)
}

const TSUMOGIRI = 60
const EXHAUSTIVE = new Set(['流局', '全員聴牌', '全員不聴'])
const UNMODELLED: Record<string, Unmodelled> = {
  流し満貫: 'nagashiMangan',
  四風連打: 'suufonRenda',
  四家立直: 'suuchaRiichi',
  四槓散了: 'suukaikan',
  三家和了: 'sanchahou',
  三家和: 'sanchahou',
}

/** `tenhouLog.ts#tenhouTile` inverted. */
function decodeTile(code: unknown): ParsedTile {
  if (typeof code !== 'number' || !Number.isInteger(code)) fail('notTenhou')
  if (code >= 51 && code <= 53) return { id: (code - 51) * 9 + 4, red: true }
  const suit = Math.floor(code / 10)
  const rank = code % 10
  if (suit >= 1 && suit <= 3 && rank >= 1) return { id: (suit - 1) * 9 + rank - 1, red: false }
  if (suit === 4 && rank >= 1 && rank <= 7) return { id: HONOR + rank - 1, red: false }
  return fail('notTenhou')
}

interface Naki {
  kind: 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan'
  /** The tile after the marker: the called one, a kakan's added one, an ankan's fourth. */
  marked: ParsedTile
  /** Every other tile in the string. */
  rest: ParsedTile[]
  /** Seats ahead of the caller the called tile came from (`tenhouLog.ts#relSeat`). */
  rel: number
}

const NAKI_KIND = { c: 'chi', p: 'pon', m: 'minkan', k: 'kakan', a: 'ankan' } as const
/** Marker slot to relative seat, per kind — `ponSlot`/`MINKAN_SLOT` inverted; `-1` is illegal. */
const NAKI_REL: Record<Naki['kind'], number[]> = {
  chi: [3],
  pon: [3, 2, 1],
  kakan: [3, 2, 1],
  minkan: [3, 2, -1, 1],
  ankan: [-1, -1, -1, 0],
}

function parseNaki(s: string): Naki {
  const m = /^((?:\d\d)*)([cpmka])((?:\d\d)+)$/.exec(s)
  if (!m) fail('notTenhou')
  const codes = (digits: string) => (digits.match(/\d\d/g) ?? []).map((c) => decodeTile(Number(c)))
  const before = codes(m[1])
  const after = codes(m[3])
  const kind = NAKI_KIND[m[2] as keyof typeof NAKI_KIND]
  const rel = NAKI_REL[kind][before.length] ?? -1
  const size = kind === 'chi' || kind === 'pon' ? 3 : 4
  if (rel < 0 || before.length + after.length !== size) fail('notTenhou')
  const naki: Naki = { kind, marked: after[0], rest: [...before, ...after.slice(1)], rel }
  const ids = [naki.marked, ...naki.rest].map((t) => t.id).sort((a, b) => a - b)
  const run = ids[0] < HONOR && ids[1] === ids[0] + 1 && ids[2] === ids[0] + 2
  const sameSuit = Math.floor(ids[0] / 9) === Math.floor(ids[2] / 9)
  if (kind === 'chi' ? !(run && sameSuit) : ids.some((id) => id !== ids[0])) fail('notTenhou')
  return naki
}

const same = (a: ParsedTile, b: ParsedTile) => a.id === b.id && a.red === b.red

interface Seat {
  takes: unknown[]
  discards: unknown[]
  ti: number
  di: number
  /** Kinds this seat holds the red copy of — what decides `Call.keepRed`. */
  reds: Set<TileId>
  /** The tile a `60` names: the last draw, until it is thrown. */
  drawn?: ParsedTile
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail('notTenhou')
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fail('notTenhou')
}

function importRound(
  raw: unknown,
  index: number,
  rules: TenhouRules,
  dealerRepeat: number,
): ImportedRound {
  const entry = asArray(raw)
  if (entry.length !== 17) fail('notTenhou')
  const { sanma, aka } = rules
  const players = sanma ? 3 : 4
  // full length or nothing: a missing key would reach `createMatch` as an `undefined` override
  const header = asArray(entry[0]).map(asCount)
  const points = asArray(entry[1])
    .slice(0, players)
    .map((p) => (typeof p === 'number' ? p : fail('notTenhou')))
  if (header.length !== 3 || points.length !== players) fail('notTenhou')
  const [k, honba, riichiSticks] = header
  if (k % 4 >= players) fail('rules')
  const match = createMatch(sanma, {
    prevalentWind: HONOR + Math.floor(k / 4),
    round: (k % 4) + 1,
    dealer: k % 4,
    honba,
    dealerRepeat,
    riichiSticks,
    points,
  })

  // where `createRound` deals each tile from: `players * 13` dealt, `live` drawable, the last 14
  // the dead wall — replacements pop its tail, then the live wall's once its own four are gone
  const full = fullWallSize(sanma)
  const dealt = players * INITIAL_HAND_SIZE
  const live = full - dealt - DEAD_WALL_SIZE
  const chunk = full - DEAD_WALL_SIZE
  const pinned = new Map<number, ParsedTile>()
  const pin = (at: number, tile: ParsedTile) => pinned.set(at, tile)
  let front = 0
  let rinshan = 0
  const replacementAt = (r: number) => (r < 4 ? chunk + 13 - r : dealt + live - 1 - (r - 4))
  // the i-th dora indicator and its ura, in the order `createRound` stacks them
  const dora = asArray(entry[2])
  const ura = asArray(entry[3])
  if (dora.length > 5 || ura.length > 5) fail('notTenhou')
  dora.forEach((code, i) => pin(chunk + 8 - 2 * i, decodeTile(code)))
  ura.forEach((code, i) => pin(chunk + 9 - 2 * i, decodeTile(code)))

  const seats: Seat[] = Array.from({ length: players }, (_, s) => {
    const haipai = asArray(entry[4 + 3 * s])
    if (haipai.length !== INITIAL_HAND_SIZE) fail('notTenhou')
    const slots = dealtIndices(s, players)
    const reds = new Set<TileId>()
    haipai.forEach((code, i) => {
      const tile = decodeTile(code)
      pin(slots[i], tile)
      if (tile.red) reds.add(tile.id)
    })
    return {
      takes: asArray(entry[5 + 3 * s]),
      discards: asArray(entry[6 + 3 * s]),
      ti: 0,
      di: 0,
      reds,
    }
  })

  const log: LogEntry[] = []
  let notice: ImportNotice | undefined
  let modelled = false
  const result = asArray(entry[16])
  const name = result[0]
  if (typeof name !== 'string') fail('notTenhou')

  // the hand ends where the record runs out: the acting seat has no take left (after a discard:
  // a ron, an exhaustive draw, an abortive one; after a kan: a chankan) or no discard after one
  // (a tsumo, kyuushu)
  const end = (seat: number, afterRinshan: boolean) => {
    const last = log.at(-1)
    const afterKan = afterRinshan && (last?.kind === 'kakan' || last?.kind === 'ankan')
    if (name === '和了') {
      const wins = result.filter((_, i) => i >= 2 && i % 2 === 0).map(asArray)
      const [who, from] = wins[0] ?? fail('notTenhou')
      if (afterKan && who !== from) log.pop() // the kan nobody completed
      if (wins.length > 1) notice = { code: 'doubleRon' }
      else if (afterKan && who !== from) notice = { code: 'chankan' }
      else {
        log.push(
          who === from
            ? { kind: 'win', seat: asCount(who) }
            : { kind: 'win', seat: asCount(who), from: asCount(from) },
        )
        modelled = true
      }
    } else if (name === '九種九牌') {
      log.push({ kind: 'abort', seat })
      modelled = true
    } else if (EXHAUSTIVE.has(name)) {
      modelled = true
    } else if (UNMODELLED[name]) {
      notice = { code: UNMODELLED[name] }
    } else {
      fail('notTenhou')
    }
  }

  let actor = match.dealer
  let draw: 'front' | 'rinshan' | 'none' = 'front'
  const budget = seats.reduce((n, s) => n + s.takes.length + s.discards.length, 1)
  for (let guard = 0; ; guard++) {
    if (guard > budget) fail('notTenhou')
    const seat = seats[actor]
    if (draw !== 'none') {
      const take = seat.takes[seat.ti]
      if (take === undefined) {
        end(actor, draw === 'rinshan')
        break
      }
      seat.ti++
      // a call where a draw belongs: the record and this walk disagree on who acted when
      const tile = typeof take === 'number' ? decodeTile(take) : fail('notTenhou')
      pin(draw === 'front' ? dealt + front++ : replacementAt(rinshan++), tile)
      seat.drawn = tile
      if (tile.red) seat.reds.add(tile.id)
    }

    const d = seat.discards[seat.di]
    if (d === undefined) {
      end(actor, false)
      break
    }
    seat.di++
    if (d === 'f44') {
      log.push({ kind: 'kita', seat: actor })
      draw = 'rinshan'
      continue
    }
    if (typeof d === 'string' && /[ak]/.test(d)) {
      const naki = parseNaki(d)
      if (naki.kind !== 'ankan' && naki.kind !== 'kakan') fail('notTenhou')
      for (const t of [naki.marked, ...naki.rest]) if (t.red) seat.reds.delete(t.id)
      log.push({ kind: naki.kind, seat: actor, tile: naki.marked.id })
      draw = 'rinshan'
      continue
    }

    // an export from before `buildKyoku` read the declaration off its event also wrote `r` on the
    // discard after a called declaration tile — harmless here, the seat has already declared
    const riichi = typeof d === 'string'
    const code = riichi ? Number((/^r(\d\d)$/.exec(d) ?? fail('notTenhou'))[1]) : d
    const tile = code === TSUMOGIRI ? (seat.drawn ?? fail('notTenhou')) : decodeTile(code)
    log.push({ kind: 'discard', seat: actor, tile, fromDrawn: code === TSUMOGIRI, riichi })
    seat.drawn = undefined
    if (tile.red) seat.reds.delete(tile.id)

    // ponytail: a seat whose next take calls this exact tile from this seat is taken to call *this*
    // discard — wrong only when the discarder throws the same tile again before the caller's next
    // turn and the call was on the second one. The walk or the replay then refuses the record (an
    // error, or the round cut short as `'stopped'`); conv.rs backtracks, if a real record needs it.
    const caller = findCaller(seats, players, actor, tile)
    if (!caller) {
      actor = (actor + 1) % players
      draw = 'front'
      continue
    }
    const { s, naki } = caller
    const callerSeat = seats[s]
    callerSeat.ti++
    const ids = naki.rest.map((t) => t.id).sort((a, b) => a - b)
    // the engine spends a held red unless told otherwise, so the record has to say when it didn't
    const keepRed = ids.some(
      (id) => callerSeat.reds.has(id) && !naki.rest.some((t) => t.id === id && t.red),
    )
    for (const t of naki.rest) if (t.red) callerSeat.reds.delete(t.id)
    const call: Call = { kind: naki.kind as Call['kind'], from: ids, ...(keepRed && { keepRed }) }
    log.push({ kind: 'call', seat: s, from: actor, call })
    actor = s
    draw = 'none'
    if (naki.kind === 'minkan') {
      // the format's "no discard in this slot" placeholder (`buildKyoku`'s daiminkan branch)
      if (callerSeat.discards[callerSeat.di] !== 0) fail('notTenhou')
      callerSeat.di++
      draw = 'rinshan'
    }
  }

  if (front + rinshan > live) fail('tiles')
  const tiles = [...pinned.values()]
  if (validateWall(tiles, players, sanma)) fail('tiles')
  if (!aka && tiles.some((t) => t.red)) fail('rules')
  const wall = wallWithPinned(pinned, sanma, aka, `tenhou-import-${index}`)

  const options: RoundOptions = {
    sanma,
    aka,
    kiriageMangan: rules.kiriageMangan,
    match,
    calls: true,
    riichi: true,
    wins: true,
    claims: true,
    calledKan: true,
  }
  const recorded = asArray(result[1] ?? [])
    .slice(0, players)
    .map((d) => (typeof d === 'number' ? d : fail('notTenhou')))
  while (recorded.length < players) recorded.push(0)

  let state
  let consumed
  try {
    state = createRound(wall, players, options)
    consumed = replayLog(state, options, log)
  } catch {
    // a discard or call of a tile the rebuilt hand does not hold — `removeTile` throws on it
    return fail('tiles')
  }
  const rr = roundResult(state)
  const reached = consumed === log.length && (!modelled || rr !== undefined)
  if (!reached) {
    return {
      match,
      wall,
      log: log.slice(0, consumed),
      deltas: recorded,
      notice: { code: 'stopped' },
    }
  }
  if (!modelled || !rr) return { match, wall, log, deltas: recorded, ...(notice && { notice }) }
  // a record's deltas leave the riichi deposits out, so they are `settleRound`'s own. An export
  // from before `buildKyoku` wrote them that way took 1000 off per riichi: it still replays whole,
  // flagged `pays` with the right deltas, which is not worth a second reading that would let a
  // genuine 1000-per-riichi disagreement through
  const engine = settleRound(state.match, rr, { sanma, format: rules.format }).deltas
  const pays = engine.some((d, s) => d !== recorded[s])
  return {
    match,
    wall,
    log,
    deltas: engine,
    ...(pays && { notice: { code: 'pays', record: recorded, engine } }),
  }
}

/** The seat whose next take calls `tile` off `discarder`. A pon or kan outranks a chi on the same
 *  tile, as at the table (`conv.rs` picks the same way). */
function findCaller(
  seats: Seat[],
  players: number,
  discarder: number,
  tile: ParsedTile,
): { s: number; naki: Naki } | undefined {
  let chi: { s: number; naki: Naki } | undefined
  for (let step = 1; step < players; step++) {
    const s = (discarder + step) % players
    const take = seats[s].takes[seats[s].ti]
    if (typeof take !== 'string') continue
    const naki = parseNaki(take)
    if (naki.kind === 'kakan' || naki.kind === 'ankan') fail('notTenhou')
    if (!same(naki.marked, tile)) continue
    if (naki.kind === 'chi') {
      if (step === 1) chi ??= { s, naki }
      continue
    }
    // sanma's from-seat is written mod 4 (tensoul, and `buildKyoku`) or mod 3: either is read
    const from = s + naki.rel
    if (from % 4 === discarder || (players === 3 && from % 3 === discarder)) return { s, naki }
  }
  return chi
}

/** Parses a tenhou.net/6 JSON log (already `JSON.parse`d) into rounds `/match` can replay. */
export function importTenhou(json: unknown): { game: ImportedGame } | ImportError {
  if (typeof json !== 'object' || json === null) return { error: 'notTenhou' }
  const record = json as Record<string, unknown>
  if (!Array.isArray(record.log) || record.log.length === 0) return { error: 'notTenhou' }
  const rule = (typeof record.rule === 'object' && record.rule) || {}
  const field = (key: string) => (rule as Record<string, unknown>)[key]
  const disp = typeof field('disp') === 'string' ? (field('disp') as string) : ''

  const ghost = Array.isArray(record.log[0]) ? (record.log[0] as unknown[])[13] : undefined
  const sanma = disp.includes('三') || (Array.isArray(ghost) && ghost.every((c) => c === 0))
  const akaKeys = ['aka51', 'aka52', 'aka53'].filter((key) => field(key) !== undefined)
  const aka = akaKeys.length
    ? akaKeys.some((key) => Number(field(key)) > 0)
    : field('aka') !== undefined
      ? Number(field('aka')) > 0
      : disp.includes('赤')
  const rules: TenhouRules = {
    sanma,
    aka,
    kiriageMangan: false,
    format: disp.includes('東') ? 'tonpuu' : 'hanchan',
  }
  const players = sanma ? 3 : 4
  const rawNames = Array.isArray(record.name) ? record.name : []
  const names = Array.from({ length: players }, (_, s) =>
    typeof rawNames[s] === 'string' ? (rawNames[s] as string) : '',
  )

  const rounds: ImportedRound[] = []
  let previous: unknown
  let dealerRepeat = 0
  for (const [index, raw] of record.log.entries()) {
    try {
      // a dealer repeat is the same kyoku number again — the format carries no counter of its own
      const k = asArray(asArray(raw)[0])[0]
      dealerRepeat = k === previous ? dealerRepeat + 1 : 0
      previous = k
      rounds.push(importRound(raw, index, rules, dealerRepeat))
    } catch (err) {
      if (err instanceof Malformed) return { error: err.code, kyoku: index }
      throw err
    }
  }
  return { game: { rules, names, rounds } }
}
