import { actionStats, type ActionStats, type StatsJob } from '../../core/table'

type Reply = { id: number; stats: ActionStats | null } | { id: number; error: string }

/** Keyed on the job object a log row carries, so a row priced once is never priced again however
 *  often it remounts — the filter toggle, the drawer reopening. A rejected job is dropped. */
const requested = new WeakMap<StatsJob, Promise<ActionStats | null>>()
/** What `requested` has already answered, readable synchronously — so a remounted row draws its
 *  lines on its first render rather than flashing the pending state for a frame. */
const answered = new WeakMap<StatsJob, ActionStats | null>()

let worker: Worker | undefined
let nextId = 0
const waiting = new Map<
  number,
  { resolve: (s: ActionStats | null) => void; reject: (e: Error) => void }
>()

// ponytail: one worker, FIFO, no cancellation — a row scrolled past is still priced in turn. A
// priority queue (visible rows first) or a small pool is the upgrade if a long log stalls.
function startWorker(): Worker {
  const w = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data
    const pending = waiting.get(reply.id)
    waiting.delete(reply.id)
    if ('error' in reply) pending?.reject(new Error(reply.error))
    else pending?.resolve(reply.stats)
  }
  // the worker itself failed (it never loaded, or threw outside a job): everything queued on it
  // fails, and the next request starts a fresh one
  w.onerror = () => {
    for (const { reject } of waiting.values()) reject(new Error('stats worker failed'))
    waiting.clear()
    worker = undefined
  }
  return w
}

function inWorker(job: StatsJob): Promise<ActionStats | null> {
  worker ??= startWorker()
  const id = nextId++
  const w = worker
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ id, job })
  })
}

/** No `Worker` (jsdom, vitest): priced on this thread, but still asynchronously, so a caller
 *  never sees a different shape of answer than the browser gives it. */
function inline(job: StatsJob): Promise<ActionStats | null> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(actionStats(job))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }, 0),
  )
}

/** One log row's stats, priced off the main thread (`core/table.ts#actionStats`). `null` is an
 *  action with no price — the job's own row should not have asked. */
export function requestStats(job: StatsJob): Promise<ActionStats | null> {
  let promise = requested.get(job)
  if (!promise) {
    promise = typeof Worker === 'undefined' ? inline(job) : inWorker(job)
    // a failure is not cached: the next request for this row tries again (on a fresh worker, if
    // the last one died) rather than leaving it unpriced for the rest of the session
    promise.then(
      (stats) => answered.set(job, stats),
      () => requested.delete(job),
    )
    requested.set(job, promise)
  }
  return promise
}

/** The stats `requestStats` has already resolved for `job`, or `undefined` if it has not. */
export function settledStats(job: StatsJob): ActionStats | null | undefined {
  return answered.get(job)
}
