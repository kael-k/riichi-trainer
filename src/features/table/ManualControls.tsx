import { useTranslation } from 'react-i18next'
import { Tile } from '../../components/tiles/Tile'
import type { ClaimAnswer, PendingClaim } from '../../core/round'
import type { TileId } from '../../core/tiles'
import { seatWind } from '../situation/urlCodec'

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
  /** The seat the board is currently *drawn from* — perspective. ADR-0034 ("you act from where
   *  you watch") still gates the riichi offer on `acting === viewSeat`: riichi is optional, so
   *  requiring a rotation to the seat it belongs to before arming it costs nothing, and the
   *  felt's own turn glow (`Table`'s `activeSeat`) plus the seat plate's eye icon already say
   *  whose turn it is without a line here repeating it. A pending claim does not follow that rule
   *  — `beginTurn`/`finishTurn` are no-ops until it is answered, so gating it on `viewSeat` the
   *  same way left the board frozen with nothing on screen to unfreeze it whenever the reader had
   *  rotated away from the claim's own seat; the prompt below renders for a pending claim
   *  regardless of which seat is being watched. */
  viewSeat: number
  /** The drill is over, so the riichi arm is stale and must not render on top of the end card.
   *  Distinct per trainer (`drillOver` for efficiency, `finished` for folding/lab) — this
   *  component has no opinion about which. It deliberately does **not**
   *  outrank a pending `claim`: efficiency's `drillOver` is true for the whole window between the
   *  graded seat's tenpai discard and its next draw, and a *replayed* link lands in that window
   *  with live play still running behind it, so an opponent can offer that seat a call while the
   *  card is already up. `beginTurn`/`finishTurn` are no-ops until a claim is answered, so
   *  suppressing the only prompt that can answer it freezes the board outright. */
  ended?: boolean
  /** This round's dealer, so a prompt names the seat by the wind it is sitting rather than by its
   *  own index (`urlCodec.ts#seatWind`). Only `/match` rotates one. */
  dealer?: number
  /** How many seats are at the table, for the same reason. */
  players?: number
}

/** Whether `ManualControls` would render anything for these props — the same gates its own
 *  render checks below, kept in exact lockstep with them (there is no other caller of this
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
  // A pending claim is not gated on perspective (see the `viewSeat` doc comment above) — only the
  // riichi offer still asks the reader to be watching the seat it belongs to.
  return !!claim || (acting === viewSeat && riichiTiles.length > 0)
}

/**
 * The controls a manual seat needs beyond picking a tile: the claim prompt on someone else's
 * discard (plus the kyuushu-kyuuhai abort offer) and the riichi declaration. Only the riichi half
 * stays gated on watching the seat it belongs to (ADR-0034) — it is an offer, so nothing is
 * blocked by ignoring it. The claim half is not: the engine suspends every seat's turn until a
 * pending claim is answered, so it renders for whoever is owed it no matter which seat the board
 * is drawn from — gating it on perspective the same way left the board frozen with no way to
 * unfreeze it short of guessing to rotate back. Who owes a decision is still the felt's own job to
 * say (`Table`'s `activeSeat` glow, the seat plate's eye icon); this is only the surface that
 * answers it.
 *
 * Renders nothing once the hand is over with nothing left to answer, while watching a seat with
 * neither a claim pending nor a riichi offer, or in the shipped single-seat setup with neither —
 * so every trainer can mount it unconditionally without growing an empty box.
 */
export function ManualControls({
  acting,
  claim,
  riichiTiles,
  riichiArmed,
  onArmRiichi,
  onAnswer,
  viewSeat,
  ended,
  dealer = 0,
  players = 4,
}: ManualControlsProps) {
  const { t } = useTranslation()
  const wind = (seat: number) => t(`wind.${seatWind(seat, dealer, players)}`)
  if (ended && !claim) return null

  // the acting seat's own completed hand (ADR-0045). Like the abort offer it is nobody's reaction
  // to a discard, so it names no other seat — but unlike it, the hand is already priced, and what
  // the reader is really deciding is whether that price is worth ending the hand for
  if (claim?.kind === 'win') {
    const { score } = claim.win
    const value = score.limit
      ? t('seats.tsumo.valueLimit', { han: score.han, limit: t(`scoring.limit.${score.limit}`) })
      : t('seats.tsumo.value', { han: score.han, fu: score.fu })
    return (
      <div
        data-testid="tsumo-prompt"
        role="group"
        aria-label={t('seats.tsumoPrompt', { wind: wind(claim.seat) })}
        className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 dark:bg-amber-950/30"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {/* the tile that completed the hand, ringed the way a claimable discard is — the reader
              has fourteen tiles on screen and this is the one the offer is about */}
          <span className="relative flex [--tile-w:calc(var(--tile-w-base)*0.7)]">
            <Tile id={claim.tile.id} red={claim.tile.red} />
            <span className="pointer-events-none absolute inset-0 rounded-[10%] outline-2 outline-amber-500" />
          </span>
          {t('seats.tsumo.question', { value })}
        </span>
        <button
          type="button"
          onClick={() => onAnswer({ kind: 'tsumo' })}
          className="min-h-11 rounded-lg bg-red-600 px-3 text-sm font-medium text-white dark:bg-red-500"
        >
          {t('seats.tsumo.confirm')}
        </button>
        <button
          type="button"
          onClick={() => onAnswer({ kind: 'pass' })}
          className="min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          {t('seats.tsumo.decline')}
        </button>
      </div>
    )
  }

  // kyuushu kyuuhai: the acting seat's own offer, not a reaction to anybody's discard, so it
  // draws no tiles and names no other seat — only how many terminals and honours it is made of
  if (claim?.kind === 'abort') {
    return (
      <div
        data-testid="abort-prompt"
        role="group"
        aria-label={t('seats.abortPrompt', { wind: wind(claim.seat) })}
        className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 dark:bg-amber-950/30"
      >
        <span className="text-sm font-medium">
          {t('seats.abort.question', { kinds: claim.kinds })}
        </span>
        <button
          type="button"
          onClick={() => onAnswer({ kind: 'abort' })}
          className="min-h-11 rounded-lg bg-amber-600 px-3 text-sm font-medium text-white dark:bg-amber-500"
        >
          {t('seats.abort.confirm')}
        </button>
        <button
          type="button"
          onClick={() => onAnswer({ kind: 'pass' })}
          className="min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          {t('seats.abort.decline')}
        </button>
      </div>
    )
  }

  if (claim) {
    return (
      <div
        data-testid="claim-prompt"
        role="group"
        aria-label={t('seats.claimPrompt', {
          wind: wind(claim.seat),
          from: wind(claim.from),
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

  // Riichi is an offer, not a question the engine is blocked on — it stays gated on watching the
  // seat it belongs to (see the `viewSeat` doc comment above), unlike the claim prompt above it.
  if (acting === viewSeat && riichiTiles.length > 0) {
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
