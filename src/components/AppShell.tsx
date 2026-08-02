import { NavLink, Outlet } from 'react-router'

const NAV_ITEMS = [{ to: '/', label: 'Home' }]

export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <span className="font-semibold">Riichi Trainer</span>
        <nav className="flex gap-3 text-sm">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => (isActive ? 'font-medium underline' : 'text-neutral-500')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
