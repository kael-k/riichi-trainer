import { ArrowLeft, Check, Copy, Settings, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useLog, type LogEntry } from '../store/log'
import { ThemeToggle } from './ThemeToggle'
import { Tile } from './tiles/Tile'

interface TrainerLayoutProps {
  title: string
  /** Form controls rendered inside the settings dialog; omit to hide the gear. */
  settings?: ReactNode
  children: ReactNode
}

export function TrainerLayout({ title, settings, children }: TrainerLayoutProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const clearLog = useLog((s) => s.clear)
  // the log store is a single global instance; each trainer page starts its own log
  useEffect(() => clearLog(), [clearLog])
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white/90 px-2 py-1 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <Link to="/" aria-label="Back to menu" className="flex size-11 items-center justify-center">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex-1 font-semibold">{title}</h1>
        <ThemeToggle />
        {settings && (
          <>
            <button
              type="button"
              aria-label="Settings"
              onClick={() => dialogRef.current?.showModal()}
              className="flex size-11 items-center justify-center"
            >
              <Settings className="size-5" />
            </button>
            <dialog
              ref={dialogRef}
              className="m-auto w-[min(90vw,24rem)] rounded-xl p-0 backdrop:bg-black/40 md:fixed md:inset-y-0 md:right-0 md:left-auto md:m-0 md:h-svh md:w-96 md:max-w-[90vw] md:rounded-none md:rounded-l-2xl dark:bg-neutral-900 dark:text-neutral-100"
            >
              <form method="dialog" className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                  <h2 className="font-semibold">{title} settings</h2>
                  <button className="flex size-11 items-center justify-center" aria-label="Close">
                    <X className="size-5" />
                  </button>
                </div>
                <div className="flex flex-col gap-4 p-4">{settings}</div>
              </form>
            </dialog>
          </>
        )}
      </header>
      <main className="flex-1 p-3">{children}</main>
      <LogPanel />
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
          <LogRow key={entry.id} entry={entry} />
        ))}
      </ol>
    </details>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [copied, setCopied] = useState(false)
  return (
    <li className="flex flex-wrap items-center gap-1 py-0.5">
      <span>{entry.text}</span>
      {entry.tiles?.map((t, i) => (
        <Tile key={i} id={t.id} red={t.red} />
      ))}
      {entry.copyText && (
        <button
          type="button"
          aria-label="Copy hand in tenhou format"
          onClick={async () => {
            await navigator.clipboard.writeText(entry.copyText!)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className="ml-auto flex size-6 shrink-0 items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </li>
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
