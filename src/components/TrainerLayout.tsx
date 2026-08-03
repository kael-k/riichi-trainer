import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useLog } from '../store/log'
import { Tile } from './tiles/Tile'

interface TrainerLayoutProps {
  title: string
  /** Form controls rendered inside the settings dialog; omit to hide the gear. */
  settings?: ReactNode
  /** Show the action log panel below the trainer (default true). */
  showLog?: boolean
  children: ReactNode
}

export function TrainerLayout({ title, settings, showLog = true, children }: TrainerLayoutProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white/90 px-2 py-1 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <Link
          to="/"
          aria-label="Back to menu"
          className="flex size-11 items-center justify-center text-xl"
        >
          ←
        </Link>
        <h1 className="flex-1 font-semibold">{title}</h1>
        {settings && (
          <>
            <button
              type="button"
              aria-label="Settings"
              onClick={() => dialogRef.current?.showModal()}
              className="flex size-11 items-center justify-center text-xl"
            >
              ⚙
            </button>
            <dialog
              ref={dialogRef}
              className="m-auto w-[min(90vw,24rem)] rounded-xl p-0 backdrop:bg-black/40 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <form method="dialog" className="flex flex-col">
                <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                  <h2 className="font-semibold">{title} settings</h2>
                  <button
                    className="flex size-11 items-center justify-center text-xl"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-col gap-4 p-4">{settings}</div>
              </form>
            </dialog>
          </>
        )}
      </header>
      <main className="flex-1 p-3">{children}</main>
      {showLog && <LogPanel />}
    </div>
  )
}

function LogPanel() {
  const { entries, clear } = useLog()
  return (
    <details className="border-t border-neutral-200 dark:border-neutral-800" open>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Log ({entries.length})
        {entries.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              clear()
            }}
            className="ml-auto rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Clear
          </button>
        )}
      </summary>
      <ol className="max-h-48 overflow-y-auto px-3 pb-2 text-sm [--tile-w:calc(var(--tile-w-base)*0.55)]">
        {entries.length === 0 && <li className="py-1 text-neutral-400">No actions yet.</li>}
        {[...entries].reverse().map((entry) => (
          <li key={entry.id} className="flex items-center gap-1 py-0.5">
            <span>{entry.text}</span>
            {entry.tiles?.map((t, i) => (
              <Tile key={i} id={t.id} red={t.red} />
            ))}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** Labeled toggle row for settings dialogs. */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-4">
      <span>{label}</span>
      {children}
    </label>
  )
}
