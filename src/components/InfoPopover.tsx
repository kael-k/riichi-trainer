import { ExternalLink, Info, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

interface InfoPopoverProps {
  /** Accessible name of the trigger button. */
  triggerLabel: string
  /** Rendered inside the trigger button (an icon, or a term + small icon). */
  trigger: ReactNode
  triggerClassName: string
  dialogTitle: string
  text?: string
  wikiUrl?: string
  /** Header icon; the `Info` glyph unless a caller has a better one for what it is showing. */
  icon?: ReactNode
  /** Arbitrary dialog content, below `text` when both are given — the wall reveal draws rows of
   *  tiles in here rather than a paragraph. */
  children?: ReactNode
  /** A dialog for content rather than a sentence: 42rem instead of 26. */
  wide?: boolean
}

/** Trigger button + modal, portalled to <body>, scrim-dismissed, Escape-closed, body scroll
 *  locked while open. Shared by the trainer info button, inline glossary terms and the wall
 *  reveal — anywhere something needs a tap target that doesn't take permanent page space. */
export function InfoPopover({
  triggerLabel,
  trigger,
  triggerClassName,
  dialogTitle,
  text,
  wikiUrl,
  icon,
  children,
  wide,
}: InfoPopoverProps) {
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
        aria-label={triggerLabel}
        aria-expanded={open}
        // a glossary term can sit inside a <label> (a settings row); without this, opening the
        // popover would also toggle that row's checkbox via the label's implicit click delegation
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={dialogTitle}
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false)
            }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          >
            <div
              className={`flex max-h-full ${wide ? 'w-[min(90vw,42rem)]' : 'w-[min(90vw,26rem)]'} flex-col overflow-hidden rounded-xl bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100`}
            >
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <h2 className="flex items-center gap-2 font-semibold">
                  <span className="shrink-0 text-neutral-400">
                    {icon ?? <Info className="size-4" />}
                  </span>
                  {dialogTitle}
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
                {/* a blank line is a paragraph break: the trainer intros are what/why/how, and
                    three of those in one block is a wall nobody reads */}
                {text?.split('\n\n').map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
                {children}
                {wikiUrl && (
                  <a
                    href={wikiUrl}
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
