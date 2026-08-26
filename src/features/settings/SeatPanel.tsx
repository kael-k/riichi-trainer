import { Settings2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { WINDS } from '../situation/urlCodec'
import { SegmentedButton } from './SettingsDialog'
import { resolveSeatConfig, withSeatMode, type SeatConfig } from './tableSettings'
import type { SeatAlgorithm } from '../../core/policy'

const MODES: SeatAlgorithm[] = ['efficiency', 'defense', 'tsumogiri', 'manual']

export interface SeatButtonProps {
  /** The seat this button configures. */
  seat: number
  players: number
  /** Where the trainer would seat you with no configuration — a link's `?seat=`, or the seat a
   *  generated board handed over. */
  defaultOrientation: number
  config: SeatConfig | null
  onChange: (config: SeatConfig) => void
  /** What an unconfigured seat is really doing right now (folding's live per-seat algorithm) —
   *  overrides the generic `'efficiency'` default `resolveSeatConfig` would otherwise show. */
  fallbackModes?: readonly SeatAlgorithm[]
  /** The seat the board is currently drawn from — purely a display concern (which seat reads as
   *  "your side" in this dialog, gating the manual-only filter below); perspective itself is the
   *  page's own ephemeral state, not this component's. */
  viewSeat: number
  /** Only your own seat may be manual. The graded drills that own their board (folding) grade
   *  exactly one seat's discards against exactly one hand, so a second manual seat has nothing
   *  defined to score — the algorithm choice is still offered for every seat. */
  ownSeatOnlyManual?: boolean
}

/**
 * One seat's own settings, behind one icon sitting at that seat's mark on the board: how the seat
 * is played (`SeatAlgorithm`). One button per seat rather than a single table-wide panel — a
 * seat's rules are read and changed while looking at that seat. "Watch from here" lives beside
 * this button now (`SeatStrip`'s own eye icon), not inside this dialog.
 *
 * Rendered only where `useTableSettings` says the panel is offered at all (`seatsEnabled`), which
 * is the Advanced gate everywhere except the lab. Setting every seat to an AI would leave nobody
 * to act, so the last manual seat's other options are disabled rather than silently overridden —
 * `resolveSeatConfig` would put it back anyway, and a control that undoes itself reads as broken.
 */
export function SeatButton({
  seat,
  players,
  defaultOrientation,
  config,
  onChange,
  fallbackModes,
  viewSeat,
  ownSeatOnlyManual = false,
}: SeatButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const resolved = resolveSeatConfig(config, players, defaultOrientation, fallbackModes)
  const wind = t(`wind.${WINDS[seat]}`)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open])

  const mode = resolved.modes[seat] ?? 'efficiency'
  const manualCount = resolved.modes.filter((m) => m === 'manual').length
  const yours = seat === viewSeat

  return (
    <>
      {/* icon alone: the trigger sits in the seat's own plate now, directly above the wind the
          board draws there, so repeating the letter here read as a stutter. The seat the board is
          drawn from is marked in full strength, the rest are muted — the same weight the plate's
          own wind uses for the same distinction. `aria-label` still names the seat */}
      {/* sized in container-query units, not the 44px it used to be: this trigger lives in a seat's
          corner cell on the felt, a track that scales with the board, and a fixed 44px inside it
          runs a phone-sized board's plate straight off the felt. The ≥44px touch target is kept by
          the pseudo-element instead — the hit area stays a real 44px square while the layout box
          costs the corner only what it draws. `relative` is what that pseudo resolves against. */}
      <button
        type="button"
        aria-label={t('seats.button', { wind })}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        // the box hugs the icon (`h-[8cqw]` is the line height the wind beside it aligns to, not a
        // square): with a `min-w-[8cqw]` it carried 2cqw of empty box on each side, which read as
        // gap and put the algorithm badge visibly further from the button than the wind is. The
        // spacing is the plate's and the strip's own `gap` now, where it can be tuned.
        // The 44px touch target is centred vertically (`top-1/2 -translate-y-1/2`) but spans only
        // its own box plus half the strip's gap on each side (`-inset-x-[0.9cqw]`), not a
        // side-agnostic square: the eye button now sits right beside this one at the same size,
        // and a centred 44px square would overlap it by as much as it missed the wind on the
        // other side.
        className={`relative flex h-[8cqw] items-center justify-center gap-[0.4cqw] text-[3cqw] font-semibold after:absolute after:top-1/2 after:-inset-x-[0.9cqw] after:h-11 after:-translate-y-1/2 ${
          yours ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'
        }`}
      >
        <Settings2 className="size-[4cqw]" />
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('seats.title', { wind })}
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          >
            <div className="flex max-h-full w-[min(92vw,24rem)] flex-col overflow-hidden rounded-xl bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <h2 className="font-semibold">{t('seats.title', { wind })}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('common.close')}
                  className="flex size-11 items-center justify-center"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-neutral-500">
                    {t('seats.playedBy')}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {MODES.filter(
                      (option) => option !== 'manual' || !ownSeatOnlyManual || yours,
                    ).map((option) => (
                      <SegmentedButton
                        key={option}
                        active={mode === option}
                        // the last manual seat may not be given away: with none, no seat ever
                        // stops the go-round loop and the hand would play itself out
                        disabled={mode === 'manual' && option !== 'manual' && manualCount === 1}
                        onClick={() =>
                          onChange({ modes: withSeatMode(config?.modes ?? [], seat, option) })
                        }
                      >
                        {t(`seats.mode.${option}`)}
                      </SegmentedButton>
                    ))}
                  </div>
                  <p className="text-sm text-neutral-500">{t(`seats.modeHint.${mode}`)}</p>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
