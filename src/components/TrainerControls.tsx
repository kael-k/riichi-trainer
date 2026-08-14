import { Pause, Play, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatElapsedMs } from '../lib/formatElapsed'

interface TrainerStatusBarProps {
  /** Whether the toggle button (and, when `timerEnabled`, the clock) is shown at all. Every
   *  trainer but shanten ties this straight to its own timer setting — pausing a clock nobody is
   *  showing has nothing to do. Shanten's toggle is also its reveal control, so it stays on
   *  regardless of the timer setting: reveal is a core mechanic, not a timer convenience. */
  showToggle: boolean
  paused: boolean
  onToggle: () => void
  toggleLabel: string
  onReset: () => void
  resetLabel: string
  /** Milliseconds; only rendered as text when `timerEnabled`. */
  elapsed: number
  timerEnabled: boolean
  /** The trainer's own score/accuracy line(s), right-aligned. */
  children?: ReactNode
}

/** The status row shared by every graded trainer: a start/pause toggle, a reset (abandon this
 *  hand, deal a fresh one) button, the clock, and whatever score line the trainer itself reports
 *  — homogeneous across trainers, mobile-friendly (wraps rather than overflowing on a phone). It
 *  never renders "Turn N"/"Hand N" text of its own: the table (where there is one) already shows
 *  that, and the trainer's own score line already implies how many hands have been played. */
export function TrainerStatusBar({
  showToggle,
  paused,
  onToggle,
  toggleLabel,
  onReset,
  resetLabel,
  elapsed,
  timerEnabled,
  children,
}: TrainerStatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <div className="flex items-center gap-1">
        {showToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={toggleLabel}
            className="flex size-12 items-center justify-center"
          >
            {paused ? (
              <Play className="size-6 fill-current" />
            ) : (
              <Pause className="size-6 fill-current" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          aria-label={resetLabel}
          className="flex size-12 items-center justify-center"
        >
          <RotateCcw className="size-6" />
        </button>
        {showToggle && timerEnabled && (
          <span className="font-mono tabular-nums text-neutral-500">
            {formatElapsedMs(elapsed)}
          </span>
        )}
      </div>
      {children && (
        <span className="ml-auto flex flex-col items-end text-neutral-500">{children}</span>
      )}
    </div>
  )
}
