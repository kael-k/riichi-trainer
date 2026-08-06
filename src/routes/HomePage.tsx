import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Tile } from '../components/tiles/Tile'
import { parseTenhou } from '../core/tiles'
import { SettingsButton } from '../features/settings/SettingsDialog'

const MODES = [
  { to: '/efficiency', titleKey: 'trainer.efficiency.title', descKey: 'trainer.efficiency.desc' },
  { to: '/shanten', titleKey: 'trainer.shanten.title', descKey: 'trainer.shanten.desc' },
  { to: '/scoring', titleKey: 'trainer.scoring.title', descKey: 'trainer.scoring.desc' },
] as const

export function HomePage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-4">
      <div className="flex justify-end">
        <SettingsButton />
      </div>
      <header className="flex flex-col items-center gap-3">
        <div className="flex [--tile-w:calc(var(--tile-w-base)*0.7)]">
          {parseTenhou('19m19p19s1234567z').map((tile, i) => (
            <Tile key={i} id={tile.id} />
          ))}
        </div>
        <h1 className="text-2xl font-bold">{t('home.title')}</h1>
      </header>
      <nav className="flex flex-col gap-3">
        {MODES.map((mode) => (
          <Link
            key={mode.to}
            to={mode.to}
            className="rounded-xl border border-neutral-200 p-4 transition-colors hover:border-neutral-400 active:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:active:bg-neutral-900"
          >
            <div className="font-semibold">{t(mode.titleKey)}</div>
            <div className="text-sm text-neutral-500">{t(mode.descKey)}</div>
          </Link>
        ))}
      </nav>
      <p className="mt-auto text-center text-xs text-neutral-400">
        {t('home.releaseVersion', { sha: __COMMIT_SHA__ })}
      </p>
    </div>
  )
}
