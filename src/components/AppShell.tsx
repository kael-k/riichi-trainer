import { useEffect } from 'react'
import { Outlet } from 'react-router'
import sprite from '../assets/tiles/sprite.svg?raw'
import { useSettings } from '../features/settings/settingsStore'

export function AppShell() {
  const theme = useSettings((s) => s.theme)

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
