import { Moon, Settings, Sun, SunMoon, X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LOCALES, TILE_SCALES, useSettings, type Locale, type Theme } from './settingsStore'

/** Labeled toggle row for settings dialogs. */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-4">
      <span>{label}</span>
      {children}
    </label>
  )
}

function SegmentedButton({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-medium ${
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

const TILE_SCALE_LABELS: Record<number, string> = { 0.8: 'S', 1: 'M', 1.25: 'L', 1.5: 'XL' }

// language names are shown in themselves, not translated — the standard convention for a picker
const LANGUAGE_NAMES: Record<(typeof LOCALES)[number], string> = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
  it: 'Italiano',
}

/** Settings shared by every trainer (and available on the home screen): theme, tile size,
 *  ruleset, language, tile numbers. Persisted in the top-level settings store, not a section. */
export function GlobalSettings() {
  const { t } = useTranslation()
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const tileScale = useSettings((s) => s.tileScale)
  const setTileScale = useSettings((s) => s.setTileScale)
  const sanma = useSettings((s) => s.sanma)
  const setSanma = useSettings((s) => s.setSanma)
  const locale = useSettings((s) => s.locale)
  const setLocale = useSettings((s) => s.setLocale)
  const showTileNumbers = useSettings((s) => s.showTileNumbers)
  const setShowTileNumbers = useSettings((s) => s.setShowTileNumbers)

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
          <option value="auto">{t('settings.languageAuto')}</option>
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('settings.numbersOnTiles')}>
        <input
          type="checkbox"
          checked={showTileNumbers}
          onChange={(e) => setShowTileNumbers(e.target.checked)}
          className="size-5"
        />
      </SettingRow>
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
  const dialogRef = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        type="button"
        aria-label={t('settings.button')}
        onClick={() => dialogRef.current?.showModal()}
        className="flex size-11 items-center justify-center"
      >
        <Settings className="size-5" />
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(90vw,24rem)] rounded-xl p-0 backdrop:bg-black/40 md:fixed md:inset-y-0 md:right-0 md:left-auto md:m-0 md:h-svh md:w-96 md:max-w-[90vw] md:rounded-none md:rounded-l-2xl dark:bg-neutral-900 dark:text-neutral-100"
      >
        <form method="dialog" className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h2 className="font-semibold">
              {title ? t('settings.title', { title }) : t('settings.titleFallback')}
            </h2>
            <button
              className="flex size-11 items-center justify-center"
              aria-label={t('common.close')}
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto p-4">
            {children}
            {children && <hr className="border-neutral-200 dark:border-neutral-800" />}
            <GlobalSettings />
          </div>
        </form>
      </dialog>
    </>
  )
}
