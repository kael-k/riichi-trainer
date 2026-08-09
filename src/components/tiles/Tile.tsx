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
import { useAdvancedSettings } from '../../features/settings/useAdvancedSettings'
import { useShowTileNumbers } from '../../features/settings/useShowTileNumbers'

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
}

export function HandDisplay({
  tiles,
  drawn,
  drawnClassName = '',
  onTileClick,
  concealed,
}: HandDisplayProps) {
  const render = (tile: ParsedTile, i: number) =>
    onTileClick ? (
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
    <div className="flex flex-wrap items-start">
      {tiles.map(render)}
      {drawn && <div className={`ml-2 ${drawnClassName}`}>{render(drawn, tiles.length)}</div>}
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
 *  the caller's `--tile-w` — the table sets its own, the flat trainer layout scales it down. */
export function River({ tiles }: { tiles: RiverTile[] }) {
  const rows: RiverTile[][] = []
  for (let i = 0; i < tiles.length; i += 6) rows.push(tiles.slice(i, i + 6))
  return (
    <div className="flex w-fit flex-col">
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
 *  not about showing the wall honestly. */
function WallTile({ tile, drawn }: { tile: ParsedTile; drawn: boolean }) {
  return (
    <span className="relative flex">
      <Tile id={tile.id} red={tile.red} />
      {drawn && (
        <span className="pointer-events-none absolute inset-0 rounded-[10%] bg-neutral-500/50" />
      )}
    </span>
  )
}

/** The whole wall as dealt, live tiles then dead, with a marker at the seam. Collapsed behind a
 *  `<details>` — seeing the wall in draw order is a deliberate peek, not something to show by
 *  default. Every tile it was dealt with is shown, not just what's left: already-drawn live tiles
 *  and already-taken dead-wall tiles are greyed rather than omitted, so the summary count (which
 *  stays the *remaining* count) and the row don't have to agree on length. */
export function WallDetails({
  liveWall,
  liveWallDrawn,
  deadWall,
  replacements,
}: {
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
}) {
  const { t } = useTranslation()
  const remaining = liveWall.length - liveWallDrawn - replacements
  return (
    <details className="text-sm text-neutral-500">
      <summary className="cursor-pointer">{t('common.wallDetails', { count: remaining })}</summary>
      <div className="mt-2 flex flex-wrap items-center [--tile-w:calc(var(--tile-w-base)*0.55)]">
        {liveWall.map((tile, i) => (
          <WallTile
            key={`live-${i}`}
            tile={tile}
            drawn={i < liveWallDrawn || i >= liveWall.length - replacements}
          />
        ))}
        {deadWall.length > 0 && (
          <span className="mx-1 self-stretch border-l border-dashed border-neutral-400 pl-1 text-xs whitespace-nowrap text-neutral-400 dark:border-neutral-600">
            {t('common.deadWallMarker')}
          </span>
        )}
        {deadWall.map((tile, i) => (
          <WallTile key={`dead-${i}`} tile={tile} drawn={i >= deadWall.length - replacements} />
        ))}
      </div>
    </details>
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
