import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Meld } from '../../core/agari'
import { HONOR, type ParsedTile, type RiverTile } from '../../core/tiles'
import { DEFAULT_TILE_SCALE, useSettings } from '../../features/settings/settingsStore'
import { WINDS, type Wind } from '../../features/situation/urlCodec'
import { MeldDisplay, River, Tile } from './Tile'

/** What one seat shows on the table. Everything is optional: a seat with nothing to show
 *  still holds its position, which is what gives the winds a place rather than a label. */
export interface SeatView {
  river?: RiverTile[]
  melds?: Meld[]
  /** Nukidora pulled (sanma). */
  nuki?: ParsedTile[]
  /** This seat has declared riichi — drawn as a 1000-point bet stick in front of its river. */
  riichi?: boolean
  /** This seat's hand tiles, shown beside the board — omitted entirely for your own seat (which
   *  has its own on-screen hand) and for an opponent whose hand the caller has hidden outright
   *  (the `hideConcealedHands` setting). The table itself doesn't gate on any setting; the caller
   *  decides both whether to pass this and whether `concealed` accompanies it. */
  hand?: ParsedTile[]
  /** Draw `hand` as face-down backs — the tile count and melds still read, faces don't. This is
   *  the default opponent view; pass `false` (real faces) only when `showOpponentHands` is on. */
  concealed?: boolean
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
  /** Tiles the live wall started with (before any draw) — shown as the bar's fixed width, so it
   *  reads as "the whole wall, greying as it's drawn" instead of shrinking away as `wallCount`
   *  drops. Omit to fall back to the bare count (no bar). */
  wallTotal?: number
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

/** Where each seat's wind mark sits on the centre box — near the edge facing that seat, but
 *  pulled in a little rather than flush against it: a declaring seat's riichi stick sits just
 *  outside that same edge (nearest the centre, by design), and flush-against-the-edge collided
 *  with it. */
const WIND_MARKS = [
  'bottom-[6%] left-1/2 -translate-x-1/2',
  'right-[6%] top-1/2 -translate-y-1/2',
  'top-[6%] left-1/2 -translate-x-1/2',
  'left-[6%] top-1/2 -translate-y-1/2',
]

/** A real dead wall always shows five indicator slots; a kan flips the next one. The unflipped
 *  ones are drawn face-down rather than left out, so the row says how many are still to come
 *  instead of silently growing. */
const INDICATOR_SLOTS = 5

/** A betting stick, sized off the board's tile width like everything else here: 1000 points
 *  (one red dot) for a riichi bet, 100 points (plain) for an honba counter. It reads as a
 *  counter mark beside the tile icon, so it inherits whatever small `--tile-w` that row sets
 *  rather than the centre panel's full one — at the panel's own width it came out four times
 *  the icon and wrapped the row onto three lines. */
function Stick({
  dot = false,
  label,
  vertical = false,
}: {
  dot?: boolean
  label: string
  /** Stood on end. The centre readout's counters use it — upright they cost a fraction of the
   *  width and stand exactly as tall as the tile icon beside them. A stick actually on the
   *  table (a seat's riichi bet) stays lying flat, which is where it really lies. */
  vertical?: boolean
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`flex shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/10 ${
        vertical
          ? 'h-[calc(var(--tile-w)*1.33)] w-[calc(var(--tile-w)*0.3)]'
          : 'h-[calc(var(--tile-w)*0.28)] w-[calc(var(--tile-w)*1.7)]'
      }`}
    >
      {dot && <span className="size-[calc(var(--tile-w)*0.2)] rounded-full bg-red-600" />}
    </span>
  )
}

/** One indicator row, rendered as two grid cells rather than its own flex box: the dora and ura
 *  rows then share a single label column and their tiles start at the same x. "Dora" and "Ura"
 *  are not the same width in any language, so laid out separately they never line up. */
function IndicatorRow({ label, tiles }: { label: string; tiles: ParsedTile[] }) {
  return (
    <>
      <span className="text-right text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="flex items-center">
        {tiles.map((tile, i) => (
          <Tile key={i} id={tile.id} red={tile.red} />
        ))}
        {/* dimmed: at this size a tile back is a solid block of colour, and five of them at full
            strength shout louder than the indicator that is actually showing */}
        {Array.from({ length: Math.max(0, INDICATOR_SLOTS - tiles.length) }, (_, i) => (
          <Tile key={`back-${i}`} className="opacity-40" />
        ))}
      </span>
    </>
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
  wallTotal,
  honba,
  children,
}: TableProps) {
  const { t } = useTranslation()
  const players = seats.length
  const slotOf = SEAT_SLOTS[players] ?? SEAT_SLOTS[4]
  // the board draws its own tiles as a fraction of its width, so the tile-size setting can only
  // reach them through the board's cap — 25.6rem is the old fixed 32rem read back out at the
  // default scale, so an untouched setting leaves the board exactly where it was
  const tileScale = useSettings((s) => s.tileScale) ?? DEFAULT_TILE_SCALE
  const showsHands = seats.some((seat) => seat.hand && seat.hand.length > 0)

  return (
    // square, so its size is one number: the narrower of the column it sits in and the height
    // left after the page chrome (~8rem of header, status line and padding), capped so it does
    // not balloon on a desktop. The width lives on this outer div, not on the square
    // itself: beside the hand the board is a flex item, where a `w-full` child would have
    // nothing to resolve against and collapse to nothing
    <div
      className="mx-auto w-full max-w-[min(100%,calc(100svh-8rem),var(--table-max))] shrink-0"
      style={
        {
          // the revealed hands are paid for out of the board's own footprint (the 8% below), so
          // the cap grows to match: at the same felt size the square needs 1/0.84 of the width.
          // Without it, turning the setting on shrank the felt by a sixth
          '--table-max': `${(25.6 * tileScale) / (showsHands ? 0.84 : 1)}rem`,
        } as CSSProperties
      }
    >
      <RotateHint />
      {/* the revealed hands sit outside the felt, so the square gives up a margin's worth of its
          own width to hold them — only when they are actually shown, so an ordinary board is
          exactly as big as it was. The border box stays square either way, which is what keeps
          each seat's rotation covering it */}
      <div className={`@container aspect-square w-full ${showsHands ? 'p-[8%]' : ''}`}>
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
                    box away from the centre, which the rotation handles for every seat. The
                    riichi stick sits above (flex-col, before River), which is the side nearest
                    the centre before rotation is applied — the box's own w/h stay untouched so
                    the fixed footprint keeps doing its job, the stick just overflows into the
                    gap toward the centre panel like everything else here does. It is positioned
                    rather than stacked: in the flow it ate its own height off the top of a box
                    three rows already fill exactly, pushing the third row out through the far
                    edge of the felt */}
                <div
                  aria-label={wind}
                  data-seat={index}
                  className={`relative flex h-[calc(var(--tile-w)*4)] w-[calc(var(--tile-w)*6)] flex-col items-start place-self-center ${slot.river} ${slot.spin}`}
                >
                  {seat.riichi && (
                    <span className="absolute bottom-full left-1/2 mb-[0.4cqw] -translate-x-1/2">
                      <Stick dot label={t('table.riichiStick')} />
                    </span>
                  )}
                  <River tiles={seat.river ?? []} />
                </div>
                {seat.hand && seat.hand.length > 0 && (
                  /* spans the whole (square) board and rotates with the seat, so the row runs that
                     seat's entire side as one row instead of wrapping inside the river's six-tile
                     box — and is then pushed clear of the felt entirely, into the margin the
                     square gave up above. Nothing about the river moves: the hand is beside the
                     table, which is also where a revealed hand belongs */
                  <div
                    className={`pointer-events-none col-span-3 col-start-1 row-span-3 row-start-1 flex items-end justify-center ${slot.spin}`}
                  >
                    <div className="flex translate-y-[112%] [--tile-w:calc(100cqw/16)]">
                      {seat.hand.map((tile, i) => (
                        <Tile key={i} id={seat.concealed ? undefined : tile.id} red={tile.red} />
                      ))}
                    </div>
                  </div>
                )}
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

          {/* the gap here separates the panel's three readouts (round, counters, indicators) and
              nothing inside them — the dora/ura rows keep their own tighter grid spacing */}
          <div className="relative col-start-2 row-start-2 flex flex-col items-center justify-center gap-[4cqw] rounded-lg border border-neutral-400/30 p-[3.75cqw] text-center text-[2.6cqw] leading-tight">
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
            <span className="flex items-center gap-[0.8cqw] [--tile-w:calc(100cqw/24)]">
              <span className="text-neutral-500 dark:text-neutral-400">{t('table.round')}</span>
              <Tile id={HONOR + WINDS.indexOf(round)} />
            </span>
            {/* tenhou's centre readout: tiles left, riichi bets on the table, honba counters —
                marked by their own object rather than a word, which is what makes the row read
                the same in every language */}
            {/* one line, never wrapped: the three marks are a single readout, and the small
                `--tile-w` is set once here so the sticks measure against the same tile the icon
                is drawn at */}
            <span className="flex items-center justify-center gap-x-[1.2cqw] text-neutral-500 [--tile-w:calc(100cqw/24)] dark:text-neutral-400">
              {wallCount !== undefined && (
                <span
                  aria-label={t('table.wall', { count: wallCount })}
                  className="flex items-center gap-[0.5cqw] whitespace-nowrap"
                >
                  <Tile />
                  {wallTotal !== undefined && (
                    <span className="flex h-[calc(var(--tile-w)*0.4)] w-[calc(var(--tile-w)*4)] overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/10">
                      {/* fixed-width bar sized to the whole starting wall, not the shrinking
                          remainder — drawn tiles stay represented, just greyed, rather than the
                          bar (and the felt's sense of "how much wall is left") shrinking away */}
                      <span
                        className="h-full bg-neutral-300 dark:bg-neutral-700"
                        style={{ flex: `${wallTotal - wallCount} 1 0%` }}
                      />
                      <span
                        className="h-full bg-neutral-600 dark:bg-neutral-300"
                        style={{ flex: `${wallCount} 1 0%` }}
                      />
                    </span>
                  )}
                  {wallCount}
                </span>
              )}
              <span className="flex items-center gap-[0.5cqw] whitespace-nowrap">
                <Stick dot vertical label={t('table.riichiSticks')} />
                {seats.filter((seat) => seat.riichi).length}
              </span>
              <span className="flex items-center gap-[0.5cqw] whitespace-nowrap">
                <Stick vertical label={t('table.honbaSticks')} />
                {honba ?? 0}
              </span>
            </span>
            <span className="grid grid-cols-[auto_auto] items-center justify-center gap-x-[0.6cqw] gap-y-[0.4cqw] [--tile-w:calc(100cqw/24)]">
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
