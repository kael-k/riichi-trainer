import { useState } from 'react'

/** Which hand we are on, beside the link that opened the trainer.
 *
 *  A link names ONE hand, not every hand from there on — a shared URL, or the log's rewind, which
 *  pushes one (`LogList.tsx`, `useLogBack.ts`). `fromLink` is true only for the hand the link
 *  itself posed: every "replay what the URL names" branch must be gated on it, or `next()` re-deals
 *  the link forever. A fresh navigation puts the reader back on hand 0, since `useUrlData` mints a
 *  new object identity per navigation, identical URL or not — the "adjust state while rendering"
 *  pattern. */
export function useLinkedHand<T>(link: T) {
  const [handIndex, setHandIndex] = useState(0)
  const [last, setLast] = useState(link)
  if (link !== last) {
    setLast(link)
    setHandIndex(0)
  }
  return { handIndex, fromLink: handIndex === 0, next: () => setHandIndex((n) => n + 1) }
}
