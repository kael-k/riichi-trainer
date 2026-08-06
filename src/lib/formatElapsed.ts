/** Formats a whole-second duration as "m:ss", e.g. 75 -> "1:15". */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
