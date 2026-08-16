import { HONOR, type TileId } from './tiles'

/**
 * The game a round sits inside: points, honba, dealer repeat, riichi sticks, which round it is.
 * A round (`core/round.ts`) plays out entirely within one `MatchState` — nothing here steps
 * between rounds (no dealer rotation, no honba increment, no settlement); it is carry-in context
 * only, plumbed through so a round has somewhere real to read it from.
 */
export interface MatchState {
  /** Prevalent wind as an honour tile id (`HONOR` = East). */
  prevalentWind: TileId
  /** Which round within the prevalent wind — East 1 is `1`. */
  round: number
  /** Payout counter, feeds `ScoringRules.honba`. */
  honba: number
  /** How many times the current dealer has repeated. Diverges from `honba` by ruleset — e.g.
   *  Mahjong Soul zeroes this on a noten-dealer exhaustive draw yet still adds a honba. */
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
