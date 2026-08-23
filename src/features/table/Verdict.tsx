import { CheckCircle2, TriangleAlert, XCircle } from 'lucide-react'
import type { LogSeverity } from '../../store/log'

export type VerdictSeverity = LogSeverity

const ICON = { ok: CheckCircle2, warning: TriangleAlert, error: XCircle }
const COLOR = {
  ok: 'text-green-600 dark:text-green-400',
  warning: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
}

/**
 * One compact feedback line — icon, colour, short text, nothing else. No numbers, no tile lists:
 * that detail stays on the action's own log row, one tap away, for every turn of the session
 * rather than the last one. This is what floats over the board, at every viewport, so a
 * reader hears the verdict without losing the tiles to a wall of text — the only feedback density
 * `BoardStage` has left (`noticeCompact`).
 */
export function Verdict({ severity, text }: { severity: VerdictSeverity; text: string }) {
  const Icon = ICON[severity]
  return (
    <p className={`flex items-center gap-1.5 text-sm font-medium ${COLOR[severity]}`}>
      <Icon className="size-4 shrink-0" /> {text}
    </p>
  )
}
