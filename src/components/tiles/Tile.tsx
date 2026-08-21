import { BrickWall } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Meld } from '../../core/agari'
import {
  tileCode,
  tileLabel,
  tileName,
  type ParsedTile,
  type RiverTile,
  type TileId,
} from '../../core/tiles'
import { dealtSeat } from '../../core/wall'
import { useAdvancedSettings } from '../../features/settings/useAdvancedSettings'
import { useShowTileNumbers } from '../../features/settings/useShowTileNumbers'
import { InfoPopover } from '../InfoPopover'
import { ChromeLabel, CHROME_BUTTON } from '../TrainerControls'

interface TileProps {
  /** Omit for a face-down tile. */
  id?: TileId
  red?: boolean
  className?: string
}

/** One tile face rendered from the SVG sprite. Width comes from `--tile-w`. */
export function Tile({ id, red = false, className = '' }: TileProps) {
  const { t } = useTranslation()
  const showNumbers = useShowTileNumbers()
  return (
    <svg
      viewBox="0 0 300 400"
      role="img"
      aria-label={id === undefined ? t('common.faceDownTile') : tileName(id)}
      className={`aspect-3/4 w-(--tile-w) shrink-0 drop-shadow-sm ${className}`}
    >
      {id === undefined ? (
        <use href="#tile-back" />
      ) : (
        <>
          <use href="#tile-front" />
          <use href={`#tile-${tileCode(id, red)}`} />
          {showNumbers && (
            <text
              x="286"
              y="76"
              textAnchor="end"
              fontSize="63"
              fontWeight="800"
              fill="#dc2626"
              stroke="#fff"
              strokeWidth="10"
              paintOrder="stroke"
              className="pointer-events-none select-none"
            >
              {tileLabel(id, red)}
            </text>
          )}
        </>
      )}
    </svg>
  )
}

interface TileButtonProps extends TileProps {
  onClick?: () => void
}

/** Tappable tile with a ≥44px hit area. */
function TileButton({ id, red, onClick, className = '' }: TileButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 flex-col items-center justify-start rounded p-0.5 transition-transform active:scale-95 ${className}`}
    >
      <Tile id={id} red={red} />
    </button>
  )
}

/** A tile turned on its side — the "this one was claimed" marker on an open meld, and the
 *  riichi declaration tile in a river. The rotated tile's box is its own height wide and its
 *  width tall, so the wrapper swaps the two and centres the (overflowing) upright tile.
 *  Takes the tile as children, not as an id, so a river can hand it an already-shaded one. */
function SidewaysTile({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-(--tile-w) w-[calc(var(--tile-w)*4/3)] place-items-center [&>*]:rotate-90">
      {children}
    </span>
  )
}

/** One called set. Ankan is drawn with its two outer tiles face-down, same convention as a
 *  concealed tile elsewhere in the app. Open calls lay their leftmost tile sideways — `Meld`
 *  doesn't record which seat it came from, so the rotated tile is always the first one rather
 *  than encoding the caller's direction. */
export function MeldDisplay({ meld }: { meld: Meld }) {
  const last = meld.tiles.length - 1
  return (
    <div className="flex items-end">
      {meld.tiles.map((t, i) => {
        const hidden = meld.kind === 'ankan' && (i === 0 || i === last)
        if (meld.kind === 'ankan' || i > 0) {
          return (
            <span key={i}>
              <Tile id={hidden ? undefined : t.id} red={t.red} />
            </span>
          )
        }
        return (
          <SidewaysTile key={i}>
            <Tile id={t.id} red={t.red} />
          </SidewaysTile>
        )
      })}
    </div>
  )
}

interface HandDisplayProps {
  tiles: ParsedTile[]
  /** Drawn tile shown rightmost, separated from the hand; clicks report index `tiles.length`. */
  drawn?: ParsedTile
  /** Extra classes on the drawn tile's wrapper — how the scoring trainer rings the winning tile. */
  drawnClassName?: string
  onTileClick?: (index: number) => void
  concealed?: boolean
  /** This hand's called sets and nuki, drawn to its right at three-quarter size — the same place
   *  and the same proportion the felt gives every other seat (`Table`'s own ring, which draws its
   *  hands at `100cqw/16` and its calls at `100cqw/22`). The seat the board is drawn from has no
   *  hand on the felt at all: its tiles are here, so its calls belong here beside them rather than
   *  stranded on the board's edge at a size its own hand never matches. */
  melds?: Meld[]
  nuki?: ParsedTile[]
  /** Only the drawn tile may be clicked — the hand proper is inert. Riichi locks every later
   *  discard to tsumogiri (`finishTurn`'s `forcedTsumogiri`, which the engine enforces whatever a
   *  caller hands it), so a declared seat must not be offered a choice the engine will refuse. */
  lockedToDrawn?: boolean
}

export function HandDisplay({
  tiles,
  drawn,
  drawnClassName = '',
  onTileClick,
  concealed,
  melds,
  nuki,
  lockedToDrawn,
}: HandDisplayProps) {
  const render = (tile: ParsedTile, i: number) =>
    // `i === tiles.length` is the drawn tile, the one thing still live under the lock
    onTileClick && !(lockedToDrawn && i < tiles.length) ? (
      <TileButton
        key={i}
        id={concealed ? undefined : tile.id}
        red={tile.red}
        onClick={() => onTileClick(i)}
      />
    ) : (
      <Tile key={i} id={concealed ? undefined : tile.id} red={tile.red} />
    )
  return (
    // `items-end`: the calls are drawn smaller than the hand, and they sit on the same line the
    // tiles do rather than hanging from its top edge.
    // `justify-center` is about the line *after* a wrap: a called hand is wider than the column it
    // sits in, so the calls drop to a second line and the tiles above them were left flush to the
    // left edge — visibly off-centre from the felt the same seat is drawn on, even though the
    // caller had already centred this box as a whole. Unwrapped it changes nothing: the box is
    // sized to its own content
    <div className="flex flex-wrap items-end justify-center">
      {tiles.map(render)}
      {drawn && <div className={`ml-2 ${drawnClassName}`}>{render(drawn, tiles.length)}</div>}
      {((melds?.length ?? 0) > 0 || (nuki?.length ?? 0) > 0) && (
        <div
          data-testid="hand-calls"
          className="ml-[calc(var(--tile-w-base)*0.8)] flex items-end gap-1 [--tile-w:calc(var(--tile-w-base)*0.75)]"
        >
          {melds?.map((meld, i) => (
            <MeldDisplay key={i} meld={meld} />
          ))}
          {nuki && nuki.length > 0 && (
            <div className="flex">
              {nuki.map((tile, i) => (
                <Tile key={i} id={tile.id} red={tile.red} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One discard. A tsumogiri (straight off the draw, never in the hand) is greyed, the usual
 *  convention; a ronned tile is ringed where it lies, which is what says "this hand was won off
 *  a discard" without a label. Both overlays go on the tile itself rather than the sideways
 *  wrapper, so a riichi declared on that tile rotates them along with the face. */
function Discard({ tile }: { tile: RiverTile }) {
  const { showTsumogiri } = useAdvancedSettings()
  const face = (
    <span className="relative flex">
      <Tile id={tile.id} red={tile.red} />
      {tile.tsumogiri && showTsumogiri && (
        <span className="pointer-events-none absolute inset-0 rounded-[10%] bg-neutral-500/50" />
      )}
      {tile.win && (
        <span className="pointer-events-none absolute inset-0 rounded-[10%] outline-2 outline-red-500" />
      )}
    </span>
  )
  return tile.riichi ? <SidewaysTile>{face}</SidewaysTile> : face
}

/** Discard pile, 6 tiles per row like a real river. Rows are flex, not grid columns, so a
 *  sideways riichi tile can widen its own row the way it does on a real table. Tile size is
 *  the caller's `--tile-w` — the table sets its own, the flat trainer layout scales it down.
 *
 *  `wide` lets those rows stand side by side instead of stacking, which is a river read off the
 *  felt — the solo trainer's own, eighteen rows deep by the time the wall is out. The rows
 *  themselves are still six: they wrap into whatever width the caller gives this box (twelve
 *  tiles' worth, there) with a gap between the pair, so reading order and the six-tile beat a
 *  player counts a river by both survive. The caller owns the width, since a river that widens
 *  as it fills walks the hand below it across the screen. */
export function River({ tiles, wide }: { tiles: RiverTile[]; wide?: boolean }) {
  const rows: RiverTile[][] = []
  for (let i = 0; i < tiles.length; i += 6) rows.push(tiles.slice(i, i + 6))
  return (
    <div className={wide ? 'flex w-full flex-wrap gap-x-2' : 'flex w-fit flex-col'}>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center">
          {row.map((tile, j) => (
            <Discard key={j} tile={tile} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** One wall tile, greyed exactly like a tsumogiri discard (`Discard` above) once it has left the
 *  wall. Unconditional — not gated on `showTsumogiri`, which is about reading opponents' rivers,
 *  not about showing the wall honestly. `mine` is the exception: a tile dealt to the seat the
 *  board is being watched from keeps its colour and takes a ring, so the reader can pick their own
 *  thirteen out of a deal that hands four tiles to each seat in turn. */
function WallTile({ tile, drawn, mine }: { tile: ParsedTile; drawn: boolean; mine?: boolean }) {
  return (
    <span className="relative flex">
      <Tile id={tile.id} red={tile.red} />
      {drawn && !mine && (
        <span className="pointer-events-none absolute inset-0 rounded-[10%] bg-neutral-500/50" />
      )}
      {mine && (
        <span className="pointer-events-none absolute inset-0 rounded-[10%] outline-2 outline-amber-500" />
      )}
    </span>
  )
}

/** One block of the wall, chunked into groups of four that never break across a line — the way the
 *  wall stands in stacks and the way a deal comes off it (`DEAL_CHUNKS`, `core/wall.ts`), so the
 *  rhythm of the row says which four went together. */
function WallRow({
  tiles,
  drawn,
  mine,
}: {
  tiles: ParsedTile[]
  drawn: (index: number) => boolean
  mine?: (index: number) => boolean
}) {
  const groups: ParsedTile[][] = []
  for (let i = 0; i < tiles.length; i += 4) groups.push(tiles.slice(i, i + 4))
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {groups.map((group, g) => (
        <span key={g} className="flex shrink-0">
          {group.map((tile, i) => (
            <WallTile key={i} tile={tile} drawn={drawn(g * 4 + i)} mine={mine?.(g * 4 + i)} />
          ))}
        </span>
      ))}
    </div>
  )
}

/** One labelled block of the reveal — dealt hands, live wall, dead wall — each on its own line
 *  rather than run together behind inline markers. */
function WallSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-neutral-400 dark:text-neutral-500">{label}</span>
      {children}
    </div>
  )
}

/** The whole wall as built, dealt hands first, then live tiles, then dead, with a marker at each
 *  seam. It is a button in the stage's chrome row (`BoardStage`'s `wall` slot) rather than a row
 *  in the session panel behind a setting: seeing the wall in draw order is a deliberate peek, and
 *  a peek wants a button of its own, not a preference somebody has to find first. Every tile it
 *  was dealt with is shown, not just what's left:
 *  already-dealt hands, already-drawn live tiles and already-taken dead-wall tiles are all greyed
 *  rather than omitted, so the summary count (which stays the *remaining* count) and the row don't
 *  have to agree on length. */
export function WallDetails({
  dealt,
  liveWall,
  liveWallDrawn,
  deadWall,
  replacements,
  seat,
  players,
}: {
  /** Every seat's starting hand, in dealing order — always face-down/greyed, since it was drawn
   *  before this display's "already drawn" concept even applies. */
  dealt: ParsedTile[]
  /** Whole live wall as dealt, draw order — not just what's left. */
  liveWall: ParsedTile[]
  /** How many of `liveWall`, from the front, are genuine draws. `replacements` more, off the
   *  tail, were pulled into the dead wall to backfill a kan (also greyed). */
  liveWallDrawn: number
  /** All 14 dead-wall tiles in build order: dora indicator(s), the rest of the dora/ura stacks,
   *  then the four rinshan tiles. Empty when the dead wall is off. */
  deadWall: ParsedTile[]
  /** Replacement (rinshan) draws taken so far — greys the last `replacements` tiles of `deadWall`
   *  (taken as kan draws) and, in tandem, the last `replacements` tiles of `liveWall` (pulled in
   *  to backfill them). */
  replacements: number
  /** The seat the board is being watched from — its own dealt tiles are ringed and left in colour.
   *  Perspective, not "your seat": rotating the board moves which thirteen are marked. Pass
   *  `players` alongside it, since where a seat's tiles fall depends on how many were dealt to. */
  seat?: number
  players?: number
}) {
  const { t } = useTranslation()
  const remaining = liveWall.length - liveWallDrawn - replacements
  const mine =
    seat !== undefined && players !== undefined
      ? (index: number) => dealtSeat(index, players) === seat
      : undefined
  return (
    <InfoPopover
      triggerLabel={t('table.wallButton')}
      trigger={
        <>
          <BrickWall className="size-5" />
          <ChromeLabel>{t('table.wallButton')}</ChromeLabel>
        </>
      }
      triggerClassName={CHROME_BUTTON}
      icon={<BrickWall className="size-4" />}
      dialogTitle={t('common.wallDetails', { count: remaining })}
      wide
    >
      {/* Sized by its own clamp rather than off `--tile-w-base`: the dialog is portalled to
          <body>, so it never sees the stage's scaled base and resolves the raw viewport clamp
          instead — which shrinks with width exactly where the reveal can least afford it. A tile
          in here is read, not played, but at ~14px on a phone it was unreadable. The flat range
          keeps it legible on a phone and stops it ballooning on a desktop; fewer tiles per row is
          the trade, and the dialog already scrolls. */}
      <div className="flex flex-col gap-2 [--tile-w:clamp(1.5rem,6.4vw,1.75rem)]">
        {dealt.length > 0 && (
          <WallSection label={t('common.dealtMarker')}>
            <WallRow tiles={dealt} drawn={() => true} mine={mine} />
          </WallSection>
        )}
        <WallSection label={t('common.liveWallMarker')}>
          <WallRow
            tiles={liveWall}
            drawn={(i) => i < liveWallDrawn || i >= liveWall.length - replacements}
          />
        </WallSection>
        {deadWall.length > 0 && (
          <WallSection label={t('common.deadWallMarker')}>
            <WallRow tiles={deadWall} drawn={(i) => i >= deadWall.length - replacements} />
          </WallSection>
        )}
      </div>
    </InfoPopover>
  )
}

/** Improving tiles with remaining counts; exhausted ones dimmed. */
export function UkeireTiles({ tiles }: { tiles: { tile: TileId; remaining: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1 [--tile-w:calc(var(--tile-w-base)*0.8)]">
      {tiles.map(({ tile, remaining }) => (
        <div
          key={tile}
          className={`flex flex-col items-center ${remaining === 0 ? 'opacity-30' : ''}`}
        >
          <Tile id={tile} />
          <span className="text-xs text-neutral-500">{remaining}</span>
        </div>
      ))}
    </div>
  )
}
