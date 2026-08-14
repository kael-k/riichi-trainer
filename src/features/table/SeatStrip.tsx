import { SeatButton, type SeatButtonProps } from '../settings/SeatPanel'

/**
 * One seat's info strip on the felt: the settings button that opens `SeatButton`'s dialog, sized
 * off the board's own `--tile-w` like everything else out here rather than the fixed control-row
 * sizing it used to have. Task 3 adds the furiten/algorithm/wait badges to this same row.
 */
export function SeatStrip(props: SeatButtonProps) {
  return (
    <div className="flex items-center justify-center">
      <SeatButton {...props} />
    </div>
  )
}
