/** Copies text to the clipboard, falling back to `execCommand` when the async Clipboard API is
 *  unavailable (any non-secure-context origin, e.g. a LAN IP over plain HTTP). Never throws;
 *  returns whether the copy succeeded so callers can skip the "copied" UI state on failure. */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}
