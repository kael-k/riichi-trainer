import { useEffect } from 'react'
import { Outlet } from 'react-router'
import sprite from '../assets/tiles/sprite.svg?raw'
import i18n, { resolveLocale } from '../features/i18n'
import { useSettings } from '../features/settings/settingsStore'

export function AppShell() {
  const theme = useSettings((s) => s.theme)
  const locale = useSettings((s) => s.locale)

  useEffect(() => {
    const apply = () => {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', isDark)
    }
    apply()
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const resolved = resolveLocale(locale)
    void i18n.changeLanguage(resolved)
    document.documentElement.lang = resolved
  }, [locale])

  return (
    <>
      {/* tile sprite; 0×0 (not display:none) so gradients/clipPaths keep working */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          overflow: 'hidden',
        }}
        dangerouslySetInnerHTML={{ __html: sprite }}
      />
      <Outlet />
    </>
  )
}
