import { Settings2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { WINDS } from '../situation/urlCodec'
import { SegmentedButton, SettingRow } from './SettingsDialog'
import { resolveSeatConfig, withSeatMode, type SeatConfig, type SeatMode } from './tableSettings'

const MODES: SeatMode[] = ['efficiency', 'defense', 'manual']

interface SeatButtonProps {
  /** The seat this button configures. */
  seat: number
  players: number
  /** Where the trainer would seat you with no configuration — a link's `?seat=`, or the seat a
   *  generated board handed over. */
  defaultOrientation: number
  config: SeatConfig | null
  onChange: (config: SeatConfig) => void
  /** What an unconfigured seat is really doing right now (folding's live per-seat policy) —
   *  overrides the generic `'efficiency'` default `resolveSeatConfig` would otherwise show. */
  fallbackModes?: readonly SeatMode[]
  /** The seat the board is currently drawn from — purely a display concern (which seat reads as
   *  "your side" in this dialog); perspective itself is the page's own ephemeral state, not this
   *  component's. */
  viewSeat: number
  /** "Watch from here" — perspective is view-only, so this never touches `onChange`. */
  onWatch: (seat: number) => void
  /** Only your own seat may be manual. The graded drills that own their board (folding) grade
   *  exactly one seat's discards against exactly one hand, so a second manual seat has nothing
   *  defined to score — the algorithm choice is still offered for every seat. */
  ownSeatOnlyManual?: boolean
}

/**
 * One seat's own settings, behind one icon sitting at that seat's mark on the board: which side
 * you watch from, and how the seat is played (`SeatMode`). One button per seat rather than a
 * single table-wide panel — a seat's rules are read and changed while looking at that seat.
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
  onWatch,
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
      {/* the wind rides along with the icon: the button sits in the control row above the board
          now, not on the seat's own mark, so nothing else says which seat it opens. The seat the
          board is drawn from is marked in full strength, the rest are muted — the same weight the
          wind marks on the felt use for the same distinction */}
      <button
        type="button"
        aria-label={t('seats.button', { wind })}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`flex h-11 min-w-11 items-center justify-center gap-0.5 text-sm font-semibold ${
          yours ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'
        }`}
      >
        <Settings2 className="size-4" />
        {wind}
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
                <div className="flex min-h-11 items-center gap-3">
                  {yours ? (
                    <span className="text-sm text-neutral-500">{t('seats.yourSide')}</span>
                  ) : (
                    <button
                      type="button"
                      // the board turns underneath the dialog, and the dialog is what covers it
                      // — the whole point of the press is to look at the new view. View-only: it
                      // never touches `onChange`, so it cannot re-search for a new hand or persist
                      onClick={() => {
                        onWatch(seat)
                        setOpen(false)
                      }}
                      className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-medium dark:border-neutral-700"
                    >
                      {t('seats.sitHere')}
                    </button>
                  )}
                </div>

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
                          onChange({
                            modes: withSeatMode(config?.modes ?? [], seat, option),
                            claims: config?.claims ?? false,
                          })
                        }
                      >
                        {t(`seats.mode.${option}`)}
                      </SegmentedButton>
                    ))}
                  </div>
                  <p className="text-sm text-neutral-500">{t(`seats.modeHint.${mode}`)}</p>
                </div>

                {/* board-wide, but it only ever affects a seat a person plays — so it is shown
                    where that decision is actually made rather than buried in the app's own
                    settings dialog */}
                {mode === 'manual' && (
                  <SettingRow label={t('seats.claims')}>
                    <input
                      type="checkbox"
                      checked={resolved.claims}
                      onChange={(e) =>
                        onChange({ modes: config?.modes ?? [], claims: e.target.checked })
                      }
                      className="size-5"
                    />
                  </SettingRow>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
