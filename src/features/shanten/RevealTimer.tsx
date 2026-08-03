function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface RevealTimerProps {
  running: boolean
  elapsed: number
  timerEnabled: boolean
  disabled: boolean
  onPlay: () => void
  onPause: () => void
}

/** Play/pause control; pausing re-conceals the hand. Timer readout only shown when enabled. */
export function RevealTimer({
  running,
  elapsed,
  timerEnabled,
  disabled,
  onPlay,
  onPause,
}: RevealTimerProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={running ? onPause : onPlay}
        aria-label={running ? 'Pause and conceal' : 'Reveal hand'}
        className="flex size-11 items-center justify-center rounded-full bg-neutral-900 text-lg text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {running ? '❚❚' : '▶'}
      </button>
      {timerEnabled && (
        <span className="font-mono text-lg tabular-nums text-neutral-600 dark:text-neutral-400">
          {formatElapsed(elapsed)}
        </span>
      )}
    </div>
  )
}
