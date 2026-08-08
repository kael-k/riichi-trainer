import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { InfoButton } from '../components/TrainerLayout'
import { Tile } from '../components/tiles/Tile'
import { parseTenhou } from '../core/tiles'
import { TRAINER_WIKI } from '../features/i18n/trainerLinks'
import { SettingsButton } from '../features/settings/SettingsDialog'

const REPO_URL = 'https://github.com/kael-k/riichi-trainer'

const MODES = [
  {
    to: '/efficiency',
    titleKey: 'trainer.efficiency.title',
    descKey: 'trainer.efficiency.desc',
    introKey: 'trainer.efficiency.intro',
    wikiUrl: TRAINER_WIKI.efficiency,
  },
  {
    to: '/shanten',
    titleKey: 'trainer.shanten.title',
    descKey: 'trainer.shanten.desc',
    introKey: 'trainer.shanten.intro',
    wikiUrl: TRAINER_WIKI.shanten,
  },
  {
    to: '/scoring',
    titleKey: 'trainer.scoring.title',
    descKey: 'trainer.scoring.desc',
    introKey: 'trainer.scoring.intro',
    wikiUrl: TRAINER_WIKI.scoring,
  },
  {
    to: '/folding',
    titleKey: 'trainer.folding.title',
    descKey: 'trainer.folding.desc',
    introKey: 'trainer.folding.intro',
    wikiUrl: TRAINER_WIKI.folding,
  },
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
          <div
            key={mode.to}
            className="relative flex items-center rounded-xl border border-neutral-200 transition-colors hover:border-neutral-400 has-[a:active]:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:has-[a:active]:bg-neutral-900"
          >
            {/* stretched over the whole card so the card is one tap target; title/desc sit
                visually on top (pointer-events-none lets clicks fall through to it), and the
                info button is a real flex sibling, not nested inside this anchor, so it's an
                independent tap target that flexbox centers against the text block's height */}
            <Link to={mode.to} className="absolute inset-0 rounded-xl" aria-label={t(mode.titleKey)} />
            <div className="pointer-events-none min-w-0 flex-1 p-4">
              <div className="font-semibold">{t(mode.titleKey)}</div>
              <div className="text-sm text-neutral-500">{t(mode.descKey)}</div>
            </div>
            <div className="relative pr-2">
              <InfoButton
                title={t(mode.titleKey)}
                intro={{ text: t(mode.introKey), wikiUrl: mode.wikiUrl }}
              />
            </div>
          </div>
        ))}
      </nav>
      <footer className="mt-auto flex flex-col items-center gap-1 text-center text-xs text-neutral-400">
        <p>
          {t('home.license')}{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-200"
          >
            {t('home.sourceLink')}
          </a>
        </p>
        <p className="font-mono break-all">{t('home.buildCommit', { sha: __COMMIT_SHA__ })}</p>
      </footer>
    </div>
  )
}
