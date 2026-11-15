import { settleRound, type RoundResult } from '../../core/match'
import {
  createRound,
  replayLog,
  roundResult,
  type RoundEvent,
  type RoundOptions,
  type RoundState,
} from '../../core/round'
import type { ReplayRules, TableCore } from '../../core/table'
import type { ImportedGame, ImportNotice } from '../../core/tenhouImport'
import { HONOR, tileCode } from '../../core/tiles'
import type { LogEntry } from '../../store/log'
import type { MatchResultParams } from '../i18n/formatLogEntry'
import { scoreDetail } from '../scoring/useScoringRound'
import { seatWind, WINDS, type Wind } from '../situation/urlCodec'

/**
 * The rows `/match` writes into the log, built from the engine's own events and state. Live play
 * (`useMatchRound`) writes them; a recorded game's replay builds the very same rows from the very
 * same events, so the two can never describe one action two ways.
 */

export type MatchRow = Omit<LogEntry, 'id'>

/** The wind each seat sits in `round`. Resolved at write time, never at render: the dealer moves
 *  between rounds, so a row written in East 2 must keep saying East 2's winds once East 3 is on the
 *  felt. */
export function roundWinds(round: RoundState): Wind[] {
  const players = round.players.length
  return Array.from({ length: players }, (_, seat) => seatWind(seat, round.match.dealer, players))
}

/** What ended `round`, in the shape the log row and the round-end card share. Read off the round
 *  that just finished, before `settleRound` steps it. */
export function resultParams(round: RoundState, rr: RoundResult): MatchResultParams {
  const ended = round.match
  const winds = roundWinds(round)
  return {
    roundWind: WINDS[ended.prevalentWind - HONOR] ?? 'E',
    roundNumber: ended.round,
    honba: ended.honba,
    kind: rr.ended,
    winner: rr.win === undefined ? undefined : winds[rr.win.seat],
    loser: rr.win?.from === undefined ? undefined : winds[rr.win.from],
  }
}

/** The round's end: the winning hand's own breakdown leads, then who paid what — the exact lines
 *  the round-end card draws (`MatchPage`'s `WinReport`), off the one `scoreDetail` the scoring
 *  trainer also uses, so the row and the card can never tell two stories about one hand. No
 *  `seat`: a result belongs to every seat, so a seat filter always shows it. */
export function resultRow(
  round: RoundState,
  result: MatchResultParams,
  deltas: number[],
  situation?: string,
): MatchRow {
  const winds = roundWinds(round)
  return {
    key: 'log.match.result',
    params: { ...result },
    detail: [
      ...(round.win ? scoreDetail(round.win.score) : []),
      ...deltas
        .map((delta, seat) => ({ seat, delta }))
        .filter((d) => d.delta !== 0)
        .map(({ seat, delta }) => ({
          key: 'log.match.delta',
          params: {
            wind: winds[seat],
            amount: (delta >= 0 ? '+' : '') + delta.toLocaleString(),
          },
        })),
    ],
    situation,
  }
}

/**
 * One seat's own action, bots included — `undefined` for an event that is not a row (a draw, the
 * round's end). Every row carries the actor as `seat`, which is what the log's seat filter reads.
 *
 * Read at report time: the whole turn is applied by then, reactions included, so the discard (or
 * call) a row describes is its seat's last one in `round.log`.
 *
 * A free discard and a call carry `stats`, a job priced off the main thread only once the row is
 * on screen (`statsClient.ts`). Its `match` is `core.options.match`, the round's **starting**
 * state — `createRound` copies it and never writes back, so it is the very `MatchState` the round
 * was dealt from, never the riichi-mutated `round.match`; its wall is the one actually dealt.
 */
export function actionRow(
  event: RoundEvent,
  core: TableCore,
  situationAt: (seat: number) => string | undefined = () => undefined,
): MatchRow | undefined {
  if (!('seat' in event) || event.kind === 'draw' || event.kind === 'abort') return undefined
  const { round, options } = core
  const seat = event.seat
  const wind = seatWind(seat, round.match.dealer, round.players.length)
  const row = (key: string, params: Record<string, unknown>, at?: number): MatchRow => ({
    key,
    params: { ...params, wind },
    seat,
    situation: situationAt(seat),
    ...(at !== undefined && {
      stats: {
        round: { match: options.match, wall: round.wall, log: round.log.slice(0, at + 1) },
        rules: {
          sanma: options.sanma,
          aka: options.aka,
          kiriageMangan: options.kiriageMangan ?? false,
        },
        at,
      },
    }),
  })
  switch (event.kind) {
    case 'discard': {
      const at = round.log.findLastIndex((e) => e.kind === 'discard' && e.seat === seat)
      const entry = round.log[at]
      // a seat already in riichi throws its draw by rule, not by choice — said so, and priced
      // nowhere. The declaration itself is the seat's last free discard, hence `!entry.riichi`
      const forced =
        entry?.kind === 'discard' && !entry.riichi && round.players[seat].riichiAt !== undefined
      const params = { turn: round.turn, tile: tileCode(event.tile.id, event.tile.red) }
      return forced ? row('log.match.discardForced', params) : row('log.match.discard', params, at)
    }
    case 'riichi':
      return row('log.match.riichi', {})
    case 'call':
      return row(
        'log.match.call',
        {
          from: seatWind(event.from, round.match.dealer, round.players.length),
          kind: event.meld.kind,
        },
        round.log.findLastIndex((e) => e.kind === 'call' && e.seat === seat),
      )
    case 'kita':
      return row('log.match.kita', {})
    case 'ankan':
    case 'kakan':
      return row('log.match.kan', { tile: tileCode(event.tile) })
  }
}

/** A recorded game's row, tagged with where it sits in the recording: `round` indexes
 *  `game.rounds`, `at` is the log index of the action it describes — `-1` for the deal and
 *  `log.length - 1` for the round's end (result, notice), so "the rows before a cursor" is the
 *  one comparison `at < step` (`rowsBefore`). */
export interface ReplayRow extends LogEntry {
  round: number
  at: number
}

/** Why an imported round is not the record verbatim. A settlement disagreement names both
 *  sides per seat, record first, under the same `log.match.delta` line a result row uses. */
function noticeRow(notice: ImportNotice, round: RoundState): MatchRow {
  if (notice.code !== 'pays') return { key: `log.match.notice.${notice.code}` }
  const winds = roundWinds(round)
  const signed = (n: number) => (n >= 0 ? '+' : '') + n.toLocaleString()
  return {
    key: 'log.match.notice.pays',
    detail: notice.record.map((record, seat) => ({
      key: 'log.match.delta',
      params: { wind: winds[seat], amount: `${signed(record)} → ${signed(notice.engine[seat])}` },
    })),
  }
}

/**
 * Every row a recorded game's log shows, built once per game: each round replayed through the
 * engine at pace 0, its events turned into the very rows live play writes (`actionRow`), then the
 * engine's own result — only where the round really ended in the engine — and the import's
 * notice. Built once because each row's `stats` job is the price cache's key (`statsClient.ts`):
 * rebuilt per cursor move, every row would be priced again.
 *
 * `at` is read off `state.log` as each event lands: an imported log carries no `pass` and replay
 * records none it infers, so the engine's log is the record's, index for index.
 */
export function replayRows(game: ImportedGame, rules: ReplayRules): ReplayRow[] {
  const players = rules.sanma ? 3 : 4
  const rows: ReplayRow[] = []
  const push = (row: MatchRow, round: number, at: number) =>
    rows.push({ ...row, id: rows.length + 1, round, at })
  game.rounds.forEach((recorded, round) => {
    const options: RoundOptions = {
      ...rules,
      match: recorded.match,
      calls: true,
      riichi: true,
      wins: true,
      claims: true,
      calledKan: true,
    }
    const state = createRound(recorded.wall, players, options)
    const core: TableCore = { round: state, options }
    push({ key: 'log.dealt' }, round, -1)
    replayLog(state, options, recorded.log, (event) => {
      const row = actionRow(event, core)
      if (row) push(row, round, state.log.length - 1)
    })
    const end = recorded.log.length - 1
    const rr = roundResult(state)
    if (rr) {
      const { deltas } = settleRound(state.match, rr, {
        sanma: rules.sanma,
        format: game.rules.format,
      })
      push(resultRow(state, resultParams(state, rr), deltas), round, end)
    }
    if (recorded.notice) push(noticeRow(recorded.notice, state), round, end)
  })
  return rows
}

/** The rows a cursor has passed: every earlier round's, and this round's with `at < step` — the
 *  board at `step` is `replayTo`'s position *before* `log[step]`, so its row is not yet there. */
export function rowsBefore<T extends { round: number; at: number }>(
  rows: T[],
  cursor: { round: number; step: number },
): T[] {
  return rows.filter(
    (r) => r.round < cursor.round || (r.round === cursor.round && r.at < cursor.step),
  )
}
