import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useSettings } from '../../features/settings/settingsStore'

/** A phone-sized viewport — the breakpoint `mobileFullscreen` auto-enters at. The height half is
 *  the same 520px the `short:` variant keys on: a phone held sideways is the viewport with the
 *  least room of all, and on the width test alone it was the one that never auto-entered — the
 *  inline layout there spends its whole height budget on the header, the status row and the hand,
 *  leaving a 214px board on a 750x342 screen. */
export const MOBILE_QUERY = '(max-width: 640px), (max-height: 520px)'

/** Whether fullscreen is on — a single flag for the whole app, not per page. Session-only (no
 *  `persist`, unlike `mobileFullscreen`): it lives for as long as the tab does, the same way the
 *  browser's own `document.fullscreenElement` does, so navigating between trainers — or back to
 *  the home page — doesn't drop out of it. The initial value is computed once, at module load
 *  (module-level `create`, not inside the hook), which is what makes the phone auto-entry a
 *  once-per-session thing rather than re-firing every time a page mounts the hook. */
const useFullscreenStore = create<{
  full: boolean
  setFull: (full: boolean | ((full: boolean) => boolean)) => void
}>((set) => ({
  full:
    typeof document !== 'undefined' &&
    useSettings.getState().mobileFullscreen &&
    matchMedia(MOBILE_QUERY).matches,
  setFull: (full) => set((s) => ({ full: typeof full === 'function' ? full(s.full) : full })),
}))

/** The fullscreen toggle's state and side effects, called from every page that draws a
 *  `FullscreenToggle` (the trainer header, `BoardStage`'s own chrome, the home page) — all of
 *  them share the one flag above, so only whichever page is currently mounted drives the real
 *  browser side effects at any moment.
 *
 * Requests fullscreen on `document.documentElement` rather than a ref to `BoardStage`'s own
 * overlay: the overlay is already `fixed inset-0` (full viewport) regardless, so which element
 * is nominally "the fullscreen element" makes no visual difference, and targeting the document
 * root means no DOM ref has to travel from this hook down into `BoardStage`.
 *
 * Auto-entered on phone-sized viewports behind `mobileFullscreen`, a persisted setting that
 * defaults on. It is a real `requestFullscreen` where the browser has one, attempted only
 * inside a real user gesture (a load-time call is rejected outright) — an auto-entered stage
 * waits for the reader's first tap before attempting it, rather than trying at mount. */
export function useFullscreenBoard() {
  const setMobileFullscreen = useSettings((s) => s.setMobileFullscreen)
  const full = useFullscreenStore((s) => s.full)
  const setFull = useFullscreenStore((s) => s.setFull)
  // whether *this* mount still owes the browser a real `requestFullscreen` call with no gesture
  // behind it yet — true only when the flag came in already set (auto-entered, or carried over
  // from a page navigation that itself isn't a gesture the Fullscreen API accepts) and the real
  // API hasn't caught up yet; false (a no-op wait) once `document.fullscreenElement` is already
  // set, since a route change within an already-fullscreen tab needs no new request at all
  const enteredWithoutGesture = useRef(
    full && typeof document !== 'undefined' && !document.fullscreenElement,
  )

  useEffect(() => {
    if (!full) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      return
    }
    const requestReal = () => {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.().catch(() => {})
      }
    }
    // StrictMode replays this effect (mount, cleanup, mount again) with no real pointerdown in
    // between, so the flag can only be cleared *inside* the listener itself — clearing it eagerly
    // here would have the synthetic second mount see it already false and fire the real call with
    // no gesture behind it after all
    let onFirstPointerDown: (() => void) | undefined
    if (enteredWithoutGesture.current) {
      onFirstPointerDown = () => {
        enteredWithoutGesture.current = false
        requestReal()
      }
      document.addEventListener('pointerdown', onFirstPointerDown, { once: true })
    } else {
      requestReal()
    }
    // Escape (or the browser's own control) leaves fullscreen without going through our button
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      if (onFirstPointerDown) document.removeEventListener('pointerdown', onFirstPointerDown)
      document.removeEventListener('fullscreenchange', onChange)
    }
  }, [full, setFull])

  return {
    full,
    toggle: () => {
      if (full) {
        // the persisted opt-out: closing it once on a phone means "not by default" from here
        // on, not just "not this visit" — the settings row is how it comes back
        if (matchMedia(MOBILE_QUERY).matches) setMobileFullscreen(false)
      } else {
        enteredWithoutGesture.current = false
      }
      setFull((f) => !f)
    },
  }
}
