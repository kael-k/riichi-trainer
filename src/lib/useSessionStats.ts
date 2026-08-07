import { useEffect, useRef, useState } from 'react'
import { useLog } from '../store/log'

/** Session score and per-hand clock shared by the graded trainers (shanten, scoring): how many
 *  hands were answered, how many right, mean time. Clearing the log clears the session it
 *  recorded, so the counters reset with it. */
export function useSessionStats() {
  // stable per mount, so an unspecified seed still gets a fresh hand each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const [correctCount, setCorrectCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  const startedAt = useRef(0)
  const entryCount = useLog((s) => s.entries.length)

  useEffect(() => {
    if (entryCount > 0) return
    setCorrectCount(0)
    setTotalCount(0)
    setTotalTime(0)
  }, [entryCount])

  return {
    randomSeed,
    correctCount,
    totalCount,
    /** Mean time per graded hand, in milliseconds. */
    averageTime: totalCount > 0 ? totalTime / totalCount : 0,
    /** (Re)starts the clock for the hand now on screen. */
    startClock: () => {
      startedAt.current = performance.now()
    },
    elapsedNow: () => performance.now() - startedAt.current,
    record: (correct: boolean, elapsed: number) => {
      setTotalCount((n) => n + 1)
      setTotalTime((t) => t + elapsed)
      if (correct) setCorrectCount((n) => n + 1)
    },
  }
}
