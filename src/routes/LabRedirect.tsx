import { Navigate, useLocation } from 'react-router'

/** `/lab` is retired — `/match` carries its per-action EV and danger now. A lab situation link
 *  (`/lab?wall=…&seat=0&log=…`) is still a promise, so it lands on `/match` with its query intact.
 *  The router's own `Navigate`, never an absolute URL, so the basename is applied. */
export function LabRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/match', search }} replace />
}
