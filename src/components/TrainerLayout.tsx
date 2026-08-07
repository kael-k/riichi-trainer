import { ArrowLeft, Check, Copy } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatLogEntry } from '../features/i18n/formatLogEntry'
import { DEFAULT_TILE_SCALE, useSettings } from '../features/settings/settingsStore'
import { SettingsButton } from '../features/settings/SettingsDialog'
import { useLog, type LogEntry } from '../store/log'
import { Tile } from './tiles/Tile'

interface TrainerLayoutProps {
  title: string
  /** Form controls rendered inside the settings dialog; omit to hide app-specific rows
   *  (the Global section still shows). */
  settings?: ReactNode
  children: ReactNode
}

export function TrainerLayout({ title, settings, children }: TrainerLayoutProps) {
  const { t } = useTranslation()
  const tileScale = useSettings((s) => s.tileScale) ?? DEFAULT_TILE_SCALE
  const clearLog = useLog((s) => s.clear)
  // the log store is a single global instance; each trainer page starts its own log
  useEffect(() => clearLog(), [clearLog])
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white/90 px-2 py-1 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <Link
          to="/"
          aria-label={t('common.back')}
          className="flex size-11 items-center justify-center"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex-1 font-semibold">{title}</h1>
        <SettingsButton title={title}>{settings}</SettingsButton>
      </header>
      <main
        className="flex-1 p-3"
        style={
          {
            '--tile-w-base': `calc(var(--tile-w-raw) * ${tileScale})`,
            // re-declared here (not just --tile-w-base) so plain, non-overriding tile
            // usages (e.g. the main hand) actually pick up the scale: --tile-w's var()
            // reference resolves once at whichever element declares it, not freshly per
            // inheriting descendant, and it was previously only ever declared at :root
            '--tile-w': 'var(--tile-w-base)',
          } as CSSProperties
        }
      >
        {children}
      </main>
      <LogPanel />
    </div>
  )
}

function LogPanel() {
  const { t } = useTranslation()
  const { entries, clear } = useLog()
  return (
    <details className="border-t border-neutral-200 dark:border-neutral-800" open>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium text-neutral-600 dark:text-neutral-400">
        {t('common.log', { count: entries.length })}
        {entries.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              clear()
            }}
            className="ml-auto rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t('common.clear')}
          </button>
        )}
      </summary>
      <ol className="max-h-48 overflow-y-auto px-3 pb-2 text-sm [--tile-w:calc(var(--tile-w-base)*0.55)]">
        {entries.length === 0 && <li className="py-1 text-neutral-400">{t('common.noActions')}</li>}
        {[...entries].reverse().map((entry) => (
          <LogRow key={entry.id} entry={entry} />
        ))}
      </ol>
    </details>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <li className="flex items-center gap-2 py-0.5">
      <div className="min-w-0 flex-1">
        <p>{formatLogEntry(entry, t)}</p>
        {entry.tiles && entry.tiles.length > 0 && (
          <div className="flex flex-wrap">
            {entry.tiles.map((tile, i) => (
              <Tile key={i} id={tile.id} red={tile.red} />
            ))}
          </div>
        )}
      </div>
      {entry.copyText && (
        <button
          type="button"
          aria-label={t('common.copyHand')}
          onClick={async () => {
            await navigator.clipboard.writeText(entry.copyText!)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className="flex size-6 shrink-0 items-center justify-center self-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </li>
  )
}
