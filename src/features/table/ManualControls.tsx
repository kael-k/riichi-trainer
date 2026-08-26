import { useTranslation } from 'react-i18next'
import { Tile } from '../../components/tiles/Tile'
import type { ClaimAnswer, PendingClaim } from '../../core/round'
import type { TileId } from '../../core/tiles'
import { WINDS } from '../situation/urlCodec'

interface ManualControlsProps {
  /** Seat whose hand is on screen right now — `finishTurn`/`answerClaim`'s notion of who is
   *  currently owed a decision, read off `round.acting`/`round.claim.seat`. */
  acting: number
  claim: PendingClaim | undefined
  /** Tiles whose discard could carry a riichi declaration; empty means the button is not offered. */
  riichiTiles: TileId[]
  riichiArmed: boolean
  onArmRiichi: (armed: boolean) => void
  onAnswer: (answer: ClaimAnswer) => void
  /** The seat the board is currently *drawn from* — perspective. A reader now acts only from the
   *  seat they are watching (ADR-0034): rotating to the seat that owes the decision is how you
   *  reach its controls, so every branch below gates on `viewSeat` rather than a fixed "your own
   *  seat". */
  viewSeat: number
  /** Rotates the board to `seat` — the escape valve the waiting line's button uses to jump
   *  straight to whichever seat owes the decision, without the reader hunting for it themselves. */
  onGoTo: (seat: number) => void
  /** The drill is over, so the riichi arm and the waiting line are stale and must not render on
   *  top of the end card. Distinct per trainer (`drillOver` for efficiency, `finished` for
   *  folding/lab) — this component has no opinion about which. It deliberately does **not**
   *  outrank a pending `claim`: efficiency's `drillOver` is true for the whole window between the
   *  graded seat's tenpai discard and its next draw, and a *replayed* link lands in that window
   *  with live play still running behind it, so an opponent can offer that seat a call while the
   *  card is already up. `beginTurn`/`finishTurn` are no-ops until a claim is answered, so
   *  suppressing the only prompt that can answer it freezes the board outright. */
  ended?: boolean
}

/** Whether `ManualControls` would render anything for these props — the same three branches its
 *  own render checks below, kept in exact lockstep with them (there is no other caller of this
 *  logic). Exported so a caller floating it in a positioned card (`BoardStage`'s `controls`, which
 *  every board-rendering trainer uses) can skip the card entirely rather than showing an empty,
 *  still-`pointer-events-auto` one — a `<ManualControls/>` element is truthy regardless of what it
 *  renders to, so `controls && …` alone can't tell an empty turn from a busy one. */
// eslint-disable-next-line react-refresh/only-export-components
export function manualControlsVisible({
  acting,
  claim,
  riichiTiles,
  viewSeat,
  ended,
}: Pick<ManualControlsProps, 'acting' | 'claim' | 'riichiTiles' | 'viewSeat' | 'ended'>): boolean {
  if (ended && !claim) return false
  return acting !== viewSeat || !!claim || riichiTiles.length > 0
}

/**
 * The controls a manual seat needs beyond picking a tile: the riichi declaration and the claim
 * prompt on someone else's discard — both live only on the seat that actually owes the decision,
 * so watching any other seat collapses to one line naming who that is and a button that rotates
 * there. The felt's own turn glow (`Table`'s `activeSeat`) is the ambient version of the same
 * fact; this is the control surface once you have rotated to match it.
 *
 * Renders nothing at all once the hand is over with nothing left to answer, or in the shipped
 * single-seat setup with no claim pending and no riichi available while already watching the seat
 * that owes the decision — so every trainer can mount it unconditionally without growing an empty
 * box.
 */
export function ManualControls({
  acting,
  claim,
  riichiTiles,
  riichiArmed,
  onArmRiichi,
  onAnswer,
  viewSeat,
  onGoTo,
  ended,
}: ManualControlsProps) {
  const { t } = useTranslation()
  if (ended && !claim) return null

  // `acting` already *is* the claim's own seat whenever one is pending (`core/table.ts#actingSeat`
  // — a claim outranks the turn order), so there is only one seat to name here either way
  if (acting !== viewSeat) {
    const wind = t(`wind.${WINDS[acting]}`)
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        {t('seats.waitingSeat', { wind })}
        <button
          type="button"
          onClick={() => onGoTo(acting)}
          className="min-h-11 rounded-lg border border-amber-400 px-3 text-sm font-medium"
        >
          {t('seats.goToSeat', { wind })}
        </button>
      </p>
    )
  }

  if (claim) {
    return (
      <div
        data-testid="claim-prompt"
        role="group"
        aria-label={t('seats.claimPrompt', {
          wind: t(`wind.${WINDS[claim.seat]}`),
          from: t(`wind.${WINDS[claim.from]}`),
        })}
        className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 dark:bg-amber-950/30"
      >
        {claim.options.map((option, i) => (
          <button
            key={i}
            type="button"
            onClick={() =>
              onAnswer(
                option.kind === 'ron' ? { kind: 'ron' } : { kind: option.kind, from: option.from },
              )
            }
            className={`flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium ${
              option.kind === 'ron'
                ? 'bg-red-600 text-white dark:bg-red-500'
                : 'border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900'
            }`}
          >
            {t(`seats.claim.${option.kind}`)}
            {/* the meld this call would make: the reader's own tiles, then the claimed one —
                ringed, since it is the one tile here that is not already in hand — so two `Chi`
                buttons on the same discard are told apart by what they actually build rather than
                by a bare label repeated twice */}
            {option.kind !== 'ron' && (
              <span className="flex [--tile-w:calc(var(--tile-w-base)*0.7)]">
                {option.from.map((id, k) => (
                  <Tile key={k} id={id} />
                ))}
                <span className="relative flex">
                  <Tile id={claim.tile.id} red={claim.tile.red} />
                  <span className="pointer-events-none absolute inset-0 rounded-[10%] outline-2 outline-amber-500" />
                </span>
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onAnswer({ kind: 'pass' })}
          className="min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          {t('seats.claim.pass')}
        </button>
      </div>
    )
  }

  if (riichiTiles.length > 0) {
    return (
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
  }

  return null
}
