import { Eye, HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoPopover } from '../../components/InfoPopover'
import { Tile } from '../../components/tiles/Tile'
import type { SeatAlgorithm } from '../../core/policy'
import type { SeatRead } from '../../core/table'
import { GLOSSARY } from '../i18n/glossary'
import { SeatButton, type SeatButtonProps } from '../settings/SeatPanel'
import { resolveSeatConfig } from '../settings/tableSettings'

/** One colour per algorithm, always shown (no gating setting — reading who is running what is
 *  basic table awareness, same reasoning as `showOpponentHands`) so the badge is a fast visual
 *  read of "who's doing what" across the felt. */
const ALGO_COLOR: Record<SeatAlgorithm, string> = {
  efficiency: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  defense: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  tsumogiri: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  ev: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  manual: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
}

interface SeatStripProps extends SeatButtonProps {
  /** This seat's own tenpai/waits/furiten (`core/table.ts#seatRead`) — present exactly when the
   *  reader can already see that seat's tiles: a seat they play, any seat once the hand is over,
   *  and every seat while the board's reveal switch is on. `undefined` otherwise. */
  read?: SeatRead
  /** The board's `showSeatWaits` setting — gates the wait-tile row specifically. The furiten badge
   *  below reads `read` alone: seeing the tiles is the gate it wants, and `read`'s presence
   *  already carries exactly that. */
  showWaits: boolean
  /** This seat's wind, already styled by `Table` — it leads the bottom line here rather than being
   *  drawn beside the strip, which is what lets the wait tiles above start at its outer edge and
   *  run the whole width of the corner. */
  wind?: ReactNode
  /** "Watch from here" — perspective is view-only, so this never touches `onChange`. Lives here
   *  as the eye icon rather than inside `SeatButton`'s dialog: rotating the board is common enough
   *  (the turn glow is the whole reason to do it) that it earns its own one-tap icon on the plate,
   *  between the gear and the wind, rather than a button two taps deep in a dialog. */
  onWatch: (seat: number) => void
}

/**
 * One seat's info strip on the felt: the wait tiles (if shown), then a meta line for the algorithm
 * badge and furiten chip, then a control line for the eye ("watch from here"), the settings button
 * that opens `SeatButton`'s dialog, and the seat's wind (`Table`'s own node, passed in) — three
 * stacked lines rather than one, which is what gives the eye room without wrapping the algorithm
 * badge onto it or overlapping the gear's touch target: measured live at a 390px board, one line
 * carrying wind + gear + badge + furiten had ~4px of slack left over, nowhere near a third 44px
 * target. It fills the corner cell on that seat's right, so the waits are drawn in full rather than
 * trimmed to the five that used to fit beside the calls, and a thirteen-sided kokushi wait wraps
 * over two lines at a size that says plainly they are not tiles in play. Sized off the board's own
 * `--tile-w` like everything else out here.
 */
export function SeatStrip({ read, showWaits, wind, onWatch, ...seatButtonProps }: SeatStripProps) {
  const { t } = useTranslation()
  const { seat, players, defaultOrientation, config, fallbackModes, viewSeat, requireManual } =
    seatButtonProps
  const mode = resolveSeatConfig(config, players, defaultOrientation, fallbackModes, requireManual)
    .modes[seat]
  const yours = seat === viewSeat

  return (
    // a column: the waits above, then the meta line, then the wind and controls on the bottom
    // line. The tiles are the tallest thing here and the widest — put on their own line they
    // pushed everything else off the corner
    <div
      data-testid="seat-strip"
      data-seat={seat}
      // `w-full`, not shrink-to-fit: the wait row wraps against this width, and a column that
      // sizes itself to its own content gives a thirteen-sided wait nothing to wrap against — it
      // drew all thirteen in one line, straight out of the corner cell and over the next seat's
      // river. The width comes from `Table`'s own `min-w-0 flex-1` wrapper — the whole corner
      // cell, since the wind is inside this column now rather than beside it.
      // `items-end`, unconditionally: the plate is the corner cell on the seat's right for every
      // seat (`SLOTS[].info`), so everything in it hangs off that outer edge rather than running
      // away from it. No per-seat branch — the rotation is what makes one rule fit all four
      className="flex w-full flex-col items-end justify-end gap-[0.4cqw]"
    >
      {showWaits && read && read.waits.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-[0.3cqw]">
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
      {/* meta line: the algorithm badge stays corner-most (`flex-row-reverse` puts the first DOM
          child rightmost), the furiten chip inboard of it — its own line now, so it never has to
          wrap onto the waits above it the way sharing a line with the eye/gear/wind would */}
      <div className="flex flex-row-reverse items-center gap-[0.6cqw]">
        <span
          className={`shrink-0 rounded px-[0.6cqw] py-[0.1cqw] text-[2cqw] ${ALGO_COLOR[mode]}`}
        >
          {t(`seats.mode.${mode}`)}
        </span>
        {read?.furiten && (
          /* `InfoPopover` directly rather than `GlossaryTerm`: the popover is portalled to
             <body>, and the plate it would otherwise sit in is rotated with its seat — a
             `GlossaryTerm` here hung its inline hover card sideways off a seat's corner, and drew
             the word itself at the page's 16px instead of the board's own scale. This is the same
             glossary entry either way, sized like the algorithm badge beside it. Its 44px target
             anchors *upward* (`after:bottom-0`) into this line's own box rather than centring on
             it, so it grows into the (non-interactive) waits row above instead of down onto the
             control line below, where the eye and gear already claim the space. */
          <InfoPopover
            triggerLabel={t('glossary.ariaLabel', { term: t(GLOSSARY.furiten.labelKey) })}
            trigger={
              /* the same affordance `GlossaryTerm` gives every other term — dotted underline plus
                 a question mark — so the chip reads as something to tap rather than as a label.
                 Both are sized in `cqw` here: `GlossaryTerm`'s own `size-3` icon is a fixed 12px
                 and would tower over a badge whose text is 2% of the board's width */
              <span className="inline-flex items-center gap-[0.3cqw] underline decoration-dotted underline-offset-2">
                {t(GLOSSARY.furiten.labelKey)}
                <HelpCircle className="size-[1.5cqw] shrink-0" />
              </span>
            }
            triggerClassName="relative shrink-0 rounded bg-red-100 px-[0.6cqw] py-[0.1cqw] text-[2cqw] text-red-800 after:absolute after:bottom-0 after:-inset-x-[0.6cqw] after:h-11 dark:bg-red-900/40 dark:text-red-300"
            dialogTitle={t(GLOSSARY.furiten.labelKey)}
            text={t(GLOSSARY.furiten.descKey)}
            wikiUrl={GLOSSARY.furiten.wikiUrl}
          />
        )}
      </div>
      {/* control line: `flex-row-reverse` again, wind first in DOM so it lands corner-most, then
          the gear, then the eye — the same reading order as a real table's own settings, closest
          things first from where the reader's thumb would land. */}
      <div className="flex flex-row-reverse items-center gap-[2cqw]">
        {wind}
        <SeatButton {...seatButtonProps} />
        {!yours && (
          // omitted on the seat already watched — nothing to switch to from where you already are
          <button
            type="button"
            aria-label={t('seats.sitHere')}
            onClick={() => onWatch(seat)}
            // the board turns underneath the felt, no dialog in the way — the whole point of the
            // eye is that rotating is a one-tap affordance now, not two taps into a dialog.
            // View-only: it never touches `onChange`, so it cannot re-search for a new hand or
            // persist. Touch target matches the gear beside it: 44px tall, spanning its own box
            // plus half the line's gap on each side, so the two never overlap
            className="relative flex h-[8cqw] items-center justify-center text-[3cqw] text-neutral-500 after:absolute after:top-1/2 after:-inset-x-[0.9cqw] after:h-11 after:-translate-y-1/2"
          >
            <Eye className="size-[4cqw]" />
          </button>
        )}
      </div>
    </div>
  )
}
