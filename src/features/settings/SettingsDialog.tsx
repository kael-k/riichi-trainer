import { Moon, Settings, Sun, SunMoon, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { ChromeLabel, CHROME_BUTTON } from '../../components/TrainerControls'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { resolveLocale } from '../i18n'
import {
  DEFAULT_TILE_SCALE,
  LOCALES,
  SIZABLE_QUERY,
  TILE_SCALES,
  useSettings,
  type Locale,
  type Theme,
} from './settingsStore'
import { resolveTableSettings, type TableApp, type TableSettings } from './tableSettings'
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

/** Presentation settings shared by every trainer (and available on the home screen): theme, tile
 *  size, language, tile numbers. Persisted in the top-level settings store, not a section. Rules
 *  of the game (number of players, red fives, kiriage mangan) live in `RulesetSettings` instead —
 *  this section is about how the interface looks, not how a hand is played or scored. */
export function UiSettings() {
  const { t } = useTranslation()
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const tileScale = useSettings((s) => s.tileScale) ?? DEFAULT_TILE_SCALE
  const setTileScale = useSettings((s) => s.setTileScale)
  const locale = useSettings((s) => s.locale)
  const setLocale = useSettings((s) => s.setLocale)
  const showTileNumbers = useShowTileNumbers()
  const setShowTileNumbers = useSettings((s) => s.setShowTileNumbers)
  const translatedTerms = useSettings((s) => s.translatedTerms)
  const setTranslatedTerms = useSettings((s) => s.setTranslatedTerms)
  const glossaryOnClick = useSettings((s) => s.glossaryOnClick)
  const setGlossaryOnClick = useSettings((s) => s.setGlossaryOnClick)
  // the size setting is a tablet/desktop control: below that the board fills its room whatever it
  // says (a smaller square pulls the side seats' hands off the screen edge) and the hand is capped
  // to the width under the board, so every step but the default is a lie. Shown and disabled
  // rather than hidden — a row that vanishes reads as a missing feature
  const sizable = useMediaQuery(SIZABLE_QUERY)

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t('settings.ui')}
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
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            {TILE_SCALES.map((scale) => (
              <SegmentedButton
                key={scale}
                // the size actually in force, which below `sizable:` is the default whatever is
                // stored — the buttons must not claim a size the screen is not drawing
                active={(sizable ? tileScale : DEFAULT_TILE_SCALE) === scale}
                disabled={!sizable}
                onClick={() => setTileScale(scale)}
              >
                {TILE_SCALE_LABELS[scale]}
              </SegmentedButton>
            ))}
          </div>
          {!sizable && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {t('settings.tileSizeUnavailable')}
            </span>
          )}
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
    </div>
  )
}

/** Rules of the game, shared by every trainer: how many players, whether hands round up to
 *  kiriage mangan, whether random walls seed a red five per suit. Red fives stay behind the
 *  Advanced gate (`useAdvancedSettings`) — a hidden row must not mean a live value, so its default
 *  (on) still applies whenever Advanced is off. */
export function RulesetSettings() {
  const { t } = useTranslation()
  const sanma = useSettings((s) => s.sanma)
  const setSanma = useSettings((s) => s.setSanma)
  const kiriageMangan = useSettings((s) => s.kiriageMangan)
  const setKiriageMangan = useSettings((s) => s.setKiriageMangan)
  const aka = useSettings((s) => s.aka)
  const setAka = useSettings((s) => s.setAka)
  const advanced = useSettings((s) => s.advanced)

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t('settings.ruleset')}
      </h3>
      <SettingRow label={t('settings.numberOfPlayers')}>
        <div className="flex gap-1">
          <SegmentedButton active={!sanma} onClick={() => setSanma(false)}>
            {t('settings.yonma')}
          </SegmentedButton>
          <SegmentedButton active={sanma} onClick={() => setSanma(true)}>
            {t('settings.sanma')}
          </SegmentedButton>
        </div>
      </SettingRow>
      <SettingRow label={t('settings.kiriageMangan')}>
        <input
          type="checkbox"
          checked={kiriageMangan}
          onChange={(e) => setKiriageMangan(e.target.checked)}
          className="size-5"
        />
      </SettingRow>
      {advanced && (
        <SettingRow label={t('settings.redFives')}>
          <input
            type="checkbox"
            checked={aka}
            onChange={(e) => setAka(e.target.checked)}
            className="size-5"
          />
        </SettingRow>
      )}
    </div>
  )
}

/** The one row this phase has: whether Advanced features (jargon-gated rows across every other
 *  section) are surfaced at all (ADR-0018). Its own section rather than living at the bottom of
 *  UI — flipping it changes what other sections show, so it reads oddly nested inside one of them. */
export function MiscSettings() {
  const { t } = useTranslation()
  const advanced = useSettings((s) => s.advanced)
  const setAdvanced = useSettings((s) => s.setAdvanced)

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t('settings.misc')}
      </h3>
      <SettingRow label={t('settings.advanced')}>
        <input
          type="checkbox"
          checked={advanced}
          onChange={(e) => setAdvanced(e.target.checked)}
          className="size-5"
        />
      </SettingRow>
    </div>
  )
}

/** The board-rendering settings shared by every trainer that draws a `Table` (efficiency, scoring,
 *  folding, the lab): whether opponent hands, seat waits and tsumogiri/tedashi marks are shown.
 *  Its own section, separate from Ruleset/UI — these are about what the board shows, not the app
 *  as a whole. Edits the *global* layer of `table` (`tableSettings.ts`, ADR-0015); the per-app
 *  override layer has no UI this phase (absent key means inherit — a three-state control is not
 *  needed). Resolved against the caller's own `app` id, so a per-app override (folding's
 *  `opponentWins`, say) is never misattributed to a trainer that never set it. Omitted entirely by
 *  `SettingsButton` when no `app` is given (home, shanten): those trainers draw no `Table` at all. */
export function BoardSettings({ app }: { app: TableApp }) {
  const { t } = useTranslation()
  const table = useSettings((s) => s.table)
  const update = useSettings((s) => s.update)
  const showTsumogiri = useSettings((s) => s.showTsumogiri)
  const setShowTsumogiri = useSettings((s) => s.setShowTsumogiri)
  const advanced = useSettings((s) => s.advanced)
  const { showOpponentHands, showSeatWaits } = resolveTableSettings(app, table)
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
      <SettingRow label={t('settings.showSeatWaits')}>
        <input
          type="checkbox"
          checked={showSeatWaits}
          onChange={(e) => updateGlobal({ showSeatWaits: e.target.checked })}
          className="size-5"
        />
      </SettingRow>
      {advanced && (
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
      )}
    </div>
  )
}

interface SettingsButtonProps {
  /** Trainer name, already translated (e.g. "Efficiency trainer"); heads the app-specific section
   *  when `children` is given. Omitted on the home screen, where there is no such section. */
  title?: string
  /** App-specific rows, shown under their own section headed `title`. */
  children?: ReactNode
  /** The trainer's table-settings id (`tableSettings.ts`), if it draws a `Table` — gates the Table
   *  section and resolves which app's override layer it reads/writes. Omitted by trainers with no
   *  board (home, shanten) or no settings surface for it yet (efficiency-solo). */
  app?: TableApp
  /** Show the button's name beside its icon where there is room (`ChromeLabel`). The stage's
   *  chrome row asks for it, since a row of bare icons needs telling apart; the home page's lone
   *  gear does not. */
  labelled?: boolean
}

/** Gear button + dialog: an app-specific section (if any), then Table (if the app draws one), then
 *  Ruleset, UI and Misc — the one settings surface shared by every screen, including home. The
 *  dialog's own title never changes ("Settings"); the section headings say what a setting is
 *  about, not the dialog. */
export function SettingsButton({ title, children, app, labelled }: SettingsButtonProps) {
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
        className={CHROME_BUTTON}
      >
        <Settings className="size-5" />
        {labelled && <ChromeLabel>{t('settings.button')}</ChromeLabel>}
      </button>
      {/* portalled to <body>: the trainer header this button sits in uses backdrop-blur, which
          on WebKit becomes the containing block for anything fixed inside it */}
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.button')}
            onClick={(e) => {
              // only an "outside" click, i.e. one that landed on the scrim itself
              if (e.target === e.currentTarget) setOpen(false)
            }}
            // `ultrawide:` padding, not a cap on the scrim itself: the scrim stays full-bleed (a
            // click anywhere outside the sheet still closes it), but the sheet it justifies against
            // lands on the capped stage's right edge (`--stage-max`, `BoardStage`) instead of the
            // screen's — this dialog is portalled to <body>, so it cannot see the stage's own cap
            // and has to be pushed in by hand off the same variable.
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 md:items-stretch md:justify-end md:p-0 ultrawide:pr-[max(0px,calc((100vw-var(--stage-max))/2))]"
          >
            <div className="flex max-h-full w-[min(90vw,24rem)] flex-col overflow-hidden rounded-xl bg-white text-neutral-900 md:h-full md:w-96 md:max-w-[90vw] md:rounded-none md:rounded-l-2xl dark:bg-neutral-900 dark:text-neutral-100">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <h2 className="font-semibold">{t('settings.button')}</h2>
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
                {children && (
                  <>
                    <div className="flex flex-col gap-4">
                      <h3 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
                        {title}
                      </h3>
                      {children}
                    </div>
                    <hr className="border-neutral-200 dark:border-neutral-800" />
                  </>
                )}
                {app && (
                  <>
                    <BoardSettings app={app} />
                    <hr className="border-neutral-200 dark:border-neutral-800" />
                  </>
                )}
                <RulesetSettings />
                <hr className="border-neutral-200 dark:border-neutral-800" />
                <UiSettings />
                <hr className="border-neutral-200 dark:border-neutral-800" />
                <MiscSettings />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
