import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Meld } from '../../core/agari'
import { HONOR, type ParsedTile, type RiverTile } from '../../core/tiles'
import { useSettings } from '../../features/settings/settingsStore'
import { WINDS, type Wind } from '../../features/situation/urlCodec'
import { MeldDisplay, River, Tile } from './Tile'

/** What one seat shows on the table. Everything is optional: a seat with nothing to show
 *  still holds its position, which is what gives the winds a place rather than a label. */
export interface SeatView {
  river?: RiverTile[]
  melds?: Meld[]
  /** Nukidora pulled (sanma). */
  nuki?: ParsedTile[]
}

interface TableProps {
  /** Indexed by seat (0 = East); the length is the player count, so sanma passes three. */
  seats: SeatView[]
  /** Your seat — always drawn at the bottom, with the others placed around it. */
  seatIndex: number
  round: Wind
  doraIndicators?: ParsedTile[]
  /** Ura indicators; pass only once they should be visible. */
  uraIndicators?: ParsedTile[]
  wallCount?: number
  honba?: number
  /** Extra centre content — the scoring trainer's win-condition badges. */
  children?: ReactNode
}

/** Where each seat lands, by its distance around the table from you. Slot 0 is the bottom
 *  (you), then clockwise. The rotation puts every seat's first river row nearest the centre
 *  with rows growing outward, and it carries the melds' corner along with it. */
const SLOTS = [
  { river: 'col-start-2 row-start-3', melds: 'col-start-3 row-start-3', spin: 'rotate-0' },
  { river: 'col-start-3 row-start-2', melds: 'col-start-3 row-start-1', spin: '-rotate-90' },
  { river: 'col-start-2 row-start-1', melds: 'col-start-1 row-start-1', spin: 'rotate-180' },
  { river: 'col-start-1 row-start-2', melds: 'col-start-1 row-start-3', spin: 'rotate-90' },
]

/** Sanma seats the third player on your left, not opposite: there is no toimen. */
const SEAT_SLOTS: Record<number, number[]> = { 3: [0, 1, 3], 4: [0, 1, 2, 3] }

/** Where each seat's wind mark sits on the centre box — against the edge facing that seat. */
const WIND_MARKS = [
  'bottom-0 left-1/2 -translate-x-1/2',
  'right-0 top-1/2 -translate-y-1/2',
  'top-0 left-1/2 -translate-x-1/2',
  'left-0 top-1/2 -translate-y-1/2',
]

function IndicatorRow({ label, tiles }: { label: string; tiles: ParsedTile[] }) {
  return (
    <span className="flex items-center gap-[0.4cqw]">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      {tiles.map((tile, i) => (
        <Tile key={i} id={tile.id} red={tile.red} />
      ))}
    </span>
  )
}

/** Shown on a narrow portrait screen, where a square board leaves the hand no room. Dismissed
 *  for good via the persisted setting rather than per session — it is a one-time tip. */
function RotateHint() {
  const { t } = useTranslation()
  const hidden = useSettings((s) => s.hideRotateHint)
  const setHidden = useSettings((s) => s.setHideRotateHint)
  if (hidden) return null
  return (
    <div className="mb-2 hidden flex-col gap-1 rounded-lg border border-amber-400 p-2 text-xs text-amber-700 max-sm:portrait:flex dark:text-amber-400">
      <span>{t('table.rotateHint')}</span>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          onChange={(e) => e.target.checked && setHidden(true)}
          className="size-5"
        />
        {t('table.rotateHintDismiss')}
      </label>
    </div>
  )
}

/**
 * The board: every seat's river, melds and nuki placed around a centre panel holding the round
 * wind, dora and wall count — the shared surface for the efficiency, scoring and folding
 * trainers. Laid out as a 3x3 grid measured in tile widths (a river's three rows are four tile
 * widths deep, so the bands are 4fr and the centre 6fr, 14 across), which is what lets the whole
 * board scale off one number: `--tile-w` is a fraction of the container's own width.
 */
export function Table({
  seats,
  seatIndex,
  round,
  doraIndicators = [],
  uraIndicators = [],
  wallCount,
  honba,
  children,
}: TableProps) {
  const { t } = useTranslation()
  const players = seats.length
  const slotOf = SEAT_SLOTS[players] ?? SEAT_SLOTS[4]

  return (
    // square, so its size is one number: the narrower of the column it sits in and the height
    // left after the page chrome (~8rem of header, status line and padding), capped at 32rem so
    // it does not balloon on a desktop. The width lives on this outer div, not on the square
    // itself: beside the hand the board is a flex item, where a `w-full` child would have
    // nothing to resolve against and collapse to nothing
    <div className="mx-auto w-full max-w-[min(100%,calc(100svh-8rem),32rem)] shrink-0">
      <RotateHint />
      <div className="@container aspect-square w-full">
        {/* minmax(0,…): a seat block is measured before it rotates, so its 6-tile row is wider
            than the 4fr band it sits in — with fr's default auto minimum that would grow the
            band and knock the whole board out of square */}
        <div className="grid h-full w-full grid-cols-[minmax(0,4fr)_minmax(0,6fr)_minmax(0,4fr)] grid-rows-[minmax(0,4fr)_minmax(0,6fr)_minmax(0,4fr)] rounded-xl bg-emerald-800/10 p-[1cqw] [--tile-w:calc(100cqw/14)] dark:bg-emerald-200/5">
          {seats.map((seat, index) => {
            const slot = SLOTS[slotOf[(index - seatIndex + players) % players]]
            const wind = t(`wind.${WINDS[index]}`)
            const called = (seat.melds?.length ?? 0) + (seat.nuki?.length ?? 0) > 0
            return (
              <div key={index} className="contents">
                {/* fixed at a full river's footprint (6 wide, 3 rows deep) rather than sized to
                    its contents, so discards start in the corner nearest the centre and fill
                    outward instead of drifting as the pile grows — and a 4th row overflows the
                    box away from the centre, which the rotation handles for every seat */}
                <div
                  aria-label={wind}
                  data-seat={index}
                  className={`grid h-[calc(var(--tile-w)*4)] w-[calc(var(--tile-w)*6)] place-items-start place-self-center ${slot.river} ${slot.spin}`}
                >
                  <River tiles={seat.river ?? []} />
                </div>
                {called && (
                  <div
                    className={`flex flex-col items-end justify-start gap-[0.5cqw] place-self-center [--tile-w:calc(100cqw/18)] ${slot.melds} ${slot.spin}`}
                  >
                    {seat.melds?.map((meld, i) => (
                      <MeldDisplay key={i} meld={meld} />
                    ))}
                    {seat.nuki && seat.nuki.length > 0 && (
                      <div className="flex [--tile-w:calc(100cqw/22)]">
                        {seat.nuki.map((tile, i) => (
                          <Tile key={i} id={tile.id} red={tile.red} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <div className="relative col-start-2 row-start-2 flex flex-col items-center justify-center gap-[0.8cqw] rounded-lg border border-neutral-400/30 p-[3.5cqw] text-center text-[2.6cqw] leading-tight">
            {seats.map((_, index) => {
              const slot = slotOf[(index - seatIndex + players) % players]
              const you = index === seatIndex
              return (
                <span
                  key={index}
                  className={`absolute rounded px-[1cqw] text-[2.4cqw] font-semibold ${WIND_MARKS[slot]} ${
                    you ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'
                  }`}
                >
                  {t(`wind.${WINDS[index]}`)}
                  {you && <span className="font-normal"> {t('table.you')}</span>}
                </span>
              )
            })}

            {/* the bare tile is the tenhou convention, but it only reads as "the round" to
                someone who already knows that, so it keeps its label like the dora row */}
            <span className="flex flex-col items-center [--tile-w:calc(100cqw/16)]">
              <span className="text-neutral-500 dark:text-neutral-400">{t('table.round')}</span>
              <Tile id={HONOR + WINDS.indexOf(round)} />
            </span>
            <span className="flex flex-wrap items-center justify-center gap-x-[1.5cqw] text-neutral-500 dark:text-neutral-400">
              {wallCount !== undefined && <span>{t('table.wall', { count: wallCount })}</span>}
              {honba !== undefined && honba > 0 && (
                <span>{t('table.honba', { count: honba })}</span>
              )}
            </span>
            <span className="flex flex-col items-center gap-[0.4cqw] [--tile-w:calc(100cqw/24)]">
              {doraIndicators.length > 0 && (
                <IndicatorRow label={t('table.dora')} tiles={doraIndicators} />
              )}
              {uraIndicators.length > 0 && (
                <IndicatorRow label={t('table.ura')} tiles={uraIndicators} />
              )}
            </span>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
