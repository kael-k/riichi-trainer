import { actionStats, type StatsJob } from '../../core/table'

/** Prices one log row's action off the main thread — `actionStats` ranks every candidate under
 *  both EV models, which runs to seconds at 2-shanten. One job in, one answer out, matched by
 *  `id`; the job and the answer are both plain data. */
self.onmessage = (event: MessageEvent<{ id: number; job: StatsJob }>) => {
  const { id, job } = event.data
  try {
    postMessage({ id, stats: actionStats(job) })
  } catch (error) {
    postMessage({ id, error: String(error) })
  }
}
