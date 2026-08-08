import { ArrowLeft, Check, Copy, Info, RotateCcw, Share2 } from 'lucide-react'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { formatLogEntry } from '../features/i18n/formatLogEntry'
import { DEFAULT_TILE_SCALE, useSettings } from '../features/settings/settingsStore'
import { SettingsButton } from '../features/settings/SettingsDialog'
import { useLog, type LogEntry } from '../store/log'
import { InfoPopover } from './InfoPopover'
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
  // The log store is a single global instance; each trainer page starts its own log. Cleared on
  // this layout's first render rather than from a mount effect: effects run children-first, so a
  // page whose round writes rows as it mounts (efficiency logs the discards a shared link replays)
  // would have them wiped a moment later by its own layout.
  const cleared = useRef(false)
  if (!cleared.current) {
    cleared.current = true
    clearLog()
  }
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

/** Info button explaining what the trainer drills, with an optional link to the full
 *  rules/theory on riichi.wiki. */
export function InfoButton({ title, intro }: { title: string; intro: TrainerIntro }) {
  const { t } = useTranslation()
  return (
    <InfoPopover
      triggerLabel={t('common.aboutTrainer')}
      trigger={<Info className="size-5" />}
      triggerClassName="flex size-11 items-center justify-center"
      dialogTitle={t('common.aboutTrainerTitle', { title })}
      text={intro.text}
      wikiUrl={intro.wikiUrl}
    />
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
        {/* numbered from the session's first action, so the numbers stay put as the list grows —
            the panel shows newest first, which would otherwise renumber every row each turn */}
        {entries
          .map((entry, i) => ({ entry, number: i + 1 }))
          .reverse()
          .map(({ entry, number }) => (
            <LogRow key={entry.id} entry={entry} number={number} />
          ))}
      </ol>
    </details>
  )
}

/** Copies `text` on click, showing a tick for a moment. A log row carries two: the hand in
 *  tenhou notation, and a link back to the situation the entry was logged from. */
function CopyButton({ label, text, icon }: { label: string; text: string; icon: ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="flex size-6 shrink-0 items-center justify-center self-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
    >
      {copied ? <Check className="size-3.5" /> : icon}
    </button>
  )
}

function LogRow({ entry, number }: { entry: LogEntry; number: number }) {
  const { t } = useTranslation()
  const showShanten = useSettings((s) => s.efficiency.showShanten)
  const [, setSearchParams] = useSearchParams()
  const log = useLog((s) => s.log)
  return (
    <li className="flex items-center gap-2 py-0.5">
      <span className="w-6 shrink-0 self-start text-right text-xs text-neutral-400 tabular-nums">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p>{formatLogEntry(entry, t, showShanten)}</p>
        {entry.tiles && entry.tiles.length > 0 && (
          <div className="flex flex-wrap">
            {entry.tiles.map((tile, i) => (
              <Tile key={i} id={tile.id} red={tile.red} />
            ))}
          </div>
        )}
      </div>
      {entry.situation !== undefined && (
        <>
          <button
            type="button"
            aria-label={t('common.rewind')}
            onClick={() => {
              setSearchParams(entry.situation!)
              // appended, not replacing the log: rewinding is itself an action worth a record,
              // and clearing history on rewind would erase feedback the player hasn't seen yet
              log('log.rewound', { number })
            }}
            className="flex size-6 shrink-0 items-center justify-center self-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <RotateCcw className="size-3.5" />
          </button>
          {/* the same situation the rewind restores, as a link someone else can open — built
              the way `CopyLinkButton` builds the page's own, since it is the same address with
              a different query */}
          <CopyButton
            label={t('common.copySituationLink')}
            icon={<Share2 className="size-3.5" />}
            text={`${location.origin}${location.pathname}${entry.situation ? `?${entry.situation}` : ''}`}
          />
        </>
      )}
      {entry.copyText && (
        <CopyButton
          label={t('common.copyHand')}
          icon={<Copy className="size-3.5" />}
          text={entry.copyText}
        />
      )}
    </li>
  )
}
