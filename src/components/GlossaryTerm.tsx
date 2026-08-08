import { HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GLOSSARY, type GlossaryTermId } from '../features/i18n/glossary'
import { InfoPopover } from './InfoPopover'

/** Marks a piece of mahjong jargon inline; tapping it opens a short explanation + riichi.wiki
 *  link. `children` lets the caller keep the surrounding sentence's own wording (e.g. a
 *  lowercase "ukeire" mid-sentence) while still keying off one glossary entry. Pass `iconOnly`
 *  on a label that already spells the term out (e.g. "Show shanten") — otherwise the term's own
 *  name renders a second time next to it. */
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
  return (
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
  )
}
