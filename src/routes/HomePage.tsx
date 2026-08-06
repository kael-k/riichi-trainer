import { Link } from 'react-router'
import { ThemeToggle } from '../components/ThemeToggle'
import { Tile } from '../components/tiles/Tile'
import { parseTenhou } from '../core/tiles'

const MODES = [
  {
    to: '/efficiency',
    title: 'Efficiency trainer',
    desc: 'Pick the best discard; see the tiles that improve your hand.',
  },
  {
    to: '/shanten',
    title: 'Shanten trainer',
    desc: 'Guess how far a hand is from tenpai, against the clock.',
  },
]

export function HomePage() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-4">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <header className="flex flex-col items-center gap-3">
        <div className="flex [--tile-w:calc(var(--tile-w-base)*0.7)]">
          {parseTenhou('19m19p19s1234567z').map((t, i) => (
            <Tile key={i} id={t.id} />
          ))}
        </div>
        <h1 className="text-2xl font-bold">Riichi Trainer</h1>
      </header>
      <nav className="flex flex-col gap-3">
        {MODES.map((mode) => (
          <Link
            key={mode.to}
            to={mode.to}
            className="rounded-xl border border-neutral-200 p-4 transition-colors hover:border-neutral-400 active:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:active:bg-neutral-900"
          >
            <div className="font-semibold">{mode.title}</div>
            <div className="text-sm text-neutral-500">{mode.desc}</div>
          </Link>
        ))}
        <div className="rounded-xl border border-dashed border-neutral-200 p-4 opacity-60 dark:border-neutral-800">
          <div className="font-semibold">Scoring trainer</div>
          <div className="text-sm text-neutral-500">Han/fu scoring drills — coming later.</div>
        </div>
      </nav>
      <p className="mt-auto text-center text-xs text-neutral-400">
        release version: {__COMMIT_SHA__}
      </p>
    </div>
  )
}
