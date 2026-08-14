import { useTranslation } from 'react-i18next'
import { Tile } from '../../components/tiles/Tile'
import type { ClaimAnswer, PendingClaim } from '../../core/match'
import type { TileId } from '../../core/tiles'
import { WINDS } from '../situation/urlCodec'

interface ManualControlsProps {
  /** Seat the board is drawn from. */
  seatIndex: number
  /** Seat whose hand is on screen right now — `seatIndex` unless a second seat is manual. */
  acting: number
  claim: PendingClaim | undefined
  /** Tiles whose discard could carry a riichi declaration; empty means the button is not offered. */
  riichiTiles: TileId[]
  riichiArmed: boolean
  onArmRiichi: (armed: boolean) => void
  onAnswer: (answer: ClaimAnswer) => void
  /** The seat the board is currently *drawn from* — perspective, not `seatIndex`. Perspective is
   *  view-only: rotating away from `seatIndex` means spectating, so every other control here
   *  (claim prompt included) is suspended rather than answered against a hand that is not on
   *  screen. Omitted by pages that have not adopted perspective at all, where it never differs
   *  from `seatIndex` and this whole branch is dead code. */
  viewSeat?: number
  /** Brings the perspective back to `seatIndex` — the escape valve that keeps a spectated drill
   *  from silently stalling on an unanswerable claim. */
  onReturn?: () => void
}

/**
 * The controls a manual seat needs beyond picking a tile: the riichi declaration, the claim
 * prompt on someone else's discard, and — once more than one seat is manual — a line saying
 * whose turn the hand on screen actually is.
 *
 * Renders nothing at all in the shipped single-seat setup with no claim pending and no riichi
 * available, so every trainer can mount it unconditionally without growing an empty box.
 */
export function ManualControls({
  seatIndex,
  acting,
  claim,
  riichiTiles,
  riichiArmed,
  onArmRiichi,
  onAnswer,
  viewSeat,
  onReturn,
}: ManualControlsProps) {
  const { t } = useTranslation()
  const showSeat = acting !== seatIndex
  const watching = viewSeat !== undefined && viewSeat !== seatIndex
  if (!claim && riichiTiles.length === 0 && !showSeat && !watching) return null

  if (watching) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        {t('seats.watchingSeat', { wind: t(`wind.${WINDS[viewSeat]}`) })}
        <button
          type="button"
          onClick={onReturn}
          className="min-h-11 rounded-lg border border-amber-400 px-3 text-sm font-medium"
        >
          {t('seats.backToYourSeat')}
        </button>
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {showSeat && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          {t('seats.playingSeat', { wind: t(`wind.${WINDS[acting]}`) })}
        </p>
      )}

      {claim ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-400 p-2">
          <p className="text-sm">
            {t('seats.claimPrompt', {
              wind: t(`wind.${WINDS[claim.seat]}`),
              from: t(`wind.${WINDS[claim.from]}`),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Tile id={claim.tile.id} red={claim.tile.red} />
            {claim.options.map((option, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  onAnswer(
                    option.kind === 'ron'
                      ? { kind: 'ron' }
                      : { kind: option.kind, from: option.from },
                  )
                }
                className="flex min-h-11 items-center gap-1 rounded-lg border border-neutral-300 px-3 text-sm font-medium dark:border-neutral-700"
              >
                {t(`seats.claim.${option.kind}`)}
                {/* the reader's own tiles that would join the meld — two identical shapes
                    otherwise read as the same button twice */}
                <span className="flex [--tile-w:calc(var(--tile-w-base)*0.55)]">
                  {option.from.map((id, k) => (
                    <Tile key={k} id={id} />
                  ))}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => onAnswer({ kind: 'pass' })}
              className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('seats.claim.pass')}
            </button>
          </div>
        </div>
      ) : (
        riichiTiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={riichiArmed}
              onClick={() => onArmRiichi(!riichiArmed)}
              className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${
                riichiArmed
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-neutral-300 dark:border-neutral-700'
              }`}
            >
              {t('seats.riichi')}
            </button>
            {riichiArmed && (
              <span className="flex flex-wrap items-center gap-1 text-sm text-neutral-500">
                {t('seats.riichiHint')}
                <span className="flex [--tile-w:calc(var(--tile-w-base)*0.55)]">
                  {riichiTiles.map((id) => (
                    <Tile key={id} id={id} />
                  ))}
                </span>
              </span>
            )}
          </div>
        )
      )}
    </div>
  )
}
