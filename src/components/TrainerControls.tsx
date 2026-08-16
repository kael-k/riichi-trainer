import { Dices, Maximize2, Minimize2, Pause, Play, Undo2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { formatElapsedMs } from '../lib/formatElapsed'

/** Drawn small enough to sit in the fullscreen board's chrome, where every other button is a
 *  44px icon rather than the status bar's roomier 48px pair — shared by every button in this
 *  file so the command bar reads as one row whichever context it's in. Deliberately no text
 *  color of its own: `SettingsButton`/`InfoButton` (the other buttons sharing this same row in
 *  fullscreen, `BoardStage.tsx`) set none either, and a gray-vs-default split between otherwise
 *  identical icon buttons read as "some of these are disabled" when none of them were. */
function buttonClasses(compact: boolean): { box: string; icon: string } {
  return {
    box: compact
      ? 'flex size-11 shrink-0 items-center justify-center'
      : 'flex size-12 items-center justify-center',
    icon: compact ? 'size-5' : 'size-6',
  }
}

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

interface CompactProps {
  compact?: boolean
}

interface PauseToggleProps extends CompactProps {
  /** Whether this button (and, when `timerEnabled`, the clock) is shown at all. Every trainer
   *  but shanten ties this straight to its own timer setting — pausing a clock nobody is showing
   *  has nothing to do. Shanten's toggle is also its reveal control, so it stays on regardless of
   *  the timer setting: reveal is a core mechanic, not a timer convenience. */
  showToggle: boolean
  paused: boolean
  onToggle: () => void
  toggleLabel: string
}

/** Start/pause (or, for shanten, reveal/pause). */
export function PauseToggle({
  showToggle,
  paused,
  onToggle,
  toggleLabel,
  compact,
}: PauseToggleProps) {
  if (!showToggle) return null
  const { box, icon } = buttonClasses(!!compact)
  return (
    <button type="button" onClick={onToggle} aria-label={toggleLabel} className={box}>
      {paused ? (
        <Play className={`${icon} fill-current`} />
      ) : (
        <Pause className={`${icon} fill-current`} />
      )}
    </button>
  )
}

interface BackButtonProps extends CompactProps {
  /** Whether there is a previous decision to undo — disabled (not hidden) otherwise, so the
   *  command bar's layout never shifts as history accumulates. */
  canBack: boolean
  onBack: () => void
  backLabel: string
}

/** Undoes the reader's own last graded decision, one at a time — see `useLogBack`. */
export function BackButton({ canBack, onBack, backLabel, compact }: BackButtonProps) {
  const { box, icon } = buttonClasses(!!compact)
  return (
    <button
      type="button"
      onClick={onBack}
      disabled={!canBack}
      aria-label={backLabel}
      className={`${box} disabled:opacity-30`}
    >
      <Undo2 className={icon} />
    </button>
  )
}

interface ResetButtonProps extends CompactProps {
  onReset: () => void
  resetLabel: string
}

/** Abandons the current hand and deals a fresh one. */
export function ResetButton({ onReset, resetLabel, compact }: ResetButtonProps) {
  const { box, icon } = buttonClasses(!!compact)
  return (
    <button type="button" onClick={onReset} aria-label={resetLabel} className={box}>
      <Dices className={icon} />
    </button>
  )
}

interface FullscreenToggleProps extends CompactProps {
  full: boolean
  onToggleFull: () => void
  fullscreenLabel: string
}

/** Enters/leaves the fullscreen board — see `useFullscreenBoard`. */
export function FullscreenToggle({
  full,
  onToggleFull,
  fullscreenLabel,
  compact,
}: FullscreenToggleProps) {
  const { box, icon } = buttonClasses(!!compact)
  return (
    <button
      type="button"
      onClick={onToggleFull}
      aria-label={fullscreenLabel}
      aria-pressed={full}
      className={box}
    >
      {full ? <Minimize2 className={icon} /> : <Maximize2 className={icon} />}
    </button>
  )
}

export interface TrainerTogglesProps
  extends PauseToggleProps, BackButtonProps, ResetButtonProps, FullscreenToggleProps {}

/** The reader's whole command bar, on its own: reveal/pause, undo, reset and fullscreen. The
 *  status bar draws them beside the clock; the fullscreen board draws the same set in its
 *  chrome, so a hand can be paused, undone or abandoned without leaving the table to do it. */
export function TrainerToggles(props: TrainerTogglesProps) {
  return (
    <>
      <PauseToggle {...props} />
      <BackButton {...props} />
      <ResetButton {...props} />
      <FullscreenToggle {...props} />
    </>
  )
}

interface TrainerStatusBarProps extends TrainerTogglesProps {
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
  elapsedNow,
  running,
  timerEnabled,
  children,
  ...toggles
}: TrainerStatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <div className="flex items-center gap-1">
        <TrainerToggles {...toggles} />
        {toggles.showToggle && timerEnabled && <Timer elapsedNow={elapsedNow} running={running} />}
      </div>
      {children && (
        <span className="ml-auto flex flex-col items-end text-neutral-500">{children}</span>
      )}
    </div>
  )
}
