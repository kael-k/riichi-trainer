import { Check, ChevronDown, Copy, RotateCcw, Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { formatLogDetail, formatLogEntry } from '../features/i18n/formatLogEntry'
import { useSettings } from '../features/settings/settingsStore'
import { copyText } from '../lib/clipboard'
import { useLog, type LogDetail, type LogEntry, type LogSeverity } from '../store/log'
import { Tile, UkeireTiles } from './tiles/Tile'

/** The verdict spine down the log's left edge, one segment per row: read top to bottom it *is* the
 *  session's accuracy record. Width carries it alongside colour, so it still reads for a
 *  colour-blind reader — and the sentence beside it names the better tile in words regardless. */
const SPINE: Record<LogSeverity, string> = {
  ok: 'w-0.5 bg-green-600 dark:bg-green-400',
  warning: 'w-0.5 bg-amber-600 dark:bg-amber-400',
  error: 'w-0.5 bg-red-600 dark:bg-red-400',
}

/** No `severity` is not the same claim as `severity: 'ok'`, which is why the spine does not fall
 *  back to it: a rewind, a replayed discard, the tenpai note and every row the lab writes are not
 *  graded decisions at all, and a green bar beside one says the reader got something right that
 *  nobody was scoring. */
const NO_VERDICT = 'w-px bg-neutral-200 dark:bg-neutral-800'

/** The deal is a boundary, not a decision: those rows draw as a rule across the list and break the
 *  spine, which is true — a new deal really is where the record starts again. */
const SEPARATOR_KEYS = new Set(['log.dealt', 'log.dealtHand'])

/** A real ≥44px touch target over a 24px layout box — the repo's own `after:size-11` trick
 *  (`SeatPanel`), so the row's icons stay small without the tap being. */
const ICON_BUTTON =
  'relative flex size-6 shrink-0 items-center justify-center text-neutral-400 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 hover:text-neutral-600 dark:hover:text-neutral-300'

/**
 * The session's decisions, and — one tap per row — why each was graded the way it was. This is the
 * feedback surface: the panel no longer carries a separate last-action box, so every turn of the
 * session stays reviewable rather than just the most recent one.
 *
 * `className` is how tall the menu is allowed to get, which is the one thing its two surfaces
 * answer differently: the session panel hands it the space its own flex split left over
 * (`min-h-0 flex-1`), while a caller with a fixed slice of a scrolling column takes the default.
 */
export function LogList({ className = 'max-h-48 short:max-h-none' }: { className?: string }) {
  const { t } = useTranslation()
  const { entries, clear } = useLog()
  // session-local, not a setting: it is a way of reading this list right now, not a preference
  // about every list from here on
  const [mistakesOnly, setMistakesOnly] = useState(false)
  // numbered from the session's first action, so the numbers stay put as the list grows — the
  // panel shows newest first, which would otherwise renumber every row each turn. Assigned before
  // filtering, so a row keeps its number under `Mistakes` too and `log.rewound` stays honest
  const rows = entries
    .map((entry, i) => ({ entry, number: i + 1 }))
    .reverse()
    .filter(
      ({ entry }) => !mistakesOnly || entry.severity === 'warning' || entry.severity === 'error',
    )
  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex min-h-11 items-center gap-2 px-3 text-sm font-medium text-neutral-600 dark:text-neutral-400">
        {t('common.log', { count: entries.length })}
        <div className="ml-auto flex overflow-hidden rounded border border-neutral-200 text-xs dark:border-neutral-700">
          {[false, true].map((only) => (
            <button
              key={String(only)}
              type="button"
              aria-pressed={mistakesOnly === only}
              onClick={() => setMistakesOnly(only)}
              className={`px-2 py-1 ${
                mistakesOnly === only
                  ? 'bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {t(only ? 'common.filterMistakes' : 'common.filterAll')}
            </button>
          ))}
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t('common.clear')}
          </button>
        )}
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 [--tile-w:calc(var(--tile-w-base)*0.6)]">
        {rows.length === 0 && (
          <li className="py-1 text-sm text-neutral-400">
            {t(mistakesOnly ? 'common.noMistakes' : 'common.noActions')}
          </li>
        )}
        {rows.map(({ entry, number }) =>
          SEPARATOR_KEYS.has(entry.key) ? (
            <DealSeparator key={entry.id} entry={entry} number={number} />
          ) : (
            <LogRow key={entry.id} entry={entry} number={number} />
          ),
        )}
      </ol>
    </div>
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
      className={ICON_BUTTON}
    >
      {copied ? <Check className="size-3.5" /> : icon}
    </button>
  )
}

/** Rewind / share / copy, unchanged in behaviour and in label from the flat list this replaces. */
function RowActions({ entry, number }: { entry: LogEntry; number: number }) {
  const { t } = useTranslation()
  const [, setSearchParams] = useSearchParams()
  const log = useLog((s) => s.log)
  return (
    <>
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
            className={ICON_BUTTON}
          >
            <RotateCcw className="size-3.5" />
          </button>
          {/* the same situation the rewind restores, as a link someone else can open — the one
              sharing surface a trainer has, now that every deal leaves its own row here */}
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
    </>
  )
}

function Tiles({ tiles }: { tiles: NonNullable<LogEntry['tiles']> }) {
  return (
    <>
      {tiles.map((tile, i) => (
        <Tile key={i} id={tile.id} red={tile.red} />
      ))}
    </>
  )
}

/** One expanded line: what the deleted feedback panels drew, as a label plus whichever of the two
 *  tile shapes it carries (plain tiles, or tiles with their remaining counts). */
function DetailLine({ detail }: { detail: LogDetail }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
      <span>{formatLogDetail(detail, t)}</span>
      {detail.tiles && detail.tiles.length > 0 && (
        <span className="flex items-center">
          <Tiles tiles={detail.tiles} />
        </span>
      )}
      {detail.ukeire && detail.ukeire.length > 0 && <UkeireTiles tiles={detail.ukeire} />}
    </div>
  )
}

/** Tiles lead, prose follows muted — the river's own order of business, and the one thing the
 *  wrapped-sentence-first list this replaces had backwards. */
function LogRow({ entry, number }: { entry: LogEntry; number: number }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  // the tie list is a second answer to a question already answered right, so it stays gated on the
  // setting at *render* — logged unconditionally, exactly as `FoldFeedback` gated its own copy,
  // which is what lets the toggle take effect on rows already on the record
  const showEquallySafe = useSettings((s) => s.folding.showEquallySafe)
  const detail = entry.detail?.filter((d) => showEquallySafe || d.key !== 'folding.equallySafe')
  const tiles = entry.tiles ?? []
  const seam = entry.seam ?? tiles.length
  return (
    <li className="flex gap-2">
      <span className="w-5 shrink-0 pt-1.5 text-right text-[10px] text-neutral-400 tabular-nums">
        {number}
      </span>
      <div
        className={`shrink-0 rounded-full ${entry.severity ? SPINE[entry.severity] : NO_VERDICT}`}
      />
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-wrap items-center">
            <Tiles tiles={tiles.slice(0, seam)} />
            {/* two tiles either side of a rule is the diff — no arrow glyph needed to say it */}
            {seam < tiles.length && (
              <span className="ml-1.5 flex items-center border-l border-neutral-200 pl-1.5 dark:border-neutral-700">
                <Tiles tiles={tiles.slice(seam)} />
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center">
            <RowActions entry={entry} number={number} />
            {detail && detail.length > 0 && (
              <button
                type="button"
                aria-label={t('common.showDetail')}
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
                className={ICON_BUTTON}
              >
                <ChevronDown className={`size-3.5 ${expanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        </div>
        <p className="text-xs leading-snug text-neutral-500 tabular-nums">
          {formatLogEntry(entry, t)}
        </p>
        {expanded && detail && (
          <div className="mt-1 flex flex-col gap-1">
            {detail.map((line, i) => (
              <DetailLine key={i} detail={line} />
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

/** A deal, drawn as the boundary it is: a hairline across the list with its label in the middle,
 *  its own rewind/share buttons inline, and the dealt hand beneath it when the entry carries one. */
function DealSeparator({ entry, number }: { entry: LogEntry; number: number }) {
  const { t } = useTranslation()
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        <span className="text-[10px] tracking-wider text-neutral-400 uppercase">
          {formatLogEntry(entry, t)}
        </span>
        <RowActions entry={entry} number={number} />
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>
      {entry.tiles && entry.tiles.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center">
          <Tiles tiles={entry.tiles} />
        </div>
      )}
    </li>
  )
}
