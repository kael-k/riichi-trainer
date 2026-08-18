import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../features/settings/settingsStore'

const IOS_UA = /iPad|iPhone|iPod/

/** iOS Safari has no element fullscreen at all — `BoardStage`'s fixed overlay is everything a
 *  tab there gets, and the browser's own bars (address bar, tab strip) never go away, landscape
 *  included. A PWA installed to the Home Screen (`display: standalone`, `vite.config.ts`) has
 *  none of that chrome, so that is the only real fix — this can only ever point at it, not
 *  remove the bars itself. iPadOS 13+ reports as a Mac; touch support is what actually tells it
 *  apart from a real desktop Safari. */
function isIOSSafariTab(): boolean {
  if (typeof navigator === 'undefined') return false
  const iOS =
    IOS_UA.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return iOS && standalone !== true
}

/** One dismissible line pointing at the Home Screen install as the fix for Safari's own bars.
 *  Lives on the home page alone, never on a trainer — the whole point is that it should never
 *  cover the tiles it is talking about, and every trainer is now the board itself. Dismissing it
 *  is permanent, same as every other persisted settings-store flag: closing it once means not
 *  seeing it again, not just this visit. */
export function IOSInstallHint() {
  const { t } = useTranslation()
  const dismissed = useSettings((s) => s.iosInstallHintDismissed)
  const setDismissed = useSettings((s) => s.setIosInstallHintDismissed)
  if (dismissed || !isIOSSafariTab()) return null
  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
      <span className="flex-1">{t('common.iosInstallHint')}</span>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={() => setDismissed(true)}
        className="flex size-8 shrink-0 items-center justify-center"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
