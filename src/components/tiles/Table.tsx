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
  /** This seat's hand tiles, shown beside the board — omitted for the seat the board is drawn
   *  from, which has its own on-screen hand below it. The table itself doesn't gate on any
   *  setting; the caller decides both whether to pass this and whether `concealed` accompanies
   *  it. */
  hand?: ParsedTile[]
  /** This seat's 14th tile, held apart from `hand` with a small gap — the same tedashi/tsumogiri
   *  read a real felt gives, for whichever seat is mid-turn. Honours `concealed` exactly like
   *  `hand`: a concealed seat's draw is still a fresh back, not a spoiler. */
  drawn?: ParsedTile
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
  honba?: number
  /** Extra centre content — the scoring trainer's win-condition badges. */
  children?: ReactNode
  /** Buttons that belong to the board (the fullscreen toggle), drawn in a row above it. They live
   *  *inside* the width-capped box on purpose: the box is the only element that knows how wide the
   *  board actually is, and a wrapper around it would have to guess — guessing wrong is what
   *  collapses the square when the board is a flex item. */
  controls?: ReactNode
  /** One seat's own info strip — the settings button plus its furiten/algorithm/wait reads —
   *  drawn in that seat's own corner cell, above its melds, like the player plate on a Mahjong
   *  Soul table. It sat one ring *outboard* of the seat's hand before, which cost the board a 16%
   *  margin on every side purely to host a 44px button: on a phone that band came out ~50px, so
   *  the strip and the hand row together overflowed it and landed on top of the seat's third
   *  river row. The corner cell is 4 tile widths square and empty until a seat calls, so the
   *  strip costs the felt nothing there. (Earlier homes, both rejected: the centre panel — four
   *  44px targets buried the round wind, the wall count and the dora row — and the control row
   *  above the board, which is nowhere near the seat it configures.) */
  seatInfo?: (seat: number) => ReactNode
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

/** Fraction of the board's own edge given up to the per-seat hand ring when hands are revealed
 *  (`showsHands`) — the single number behind both the felt's own padding (`p-[10%]`, hardcoded
 *  below since Tailwind's class scanner needs the literal) and the `--table-cap` divisor that
 *  keeps the felt from shrinking when it's spent. A revealed hand row is `100cqw/16` per tile,
 *  so ~8.3cqw tall — 10% of the square clears it. It was 16% while the seat strip lived out here
 *  too; the strip has moved to the corner cells, and the board keeps the difference. */
const SEAT_RING_FRACTION = 0.1

/** How much of a seat's corner cell the meld stack may take, in felt widths (`cqw`). The cell is
 *  4 board tiles deep — `4 * (100 - 2) / 14.6` ≈ 26.8cqw — and the seat's plate is pinned to the
 *  far end of that same column, so the calls get the rest. Four calls is the case this exists for:
 *  at the plain `100cqw/18` tile they need ~31cqw and land on the seat's own river instead. */
const MELD_BAND = 17

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
function IndicatorRow({
  label,
  tiles,
  testId,
}: {
  label: string
  tiles: ParsedTile[]
  /** Names the row for the UI suite — the visible label is translated, so it is no handle. */
  testId: string
}) {
  return (
    <>
      <span className="text-right text-neutral-500 dark:text-neutral-400">{label}</span>
      <span data-testid={testId} className="flex items-center">
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
  controls,
  seatInfo,
}: TableProps) {
  const { t } = useTranslation()
  const players = seats.length
  const slotOf = SEAT_SLOTS[players] ?? SEAT_SLOTS[4]
  // the board draws its own tiles as a fraction of its width, so the tile-size setting can only
  // reach them through the board's cap — 25.6rem is the old fixed 32rem read back out at the
  // default scale, so an untouched setting leaves the board exactly where it was
  const tileScale = useSettings((s) => s.tileScale) ?? DEFAULT_TILE_SCALE
  const showsHands = seats.some((seat) => seat.hand && seat.hand.length > 0)
  // evaluated once per seat rather than once per render pass through the loop below — a caller
  // may pass `seatInfo` unconditionally and return nothing per seat (e.g. while `seatsEnabled`
  // is false), and each seat's corner cell has to know which it got
  const seatInfoNodes = seatInfo ? seats.map((_, i) => seatInfo(i)) : undefined

  return (
    // square, so its size is one number: the narrower of the column it sits in and the height
    // left after the page chrome (~8rem of header, status line and padding — the fullscreen
    // board overrides that with its own `--board-max-h`), capped so it does not balloon on a
    // desktop. The width lives on this outer div, not on the square
    // itself: beside the hand the board is a flex item, where a `w-full` child would have
    // nothing to resolve against and collapse to nothing
    <div
      // `--board-controls` is a class, not part of the style object below, so the `short:` variant
      // can zero it: held sideways the row moves off the top of the board into the gutter beside
      // it, and a row that costs nothing vertically must not still be charged for
      // `100cqh` is the real height left for the board wherever an ancestor declares itself a
      // size container (the fullscreen stage does), so the square fits what is actually there
      // rather than what `--board-max-h` guessed the chrome and the hand would take. With no such
      // ancestor the unit falls back to the small viewport, which is larger than the guess and so
      // changes nothing for the inline layout
      className={`relative mx-auto w-full max-w-[min(100%,calc(100cqh-var(--board-controls,0px)),calc(var(--board-max-h,calc(100svh-8rem))-var(--board-controls,0px)),var(--table-max,var(--table-cap)))] shrink-0 ${
        controls
          ? '[--board-controls:2.75rem] short:[--board-controls:0px]'
          : '[--board-controls:0px]'
      }`}
      style={
        {
          // the revealed hands are paid for out of the board's own footprint (the 10% below), so
          // the cap grows to match: at the same felt size the square needs 1/0.8 of the width.
          // Without it, revealing hands shrank the felt.
          // Named `--table-cap`, not `--table-max`: this is the desktop "don't balloon" default,
          // and an inline style would otherwise outrank the `--table-max` a caller sets on an
          // ancestor — which is exactly how fullscreen lifts the cap
          '--table-cap': `${(25.6 * tileScale) / (showsHands ? 1 - 2 * SEAT_RING_FRACTION : 1)}rem`,
        } as CSSProperties
      }
    >
      {/* a row above the board normally; held sideways, a column standing in the gutter to its
          left (`right-full`, so it hugs the square's edge whatever the square's size), wrapping
          into a second column rather than running off the bottom. Height is the only axis a
          square board is ever short of, and the width beside it is doing nothing. The seat panel
          no longer lives here — each seat's own strip, on the felt itself, replaced it */}
      {controls && (
        <div className="flex items-center gap-1 short:absolute short:top-0 short:right-full short:h-full short:flex-col short:flex-wrap short:content-end short:items-center short:gap-0">
          <div className="ml-auto flex items-center gap-1 short:contents">{controls}</div>
        </div>
      )}
      {/* the revealed hands sit outside the felt, so the square gives up a margin's worth of its
          own width to hold them — only while they are actually shown, so an ordinary board is
          exactly as big as it was. The border box stays square either way, which is what keeps
          each seat's rotation covering it. `relative`: the ring below is anchored to *this* box's
          own edge, not the felt's, so it can never leave the square */}
      <div
        data-testid="board"
        className={`@container relative aspect-square w-full ${showsHands ? 'p-[10%]' : ''}`}
      >
        {/* minmax(0,…): a seat block is measured before it rotates, so its 6-tile row is wider
            than the 4fr band it sits in — with fr's default auto minimum that would grow the
            band and knock the whole board out of square. The centre band is 6.6fr, not 6fr: the
            felt's own p-[1cqw] eats 2cqw off the 100cqw --tile-w divisor below, so 4fr must stay
            exactly 4 tile widths for the river bands to fit — that leaves 6.6fr for the centre,
            which is what actually grows it (the old 6fr/100cqw pairing quietly shorted the river
            bands by that same 2cqw, which is what let them overlap the panel) */}
        {/* `aspect-square`, not `h-full`: the felt's box is square by construction (a square with
            equal padding on all four sides — percentage padding resolves against the width, so it
            is equal), and asking for it directly is the one form both engines agree on. `h-full`
            here is a percentage of a height the square itself only gets from `aspect-ratio`, which
            WebKit treats as indefinite — the height fell back to auto, the rows sized to their
            content instead of to their fr shares, and the board came out 390x468 on an iPhone
            while Chrome drew it square. That is the "table is not squared, but only on iOS" bug. */}
        <div className="grid aspect-square w-full grid-cols-[minmax(0,4fr)_minmax(0,6.6fr)_minmax(0,4fr)] grid-rows-[minmax(0,4fr)_minmax(0,6.6fr)_minmax(0,4fr)] rounded-xl bg-emerald-800/10 p-[1cqw] [--tile-w:calc((100cqw-2cqw)/14.6)] dark:bg-emerald-200/5">
          {seats.map((seat, index) => {
            const slot = SLOTS[slotOf[(index - seatIndex + players) % players]]
            const wind = t(`wind.${WINDS[index]}`)
            const called = (seat.melds?.length ?? 0) + (seat.nuki?.length ?? 0) > 0
            // every row the corner cell has to stack: one per meld, one for the nuki pile
            const rows = (seat.melds?.length ?? 0) + (seat.nuki?.length ? 1 : 0) || 1
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
                  data-testid="river"
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
                {((seat.hand && seat.hand.length > 0) || seat.drawn) && (
                  /* anchored to the *outer* square (the `relative` box two levels up), not to the
                     felt this `contents` group sits in — `display: contents` doesn't generate a
                     box, so an absolutely positioned child here still resolves against that outer
                     box regardless of its own grid-item ancestry. `inset-0` on a padded ancestor
                     reaches past its own padding to the true border edge, so `items-end` lands
                     this ring flush against the square's own boundary: the ring can grow into the
                     padding band it was given, never past it. Nothing about the river moves: the
                     hand is beside the table, which is where a revealed hand belongs. The seat's
                     info strip is no longer stacked out here with it — that lives in the corner
                     cell below now, so this ring is never deeper than one row of tiles */
                  <div
                    className={`pointer-events-none absolute inset-0 flex items-end justify-center ${slot.spin}`}
                  >
                    <div className="flex [--tile-w:calc(100cqw/16)]">
                      {seat.hand?.map((tile, i) => (
                        <Tile key={i} id={seat.concealed ? undefined : tile.id} red={tile.red} />
                      ))}
                      {seat.drawn && (
                        <div className="ml-[0.5cqw]">
                          <Tile
                            id={seat.concealed ? undefined : seat.drawn.id}
                            red={seat.drawn.red}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(called || seatInfoNodes?.[index]) && (
                  /* the seat's own corner: melds stacked from the edge nearest the centre, the
                     info strip pinned (`mt-auto`) to the far one — the plate at the seat's corner,
                     where a Mahjong Soul table puts it. The cell fills its whole 4x4 tile-width
                     track (no `place-self-center`) so `mt-auto` has the corner to push against,
                     and the seat's own rotation carries "far" round with it for every seat */
                  <div
                    data-testid="corner"
                    data-seat={index}
                    style={
                      {
                        // the corner track is 4 board tiles deep and has to hold every call this
                        // seat has made *plus* its plate. One meld row is 4/3 of a tile tall, so
                        // `MELD_BAND` divided by that many rows is the widest tile that still fits;
                        // `min()` keeps a seat with one or two calls at the size it always drew,
                        // and only a heavily open hand pays. Without it a third call pushed the
                        // stack out of the corner and across the seat's own river.
                        '--tile-w': `min(calc(100cqw/18), calc(${MELD_BAND}cqw / ${rows * (4 / 3)}))`,
                      } as CSSProperties
                    }
                    className={`flex h-full w-full flex-col items-end justify-start gap-[0.5cqw] ${slot.melds} ${slot.spin}`}
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
                    {seatInfoNodes?.[index] && (
                      <div className="mt-auto [--tile-w:calc(100cqw/22)]">
                        {seatInfoNodes[index]}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* the gap here separates the panel's three readouts (round, counters, indicators) and
              nothing inside them — the dora/ura rows keep their own tighter grid spacing */}
          <div className="relative col-start-2 row-start-2 flex flex-col items-center justify-center gap-[3cqw] rounded-lg border border-neutral-400/30 p-[3.5cqw] text-center text-[2.6cqw] leading-tight">
            {seats.map((_, index) => {
              const slot = slotOf[(index - seatIndex + players) % players]
              const you = index === seatIndex
              return (
                <span
                  key={index}
                  className={`absolute flex items-center rounded px-[1cqw] text-[2.4cqw] font-semibold ${WIND_MARKS[slot]} ${
                    you ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'
                  }`}
                >
                  {t(`wind.${WINDS[index]}`)}
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
                <IndicatorRow label={t('table.dora')} tiles={doraIndicators} testId="dora-row" />
              )}
              {uraIndicators.length > 0 && (
                <IndicatorRow label={t('table.ura')} tiles={uraIndicators} testId="ura-row" />
              )}
            </span>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
