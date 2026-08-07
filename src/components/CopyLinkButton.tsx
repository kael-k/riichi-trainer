import { Check, Link as LinkIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Copies the drill on screen as a shareable link. `query` runs on click, so the link always
 *  reflects the round as it stands right then. */
export function CopyLinkButton({ query }: { query: () => string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const q = query()
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}${q ? `?${q}` : ''}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
    >
      {copied ? <Check className="size-4" /> : <LinkIcon className="size-4" />}
      {copied ? t('common.copied') : t('common.copySituationLink')}
    </button>
  )
}
