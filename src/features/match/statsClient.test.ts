import { describe, expect, it } from 'vitest'
import { actionStats, type StatsJob } from '../../core/table'
import { importTenhou } from '../../core/tenhouImport'
import convlog from '../../core/testdata/convlog.json'
import { requestStats, settledStats } from './statsClient'

describe('requestStats', () => {
  // jsdom has no `Worker`, so this is the inline fallback — the same answer, still asynchronous
  it('prices a job on this thread when there is no Worker, once per job', async () => {
    expect(typeof Worker).toBe('undefined')
    const imported = importTenhou(convlog)
    if ('error' in imported) throw new Error(imported.error)
    const { rules, rounds } = imported.game
    const job: StatsJob = { round: rounds[0], rules, at: 0 }

    const promise = requestStats(job)
    // asynchronous even inline: nothing has been priced by the time the call returns
    expect(settledStats(job)).toBeUndefined()
    const stats = await promise
    expect(stats).toEqual(actionStats(job))
    expect(settledStats(job)).toBe(stats)
    // keyed on the job object: asking again is the same answer, not a second pricing
    expect(requestStats(job)).toBe(promise)
  })
})
