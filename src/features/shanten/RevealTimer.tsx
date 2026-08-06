import { Play, Square } from 'lucide-react'
import { formatElapsedMs } from '../../lib/formatElapsed'

interface RevealTimerProps {
  running: boolean
  elapsed: number
  timerEnabled: boolean
  onPlay: () => void
  onStop: () => void
}

/** Play/stop control; stopping re-conceals and deals a fresh hand. Timer readout
 *  only shown when enabled. */
export function RevealTimer({ running, elapsed, timerEnabled, onPlay, onStop }: RevealTimerProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={running ? onStop : onPlay}
        aria-label={running ? 'Stop and deal a new hand' : 'Reveal hand'}
        className="flex size-11 items-center justify-center rounded-full bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        {running ? (
          <Square className="size-4 fill-current" />
        ) : (
          <Play className="size-5 fill-current" />
        )}
      </button>
      {timerEnabled && (
        <span className="font-mono text-lg tabular-nums text-neutral-600 dark:text-neutral-400">
          {formatElapsedMs(elapsed)}
        </span>
      )}
    </div>
  )
}
