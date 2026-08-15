import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { IOSInstallHint } from '../components/IOSInstallHint'
import { InfoButton } from '../components/TrainerLayout'
import { Tile } from '../components/tiles/Tile'
import { parseTenhou } from '../core/tiles'
import { TRAINER_WIKI } from '../features/i18n/trainerLinks'
import { SettingsButton } from '../features/settings/SettingsDialog'

const REPO_URL = 'https://github.com/kael-k/riichi-trainer'

/** Solitaire: one seat, no board — a phone-sized drill. Table: a full board with real seats.
 *  The route is the only thing that decides which drill a card opens (ADR-0013) — the section a card
 *  sits under is purely a home-page grouping, not a hidden setting. */
const SOLITAIRE_MODES = [
  {
    to: '/efficiency-solo',
    titleKey: 'trainer.efficiencySolo.title',
    descKey: 'trainer.efficiencySolo.desc',
    introKey: 'trainer.efficiencySolo.intro',
    wikiUrl: TRAINER_WIKI.efficiencySolo,
  },
  {
    to: '/shanten',
    titleKey: 'trainer.shanten.title',
    descKey: 'trainer.shanten.desc',
    introKey: 'trainer.shanten.intro',
    wikiUrl: TRAINER_WIKI.shanten,
  },
] as const

const TABLE_MODES = [
  {
    to: '/efficiency',
    titleKey: 'trainer.efficiency.title',
    descKey: 'trainer.efficiency.desc',
    introKey: 'trainer.efficiency.intro',
    wikiUrl: TRAINER_WIKI.efficiency,
  },
  {
    to: '/folding',
    titleKey: 'trainer.folding.title',
    descKey: 'trainer.folding.desc',
    introKey: 'trainer.folding.intro',
    wikiUrl: TRAINER_WIKI.folding,
  },
  {
    to: '/scoring',
    titleKey: 'trainer.scoring.title',
    descKey: 'trainer.scoring.desc',
    introKey: 'trainer.scoring.intro',
    wikiUrl: TRAINER_WIKI.scoring,
  },
  {
    to: '/lab',
    titleKey: 'trainer.lab.title',
    descKey: 'trainer.lab.desc',
    introKey: 'trainer.lab.intro',
    wikiUrl: TRAINER_WIKI.lab,
  },
] as const

type Mode = (typeof SOLITAIRE_MODES)[number] | (typeof TABLE_MODES)[number]

/** One home-page card: a stretched tap target over the whole row (title/desc sit visually on top,
 *  `pointer-events-none` lets clicks fall through to it) plus an independent info-button tap
 *  target as a real flex sibling, not nested inside the anchor. */
function ModeCard({ mode }: { mode: Mode }) {
  const { t } = useTranslation()
  return (
    <div className="relative flex items-center rounded-xl border border-neutral-200 transition-colors hover:border-neutral-400 has-[a:active]:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:has-[a:active]:bg-neutral-900">
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
  )
}

export function HomePage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-4">
      <IOSInstallHint />
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
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-neutral-500">{t('home.section.solitaire')}</span>
        <nav className="flex flex-col gap-3">
          {SOLITAIRE_MODES.map((mode) => (
            <ModeCard key={mode.to} mode={mode} />
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-neutral-500">{t('home.section.table')}</span>
        <nav className="flex flex-col gap-3">
          {TABLE_MODES.map((mode) => (
            <ModeCard key={mode.to} mode={mode} />
          ))}
        </nav>
      </div>
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
