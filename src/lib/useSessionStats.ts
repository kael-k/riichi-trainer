import { useEffect, useRef, useState } from 'react'
import { useLog } from '../store/log'

/** Session score and clock shared by the graded trainers (shanten, scoring, folding): how many
 *  answers were given, how many right, mean time. The unit is whatever the trainer grades — a hand
 *  for shanten and scoring, a single discard for folding. Clearing the log clears the session it
 *  recorded, so the counters reset with it. */
export function useSessionStats() {
  // stable per mount, so an unspecified seed still gets a fresh hand each page load
  const [randomSeed] = useState(() => Math.random().toString(36).slice(2))
  const [correctCount, setCorrectCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  const [totalQuality, setTotalQuality] = useState(0)
  const startedAt = useRef(0)
  const entryCount = useLog((s) => s.entries.length)

  useEffect(() => {
    if (entryCount > 0) return
    setCorrectCount(0)
    setTotalCount(0)
    setTotalTime(0)
    setTotalQuality(0)
  }, [entryCount])

  return {
    randomSeed,
    correctCount,
    totalCount,
    /** Mean time per graded hand, in milliseconds. */
    averageTime: totalCount > 0 ? totalTime / totalCount : 0,
    /** Mean of whatever partial credit `record` was given, 0-1. Right/wrong is a coarse measure
     *  where an answer can be nearly right (a folding discard one tier off the safest is not the
     *  same mistake as throwing the most dangerous tile in hand); trainers that can say how close
     *  a choice was pass it, the rest leave it at right = 1, wrong = 0. */
    averageQuality: totalCount > 0 ? totalQuality / totalCount : 0,
    /** (Re)starts the clock for the hand now on screen. */
    startClock: () => {
      startedAt.current = performance.now()
    },
    elapsedNow: () => performance.now() - startedAt.current,
    record: (correct: boolean, elapsed: number, quality = correct ? 1 : 0) => {
      setTotalCount((n) => n + 1)
      setTotalTime((t) => t + elapsed)
      setTotalQuality((q) => q + quality)
      if (correct) setCorrectCount((n) => n + 1)
    },
  }
}
