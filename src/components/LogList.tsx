import { Check, ChevronDown, Copy, RotateCcw, Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { formatLogDetail, formatLogEntry, splitTileCodes } from '../features/i18n/formatLogEntry'
import { useTermName } from '../features/i18n/useTermName'
import { copyText } from '../lib/clipboard'
import { useLog, type LogBar, type LogDetail, type LogEntry, type LogSeverity } from '../store/log'
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
    // an inline-size container so the tile row below can cap itself against the column it is
    // actually in — the panel is 320px on a laptop and up to 448px on a desktop, and a hand has
    // to read on one line in both. Declared here rather than on the `<ol>` itself: a container
    // query unit resolves against an *ancestor* container, never the element declaring it
    <div className={`flex min-h-0 flex-col [container-type:inline-size] ${className}`}>
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
      {/* the log's own tile size: 0.6 of the hand's, capped so fourteen still fit the column's
          width (`2rem` is the widest indent any row here has — the separator's `px-3` both sides,
          plus slack, since an exact fit wraps anyway on fractional widths) and floored at 20px,
          below which the tile art stops reading. `--tile-w-base` rather
          than `--tile-w` alone, so a nested override composes with it instead of ignoring it —
          `UkeireTiles`' own 0.8 is measured off the base, and used to come out *larger* than the
          tiles above it. Written from `--tile-w-raw`, since a declaration cannot read itself. */}
      <ol className="min-h-0 flex-1 overflow-y-auto pb-2 [--tile-w-base:clamp(1.25rem,(100cqw_-_2rem)/14,calc(var(--tile-w-raw)*var(--tile-scale,1)*0.6))] [--tile-w:var(--tile-w-base)]">
        {rows.length === 0 && (
          <li className="px-3 py-1 text-sm text-neutral-400">
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

/** A formatted sentence with the tiles it names drawn where their codes were: "discarded 0p" and
 *  "drew 4z" are expert shorthand, and this is the one surface a beginner reads their mistakes off
 *.
 *
 *  Sized in `em`, not off the log's own `--tile-w-base`: these ride inside a line of prose rather
 *  than standing in a row of their own, so they scale with the sentence. `align-middle` puts them
 *  on the text's own centre line — a tile has no baseline of its own for the line box to hang it
 *  from. `1.5em` wide is `2em` tall (`aspect-3/4`), which is why the row's prose is set on 2em
 *  leading: the line box has to be the tile's own height or a sentence that wraps draws its
 *  second line straight through the tiles on its first. A tile is worth the row being taller —
 *  shrinking it to the text's line instead puts it under the ~20px the tile art stops reading at.
 *
 *  Nothing is done here for a screen reader on purpose: `Tile` already carries `role="img"` and
 *  the tile's translated name, so the sentence is *read out* better than it was — "discarded red
 *  five of circles" rather than "discarded 0p". An `aria-label` over the whole line would put the
 *  codes back for exactly the readers who can least afford them. */
function LogSentence({ text }: { text: string }) {
  return (
    <>
      {splitTileCodes(text).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={i} className="inline-flex align-middle [--tile-w:1.5em]">
            <Tile id={part.id} red={part.red} />
          </span>
        ),
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
 *  tile shapes it carries (plain tiles, or tiles with their remaining counts). A `header` line is
 *  the grouping above them — the same hairline-label treatment `DealSeparator` gives a deal, since
 *  it makes the same kind of claim: what follows belongs together.
 *
 *  Exported because a `LogDetail[]` is not only a log row's own contents: `/match`'s round-end
 *  report draws the very same lines the log row for that round carries, and drawing them twice
 *  two ways is how the two come to disagree. */
export function DetailLine({ detail }: { detail: LogDetail }) {
  const { t } = useTranslation()
  const termName = useTermName()
  const text = formatLogDetail(detail, t, termName)
  if (detail.header) {
    return <div className="mt-1 text-[10px] tracking-wider text-neutral-400 uppercase">{text}</div>
  }
  const tiles = detail.tiles ?? []
  const seam = detail.seam ?? tiles.length
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 text-xs ${
        detail.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'
      }`}
    >
      <span>{text}</span>
      {tiles.length > 0 && (
        <span className="flex items-center">
          <Tiles tiles={tiles.slice(0, seam)} />
          {/* the subject tile, then a rule, then what explains it */}
          {seam < tiles.length && (
            <span className="ml-1.5 flex items-center border-l border-neutral-200 pl-1.5 dark:border-neutral-700">
              <Tiles tiles={tiles.slice(seam)} />
            </span>
          )}
        </span>
      )}
      {detail.ukeire && detail.ukeire.length > 0 && <UkeireTiles tiles={detail.ukeire} />}
      {detail.bars && detail.bars.length > 0 && <EvBars bars={detail.bars} />}
    </div>
  )
}

/** Every candidate discard's EV, normalized on the ranking's own best entry (the
 *  "the grading UI must show the band it graded against" — this is the evidence half; the band
 *  itself is named in the line's own text). `w-full` inside the row's `flex-wrap` is what puts the
 *  whole block on its own line without a second container: nothing else fits beside a 100%-wide
 *  child, so it always wraps clean under the sentence and the ukeire block. */
function EvBars({ bars }: { bars: LogBar[] }) {
  return (
    <div className="mt-0.5 flex w-full flex-col gap-0.5">
      {bars.map((bar) => (
        <div key={bar.tile} className="flex items-center gap-1.5">
          <span className="flex items-center [--tile-w:calc(var(--tile-w-base)*0.7)]">
            <Tile id={bar.tile} />
          </span>
          <div className="h-1 flex-1 rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className={`h-1 rounded-full ${
                bar.best
                  ? 'bg-green-600 dark:bg-green-400'
                  : bar.chosen
                    ? 'bg-red-600 dark:bg-red-400'
                    : 'bg-neutral-400 dark:bg-neutral-600'
              }`}
              style={{ width: `${Math.round(Math.max(0, Math.min(1, bar.fraction)) * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-neutral-500">
            {bar.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Tiles lead, prose follows muted — the river's own order of business, and the one thing the
 *  wrapped-sentence-first list this replaces had backwards. */
function LogRow({ entry, number }: { entry: LogEntry; number: number }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const detail = entry.detail
  const tiles = entry.tiles ?? []
  return (
    <li className="relative py-1 pr-1 pl-3">
      {/* the rail, on the list's own left edge rather than a column indented past the ordinal:
          rows are adjacent, so the segments meet and read top to bottom as one record */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 rounded-full ${entry.severity ? SPINE[entry.severity] : NO_VERDICT}`}
      />
      {tiles.length > 0 && (
        // the tiles get the row's whole width: no ordinal gutter ahead of them and no action
        // cluster beside them, which is what lets a full hand read on one line
        <div className="flex flex-wrap items-center">
          <Tiles tiles={tiles} />
        </div>
      )}
      <div className="flex items-start gap-1">
        {/* `leading-[2]` is the tile's own height (`LogSentence`), not a typographic choice:
            the sentence draws tiles inline, so a line box shorter than one overlaps the line
            below it. Rows with no tile in their prose ride the same leading rather than each
            row setting its own — a log column whose line spacing changed per row reads worse
            than one that is uniformly airy. */}
        <p className="min-w-0 flex-1 pt-0.5 text-xs leading-[2] text-neutral-500 tabular-nums">
          {/* the ordinal leads the sentence instead of holding a column of its own — it is only
              ever read against `log.rewound`'s "Rewound to entry {{number}}" */}
          <span className="mr-1.5 text-[10px] text-neutral-400">{number}</span>
          <LogSentence text={formatLogEntry(entry, t)} />
        </p>
        <div className="flex shrink-0 items-center">
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
      {expanded && detail && (
        <div className="mt-1 flex flex-col gap-1">
          {detail.map((line, i) => (
            <DetailLine key={i} detail={line} />
          ))}
        </div>
      )}
    </li>
  )
}

/** A deal, drawn as the boundary it is: a hairline across the list with its label in the middle
 *  and its own rewind/share/copy buttons inline. No tiles — a deal is where the record starts
 *  again, and the hand itself belongs to the row that grades it. */
function DealSeparator({ entry, number }: { entry: LogEntry; number: number }) {
  const { t } = useTranslation()
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        <span className="text-[10px] tracking-wider text-neutral-400 uppercase">
          {formatLogEntry(entry, t)}
        </span>
        <RowActions entry={entry} number={number} />
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>
    </li>
  )
}
