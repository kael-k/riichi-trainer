import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Tile } from '../../components/tiles/Tile'
import type { SeatAlgorithm } from '../../core/policy'
import type { SeatRead } from '../../core/table'
import { SeatButton, type SeatButtonProps } from '../settings/SeatPanel'
import { resolveSeatConfig } from '../settings/tableSettings'

/** One colour per algorithm, always shown (no gating setting — reading who is running what is
 *  basic table awareness, same reasoning as `showOpponentHands`) so the badge is a fast visual
 *  read of "who's doing what" across the felt. */
const ALGO_COLOR: Record<SeatAlgorithm, string> = {
  efficiency: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  defense: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  tsumogiri: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  manual: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
}

interface SeatStripProps extends SeatButtonProps {
  /** This seat's own tenpai/waits/furiten (`core/table.ts#seatRead`) — present for a seat the
   *  reader plays regardless of `showWaits` (their own furiten is legitimate information a real
   *  client shows), present for every seat when `showWaits` is on, `undefined` otherwise. */
  read?: SeatRead
  /** The board's `showSeatWaits` setting — gates the wait-tile row specifically (the furiten
   *  badge below reads `read` alone, since its presence already carries that gate for this seat). */
  showWaits: boolean
  /** This seat's wind, already styled by `Table` — it leads the bottom line here rather than being
   *  drawn beside the strip, which is what lets the wait tiles above start at its left edge and
   *  run the whole width of the corner. */
  wind?: ReactNode
}

/**
 * One seat's info strip on the felt: the settings button that opens `SeatButton`'s dialog, plus
 * — in the order the reads were specified — the furiten badge, the algorithm badge and the wait
 * tiles, with the seat's wind (`Table`'s own node, passed in) leading the bottom line. It fills
 * the corner cell on that seat's left, so the waits are drawn in full rather than trimmed to the
 * five that used to fit beside the calls, and a thirteen-sided kokushi wait wraps over two lines
 * at a size that says plainly they are not tiles in play. Sized off the board's own `--tile-w`
 * like everything else out here.
 */
export function SeatStrip({ read, showWaits, wind, ...seatButtonProps }: SeatStripProps) {
  const { t } = useTranslation()
  const { seat, players, defaultOrientation, config, fallbackModes } = seatButtonProps
  const mode = resolveSeatConfig(config, players, defaultOrientation, fallbackModes).modes[seat]

  return (
    // a column: the waits above, the wind and the controls on the bottom line. The tiles are the
    // tallest thing here and the widest — put on that line they pushed the settings button and
    // the algorithm badge off the corner
    <div
      data-testid="seat-strip"
      data-seat={seat}
      // `w-full`, not shrink-to-fit: the wait row wraps against this width, and a column that
      // sizes itself to its own content gives a thirteen-sided wait nothing to wrap against — it
      // drew all thirteen in one line, straight out of the corner cell and over the next seat's
      // river. The width comes from `Table`'s own `min-w-0 flex-1` wrapper — the whole corner
      // cell, since the wind is inside this column now rather than beside it
      className="flex w-full flex-col items-start justify-end gap-[0.4cqw]"
    >
      {showWaits && read && read.waits.length > 0 && (
        <div className="flex flex-wrap items-center gap-[0.3cqw]">
          {read.waits.map(({ tile, remaining }) => (
            <div
              key={tile}
              className={`flex flex-col items-center ${remaining === 0 ? 'opacity-30' : ''}`}
            >
              <Tile id={tile} />
              <span className="text-[1.6cqw] leading-none text-neutral-500">{remaining}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-start gap-[0.6cqw]">
        {wind}
        <SeatButton {...seatButtonProps} />
        {read?.furiten && <GlossaryTerm id="furiten" />}
        <span
          className={`shrink-0 rounded px-[0.6cqw] py-[0.1cqw] text-[2cqw] ${ALGO_COLOR[mode]}`}
        >
          {t(`seats.mode.${mode}`)}
        </span>
      </div>
    </div>
  )
}
