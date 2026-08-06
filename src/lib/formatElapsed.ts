/** Formats a whole-second duration as "m:ss", e.g. 75 -> "1:15". */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Formats a millisecond duration as "m:ss.mmm", e.g. 75432 -> "1:15.432". */
export function formatElapsedMs(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  return `${formatElapsed(Math.floor(total / 1000))}.${String(total % 1000).padStart(3, '0')}`
}
