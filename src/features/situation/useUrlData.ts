import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router'

/** Decoded query params, re-derived once per navigation rather than once per query string.
 *  A log entry's rewind restores the situation as it stood before that action, and for the
 *  first action of a round that *is* the URL already in the bar — `useSearchParams` memoises
 *  on `location.search`, so keyed on the string alone the rewind is a silent no-op and the
 *  round never rebuilds. Every push gets a fresh `location.key`, identical URL or not. */
export function useUrlData<T>(decode: (params: URLSearchParams) => T): T {
  const [params] = useSearchParams()
  const { key } = useLocation()
  // decode is a module-level function; keyed on the navigation, not on it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => decode(params), [params, key])
}
