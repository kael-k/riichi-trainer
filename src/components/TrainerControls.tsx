import { Dices, Pause, Play, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatElapsedMs } from '../lib/formatElapsed'

/** Every button here shares the chrome row with `InfoButton` and `SettingsButton`
 *  (`BoardStage.tsx`), so it is drawn to match them: a 44px target that grows to hold its own name
 *  where there is room for one (`labelled:`, `index.css`), and deliberately no text color of its
 *  own — those two set none either, and a gray-vs-default split between otherwise identical icon
 *  buttons read as "some of these are disabled" when none of them were. */
export const CHROME_BUTTON =
  'flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-1 text-sm'
const ICON = 'size-5'

/** The button's own name, shown beside its icon only where the row has the width for it. The
 *  `aria-label` stays on the button either way, so the accessible name never depends on the
 *  viewport. */
export function ChromeLabel({ children }: { children: string }) {
  return <span className="hidden whitespace-nowrap labelled:inline">{children}</span>
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

interface PauseToggleProps {
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
export function PauseToggle({ showToggle, paused, onToggle, toggleLabel }: PauseToggleProps) {
  if (!showToggle) return null
  return (
    <button type="button" onClick={onToggle} aria-label={toggleLabel} className={CHROME_BUTTON}>
      {paused ? (
        <Play className={`${ICON} fill-current`} />
      ) : (
        <Pause className={`${ICON} fill-current`} />
      )}
      <ChromeLabel>{toggleLabel}</ChromeLabel>
    </button>
  )
}

interface BackButtonProps {
  /** Whether there is a previous decision to undo — disabled (not hidden) otherwise, so the
   *  command bar's layout never shifts as history accumulates. */
  canBack: boolean
  onBack: () => void
  backLabel: string
}

/** Undoes the reader's own last graded decision, one at a time — see `useLogBack`. */
export function BackButton({ canBack, onBack, backLabel }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onBack}
      disabled={!canBack}
      aria-label={backLabel}
      className={`${CHROME_BUTTON} disabled:opacity-30`}
    >
      <Undo2 className={ICON} />
      <ChromeLabel>{backLabel}</ChromeLabel>
    </button>
  )
}

interface ResetButtonProps {
  onReset: () => void
  resetLabel: string
}

/** Abandons the current hand and deals a fresh one. */
export function ResetButton({ onReset, resetLabel }: ResetButtonProps) {
  return (
    <button type="button" onClick={onReset} aria-label={resetLabel} className={CHROME_BUTTON}>
      <Dices className={ICON} />
      <ChromeLabel>{resetLabel}</ChromeLabel>
    </button>
  )
}

export interface TrainerTogglesProps extends PauseToggleProps, BackButtonProps, ResetButtonProps {}

/** The reader's whole command bar, on its own: reveal/pause, undo and reset — drawn in the
 *  stage's chrome row (`BoardStage.tsx`) between the trainer's info button and the log toggle, so
 *  a hand can be paused, undone or abandoned without leaving the table to do it. */
export function TrainerToggles(props: TrainerTogglesProps) {
  return (
    <>
      <PauseToggle {...props} />
      <BackButton {...props} />
      <ResetButton {...props} />
    </>
  )
}
