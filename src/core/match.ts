import type { Payments } from './score'
import { HONOR, type TileId } from './tiles'

/**
 * The game a round sits inside: points, honba, dealer repeat, riichi sticks, which round it is.
 * A round (`core/round.ts`) plays out entirely within one `MatchState`; `settleRound` below is
 * what steps between rounds — dealer
 * rotation, honba/repeat, payouts, end-of-match. Nothing in `round.ts` calls it: a round must not
 * know what follows it, so the caller (`useMatchRound`) reads the ended round's result and feeds
 * it back in for the next deal.
 */
export interface MatchState {
  /** Prevalent wind as an honour tile id (`HONOR` = East). */
  prevalentWind: TileId
  /** Which round within the prevalent wind — East 1 is `1`. */
  round: number
  /** Payout counter, feeds `ScoringRules.honba`. */
  honba: number
  /** How many times the current dealer has repeated. Diverges from `honba` by ruleset. */
  dealerRepeat: number
  /** Seat index. */
  dealer: number
  riichiSticks: number
  points: number[]
}

export const STARTING_POINTS_YONMA = 25000
export const STARTING_POINTS_SANMA = 35000

export function createMatch(sanma: boolean, overrides?: Partial<MatchState>): MatchState {
  const players = sanma ? 3 : 4
  const startingPoints = sanma ? STARTING_POINTS_SANMA : STARTING_POINTS_YONMA
  return {
    prevalentWind: HONOR,
    round: 1,
    honba: 0,
    dealerRepeat: 0,
    dealer: 0,
    riichiSticks: 0,
    points: Array.from({ length: players }, () => startingPoints),
    ...overrides,
  }
}

/** East-only, or the full four-wind game. Stated here rather than read off `MatchState`, which
 *  carries no match length of its own — `settleRound` needs it only to know where the last round
 *  is. */
export type MatchFormat = 'tonpuu' | 'hanchan'

/** What ended a round, in exactly the shape `settleRound` needs and nothing it has to re-derive:
 *  `core/round.ts#roundResult` reads it straight off a just-ended `RoundState`. */
export interface RoundResult {
  ended: 'win' | 'exhaustive' | 'abort'
  /** Set only for `'win'`. `payments` is `WinRecord.score.payments` — honba is already folded
   *  into it (`tryWin` prices the win against `state.match.honba`), so `settleRound` never adds
   *  it a second time. */
  win?: { seat: number; from?: number; payments: Payments }
  /** Seats whose hand is tenpai — exhaustive draw only. */
  tenpai?: number[]
}

export interface Settlement {
  /** The next round's carry-in — dealer, honba, wind, sticks, points all stepped. */
  match: MatchState
  /** Each seat's point change this round, same order as `points`. */
  deltas: number[]
  /** The match is over: a seat busted (below zero), or the format's last round has been played
   *  past. Checked here rather than left to the caller, since both conditions need the stepped
   *  state this function already built. */
  over: boolean
}

/** Steps one ended round's `MatchState` to the next: prices the payments, rotates the dealer (or
 *  repeats it), and says whether the match is over. `match` is the **ended round's own**
 *  `RoundState.match`, not the options copy handed to `createRound` — a riichi mid-round already
 *  deducted 1000 and added a stick there, and that mutation must carry forward.
 *
 * **Sticks still on the table when the match ends go to the leader** (points highest, ties to the
 * lowest seat index — same tie-break `placement.ts#ranks` uses), the Tenhou/majsoul convention,
 * rather than the other real option (carried to a next hanchan this engine never plays).
 *
 * Deliberately not modelled, each a real ruleset variant this engine has not decided on: dealer
 * agari-yame/tenpai-yame (ending the match early on a dealer's win/tenpai in the last hand), West
 * sudden death when nobody has reached the return score, nagashi mangan, and sanma's nukidora
 * payments (`kita` is scored as ordinary dora in `scoreHand`, never paid out separately). */
export function settleRound(
  match: MatchState,
  result: RoundResult,
  rules: { sanma: boolean; format: MatchFormat },
): Settlement {
  const players = match.points.length
  const deltas = new Array<number>(players).fill(0)
  let riichiSticks = match.riichiSticks
  // whether the *current* dealer keeps the seat — the one branch honba/dealerRepeat/round/wind
  // all key off
  let repeats: boolean

  if (result.ended === 'win' && result.win) {
    const { seat, from, payments } = result.win
    // `payments.total` is already the winner's whole take, honba included, in all three shapes
    // (ron, dealer tsumo, non-dealer tsumo) — `computePayments` (`core/score.ts`) built it that
    // way, so nothing here re-sums per-payer amounts for the winner's own side.
    deltas[seat] += payments.total + riichiSticks * 1000
    if (from !== undefined) {
      deltas[from] -= payments.main
    } else {
      for (let s = 0; s < players; s++) {
        if (s === seat) continue
        deltas[s] -= s === match.dealer ? (payments.fromDealer ?? payments.main) : payments.main
      }
    }
    riichiSticks = 0
    repeats = seat === match.dealer
  } else if (result.ended === 'exhaustive') {
    const tenpaiSeats = result.tenpai ?? []
    const notenCount = players - tenpaiSeats.length
    if (tenpaiSeats.length > 0 && notenCount > 0) {
      const pot = (players - 1) * 1000
      const gain = pot / tenpaiSeats.length
      const pay = pot / notenCount
      for (let s = 0; s < players; s++) deltas[s] = tenpaiSeats.includes(s) ? gain : -pay
    }
    repeats = tenpaiSeats.includes(match.dealer)
  } else {
    repeats = true // abort — nobody is noten and nobody pays, the dealer just repeats
  }

  let { dealer, dealerRepeat, honba, round, prevalentWind } = match
  if (repeats) {
    dealerRepeat += 1
    honba += 1
  } else {
    dealer = (dealer + 1) % players
    dealerRepeat = 0
    honba = result.ended === 'win' ? 0 : honba + 1
    if (round >= players) {
      round = 1
      prevalentWind += 1
    } else {
      round += 1
    }
  }

  let points = match.points.map((p, s) => p + deltas[s])
  const finalWind = rules.format === 'tonpuu' ? HONOR : HONOR + 1
  const over = points.some((p) => p < 0) || prevalentWind > finalWind

  // sticks still on the table when the match ends go to the leader rather than vanishing
  // (Tenhou/majsoul convention) — ties broken by seat order, same rule `placement.ts#ranks` uses,
  // duplicated rather than imported to avoid a `match.ts` → `placement.ts` cycle (`placement.ts`
  // already imports `MatchState` from here)
  if (over && riichiSticks > 0) {
    let leader = 0
    for (let s = 1; s < players; s++) if (points[s] > points[leader]) leader = s
    points = points.map((p, s) => (s === leader ? p + riichiSticks * 1000 : p))
    riichiSticks = 0
  }

  return {
    match: { prevalentWind, round, honba, dealerRepeat, dealer, riichiSticks, points },
    deltas,
    over,
  }
}
