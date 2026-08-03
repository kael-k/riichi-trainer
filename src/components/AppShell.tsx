import { Outlet } from 'react-router'
import sprite from '../assets/tiles/sprite.svg?raw'

export function AppShell() {
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
