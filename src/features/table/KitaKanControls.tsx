import { useTranslation } from 'react-i18next'
import { Tile } from '../../components/tiles/Tile'
import type { Meld } from '../../core/agari'
import { NORTH } from '../../core/round'
import type { ParsedTile, TileId } from '../../core/tiles'

interface KitaKanControlsProps {
  /** Whether north can be pulled at all — sanma-only, same gate `useEfficiencyRound` uses. */
  sanma: boolean
  /** The acting seat's own thirteen (or twelve, mid-turn) held tiles, concealed, drawn tile
   *  excluded — same split every board trainer already keeps (`splitDrawn`/`splitConcealedDrawn`). */
  hand: readonly ParsedTile[]
  /** The fourteenth tile, separate from `hand` for the same reason `PlayerState.drawn` is: a
   *  closed kan on a triplet just completed by the draw needs to count that copy too. */
  drawn: ParsedTile | undefined
  /** The acting seat's own melds — read only to find a pon holding a kakan-eligible 4th copy.
   *  Omitted (with `onKakan`) on every trainer but the match board, which is what keeps kakan
   *  ankan's-sibling-only there and off everywhere else. */
  melds?: readonly Meld[]
  /** Whether this seat's turn is actually live right now — the same guard each page already
   *  computes for its discard handler; this component makes no turn-order decision of its own. */
  canAct: boolean
  onKita: () => void
  onKan: (id: TileId) => void
  /** Present only where kakan is legal at all (`RoundOptions.calledKan`, match-only). */
  onKakan?: (id: TileId) => void
}

/** Tile id → held count, hand plus the separated drawn tile — the one count both ankan (needs 4)
 *  and kakan (needs 1, on top of an existing pon) read. */
function heldCounts(
  hand: readonly ParsedTile[],
  drawn: ParsedTile | undefined,
): Map<number, number> {
  const counts = new Map<number, number>()
  for (const t of hand) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
  if (drawn) counts.set(drawn.id, (counts.get(drawn.id) ?? 0) + 1)
  return counts
}

function kakanEligible(melds: readonly Meld[] | undefined, counts: Map<number, number>): TileId[] {
  if (!melds) return []
  return melds
    .filter((m) => m.kind === 'pon' && (counts.get(m.tiles[0].id) ?? 0) >= 1)
    .map((m) => m.tiles[0].id)
}

/** Whether `KitaKanControls` would render anything for these props — same contract as
 *  `manualControlsVisible`: a caller floating this in a positioned card must be able to tell an
 *  empty turn from a busy one before rendering the card at all (ADR-0035). */
// eslint-disable-next-line react-refresh/only-export-components
export function kitaKanVisible({
  sanma,
  hand,
  drawn,
  melds,
  canAct,
}: Pick<KitaKanControlsProps, 'sanma' | 'hand' | 'drawn' | 'melds' | 'canAct'>): boolean {
  if (!canAct) return false
  if (sanma && hand.some((t) => t.id === NORTH)) return true
  const counts = heldCounts(hand, drawn)
  return [...counts.values()].some((c) => c === 4) || kakanEligible(melds, counts).length > 0
}

/**
 * The kita/kan row — extracted from `EfficiencyPage.tsx` (still the only other caller) so the
 * match trainer offers the same buttons rather than lacking them entirely. Ankan (closed kan on a
 * held quad) is offered everywhere this component is used; kakan (an added kan on an open pon) is
 * offered only when the caller passes `melds`/`onKakan` — the match board alone.
 */
export function KitaKanControls({
  sanma,
  hand,
  drawn,
  melds,
  canAct,
  onKita,
  onKan,
  onKakan,
}: KitaKanControlsProps) {
  const { t } = useTranslation()
  if (!kitaKanVisible({ sanma, hand, drawn, melds, canAct })) return null

  const counts = heldCounts(hand, drawn)
  const ankanIds = [...counts.entries()].filter(([, c]) => c === 4).map(([id]) => id)
  const kakanIds = onKakan ? kakanEligible(melds, counts) : []
  const hasNorth = sanma && hand.some((t) => t.id === NORTH)

  return (
    <>
      {hasNorth && (
        <button
          type="button"
          onClick={onKita}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
        >
          {t('efficiency.kitaButton')}
        </button>
      )}
      {ankanIds.map((id) => (
        <button
          key={`ankan-${id}`}
          type="button"
          onClick={() => onKan(id)}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
        >
          <span className="[--tile-w:calc(var(--tile-w-base)*0.6)]">
            <Tile id={id} />
          </span>
          {t('efficiency.kanButton')}
        </button>
      ))}
      {kakanIds.map((id) => (
        <button
          key={`kakan-${id}`}
          type="button"
          onClick={() => onKakan?.(id)}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
        >
          <span className="[--tile-w:calc(var(--tile-w-base)*0.6)]">
            <Tile id={id} />
          </span>
          {t('efficiency.kanButton')}
        </button>
      ))}
    </>
  )
}
