import { HelpCircle } from 'lucide-react'
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
}

/**
 * One seat's info strip on the felt: the settings button that opens `SeatButton`'s dialog, then
 * the algorithm badge (which belongs beside the trigger that sets it), then the furiten badge, and
 * the wait tiles above — the two hand reads together, outboard of the two seat settings, with the
 * seat's wind (`Table`'s own node, passed in) leading the bottom line. It fills
 * the corner cell on that seat's right, so the waits are drawn in full rather than trimmed to the
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
      {/* `flex-row-reverse`, so source order still reads wind-first while the wind lands at the
          corner: it is the one thing on this line that has to sit on the felt's own edge.
          `flex-wrap-reverse` with it: this line does overflow (a manual seat carries a furiten
          chip and an algorithm badge beside the wind), and wrapping the usual way pushed the
          overflow *below* the wind, which is off the felt and no longer the corner */}
      <div className="flex flex-row-reverse flex-wrap-reverse items-center gap-[0.6cqw]">
        {wind}
        <SeatButton {...seatButtonProps} />
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
             glossary entry either way, sized like the algorithm badge beside it, with
             `SeatPanel`'s `after:size-11` trick keeping a real 44px target over a `cqw` box */
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
            triggerClassName="relative shrink-0 rounded bg-red-100 px-[0.6cqw] py-[0.1cqw] text-[2cqw] text-red-800 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 dark:bg-red-900/40 dark:text-red-300"
            dialogTitle={t(GLOSSARY.furiten.labelKey)}
            text={t(GLOSSARY.furiten.descKey)}
            wikiUrl={GLOSSARY.furiten.wikiUrl}
          />
        )}
      </div>
    </div>
  )
}
