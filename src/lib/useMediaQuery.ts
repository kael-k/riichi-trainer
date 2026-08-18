import { useCallback, useSyncExternalStore } from 'react'

/**
 * Live `matchMedia` result as a boolean.
 *
 * `useSyncExternalStore` rather than the usual effect-plus-state pair: the very first render
 * already gets the real answer, so a layout that picks its *shape* from a query (the session panel
 * below `lg` is a drawer, at `lg` and up it is docked beside the board) never draws the wrong one
 * for a frame first. The server snapshot is `false` — there is no viewport to measure before
 * hydration, and the narrow shape is the one that fits either way.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  )
}
