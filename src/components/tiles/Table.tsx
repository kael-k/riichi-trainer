import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Meld } from '../../core/agari'
import type { ParsedTile, RiverTile } from '../../core/tiles'
import type { CallBanner } from '../../features/table/useRound'
import { WINDS, type Wind } from '../../features/situation/urlCodec'
import { gapIndex, MeldDisplay, River, Tile } from './Tile'

/** What one seat shows on the table. Everything is optional: a seat with nothing to show
 *  still holds its position, which is what gives the winds a place rather than a label. */
export interface SeatView {
  river?: RiverTile[]
  melds?: Meld[]
  /** Nukidora pulled (sanma). */
  nuki?: ParsedTile[]
  /** This seat has declared riichi — drawn as a 1000-point bet stick in front of its river. */
  riichi?: boolean
  /** The last tile in this seat's river is a discard a claim is pending on — displaced out of its
   *  row and ringed amber, so a reader can see *what* is being asked about without a caption
   *  duplicating what the turn glow (`activeSeat`) already says. `finishTurn` pushes a discard
   *  onto the river before resolving reactions, so the claimed tile is always `river.at(-1)`. */
  claiming?: boolean
  /** This seat's hand tiles, shown beside the board — omitted for the seat the board is drawn
   *  from, which has its own on-screen hand below it. The table itself doesn't gate on any
   *  setting; the caller decides both whether to pass this and whether `concealed` accompanies
   *  it. */
  hand?: ParsedTile[]
  /** A tile this seat has just thrown out of its thirteen, still in flight to the river: its slot
   *  in `hand` stays open (one tile of empty space, at the sorted position it would occupy) until
   *  whoever set this clears it. That hole *is* the tedashi read — a tsumogiri never leaves one,
   *  which is why this is only ever set for the other kind. Board truth like `claiming`, and a
   *  value: the position is the row's own sort, not a fact about the hand. */
  tedashi?: ParsedTile
  /** This seat's 14th tile, held apart from `hand` with a small gap — the same tedashi/tsumogiri
   *  read a real felt gives, for whichever seat is mid-turn. Honours `concealed` exactly like
   *  `hand`: a concealed seat's draw is still a fresh back, not a spoiler. */
  drawn?: ParsedTile
  /** Draw `hand` as face-down backs — the tile count and melds still read, faces don't. This is
   *  the default opponent view; pass `false` (real faces) only when `showOpponentHands` is on. */
  concealed?: boolean
  /** This seat's current point total (`MatchState.points`) — drawn on the centre panel's edge
   *  facing this seat and turned to face it, where a real table keeps the scores. Board truth like
   *  `riichi`/`melds` rather than something routed through the caller's `seatInfo` render prop,
   *  which is the settings/algorithm/waits surface. */
  points?: number
}

interface TableProps {
  /** Indexed by seat (0 = East); the length is the player count, so sanma passes three. */
  seats: SeatView[]
  /** Your seat — always drawn at the bottom, with the others placed around it. */
  seatIndex: number
  round: Wind
  /** Which round within the prevalent wind — East 1 is `1` (`MatchState.round`). Printed after the
   *  wind's name in the centre panel ("East 1"). */
  roundNumber?: number
  /** How many times this dealer has repeated (`MatchState.dealerRepeat`) — printed after the round
   *  ("East 1 · 0"). Omitted entirely when not given, which is what a frozen result with no
   *  running match passes. Not `honba`: the two diverge by ruleset, and the honba counter has its
   *  own stick mark in the row below. */
  dealerRepeat?: number
  doraIndicators?: ParsedTile[]
  /** Ura indicators; pass only once they should be visible. */
  uraIndicators?: ParsedTile[]
  wallCount?: number
  honba?: number
  /** The seat that owes a decision right now (`core/table.ts#actingSeat` — a pending claim
   *  outranks the turn order) — lights the felt's edge on that seat's side, the one ambient signal
   *  that the board is waiting on a person rather than sitting idle. Omit once the hand is over. */
  activeSeat?: number
  /** The call a seat has just made, drawn big on that seat's own edge for as long as whoever owns
   *  this keeps it set. Board truth like `activeSeat`, and a **value**: `Table` never derives
   *  which call a meld represents — a meld-count diff plus `meld.kind` would be game logic in a
   *  pure view (ADR-0014, ADR-0042). Its lifetime belongs to the driver that raised it
   *  (`useRound`'s `callBanner`), which is the only thing that knows when the board moved on. */
  call?: CallBanner
  /** Extra centre content — the scoring trainer's win-condition badges. */
  children?: ReactNode
  /** One seat's own info strip — the settings button plus its furiten/algorithm/wait reads — given
   *  the whole corner cell on that seat's *right*, so a thirteen-sided wait has a 4x4 tile-width
   *  track to wrap into. The seat's wind comes back the other way, as the second argument: an
   *  already-styled node the strip puts on its own bottom line, which is what lets the wait tiles
   *  above start at the wind's outer edge rather than indented past it. A caller that returns
   *  nothing for a seat gets the bare wind drawn there instead. (Earlier homes, all rejected: one
   *  ring *outboard* of the seat's hand, which cost the board a 16% margin on every side purely to
   *  host a 44px button — on a phone that band came out ~50px and the strip landed on the seat's
   *  third river row; the centre panel, where four 44px targets buried the round, the wall count
   *  and the dora row; and the control row above the board, nowhere near the seat it configures.) */
  seatInfo?: (seat: number, wind: ReactNode) => ReactNode
}

/** Where each seat lands, by its distance around the table from you. Slot 0 is the bottom
 *  (you), then clockwise. The rotation puts every seat's first river row nearest the centre
 *  with rows growing outward, and it carries the seat's `info` corner (its wind, its algorithm,
 *  its waits) along with it. The calls are not a corner cell at all any more — they lie beside
 *  the seat's own hand, off the felt, in the ring below.
 *
 *  `info` is the corner cell on that seat's own **right**, read after `spin` is applied: the
 *  bottom seat's is the board's bottom-right, and each further slot's is one corner round from
 *  there. Every seat gets a distinct corner, sanma's three (`SEAT_SLOTS[3]`) included. */
const SLOTS = [
  {
    river: 'col-start-2 row-start-3',
    info: 'col-start-3 row-start-3',
    spin: 'rotate-0',
  },
  {
    river: 'col-start-3 row-start-2',
    info: 'col-start-3 row-start-1',
    spin: '-rotate-90',
  },
  {
    river: 'col-start-2 row-start-1',
    info: 'col-start-1 row-start-1',
    spin: 'rotate-180',
  },
  {
    river: 'col-start-1 row-start-2',
    info: 'col-start-1 row-start-3',
    spin: 'rotate-90',
  },
]

/** Sanma seats the third player on your left, not opposite: there is no toimen. */
const SEAT_SLOTS: Record<number, number[]> = { 3: [0, 1, 3], 4: [0, 1, 2, 3] }

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
  roundNumber,
  dealerRepeat,
  doraIndicators = [],
  uraIndicators = [],
  wallCount,
  honba,
  activeSeat,
  call,
  children,
  seatInfo,
}: TableProps) {
  const { t } = useTranslation()
  const players = seats.length
  const slotOf = SEAT_SLOTS[players] ?? SEAT_SLOTS[4]
  // the board draws its own tiles as a fraction of its width, so the tile-size setting can only
  // reach them through the board's cap — 25.6rem is the old fixed 32rem read back out at the
  // default scale, so an untouched setting leaves the board exactly where it was
  // the ring outside the felt holds hands *and* calls, so a board where nobody's hand is drawn
  // but somebody has called still has to pay for the band — otherwise those calls would be drawn
  // over the felt's own edge and across a river
  const showsHands = seats.some(
    (seat) => seat.hand?.length || seat.melds?.length || seat.nuki?.length,
  )
  // the seat's own wind, styled by the board and handed *to* the strip rather than drawn beside
  // it: the strip puts it on its bottom line with the settings button, which is what lets the
  // wait tiles above start at the wind's own left edge and take the whole cell's width. A caller
  // that renders no strip gets nothing to place it in, so the board draws it itself below
  const windNode = (index: number) => (
    <span
      // `ml`, not `mr`: the strip's bottom line runs `flex-row-reverse` so the wind stays the
      // corner-most element, which puts the rest of the line on the wind's *inboard* side
      // `justify-end` matters only when this node is the *whole* plate — a trainer with its seat
      // panel off renders no strip, and the wind then fills the corner cell's full width on its
      // own. Left-aligned there it sat mid-felt instead of on the corner. Inside the strip it is a
      // `shrink-0` flex item sized to the letter, so the same class changes nothing
      className={`ml-[2cqw] flex h-[8cqw] shrink-0 items-center justify-end text-[3cqw] leading-none font-semibold ${
        // the settings trigger beside it is `8cqw` tall (`SeatPanel`), several times the letter's
        // own box — bottom-aligning the two would leave the wind sitting visibly below it, so it
        // takes that line's height and centres itself in it. The plate's own `pr` makes up the
        // same `(8cqw - 3cqw) / 2` on the outer side, so the letter sits the same distance from
        // both felt edges
        index === seatIndex ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'
      }`}
    >
      {t(`wind.${WINDS[index]}`)}
    </span>
  )
  // evaluated once per seat rather than once per render pass through the loop below — a caller
  // may pass `seatInfo` unconditionally and return nothing per seat (e.g. while `seatsEnabled`
  // is false), and each seat's corner cell has to know which it got
  const seatInfoNodes = seatInfo ? seats.map((_, i) => seatInfo(i, windNode(i))) : undefined

  return (
    // square, so its size is one number: the smaller of the width it is given and the height left
    // beside it. Both are read off the stage's own board area, which declares itself a size
    // container — `100cqh` is the height genuinely left after the chrome row and the hand strip
    // have taken theirs. Nothing estimates that any more: the old `--board-max-h` guess
    // (`100svh` minus a nominal chrome+hand) sat inside this same `min()`, so whenever it came out
    // tighter than the truth it was the guess that sized the board, not the room. With no size
    // container at all `cqh` falls back to the small viewport, which is the same guess without a
    // variable. There is no "don't balloon" cap. `--board-scale` is the tile-size setting's board
    // half, and it is 1 on anything smaller than a tablet (`sizable:`, `index.css`, applied by
    // `BoardStage`): a shrunk square leaves the side seats' hands floating off the screen edges,
    // which on a phone is the one thing the board must never do. With room to spare — a tablet, a
    // desktop — that margin is air the reader asked for, and XL is still all the room there is.
    // The width lives on this outer div, not on the square itself: beside the hand the board
    // is a flex item, where a `w-full` child would have nothing to resolve against and collapse to
    // nothing
    <div className="relative mx-auto w-full max-w-[calc(min(100%,100cqh)*var(--board-scale,1))] shrink-0">
      {/* the revealed hands sit outside the felt, so the square gives up 10% of its own edge on
          each side to hold them — only while they are actually shown, so an ordinary board is
          exactly as big as it was. A revealed hand row is `100cqw/16` per tile, so ~8.3cqw tall,
          which 10% clears; it was 16% while the seat strip lived out here too, and the board kept
          the difference when the strip moved into the corner cells. The literal is written out
          rather than computed because Tailwind's class scanner needs to see it.
          The border box stays square either way, which is what keeps each seat's rotation covering
          it. `relative`: the ring below is anchored to *this* box's own edge, not the felt's, so
          it can never leave the square */}
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
            // where a tile in flight came out of: the row is sorted, so the slot it left is the
            // one its own id would sort back into — or, for a row of backs, its middle, since
            // filler has no sort to read. -1 (nothing in flight) can never match an index
            const gap = seat.tedashi ? gapIndex(seat.hand, seat.tedashi, seat.concealed) : -1
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
                  <River tiles={seat.river ?? []} claiming={seat.claiming} />
                </div>
                {((seat.hand && seat.hand.length > 0) || seat.drawn || called) && (
                  /* anchored to the *outer* square (the `relative` box two levels up), not to the
                     felt this `contents` group sits in — `display: contents` doesn't generate a
                     box, so an absolutely positioned child here still resolves against that outer
                     box regardless of its own grid-item ancestry. `inset-0` on a padded ancestor
                     reaches past its own padding to the true border edge, so `items-end` lands
                     this ring flush against the square's own boundary: the ring can grow into the
                     padding band it was given, never past it. Nothing about the river moves: the
                     hand is beside the table, which is where a revealed hand belongs. The seat's
                     info strip is no longer stacked out here with it — that lives in the corner
                     cell below now, so this ring is never deeper than one row of tiles.
                     The calls ride along at the right-hand end of that same row, off the felt,
                     where a Mahjong Soul table draws them — not in a corner cell, where they used
                     to pile up as if the board were a real table seen from above */
                  <div
                    data-testid="seat-ring"
                    data-seat={index}
                    className={`pointer-events-none absolute inset-0 flex items-end ${
                      // the seat the board is drawn from has no hand out here — it sits below the
                      // board — so a centred group would put that seat's calls in the middle of its
                      // own edge, right over the hand. Pushed to its right-hand end instead, which
                      // is where every other seat's calls already land relative to its hand
                      seat.hand?.length || seat.drawn ? 'justify-center' : 'justify-end'
                    } ${slot.spin}`}
                  >
                    <div className="flex items-end [--tile-w:calc(100cqw/16)]">
                      {seat.hand?.map((tile, i) => (
                        <Tile
                          key={i}
                          id={seat.concealed ? undefined : tile.id}
                          red={tile.red}
                          // the hole a tedashi leaves: one tile of space before whichever tile now
                          // stands where the thrown one did — and for a face-down row, before its
                          // middle tile, which says a tile left the hand without saying where from
                          className={i === gap ? 'ml-(--tile-w)' : undefined}
                        />
                      ))}
                      {gap === seat.hand?.length && <span className="w-(--tile-w) shrink-0" />}
                      {seat.drawn && (
                        // the same read `HandDisplay`'s own `ml-2` gives the bottom hand, in the
                        // felt's units: about a fifth of a tile, enough to say "this one was just
                        // drawn" without breaking the row into two hands
                        <div className="ml-[1.2cqw]">
                          <Tile
                            id={seat.concealed ? undefined : seat.drawn.id}
                            red={seat.drawn.red}
                          />
                        </div>
                      )}
                      {called && (
                        /* smaller than the hand they sit beside, and deliberately so: four calls
                           at the hand's own tile width run past the felt's edge, and a called set
                           is settled information — it does not need to shout as loud as the
                           tiles still being decided */
                        <div
                          data-testid="seat-calls"
                          className="ml-[5cqw] flex items-end gap-[0.5cqw] [--tile-w:calc(100cqw/22)]"
                        >
                          {seat.melds?.map((meld, i) => (
                            <MeldDisplay key={i} meld={meld} />
                          ))}
                          {seat.nuki && seat.nuki.length > 0 && (
                            <div className="flex">
                              {seat.nuki.map((tile, i) => (
                                <Tile key={i} id={tile.id} red={tile.red} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* the seat's plate, in the corner on its own left: the wind it is sitting, and —
                    where a caller offers one — its algorithm, furiten and waits, with the wind
                    handed into the strip so both share one bottom line. A caller that renders no
                    strip gets the bare wind instead, so a seat still says which one it is on a
                    trainer that never renders a seat strip at all */}
                <div
                  data-testid="seat-plate"
                  data-seat={index}
                  // pinned to the corner's outer edge (`items-end justify-end`) and held off it by
                  // its own padding, so the wind is inside the felt rather than sitting on its
                  // border. The right inset is the bigger one: it matches what centring the wind on
                  // the `8cqw` button line already costs it vertically, so the letter sits the same
                  // distance from both felt edges — and it is the strip's outer edge too, which is
                  // what puts the wait tiles above in line with the wind rather than indented past
                  // it. Both alignments are the seat's own right corner once `spin` has run
                  className={`pointer-events-none flex h-full w-full items-end justify-end p-[0.2cqw] pr-[2.7cqw] ${slot.info} ${slot.spin}`}
                >
                  {/* `min-w-0 flex-1`: the strip's own wait row wraps, and without a boundary to
                      wrap against a thirteen-sided wait drew its tiles in one line straight across
                      the felt and over the seat's river */}
                  <div className="pointer-events-auto min-w-0 flex-1 [--tile-w:calc(100cqw/32)]">
                    {/* `||`, not `??`: a caller offering `seatInfo` unconditionally returns
                        `false` per seat while its panel is off (`seatsEnabled && <SeatStrip/>`),
                        and a nullish check would take that as a node and drop the wind entirely */}
                    {seatInfoNodes?.[index] || windNode(index)}
                  </div>
                </div>
              </div>
            )
          })}

          {/* the gap here separates the panel's three readouts (round, counters, indicators) and
              nothing inside them — the dora/ura rows keep their own tighter grid spacing */}
          <div
            data-testid="centre-panel"
            className="relative col-start-2 row-start-2 flex flex-col items-center justify-center gap-[3cqw] rounded-lg border border-neutral-400/30 p-[3.5cqw] text-center text-[2.6cqw] leading-tight"
          >
            {/* each seat's score, drawn on the centre panel's edge facing that seat and turned to
                face it — the same read a real table gives, where the scores sit between the
                players rather than on any one plate */}
            {seats.map((seat, index) => {
              const slot = slotOf[(index - seatIndex + players) % players]
              const you = index === seatIndex
              if (seat.points === undefined) return null
              return (
                /* the rotation goes on a *square* overlay covering the whole panel, never on the
                   score itself: a transform doesn't move the box it is laid out in, so turning a
                   wide text run 90° about its own centre left the side seats' scores half their
                   own text width further in than the bottom and top ones. Rotating the square
                   instead leaves it exactly where it was and carries the score, pinned to its
                   bottom edge, round to the edge facing that seat — one offset, all four seats */
                <span key={index} className={`absolute inset-0 ${SLOTS[slot].spin}`}>
                  <span
                    data-testid="seat-points"
                    data-seat={index}
                    aria-label={t('table.points', { count: seat.points })}
                    className={`absolute bottom-[6%] left-1/2 -translate-x-1/2 rounded px-[1cqw] text-[2.6cqw] font-semibold whitespace-nowrap ${
                      you ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'
                    }`}
                  >
                    {seat.points.toLocaleString()}
                  </span>
                </span>
              )
            })}

            {/* spelled out rather than drawn as a wind tile: "East 1 · 0" reads the same to
                someone who has never been told the tile means the round */}
            {/* the one line the panel leads with, so it is set a third larger than the readouts
                under it rather than at the panel's own base size */}
            <span className="text-[3.2cqw] text-neutral-500 dark:text-neutral-400">
              {t(dealerRepeat === undefined ? 'table.roundLine' : 'table.roundLineRepeat', {
                wind: t(`windFull.${round}`),
                number: roundNumber ?? 1,
                repeat: dealerRepeat,
              })}
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
        {/* the one ambient signal that the board is waiting on a person: an amber bar on the
            felt's edge nearest whoever owes the decision, the same rotated-square-overlay trick
            `seat-points` uses above — a transform doesn't move the box it was laid out in, so the
            bar is pinned to a square's near edge and the square itself is turned to face the seat.
            A sibling of the felt-grid div, not a child of it: `seat-ring` already anchors to *this*
            box (`board`, "relative box two levels up" per its own comment) rather than the felt
            immediately around it, and a second `relative` wrapper one level closer would have
            quietly changed what that inset-0 resolves against for every seat's ring. So it insets
            itself by the felt's own share instead — the same `10%` the square gives up on each
            side to hold the revealed hands, and only when it actually gives it up, or the bar
            lands *below* the felt in the strip those hands sit in. Still square either way, which
            is what keeps the rotation covering it. `pointer-events-none` throughout: it must never
            sit between the reader and a tile they are about to click. `motion-safe:` keeps the
            pulse off under reduced motion, where the bar is still there, just static. */}
        {/* the call a seat just made, on that seat's own edge — the same rotated-square overlay the
            turn mark below and `seat-points` above both use, and a sibling of the felt grid for
            the same reason: a second `relative` wrapper here would change what every seat ring's
            `inset-0` resolves against. Pinned above the turn bar rather than centred on the felt,
            so the word says *who* called without a caption naming the seat, and sized in `cqw`
            like every other felt label. `pointer-events-none`: it must never sit between the
            reader and a tile they are about to click. */}
        {call !== undefined && (
          <span
            data-testid="call-banner"
            data-seat={call.seat}
            data-kind={call.kind}
            className={`pointer-events-none absolute ${showsHands ? 'inset-[10%]' : 'inset-0'} ${SLOTS[slotOf[(call.seat - seatIndex + players) % players]].spin}`}
          >
            <span className="absolute bottom-[4cqw] left-1/2 -translate-x-1/2 rounded-[1cqw] bg-amber-500 px-[2cqw] py-[0.6cqw] text-[4.4cqw] leading-none font-bold tracking-wide text-white shadow-[0_0_2cqw] shadow-amber-500/50 motion-safe:animate-call-banner">
              {t(`seats.call.${call.kind}`)}
            </span>
          </span>
        )}
        {activeSeat !== undefined && (
          <span
            data-testid="turn-mark"
            data-seat={activeSeat}
            className={`pointer-events-none absolute ${showsHands ? 'inset-[10%]' : 'inset-0'} ${SLOTS[slotOf[(activeSeat - seatIndex + players) % players]].spin}`}
          >
            <span className="absolute inset-x-[14%] bottom-[0.6cqw] h-[1.2cqw] rounded-full bg-amber-400 shadow-[0_0_2cqw] shadow-amber-400/70 motion-safe:animate-pulse" />
          </span>
        )}
      </div>
    </div>
  )
}
