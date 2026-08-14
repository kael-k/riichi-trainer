import { HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GLOSSARY, type GlossaryTermId } from '../features/i18n/glossary'
import { useSettings } from '../features/settings/settingsStore'
import { InfoPopover } from './InfoPopover'

/** Marks a piece of mahjong jargon inline; tapping it opens a short explanation + riichi.wiki
 *  link, and — on a device that actually supports hover — hovering it shows the same short
 *  explanation right away, without the tap. `children` lets the caller keep the surrounding
 *  sentence's own wording (e.g. a lowercase "ukeire" mid-sentence) while still keying off one
 *  glossary entry. Pass `iconOnly` on a label that already spells the term out (e.g. "Show
 *  shanten") — otherwise the term's own name renders a second time next to it. */
export function GlossaryTerm({
  id,
  children,
  iconOnly,
}: {
  id: GlossaryTermId
  children?: ReactNode
  iconOnly?: boolean
}) {
  const { t } = useTranslation()
  const entry = GLOSSARY[id]
  const glossaryOnClick = useSettings((s) => s.glossaryOnClick)
  return (
    // relative/group anchor the hover card below to this term specifically, not the sentence
    // around it; inline-flex keeps it sized to the trigger rather than stretching to a full line
    <span className="group relative inline-flex">
      <InfoPopover
        triggerLabel={t('glossary.ariaLabel', { term: t(entry.labelKey) })}
        trigger={
          iconOnly ? (
            <HelpCircle className="size-3.5 shrink-0 text-neutral-400" />
          ) : (
            <span className="inline-flex items-center gap-0.5 underline decoration-dotted decoration-neutral-400 underline-offset-2">
              {children ?? t(entry.labelKey)}
              <HelpCircle className="size-3 shrink-0 text-neutral-400" />
            </span>
          )
        }
        // -m-1/p-1 grows the tap target past the visible underline without disturbing inline text
        // flow or the surrounding sentence's line-height
        triggerClassName="-m-1 inline-flex items-center rounded p-1 align-baseline"
        dialogTitle={t(entry.labelKey)}
        text={t(entry.descKey)}
        wikiUrl={entry.wikiUrl}
      />
      {!glossaryOnClick && (
        // group-hover/group-focus-within only, deliberately no click handling of its own — the
        // button above already opens the full popover (wiki link included) on tap or click.
        // Tailwind's hover:/group-hover: already compile to `@media (hover: hover)`, so this
        // never shows on a touch device regardless of the setting
        <div
          role="tooltip"
          className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-2 w-64 max-w-[80vw] -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-3 text-left text-sm whitespace-normal text-neutral-600 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
        >
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">
            {t(entry.labelKey)}
          </p>
          <p className="mt-1">{t(entry.descKey)}</p>
        </div>
      )}
    </span>
  )
}
