import { useTranslation } from 'react-i18next'
import { Tile } from '../../components/tiles/Tile'
import type { Meld } from '../../core/agari'
import { createHand } from '../../core/hand'
import { kanOptions } from '../../core/policy'
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
   *  ankan's-sibling-only there and off everywhere else. **Its presence is what stands in for
   *  `RoundOptions.calledKan` here**: the two travel together by contract, and reading one flag
   *  in both `kitaKanVisible` and the render is what keeps the button row and the "is there a row
   *  at all" answer from disagreeing. */
  melds?: readonly Meld[]
  /** Whether this seat's turn is actually live right now — the same guard each page already
   *  computes for its discard handler; this component makes no turn-order decision of its own. */
  canAct: boolean
  onKita: () => void
  onKan: (id: TileId) => void
  /** Present only where kakan is legal at all (`RoundOptions.calledKan`, match-only). */
  onKakan?: (id: TileId) => void
}

/** The kans this seat could declare, read off the engine's own rule (`policy.ts#kanOptions`)
 *  rather than a second one drawn here — the reason the helper exists. The page hands this
 *  component tiles as held rather than a `Hand`, so the counts are rebuilt: the drawn tile is
 *  separated out on the way in and a kan on a triplet the draw just completed needs it counted.
 *  `calledKan` rides on `onKakan` being passed at all, which is the match board alone. */
function kansOf({ hand, drawn, melds }: Pick<KitaKanControlsProps, 'hand' | 'drawn' | 'melds'>) {
  const counts = createHand()
  for (const t of hand) counts.counts[t.id]++
  if (drawn) counts.counts[drawn.id]++
  return kanOptions(counts, melds ?? [], melds !== undefined)
}

/** Whether `KitaKanControls` would render anything for these props — same contract as
 *  `manualControlsVisible`: a caller floating this in a positioned card must be able to tell an
 *  empty turn from a busy one before rendering the card at all (ADR-0035). */
// eslint-disable-next-line react-refresh/only-export-components
export function kitaKanVisible(
  props: Pick<KitaKanControlsProps, 'sanma' | 'hand' | 'drawn' | 'melds' | 'canAct'>,
): boolean {
  if (!props.canAct) return false
  if (props.sanma && props.hand.some((t) => t.id === NORTH)) return true
  return kansOf(props).length > 0
}

/**
 * The kita/kan row — extracted from `EfficiencyPage.tsx` (still the only other caller) so the
 * match trainer offers the same buttons rather than lacking them entirely. Ankan (closed kan on a
 * held quad) is offered everywhere this component is used; kakan (an added kan on an open pon) is
 * offered only when the caller passes `melds`/`onKakan` — the match board alone.
 */
export function KitaKanControls(props: KitaKanControlsProps) {
  const { sanma, hand, onKita, onKan, onKakan } = props
  const { t } = useTranslation()
  if (!kitaKanVisible(props)) return null

  const kans = kansOf(props)
  const ankanIds = kans.filter((k) => k.kind === 'ankan').map((k) => k.tile)
  const kakanIds = kans.filter((k) => k.kind === 'kakan').map((k) => k.tile)
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
