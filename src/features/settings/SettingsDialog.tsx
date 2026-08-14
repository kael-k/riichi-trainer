import { Moon, Settings, Sun, SunMoon, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { resolveLocale } from '../i18n'
import {
  DEFAULT_TILE_SCALE,
  LOCALES,
  TILE_SCALES,
  useSettings,
  type Locale,
  type Theme,
} from './settingsStore'
import { resolveTableSettings, type TableSettings } from './tableSettings'
import { useShowTileNumbers } from './useShowTileNumbers'

/** Labeled toggle row for settings dialogs. `label` takes a GlossaryTerm alongside its text on
 *  rows that name jargon (e.g. tedashi/tsumogiri), so it's ReactNode rather than a plain string. */
export function SettingRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-4">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** One button of a mutually-exclusive row. Exported for the seat panel (`SeatPanel.tsx`), which
 *  is a settings surface of its own but must not grow a second look for the same control. */
export function SegmentedButton({
  active,
  onClick,
  children,
  label,
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-medium disabled:opacity-40 ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-neutral-300 dark:border-neutral-700'
      }`}
    >
      {children}
    </button>
  )
}

const THEMES: { value: Theme; icon: typeof SunMoon; labelKey: string }[] = [
  { value: 'system', icon: SunMoon, labelKey: 'settings.themeSystem' },
  { value: 'light', icon: Sun, labelKey: 'settings.themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'settings.themeDark' },
]

const TILE_SCALE_LABELS: Record<number, string> = { 1: 'S', 1.25: 'M', 1.5: 'L', 1.8: 'XL' }

// language names are shown in themselves, not translated — the standard convention for a picker
const LANGUAGE_NAMES: Record<(typeof LOCALES)[number], string> = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
  it: 'Italiano',
}

// GB rather than US for English — the flag names a language here, not a country, and there is no
// neutral "English" flag to reach for instead
const LANGUAGE_FLAGS: Record<(typeof LOCALES)[number], string> = {
  en: '🇬🇧',
  ja: '🇯🇵',
  zh: '🇨🇳',
  it: '🇮🇹',
}

/** Settings shared by every trainer (and available on the home screen): theme, tile size,
 *  ruleset, language, tile numbers. Persisted in the top-level settings store, not a section. */
export function GlobalSettings() {
  const { t } = useTranslation()
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const tileScale = useSettings((s) => s.tileScale) ?? DEFAULT_TILE_SCALE
  const setTileScale = useSettings((s) => s.setTileScale)
  const sanma = useSettings((s) => s.sanma)
  const setSanma = useSettings((s) => s.setSanma)
  const locale = useSettings((s) => s.locale)
  const setLocale = useSettings((s) => s.setLocale)
  const showTileNumbers = useShowTileNumbers()
  const setShowTileNumbers = useSettings((s) => s.setShowTileNumbers)
  const translatedTerms = useSettings((s) => s.translatedTerms)
  const setTranslatedTerms = useSettings((s) => s.setTranslatedTerms)
  const showTsumogiri = useSettings((s) => s.showTsumogiri)
  const setShowTsumogiri = useSettings((s) => s.setShowTsumogiri)
  const aka = useSettings((s) => s.aka)
  const setAka = useSettings((s) => s.setAka)
  const advanced = useSettings((s) => s.advanced)
  const setAdvanced = useSettings((s) => s.setAdvanced)
  const glossaryOnClick = useSettings((s) => s.glossaryOnClick)
  const setGlossaryOnClick = useSettings((s) => s.setGlossaryOnClick)

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t('settings.global')}
      </h3>
      <SettingRow label={t('settings.theme')}>
        <div className="flex gap-1">
          {THEMES.map(({ value, icon: Icon, labelKey }) => (
            <SegmentedButton
              key={value}
              active={theme === value}
              onClick={() => setTheme(value)}
              label={t(labelKey)}
            >
              <Icon className="size-4" />
            </SegmentedButton>
          ))}
        </div>
      </SettingRow>
      <SettingRow label={t('settings.tileSize')}>
        <div className="flex gap-1">
          {TILE_SCALES.map((scale) => (
            <SegmentedButton
              key={scale}
              active={tileScale === scale}
              onClick={() => setTileScale(scale)}
            >
              {TILE_SCALE_LABELS[scale]}
            </SegmentedButton>
          ))}
        </div>
      </SettingRow>
      <SettingRow label={t('settings.ruleset')}>
        <div className="flex gap-1">
          <SegmentedButton active={!sanma} onClick={() => setSanma(false)}>
            {t('settings.yonma')}
          </SegmentedButton>
          <SegmentedButton active={sanma} onClick={() => setSanma(true)}>
            {t('settings.sanma')}
          </SegmentedButton>
        </div>
      </SettingRow>
      <SettingRow label={t('settings.language')}>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-2 text-neutral-900 [color-scheme:light] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark]"
        >
          {/* "Auto" carries the flag of whichever language it actually resolves to, so the row
              reads as a real choice rather than a blank one */}
          <option value="auto">
            {LANGUAGE_FLAGS[resolveLocale('auto')]} {t('settings.languageAuto')}
          </option>
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_FLAGS[code]} {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
      </SettingRow>
      {/* ja/zh already read these terms as their own words, so there is nothing to translate */}
      {resolveLocale(locale) !== 'ja' && resolveLocale(locale) !== 'zh' && (
        <SettingRow label={t('settings.translatedTerms')}>
          <input
            type="checkbox"
            checked={translatedTerms}
            onChange={(e) => setTranslatedTerms(e.target.checked)}
            className="size-5"
          />
        </SettingRow>
      )}
      <SettingRow label={t('settings.numbersOnTiles')}>
        <input
          type="checkbox"
          checked={showTileNumbers}
          onChange={(e) => setShowTileNumbers(e.target.checked)}
          className="size-5"
        />
      </SettingRow>
      <SettingRow label={t('settings.glossaryOnClick')}>
        <input
          type="checkbox"
          checked={glossaryOnClick}
          onChange={(e) => setGlossaryOnClick(e.target.checked)}
          className="size-5"
        />
      </SettingRow>
      <SettingRow label={t('settings.advanced')}>
        <input
          type="checkbox"
          checked={advanced}
          onChange={(e) => setAdvanced(e.target.checked)}
          className="size-5"
        />
      </SettingRow>
      {advanced && (
        <>
          <SettingRow
            label={
              <>
                {t('settings.tsumogiriMarks')} <GlossaryTerm id="tsumogiri" iconOnly />
                {' / '}
                <GlossaryTerm id="tedashi" iconOnly />
              </>
            }
          >
            <input
              type="checkbox"
              checked={showTsumogiri}
              onChange={(e) => setShowTsumogiri(e.target.checked)}
              className="size-5"
            />
          </SettingRow>
          <SettingRow label={t('settings.redFives')}>
            <input
              type="checkbox"
              checked={aka}
              onChange={(e) => setAka(e.target.checked)}
              className="size-5"
            />
          </SettingRow>
        </>
      )}
    </div>
  )
}

/** The board-rendering settings shared by every trainer that draws a `Table` (efficiency, scoring,
 *  folding, the lab): whether opponent hands and the wall are shown. Its own section, separate
 *  from Global — these are about what the board shows, not the app as a whole. Edits the *global*
 *  layer of `table` (`tableSettings.ts`, D-13); the per-app override layer has no UI this phase
 *  (absent key means inherit — a three-state control is not needed). `'efficiency'` is an
 *  arbitrary representative app id: every field read here resolves off `global` alone, so which
 *  app id is passed only matters for a field that had a per-app override, and none does. */
export function BoardSettings() {
  const { t } = useTranslation()
  const advanced = useSettings((s) => s.advanced)
  const table = useSettings((s) => s.table)
  const update = useSettings((s) => s.update)
  const { showWall, showOpponentHands, hideConcealedHands } = resolveTableSettings(
    'efficiency',
    table,
  )
  // `update` only merges at the section level, so a patch of `{ global: {...} }` would otherwise
  // replace the whole global layer instead of adding one key to it — merge the existing layer in
  // first, same as every per-app write site does with its own `apps[app]` slice.
  const updateGlobal = (patch: Partial<TableSettings>) =>
    update('table', { global: { ...table.global, ...patch } })

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t('settings.table')}
      </h3>
      <SettingRow label={t('settings.showOpponentHands')}>
        <input
          type="checkbox"
          checked={showOpponentHands}
          onChange={(e) => updateGlobal({ showOpponentHands: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
      {/* moot once opponent hands are revealed outright */}
      {!showOpponentHands && (
        <SettingRow label={t('settings.hideConcealedHands')}>
          <input
            type="checkbox"
            checked={hideConcealedHands}
            onChange={(e) => updateGlobal({ hideConcealedHands: e.target.checked })}
            className="size-5"
          />
        </SettingRow>
      )}
      {/* stays behind the Advanced gate on GlobalSettings: a hidden row must not mean a live
          value, and the stored choice comes straight back once Advanced is re-enabled */}
      {advanced && (
        <SettingRow label={t('settings.showWall')}>
          <input
            type="checkbox"
            checked={showWall}
            onChange={(e) => updateGlobal({ showWall: e.target.checked })}
            className="size-5"
          />
        </SettingRow>
      )}
    </div>
  )
}

interface SettingsButtonProps {
  /** Trainer name, already translated (e.g. "Efficiency trainer"); omitted on the home screen. */
  title?: string
  /** App-specific rows shown above the Global section. */
  children?: ReactNode
}

/** Gear button + dialog with app-specific settings (if any) on top and Global settings
 *  underneath — the one settings surface shared by every screen, including home. */
export function SettingsButton({ title, children }: SettingsButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // the panel is a plain positioned overlay, not a <dialog>: iOS Safari kept losing it to
  // top-layer/sizing quirks (a modal dialog whose own height is auto collapses there, so the
  // backdrop dimmed over nothing), and nothing here actually needs the dialog element
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    // the page behind must not scroll while the panel is up
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
        aria-label={t('settings.button')}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex size-11 items-center justify-center"
      >
        <Settings className="size-5" />
      </button>
      {/* portalled to <body>: the trainer header this button sits in uses backdrop-blur, which
          on WebKit becomes the containing block for anything fixed inside it */}
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title ? t('settings.title', { title }) : t('settings.titleFallback')}
            onClick={(e) => {
              // only an "outside" click, i.e. one that landed on the scrim itself
              if (e.target === e.currentTarget) setOpen(false)
            }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 md:items-stretch md:justify-end md:p-0"
          >
            <div className="flex max-h-full w-[min(90vw,24rem)] flex-col overflow-hidden rounded-xl bg-white text-neutral-900 md:h-full md:w-96 md:max-w-[90vw] md:rounded-none md:rounded-l-2xl dark:bg-neutral-900 dark:text-neutral-100">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <h2 className="font-semibold">
                  {title ? t('settings.title', { title }) : t('settings.titleFallback')}
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
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {children}
                {children && <hr className="border-neutral-200 dark:border-neutral-800" />}
                <BoardSettings />
                <hr className="border-neutral-200 dark:border-neutral-800" />
                <GlobalSettings />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
