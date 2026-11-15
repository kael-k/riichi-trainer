import type { RoundResult } from '../../core/match'
import type { RoundEvent, RoundState } from '../../core/round'
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
 * Read at report time: the whole turn is applied by then, reactions included, so the discard a
 * row describes is its seat's last one in `round.log`.
 */
export function actionRow(
  event: RoundEvent,
  round: RoundState,
  situationAt: (seat: number) => string | undefined = () => undefined,
): MatchRow | undefined {
  if (!('seat' in event) || event.kind === 'draw' || event.kind === 'abort') return undefined
  const seat = event.seat
  const wind = seatWind(seat, round.match.dealer, round.players.length)
  const row = (key: string, params: Record<string, unknown>): MatchRow => ({
    key,
    params: { ...params, wind },
    seat,
    situation: situationAt(seat),
  })
  switch (event.kind) {
    case 'discard': {
      const entry = round.log.findLast((e) => e.kind === 'discard' && e.seat === seat)
      // a seat already in riichi throws its draw by rule, not by choice — said so, and priced
      // nowhere. The declaration itself is the seat's last free discard, hence `!entry.riichi`
      const forced =
        entry?.kind === 'discard' && !entry.riichi && round.players[seat].riichiAt !== undefined
      return row(forced ? 'log.match.discardForced' : 'log.match.discard', {
        turn: round.turn,
        tile: tileCode(event.tile.id, event.tile.red),
      })
    }
    case 'riichi':
      return row('log.match.riichi', {})
    case 'call':
      return row('log.match.call', {
        from: seatWind(event.from, round.match.dealer, round.players.length),
        kind: event.meld.kind,
      })
    case 'kita':
      return row('log.match.kita', {})
    case 'ankan':
    case 'kakan':
      return row('log.match.kan', { tile: tileCode(event.tile) })
  }
}
