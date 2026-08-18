import { useEffect } from 'react'

/** A phone-sized viewport. The height half is the same 520px the `short:` variant keys on: a phone
 *  held sideways is the viewport with the least room of all, and on the width test alone it was
 *  the one that never matched. */
export const MOBILE_QUERY = '(max-width: 640px), (max-height: 520px)'

/** Whether the reader has already left fullscreen once this session. Module scope, so it outlives
 *  the page they left it on — never persisted, the same lifetime the browser gives its own
 *  `document.fullscreenElement`. */
let dismissed = false

/**
 * Asks the browser for real fullscreen on a phone.
 *
 * The stage lays itself out the same either way — it is the whole page now, not an overlay over
 * one — so this only ever removes the browser's *own* chrome on top of it. That is worth having on
 * Android, where the URL bar and the system bars eat a third of a 750px-tall screen; iOS Safari has
 * no element fullscreen at all, so there the call is absent and installing to the Home Screen
 * (`IOSInstallHint`) stays the only real answer. There is no button and no setting: the reader
 * leaves it the way they leave any other fullscreen page, with the system's own back or swipe, and
 * that is remembered for the session so the page never fights them for the screen.
 *
 * `requestFullscreen` is rejected outright unless it is running inside a user gesture, so the call
 * waits for the reader's first `pointerdown` rather than firing at mount.
 */
export function useMobileFullscreen() {
  useEffect(() => {
    if (dismissed || !matchMedia(MOBILE_QUERY).matches) return
    if (!document.documentElement.requestFullscreen) return

    const onFirstPointerDown = () => {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch(() => {})
      }
    }
    document.addEventListener('pointerdown', onFirstPointerDown, { once: true })

    const onChange = () => {
      if (!document.fullscreenElement) dismissed = true
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('pointerdown', onFirstPointerDown)
      document.removeEventListener('fullscreenchange', onChange)
    }
  }, [])
}
