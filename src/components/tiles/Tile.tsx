import { useTranslation } from 'react-i18next'
import { tileCode, tileLabel, tileName, type ParsedTile, type TileId } from '../../core/tiles'
import { useSettings } from '../../features/settings/settingsStore'

interface TileProps {
  /** Omit for a face-down tile. */
  id?: TileId
  red?: boolean
  className?: string
}

/** One tile face rendered from the SVG sprite. Width comes from `--tile-w`. */
export function Tile({ id, red = false, className = '' }: TileProps) {
  const { t } = useTranslation()
  const showNumbers = useSettings((s) => s.showTileNumbers)
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
export function TileButton({ id, red, onClick, className = '' }: TileButtonProps) {
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

interface HandDisplayProps {
  tiles: ParsedTile[]
  /** Drawn tile shown rightmost, separated from the hand; clicks report index `tiles.length`. */
  drawn?: ParsedTile
  onTileClick?: (index: number) => void
  concealed?: boolean
}

export function HandDisplay({ tiles, drawn, onTileClick, concealed }: HandDisplayProps) {
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
      {drawn && <div className="ml-2">{render(drawn, tiles.length)}</div>}
    </div>
  )
}

/** Discard pile, 6 tiles per row like a real river. */
// ponytail: no riichi sideways-tile rotation yet; add when riichi state exists (M3+)
export function River({
  tiles,
  onTileClick,
}: {
  tiles: ParsedTile[]
  onTileClick?: (index: number) => void
}) {
  return (
    <div className="grid w-fit grid-cols-6 [--tile-w:calc(var(--tile-w-base)*0.8)]">
      {tiles.map((tile, i) =>
        onTileClick ? (
          <TileButton key={i} id={tile.id} red={tile.red} onClick={() => onTileClick(i)} />
        ) : (
          <Tile key={i} id={tile.id} red={tile.red} />
        ),
      )}
    </div>
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
