import { ArrowLeft, Check, Copy, ExternalLink, Info, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatLogEntry } from '../features/i18n/formatLogEntry'
import { DEFAULT_TILE_SCALE, useSettings } from '../features/settings/settingsStore'
import { SettingsButton } from '../features/settings/SettingsDialog'
import { useLog, type LogEntry } from '../store/log'
import { Tile } from './tiles/Tile'

export interface TrainerIntro {
  /** Beginner-facing explanation of what the trainer drills. */
  text: string
  /** riichi.wiki page with the full rules/theory, if one exists for this trainer's topic. */
  wikiUrl?: string
}

interface TrainerLayoutProps {
  title: string
  /** Form controls rendered inside the settings dialog; omit to hide app-specific rows
   *  (the Global section still shows). */
  settings?: ReactNode
  /** Shown behind an info button in the header; omit to hide the button. */
  intro?: TrainerIntro
  children: ReactNode
}

export function TrainerLayout({ title, settings, intro, children }: TrainerLayoutProps) {
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
        {intro && <InfoButton title={title} intro={intro} />}
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

/** Info button + modal explaining what the trainer drills, with an optional link to the full
 *  rules/theory on riichi.wiki. Mirrors SettingsButton's overlay (portalled, scrim-dismissed,
 *  Escape-closed, body scroll locked) but as a centered card — the content is a paragraph, not
 *  a settings list, so the desktop side-sheet treatment doesn't earn its keep here. */
export function InfoButton({ title, intro }: { title: string; intro: TrainerIntro }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label={t('common.aboutTrainer')}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex size-11 items-center justify-center"
      >
        <Info className="size-5" />
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('common.aboutTrainerTitle', { title })}
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false)
            }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          >
            <div className="flex max-h-full w-[min(90vw,26rem)] flex-col overflow-hidden rounded-xl bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Info className="size-4 shrink-0 text-neutral-400" />
                  {t('common.aboutTrainerTitle', { title })}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex size-11 items-center justify-center"
                  aria-label={t('common.close')}
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm text-neutral-600 dark:text-neutral-400">
                <p>{intro.text}</p>
                {intro.wikiUrl && (
                  <a
                    href={intro.wikiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center gap-1.5 self-start font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                  >
                    {t('common.learnMoreWiki')}
                    <ExternalLink className="size-3.5 shrink-0" />
                  </a>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
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
