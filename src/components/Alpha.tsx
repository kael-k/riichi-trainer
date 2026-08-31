import { useTranslation } from 'react-i18next'

/** A small "this is new and may still move" tag — three surfaces carry it today: `/match`, the two
 *  EV algorithm entries, and folding's EV grading option. One shared
 *  span rather than three copies, so a later change to how alpha reads changes in one place. */
export function Alpha() {
  const { t } = useTranslation()
  return (
    <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase dark:bg-amber-950 dark:text-amber-400">
      {t('common.alpha')}
    </span>
  )
}
