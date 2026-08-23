import { Check, Copy, RotateCcw, Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { formatLogEntry } from '../features/i18n/formatLogEntry'
import { copyText } from '../lib/clipboard'
import { useLog, type LogEntry } from '../store/log'
import { Tile } from './tiles/Tile'

/** The session's action rows. `className` is how tall the list is allowed to get, which is the
 *  one thing its two surfaces answer differently: the session panel hands it the space its own
 *  flex split left over (`min-h-0 flex-1`), while a caller with a fixed slice of a scrolling
 *  column takes the default. */
export function LogList({ className = 'max-h-48 short:max-h-none' }: { className?: string }) {
  const { t } = useTranslation()
  const entries = useLog((s) => s.entries)
  return (
    <ol
      className={`overflow-y-auto px-3 pb-2 text-sm [--tile-w:calc(var(--tile-w-base)*0.55)] ${className}`}
    >
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
        const ok = await copyText(text)
        if (!ok) return
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
  const [, setSearchParams] = useSearchParams()
  const log = useLog((s) => s.log)
  return (
    <li className="flex items-center gap-2 py-0.5">
      <span className="w-6 shrink-0 self-start text-right text-xs text-neutral-400 tabular-nums">
        {number}
      </span>
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
      {entry.situation !== undefined && (
        <>
          <button
            type="button"
            aria-label={t('common.rewind')}
            onClick={() => {
              setSearchParams(entry.situation!)
              // appended, not replacing the log: rewinding is itself an action worth a record,
              // and clearing history on rewind would erase feedback the player hasn't seen yet
              log({ key: 'log.rewound', params: { number } })
            }}
            className="flex size-6 shrink-0 items-center justify-center self-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <RotateCcw className="size-3.5" />
          </button>
          {/* the same situation the rewind restores, as a link someone else can open — the one
              sharing surface a trainer has, now that every deal leaves its own row here (T2/T3) */}
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
