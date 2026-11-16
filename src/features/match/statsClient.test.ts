import { describe, expect, it, vi } from 'vitest'
import { actionStats, type StatsJob } from '../../core/table'
import { importTenhou } from '../../core/tenhouImport'
import convlog from '../../core/testdata/convlog.json'
import { requestStats, settledStats } from './statsClient'

vi.mock('../../core/table', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../core/table')>()
  return { ...real, actionStats: vi.fn(real.actionStats) }
})

const imported = importTenhou(convlog)
if ('error' in imported) throw new Error(imported.error)
const { rules, rounds } = imported.game

describe('requestStats', () => {
  // jsdom has no `Worker`, so this is the inline fallback — the same answer, still asynchronous
  it('prices a job on this thread when there is no Worker, once per job', async () => {
    expect(typeof Worker).toBe('undefined')
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

  it('does not cache a failure: the next request prices the job again', async () => {
    vi.mocked(actionStats)
      .mockImplementationOnce(() => {
        throw new Error('stats worker failed')
      })
      .mockImplementationOnce(() => null)
    const job: StatsJob = { round: rounds[0], rules, at: 1 }

    const failed = requestStats(job)
    await expect(failed).rejects.toThrow('stats worker failed')
    expect(settledStats(job)).toBeUndefined()
    const retried = requestStats(job)
    expect(retried).not.toBe(failed)
    await expect(retried).resolves.toBeNull()
    expect(settledStats(job)).toBeNull()
  })
})
