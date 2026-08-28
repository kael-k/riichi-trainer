import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Alpha } from '../components/Alpha'
import { IOSInstallHint } from '../components/IOSInstallHint'
import { InfoButton } from '../components/tiles/BoardStage'
import { Tile } from '../components/tiles/Tile'
import { parseTenhou } from '../core/tiles'
import { TRAINER_WIKI } from '../features/i18n/trainerLinks'
import { SettingsButton } from '../features/settings/SettingsDialog'

const REPO_URL = 'https://github.com/kael-k/riichi-trainer'

/** The route is the only thing that decides which drill a card opens (ADR-0013) — order here is
 *  purely a home-page display choice, not a hidden setting. */
const MODES = [
  {
    to: '/efficiency-solo',
    titleKey: 'trainer.efficiencySolo.title',
    descKey: 'trainer.efficiencySolo.desc',
    introKey: 'trainer.efficiencySolo.intro',
    wikiUrl: TRAINER_WIKI.efficiencySolo,
  },
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
    to: '/match',
    titleKey: 'trainer.match.title',
    descKey: 'trainer.match.desc',
    introKey: 'trainer.match.intro',
    wikiUrl: TRAINER_WIKI.match,
    // alpha: the newest trainer, still missing dealer agari-yame/tenpai-yame and nagashi mangan
    // (docs/STATUS.md item 22) — a full hanchan can be played, but not every rule of one yet
    alpha: true,
  },
  // Lab is under development, disabled for now — see README.
  // {
  //   to: '/lab',
  //   titleKey: 'trainer.lab.title',
  //   descKey: 'trainer.lab.desc',
  //   introKey: 'trainer.lab.intro',
  //   wikiUrl: TRAINER_WIKI.lab,
  // },
] as const

type Mode = (typeof MODES)[number]

/** One home-page card: a stretched tap target over the whole row (title/desc sit visually on top,
 *  `pointer-events-none` lets clicks fall through to it) plus an independent info-button tap
 *  target as a real flex sibling, not nested inside the anchor. */
function ModeCard({ mode }: { mode: Mode }) {
  const { t } = useTranslation()
  return (
    <div className="relative flex items-center rounded-xl border border-neutral-200 transition-colors hover:border-neutral-400 has-[a:active]:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:has-[a:active]:bg-neutral-900">
      <Link to={mode.to} className="absolute inset-0 rounded-xl" aria-label={t(mode.titleKey)} />
      <div className="pointer-events-none min-w-0 flex-1 p-4">
        <div className="flex items-center gap-1.5 font-semibold">
          {t(mode.titleKey)}
          {'alpha' in mode && mode.alpha && <Alpha />}
        </div>
        <div className="text-sm text-neutral-500">{t(mode.descKey)}</div>
      </div>
      <div className="relative pr-2">
        <InfoButton
          title={t(mode.titleKey)}
          intro={{
            text:
              'alpha' in mode && mode.alpha
                ? `${t(mode.introKey)}\n\n${t('common.alphaNote')}`
                : t(mode.introKey),
            wikiUrl: mode.wikiUrl,
          }}
        />
      </div>
    </div>
  )
}

export function HomePage() {
  const { t } = useTranslation()
  // the same box `BoardStage` puts round a trainer, for the same reason: the settings sheet mounts
  // inside it, so on a 21:9 screen it docks to where the app stops rather than to the monitor's
  // own right edge, a menu's width away from the gear that opened it. One cap for both, so the app
  // box does not change size between the home screen and a trainer.
  const [stage, setStage] = useState<HTMLElement | null>(null)
  return (
    <div className="flex h-svh w-full justify-center ultrawide:bg-neutral-100 ultrawide:dark:bg-black">
      <div
        ref={setStage}
        // `h-svh` + `overflow-hidden` so the scrim portalled in here is a viewport, not a page:
        // the menu scrolls in the column below instead of the box growing under it, which would
        // stretch a full-height sheet past the bottom of the screen
        className="relative flex h-svh w-full flex-col overflow-hidden bg-white ultrawide:max-w-[var(--stage-max)] dark:bg-neutral-950"
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-4">
            <IOSInstallHint />
            <div className="flex justify-end">
              <SettingsButton container={stage} />
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
                <ModeCard key={mode.to} mode={mode} />
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
              {/* the short sha is what shows, the whole one is the `title` (and what
                `vite.config.ts` deliberately keeps): a bug report needs the exact build, but
                forty hex characters wrap mid-hash on a phone and read as line noise. Seven is
                what every git UI shows and is unambiguous in practice */}
              <p className="font-mono" title={__COMMIT_SHA__}>
                {t('home.buildCommit', { sha: __COMMIT_SHA__.slice(0, 7) })}
              </p>
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}
