import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SettingRow, TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay } from '../../components/tiles/Tile'
import { useSettings } from '../settings/settingsStore'
import { decodeSituation } from '../situation/urlCodec'
import { RevealTimer } from './RevealTimer'
import { useShantenRound, type ShantenBreakdown } from './useShantenRound'

const QUICK_GUESSES = [0, 1, 2, 3, 4, 5, 6]

function pathsLabel(breakdown: ShantenBreakdown): string | null {
  if (breakdown.paths.length === 1 && breakdown.paths[0] === 'standard') return null
  return `via ${breakdown.paths.join(' / ')}`
}

export function ShantenPage() {
  const [params] = useSearchParams()
  const situation = useMemo(() => decodeSituation(params), [params])
  const settings = useSettings((s) => s.shanten)
  const update = useSettings((s) => s.update)
  const showTileNumbers = useSettings((s) => s.showTileNumbers)
  const setShowTileNumbers = useSettings((s) => s.setShowTileNumbers)
  const [guessInput, setGuessInput] = useState('')

  const round = useShantenRound(situation, settings.timerEnabled)

  useEffect(() => setGuessInput(''), [round.hand])

  // Space toggles reveal/pause — the number input auto-focuses on reveal, so typing a
  // digit + Enter already submits without any extra wiring
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      e.preventDefault()
      if (round.running) round.pause()
      else round.reveal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.running, round.pause, round.reveal])

  const submitGuess = (value: number) => {
    if (Number.isNaN(value) || value < 0) return
    round.submit(value)
  }

  return (
    <TrainerLayout
      title="Shanten trainer"
      settings={
        <>
          <SettingRow label="Timer">
            <input
              type="checkbox"
              checked={settings.timerEnabled}
              onChange={(e) => update('shanten', { timerEnabled: e.target.checked })}
              className="size-5"
            />
          </SettingRow>
          <SettingRow label="Numbers on tiles">
            <input
              type="checkbox"
              checked={showTileNumbers}
              onChange={(e) => setShowTileNumbers(e.target.checked)}
              className="size-5"
            />
          </SettingRow>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>Hand {round.totalCount + 1}</span>
          <span>
            Correct: {round.correctCount} / {round.totalCount}
          </span>
        </div>

        <RevealTimer
          running={round.running}
          elapsed={round.elapsed}
          timerEnabled={settings.timerEnabled}
          onPlay={round.reveal}
          onPause={round.pause}
        />

        <HandDisplay tiles={round.hand} concealed={round.concealed} />

        {!round.concealed && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitGuess(Number(guessInput))
            }}
            className="flex flex-col gap-2"
          >
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                autoFocus
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                placeholder="shanten?"
                className="min-h-11 w-24 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                Submit
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_GUESSES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => submitGuess(n)}
                  className="min-h-11 min-w-11 rounded-lg border border-neutral-300 font-medium dark:border-neutral-700"
                >
                  {n}
                </button>
              ))}
            </div>
          </form>
        )}

        {round.lastResult && (
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <p
              className={`flex items-center gap-1.5 font-semibold ${round.lastResult.correct ? 'text-green-600 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}
            >
              {round.lastResult.correct ? (
                <>
                  <CheckCircle2 className="size-4" /> Correct
                </>
              ) : (
                <>
                  <XCircle className="size-4" /> You said {round.lastResult.guess}
                </>
              )}
            </p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Previous hand — actual shanten: {round.lastResult.actual.value}
              {pathsLabel(round.lastResult.actual) && ` (${pathsLabel(round.lastResult.actual)})`}
            </p>
            <div className="[--tile-w:calc(var(--tile-w-base)*0.55)]">
              <HandDisplay tiles={round.lastResult.hand} />
            </div>
          </div>
        )}
      </div>
    </TrainerLayout>
  )
}
