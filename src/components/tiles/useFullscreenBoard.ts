import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../features/settings/settingsStore'

/** A phone-sized viewport — the breakpoint `mobileFullscreen` auto-enters at. The height half is
 *  the same 520px the `short:` variant keys on: a phone held sideways is the viewport with the
 *  least room of all, and on the width test alone it was the one that never auto-entered — the
 *  inline layout there spends its whole height budget on the header, the status row and the hand,
 *  leaving a 214px board on a 750x342 screen. */
export const MOBILE_QUERY = '(max-width: 640px), (max-height: 520px)'

/** The fullscreen toggle's state and side effects, called once per page — the button itself lives
 *  in the trainer's own command bar (`TrainerToggles`) rather than in `BoardStage`, so both the
 *  status bar and `BoardStage` (which only needs to know whether it's `full`) thread this same
 *  state through rather than `BoardStage` owning a button no sibling component could reach.
 *
 * Requests fullscreen on `document.documentElement` rather than a ref to `BoardStage`'s own
 * overlay: the overlay is already `fixed inset-0` (full viewport) regardless, so which element
 * is nominally "the fullscreen element" makes no visual difference, and targeting the document
 * root means no DOM ref has to travel from this hook (called at the page) down into `BoardStage`.
 *
 * Auto-entered on phone-sized viewports behind `mobileFullscreen`, a persisted setting that
 * defaults on. It is a real `requestFullscreen` where the browser has one, attempted only
 * inside a real user gesture (a load-time call is rejected outright) — an auto-entered stage
 * waits for the reader's first tap before attempting it, rather than trying at mount. */
export function useFullscreenBoard() {
  const mobileFullscreen = useSettings((s) => s.mobileFullscreen)
  const setMobileFullscreen = useSettings((s) => s.setMobileFullscreen)
  const [full, setFull] = useState(() => mobileFullscreen && matchMedia(MOBILE_QUERY).matches)
  // whether *this* entry into fullscreen happened with no gesture behind it yet (true only for
  // an auto-entered stage, and only until the first tap resolves it) — captured once per entry,
  // not just at mount, so leaving and manually re-entering later still requests real fullscreen
  // immediately like any other button press
  const enteredWithoutGesture = useRef(full)

  // the browser's own fullscreen, where it exists. Failures are ignored on purpose: iOS Safari
  // has no element fullscreen at all, and the fixed overlay `BoardStage` draws is the part that
  // matters
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
  }, [full])

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
