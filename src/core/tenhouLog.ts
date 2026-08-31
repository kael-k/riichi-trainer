import type { MatchFormat, MatchState } from './match'
import { ranks, resultPoints } from './placement'
import { createRound, replayLog, type LogEntry, type RoundOptions, type RoundState } from './round'
import type { LimitName, ScoreResult } from './score'
import { HONOR, type ParsedTile } from './tiles'
import { dealtIndices } from './wall'
import type { YakuName, YakumanName } from './yaku'

/**
 * Exports a played `/match` to the tenhou.net/6 JSON log format, so a match played here can be
 * opened in a third-party analysis tool (mjai-reviewer/Mortal, akochan-reviewer, tenhou's own
 * viewers). Verified against the two reference implementations rather than memory — the encoder
 * ([Equim-chan/tensoul](https://github.com/Equim-chan/tensoul/blob/main/convert.js)) and, more
 * importantly, the actual **decoder** a downstream tool runs
 * ([mjai-reviewer's `convlog`](https://github.com/Equim-chan/mjai-reviewer/blob/master/convlog/src/conv.rs)),
 * since only the decoder's byte-offset math is the ground truth the meld strings must satisfy.
 *
 * One settled round needs no live event capture of its own: `core/round.ts#replayLog` already
 * replays a round's wall + decision log through the real engine and reports every `RoundEvent`
 * (draw, discard, call, kita, ankan, kakan, win, exhaustive, abort) in order, so this module is a
 * pure translation from that stream to tenhou's tile codes and meld strings.
 *
 * **Not modelled, because the engine itself doesn't model it** (see `docs/model/limits.md`):
 * chankan, double/triple ron, nagashi mangan, and the suukaikan/suufonrenda/suucha-riichi aborts —
 * none of these can appear in an exported log. Pao (sekinin barai) likewise never appears; `target`
 * on a win is always the discarder (ron) or the winner itself (tsumo).
 *
 * **Sanma is the tensoul convention**, not a second format: seat 3 is padded (empty name, a
 * placeholder haipai of the format's own "unknown tile" sentinel, `0`), and `rule.disp` carries
 * `三` — which is exactly what makes the *mainline* four-player reviewer reject it
 * (`rule.disp.contains('三')`); a 3p-aware fork is required to open it.
 */

const TSUMOGIRI = 60

/** Tenhou's own numeric tile code: 11-19 man, 21-29 pin, 31-39 sou, 41-47 winds then dragons
 *  (E,S,W,N,haku,hatsu,chun — the same order `tiles.ts#tileName` uses), 51/52/53 red fives. */
export function tenhouTile(t: ParsedTile): number {
  if (t.id >= HONOR) return 41 + (t.id - HONOR)
  const suit = Math.floor(t.id / 9) // 0 = m, 1 = p, 2 = s
  if (t.red) return 51 + suit
  return (suit + 1) * 10 + ((t.id % 9) + 1)
}

function tileStr(t: ParsedTile): string {
  return String(tenhouTile(t))
}

function pad4<T>(arr: readonly T[], fill: T): T[] {
  const out = [...arr]
  while (out.length < 4) out.push(fill)
  return out
}

/** Removes and returns the meld tile matching `called` (id and redness) — the physical copy that
 *  came from the discarder. There is at most one red copy of any kind in the whole game, so this
 *  match is always exact and unique; `tiles` (a copy of `Meld.tiles`, never the live array) is left
 *  holding exactly the tiles the caller held before the call. */
function pluckCalled(tiles: ParsedTile[], called: ParsedTile): ParsedTile {
  const i = tiles.findIndex((t) => t.id === called.id && t.red === called.red)
  return tiles.splice(i, 1)[0]
}

/** How many seats "ahead" in deal order `from` sits from `seat`'s own perspective. Always mod 4
 *  regardless of player count — the convention the reference JS encoder (tensoul) uses uniformly
 *  even for its own 3-player logs, and the only real-world-tested precedent available for a seat
 *  arithmetic tenhou's own spec never wrote down for sanma. */
function relSeat(from: number, seat: number): number {
  return (((from - seat) % 4) + 4) % 4
}

/** Byte-offset slot (of 3) tenhou's pon naki places its marker at, by relative seat: kamicha (rel
 *  3) leads, shimocha (rel 1) trails. Confirmed against `conv.rs#take_action_to_events`'s pon
 *  branch (marker at byte 0/2/4 = tile-slot 0/1/2 for rel 3/2/1). */
function ponSlot(rel: number): number {
  return 3 - rel
}

/** Same idea for daiminkan's 4-tile naki, but the marker's slot is *not* the clean 0/1/2 sequence
 *  pon uses — shimocha's call marks the very last of the four slots, not the third, confirmed
 *  against `conv.rs`'s daiminkan branch (marker at byte 0/2/6, never 4). */
const MINKAN_SLOT: Record<number, number> = { 3: 0, 2: 1, 1: 3 }

export function chiNaki(called: ParsedTile, own: ParsedTile[]): string {
  const [a, b] = [...own].sort((x, y) => x.id - y.id)
  return 'c' + tileStr(called) + tileStr(a) + tileStr(b)
}

export function ponNaki(from: number, seat: number, called: ParsedTile, own: ParsedTile[]): string {
  const parts = own.map(tileStr)
  parts.splice(ponSlot(relSeat(from, seat)), 0, 'p' + tileStr(called))
  return parts.join('')
}

export function minkanNaki(
  from: number,
  seat: number,
  called: ParsedTile,
  own: ParsedTile[],
): string {
  const parts = own.map(tileStr)
  parts.splice(MINKAN_SLOT[relSeat(from, seat)], 0, 'm' + tileStr(called))
  return parts.join('')
}

export function ankanNaki(tiles: ParsedTile[]): string {
  if (tiles.length !== 4) return '' // defensive only — `callAnkan` always builds exactly 4
  return tileStr(tiles[0]) + tileStr(tiles[1]) + tileStr(tiles[2]) + 'a' + tileStr(tiles[3])
}

type Action = number | string

interface SeatAccum {
  haipai: number[]
  takes: Action[]
  discards: Action[]
}

/** One settled round, exactly what `useMatchRound` already holds at settlement — no bookkeeping of
 *  its own beyond what the round-in-progress hook already tracks. */
export interface TenhouRoundInput {
  /** The round's **starting** `MatchState` — `createRound`'s own copy, before this round's riichi
   *  deductions or its settlement. Never `RoundState.match` off the ended round (the live one), and
   *  never the *stepped* one `settleRound` returns (the next round's carry-in) — see
   *  `core/match.ts`'s own doc comment on `MatchState` being carry-in, not a sequencer. */
  match: MatchState
  wall: ParsedTile[]
  log: LogEntry[]
  /** This round's own point deltas, straight off `settleRound` — the win/draw payment swing only.
   *  A riichi's −1000 already moved `match.points` before `settleRound` ever ran, so it is *not*
   *  in here; `buildKyoku` adds it back in from the replayed discards themselves. */
  deltas: number[]
}

export interface TenhouRules {
  sanma: boolean
  aka: boolean
  kiriageMangan: boolean
  format: MatchFormat
}

const LIMIT_LABEL: Record<LimitName, string> = {
  mangan: '満貫',
  haneman: '跳満',
  baiman: '倍満',
  sanbaiman: '三倍満',
  kazoe: '数え役満',
  yakuman: '役満',
}

// Plain romaji, same labels `en.json`'s `scoring.yaku`/`scoring.yakuman` sections carry — the
// export is locale-independent (like tenhou's own kanji), so this is a literal copy rather than a
// dependency on i18next from a module that otherwise has none.
const YAKU_LABEL: Record<YakuName, string> = {
  riichi: 'Riichi',
  doubleRiichi: 'Double riichi',
  ippatsu: 'Ippatsu',
  menzenTsumo: 'Menzen tsumo',
  tanyao: 'Tanyao',
  pinfu: 'Pinfu',
  iipeikou: 'Iipeikou',
  yakuhaiHaku: 'Yakuhai (haku)',
  yakuhaiHatsu: 'Yakuhai (hatsu)',
  yakuhaiChun: 'Yakuhai (chun)',
  yakuhaiSeatWind: 'Yakuhai (seat wind)',
  yakuhaiRoundWind: 'Yakuhai (round wind)',
  haitei: 'Haitei raoyue',
  houtei: 'Houtei raoyui',
  rinshan: 'Rinshan kaihou',
  chankan: 'Chankan',
  chiitoitsu: 'Chiitoitsu',
  sanshokuDoujun: 'Sanshoku doujun',
  ittsuu: 'Ittsuu',
  chanta: 'Chanta',
  toitoi: 'Toitoi',
  sanankou: 'Sanankou',
  sankantsu: 'Sankantsu',
  sanshokuDoukou: 'Sanshoku doukou',
  honroutou: 'Honroutou',
  shousangen: 'Shousangen',
  ryanpeikou: 'Ryanpeikou',
  honitsu: 'Honitsu',
  junchan: 'Junchan',
  chinitsu: 'Chinitsu',
}

const YAKUMAN_LABEL: Record<YakumanName, string> = {
  kokushi: 'Kokushi musou',
  suuankou: 'Suuankou',
  daisangen: 'Daisangen',
  shousuushii: 'Shousuushii',
  daisuushii: 'Daisuushii',
  tsuuiisou: 'Tsuuiisou',
  chinroutou: 'Chinroutou',
  ryuuiisou: 'Ryuuiisou',
  chuuren: 'Chuurenpoutou',
  suukantsu: 'Suukantsu',
}

function scoreString(score: ScoreResult, tsumo: boolean, dealer: boolean): string {
  const head = score.limit ? LIMIT_LABEL[score.limit] : `${score.fu}符${score.han}飜`
  if (!tsumo) return `${head}${score.payments.main}点`
  return dealer
    ? `${head}${score.payments.main}点∀`
    : `${head}${score.payments.main}-${score.payments.fromDealer}点`
}

function yakuLines(score: ScoreResult): string[] {
  const lines = score.yaku.map((y) => `${YAKU_LABEL[y.name]}(${y.han}飜)`)
  lines.push(...score.yakuman.map((y) => `${YAKUMAN_LABEL[y]}(役満)`))
  if (score.dora.dora) lines.push(`dora(${score.dora.dora}飜)`)
  if (score.dora.aka) lines.push(`aka dora(${score.dora.aka}飜)`)
  if (score.dora.ura) lines.push(`ura dora(${score.dora.ura}飜)`)
  if (score.dora.kita) lines.push(`kita(${score.dora.kita}飜)`)
  return lines
}

function buildResult(state: RoundState, deltas: number[]): unknown[] {
  if (state.ended === 'win' && state.win) {
    const win = state.win
    const dealer = win.seat === state.match.dealer
    const tsumo = win.from === undefined
    const from = win.from ?? win.seat
    return [
      '和了',
      pad4(deltas, 0),
      [win.seat, from, win.seat, scoreString(win.score, tsumo, dealer), ...yakuLines(win.score)],
    ]
  }
  if (state.ended === 'exhaustive') return ['流局', pad4(deltas, 0)]
  return ['九種九牌'] // the only abort this engine models
}

/** One round of the exported log. `players` is read off `rules.sanma`, not off `input.match.points`
 *  — a *ghost* fourth seat (sanma's padded slot) is never dealt into, so its length would be wrong. */
export function buildKyoku(input: TenhouRoundInput, rules: TenhouRules): unknown[] {
  const players = rules.sanma ? 3 : 4
  const options: RoundOptions = {
    sanma: rules.sanma,
    aka: rules.aka,
    kiriageMangan: rules.kiriageMangan,
    match: input.match,
    calls: true,
    riichi: true,
    wins: true,
    claims: true,
    calledKan: true,
  }
  const state = createRound(input.wall, players, options)
  const accum: SeatAccum[] = Array.from({ length: players }, (_, seat) => ({
    haipai: dealtIndices(seat, players).map((i) => tenhouTile(state.wall[i])),
    takes: [],
    discards: [],
  }))

  let lastDiscard: ParsedTile | undefined
  const ponRecord = new Map<string, { naki: string; tiles: ParsedTile[] }>()
  const riichiCount = new Array(players).fill(0)

  replayLog(state, options, input.log, (event) => {
    switch (event.kind) {
      case 'draw':
        accum[event.seat].takes.push(tenhouTile(event.tile))
        break
      case 'discard': {
        const value = event.tile.tsumogiri ? TSUMOGIRI : tenhouTile(event.tile)
        accum[event.seat].discards.push(event.tile.riichi ? `r${value}` : value)
        if (event.tile.riichi) riichiCount[event.seat]++
        lastDiscard = event.tile
        break
      }
      case 'call': {
        const tiles = [...event.meld.tiles]
        const called = pluckCalled(tiles, lastDiscard!)
        if (event.meld.kind === 'chi') {
          accum[event.seat].takes.push(chiNaki(called, tiles))
        } else if (event.meld.kind === 'pon') {
          const naki = ponNaki(event.from, event.seat, called, tiles)
          accum[event.seat].takes.push(naki)
          ponRecord.set(`${event.seat}:${called.id}`, { naki, tiles })
        } else {
          // daiminkan — a 0 placeholder in discards is the format's own convention for "this
          // seat's turn slot has no discard yet" (confirmed against `conv.rs#finalize_discards`,
          // which strips it back out on read).
          accum[event.seat].takes.push(minkanNaki(event.from, event.seat, called, tiles))
          accum[event.seat].discards.push(0)
        }
        break
      }
      case 'kita':
        // tenhou doesn't mark kita by when it was drawn — always the literal North code.
        accum[event.seat].discards.push('f44')
        break
      case 'ankan': {
        const tiles = state.players[event.seat].melds.at(-1)?.tiles ?? []
        accum[event.seat].discards.push(ankanNaki(tiles))
        break
      }
      case 'kakan': {
        const record = ponRecord.get(`${event.seat}:${event.tile}`)
        const meldTiles = state.players[event.seat].melds.at(-1)?.tiles ?? []
        if (!record) break
        const addedRed = meldTiles.some((t) => t.red) && !record.tiles.some((t) => t.red)
        accum[event.seat].discards.push(
          record.naki.replace('p', 'k' + tileStr({ id: event.tile, red: addedRed })),
        )
        break
      }
    }
  })

  const doraIndicators = state.doraIndicators.map(tenhouTile)
  const riichiWin = state.win !== undefined && (state.win.ctx.riichi || state.win.ctx.doubleRiichi)
  const uraIndicators = riichiWin
    ? state.uraStack.slice(0, state.doraIndicators.length).map(tenhouTile)
    : []

  const trueDeltas = input.deltas.map((d, seat) => d - 1000 * riichiCount[seat])
  const entry: unknown[] = [
    [
      4 * (input.match.prevalentWind - HONOR) + (input.match.round - 1),
      input.match.honba,
      input.match.riichiSticks,
    ],
    pad4(input.match.points, 0),
    doraIndicators,
    uraIndicators,
  ]
  const ghostHaipai = new Array(13).fill(0) // tenhou's own "unknown tile" sentinel — see module doc
  for (let seat = 0; seat < 4; seat++) {
    const a = accum[seat]
    entry.push(a ? a.haipai : ghostHaipai, a ? a.takes : [], a ? a.discards : [])
  }
  entry.push(buildResult(state, trueDeltas))
  return entry
}

/** The whole match: every settled round plus the header tenhou's format requires — `sc` is the
 *  final scoreboard (`finalPoints`, live at export time, mid-match or at the end), priced through
 *  the same placement objective this app's `'ev'` seats maximise (`core/placement.ts`). */
export function tenhouMatchLog(
  rounds: readonly TenhouRoundInput[],
  finalPoints: readonly number[],
  rules: TenhouRules,
  names: readonly string[],
): unknown {
  const players = rules.sanma ? 3 : 4
  const rank = ranks(finalPoints)
  const sc = new Array(8).fill(0)
  finalPoints.forEach((score, seat) => {
    sc[2 * seat] = score
    sc[2 * seat + 1] = Math.round(resultPoints(score, rank[seat], rules.sanma) * 10) / 10
  })

  const disp =
    (rules.sanma ? '三' : '') +
    (rules.format === 'tonpuu' ? '東' : '南') +
    '喰' +
    (rules.aka ? '赤' : '')

  return {
    ver: '2.3',
    ref: '',
    log: rounds.map((r) => buildKyoku(r, rules)),
    ratingc: `PF${players}`,
    rule: {
      disp,
      aka51: rules.aka && !rules.sanma ? 1 : 0,
      aka52: rules.aka ? 1 : 0,
      aka53: rules.aka ? 1 : 0,
    },
    lobby: 0,
    dan: pad4(
      Array.from(names, () => ''),
      '',
    ),
    rate: pad4(
      Array.from(names, () => 0),
      0,
    ),
    sx: pad4(
      Array.from(names, () => 'C'),
      '',
    ),
    name: pad4([...names], ''),
    sc,
    title: ['', ''],
  }
}
