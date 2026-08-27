import { createMatch } from '../../core/match'
import { NORTH, type RoundOptions } from '../../core/round'
import { HONOR } from '../../core/tiles'
import { matchOverrides, WINDS, type Situation } from '../situation/urlCodec'
import { useEfficiencyDrill } from '../efficiency/useEfficiencyDrill'

export { NORTH }
export type { TurnResult } from '../efficiency/grade'

/** Options that change how a round plays out; resolved from settings with per-situation
 *  overrides so shared links reproduce exactly. */
export interface SoloOptions {
  aka: boolean
  /** Three-player rules: 108-tile wall (no 2m-8m), nukidora. Solo is always one seat regardless. */
  sanma: boolean
}

/** Drives one solitaire efficiency round on `useEfficiencyDrill` — the table app's own thin hook
 *  (`useEfficiencyRound`) sits on the same drill; this hook differs only in its `RoundOptions`
 *  (one seat, no calls, no riichi) and its own `nuki` (this seat's pile, not every seat's).
 *  Grading and log-row shaping are imported from `features/efficiency/grade`, never re-implemented
 *  here, so a solitaire mistake and a table mistake score identically (ADR-0013, ADR-0032). */
export function useEfficiencySoloRound(situation: Situation, options: SoloOptions) {
  const players = 1
  const seatIndex = 0
  const prevalentWind = HONOR + Math.max(0, WINDS.indexOf(situation.round))
  const roundOptions: RoundOptions = {
    sanma: options.sanma,
    aka: options.aka,
    match: createMatch(options.sanma, { prevalentWind, ...matchOverrides(situation) }),
    // nobody else is dealt in, so there is nobody to call or declare from
    calls: false,
    riichi: false,
    wins: false,
    // as above: nothing here should end the hand except the drill's own tenpai stop
    abortiveDraws: false,
    // one seat, and it is always yours: there is no other side to sit at
    algorithms: ['manual'],
  }

  const drill = useEfficiencyDrill({ situation, players, seatIndex, options: roundOptions })

  return {
    ...drill,
    nuki: drill.snapshot?.nuki[seatIndex] ?? [],
    kita: drill.table.kita,
    kan: drill.table.kan,
  }
}
