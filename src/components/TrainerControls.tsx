import { Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { formatElapsedMs } from '../lib/formatElapsed'

/** Display refresh of the live clock; the graded time itself is read straight off the trainer's
 *  own clock at submit, so it never inherits this granularity. */
const TICK_MS = 50

/** The live clock. It owns its interval so a 20Hz tick re-renders this one span instead of the
 *  whole trainer behind it — every trainer reports milliseconds, and reading the board is far too
 *  expensive to redo twenty times a second for a digit. `elapsedNow` is called on each tick rather
 *  than passed a number, so the trainer's clock (pauses and all) stays the single source of truth
 *  and this only decides how often it is shown. */
export function Timer({ elapsedNow, running }: { elapsedNow: () => number; running: boolean }) {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const tick = () => setMs(elapsedNow())
    // once immediately, so a stop/pause/reset lands on screen without waiting for a tick that,
    // when `running` is false, is never coming
    tick()
    if (!running) return
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [running, elapsedNow])
  return <span className="font-mono tabular-nums text-neutral-500">{formatElapsedMs(ms)}</span>
}

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
  /** Milliseconds on the trainer's own clock, read per tick — see `Timer`. */
  elapsedNow: () => number
  /** Whether that clock is ticking right now (not finished, not paused, hand in play). */
  running: boolean
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
  elapsedNow,
  running,
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
        {showToggle && timerEnabled && <Timer elapsedNow={elapsedNow} running={running} />}
      </div>
      {children && (
        <span className="ml-auto flex flex-col items-end text-neutral-500">{children}</span>
      )}
    </div>
  )
}
