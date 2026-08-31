import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useLog } from '../store/log'

/** Log keys that record navigation itself rather than a decision — a shared link's replayed
 *  discards (`log.replay`) carry a `situation` too (so their own row is still individually
 *  rewindable) but are not something "back" should walk through: they are not decisions made in
 *  this session, and re-navigating to one on every "back" click (`logReplay`'s dedup key is the
 *  decoded situation's identity, which a URL change always mints fresh) would grow this list on
 *  every press and break the cursor below. The board-as-dealt rows (`log.dealt`/`log.dealtHand`,
 *  are the same kind of row for the same reason — a board coming into existence is not
 *  a decision the reader made, and letting it count as one made "undo" enabled with nothing yet to
 *  undo. */
const META_KEYS = new Set(['log.replay', 'log.dealt', 'log.dealtHand'])

/** One step back through this session's own decisions, reusing the rewind every log entry
 *  already carries (`entry.situation`, the state before that entry) — same mechanism as a log
 *  row's own rewind button, just aimed at the most recent entry instead of a chosen one.
 *
 * Repeated presses walk further back: `steps` is a cursor over the decision rows (append-only,
 * so the array itself never shrinks), reset to 0 the moment a *new* decision actually lands —
 * detected as the decision count changing, which a "back" press itself never does (its own log
 * row carries no `situation`, so it never joins `decisions`). */
export function useLogBack() {
  const entries = useLog((s) => s.entries)
  const log = useLog((s) => s.log)
  const [, setSearchParams] = useSearchParams()

  const decisions = entries.filter((e) => e.situation !== undefined && !META_KEYS.has(e.key))

  const [steps, setSteps] = useState(0)
  const [seenCount, setSeenCount] = useState(decisions.length)
  if (decisions.length !== seenCount) {
    setSeenCount(decisions.length)
    setSteps(0)
  }

  const target = decisions[decisions.length - 1 - steps]

  return {
    canBack: target !== undefined,
    back: () => {
      if (!target) return
      setSteps((s) => s + 1)
      setSearchParams(target.situation!)
      log({ key: 'log.wentBack' })
    },
  }
}
