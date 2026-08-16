import type { TFunction } from 'i18next'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BoardStage } from '../../components/tiles/BoardStage'
import { useFullscreenBoard } from '../../components/tiles/useFullscreenBoard'
import {
  FullscreenToggle,
  TrainerStatusBar,
  TrainerToggles,
} from '../../components/TrainerControls'
import { TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay } from '../../components/tiles/Tile'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SettingRow, SettingsButton } from '../settings/SettingsDialog'
import { useSettings } from '../settings/settingsStore'
import { decodeSituation } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { Verdict } from '../table/Verdict'
import { useShantenRound, type RoundResult, type ShantenBreakdown } from './useShantenRound'

const QUICK_GUESSES = [0, 1, 2, 3, 4, 5, 6]

function pathsLabel(breakdown: ShantenBreakdown, t: TFunction): string | null {
  if (breakdown.paths.length === 1 && breakdown.paths[0] === 'standard') return null
  return t('shanten.via', { paths: breakdown.paths.map((p) => t(`shanten.path.${p}`)).join(' / ') })
}

/** The fullscreen overlay's one-line verdict — same shape as every other trainer's
 *  `noticeCompact` (`Verdict`): a label plus the actual shanten and, when it's not the plain
 *  standard decomposition, which path it came from. No guess/tile breakdown — that stays in the
 *  full `notice` the inline layout keeps and the log always has. */
function verdictText(result: RoundResult, t: TFunction): string {
  const label = t(result.correct ? 'shanten.correctLabel' : 'shanten.wrongLabel')
  const actual = t('shanten.actualShanten', { value: result.actual.value })
  const via = pathsLabel(result.actual, t)
  return via ? `${label} — ${actual} ${via}` : `${label} — ${actual}`
}

export function ShantenPage() {
  const { t } = useTranslation()
  const situation = useUrlData(decodeSituation)
  const settings = useSettings((s) => s.shanten)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)
  const [guessInput, setGuessInput] = useState('')

  const round = useShantenRound(situation, settings.timerEnabled, situation.sanma ?? sanma)

  useEffect(() => setGuessInput(''), [round.hand])

  // Space toggles reveal/stop — the number input auto-focuses on reveal, so typing a
  // digit + Enter already submits without any extra wiring
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      e.preventDefault()
      if (!round.revealed) round.reveal()
      else round.togglePause()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.revealed, round.togglePause, round.reveal])

  const submitGuess = (value: number) => {
    if (Number.isNaN(value) || value < 0) return
    round.submit(value)
  }

  const settingsRows = (
    <SettingRow label={t('shanten.settings.timer')}>
      <input
        type="checkbox"
        checked={settings.timerEnabled}
        onChange={(e) => update('shanten', { timerEnabled: e.target.checked })}
        className="size-5"
      />
    </SettingRow>
  )

  const { full, toggle: toggleFull } = useFullscreenBoard()
  const { canBack, back } = useLogBack()

  // the same command bar the status bar draws, so the fullscreen chrome can draw them too rather
  // than sending you back out to the page for them
  const toggles = {
    showToggle: true,
    paused: !round.revealed || round.paused,
    onToggle: round.revealed ? round.togglePause : round.reveal,
    toggleLabel: !round.revealed
      ? t('shanten.revealHand')
      : t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer'),
    canBack,
    onBack: back,
    backLabel: t('common.undoAction'),
    onReset: round.stop,
    resetLabel: t('common.resetHand'),
    full,
    onToggleFull: toggleFull,
    fullscreenLabel: t(full ? 'table.exitFullscreen' : 'table.fullscreen'),
  }

  return (
    <TrainerLayout
      title={t('trainer.shanten.title')}
      intro={{ text: t('trainer.shanten.intro'), wikiUrl: TRAINER_WIKI.shanten }}
      settings={settingsRows}
    >
      <div className="flex flex-col gap-4">
        <TrainerStatusBar
          {...toggles}
          elapsedNow={round.elapsedNow}
          running={round.running}
          timerEnabled={settings.timerEnabled}
        >
          <span>
            {t('shanten.correctScore', { correct: round.correctCount, total: round.totalCount })}
          </span>
          {settings.timerEnabled && (
            <span>{t('shanten.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
          )}
        </TrainerStatusBar>

        <BoardStage
          title={t('trainer.shanten.title')}
          intro={{ text: t('trainer.shanten.intro'), wikiUrl: TRAINER_WIKI.shanten }}
          full={full}
          chrome={
            <>
              <SettingsButton title={t('trainer.shanten.title')}>{settingsRows}</SettingsButton>
              <TrainerToggles {...toggles} compact />
              <FullscreenToggle {...toggles} compact />
            </>
          }
          board={
            // named for the UI suite: the feedback notice draws a `HandDisplay` of its own (the
            // hand just answered), so "the tiles on screen" needs to say which. Passed as `board`
            // rather than `hand`: shanten has no felt, and this is what fullscreen centres in the
            // viewport instead of pinning it to the hand strip at the bottom — `full` only widens
            // the gap below the tiles here, since that's the one shape this page actually changes.
            <div data-testid="shanten-hand" className={`flex flex-col ${full ? 'gap-8' : 'gap-4'}`}>
              <HandDisplay tiles={round.hand} concealed={round.concealed} />

              {!round.concealed && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    submitGuess(Number(guessInput))
                  }}
                  className="flex flex-col gap-2"
                >
                  {/* typing a number needs a keyboard, and a keyboard on a phone covers the hand
                      you are counting — so the field is a tablet-and-up control and the buttons
                      are the whole answer below that. Held sideways the same applies at any
                      width: `short:` is where the keyboard would eat the screen outright */}
                  <div className="flex gap-2 max-sm:hidden short:hidden">
                    <input
                      type="number"
                      min={0}
                      autoFocus
                      value={guessInput}
                      onChange={(e) => setGuessInput(e.target.value)}
                      placeholder={t('shanten.placeholder')}
                      className="min-h-11 w-24 rounded border border-neutral-300 px-2 [appearance:textfield] dark:border-neutral-700 dark:bg-neutral-900 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="submit"
                      className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      {t('common.submit')}
                    </button>
                  </div>
                  {/* seven answers, so a phone gets four per row with the last three (4-6)
                      centred under them rather than stuck to the left of an empty fourth cell —
                      flex-wrap centres an incomplete line the way grid's fixed tracks can't, and
                      a fixed square `basis` (not `w-full` against a grid track) is what keeps
                      every button, full row or not, the same size. 0 through 6 are all reachable
                      (chiitoitsu caps shanten at 6). Held sideways they go on one row: height is
                      the only axis short of room there, and a second row would come out of the
                      board's */}
                  <div className="flex flex-wrap gap-2 max-sm:justify-center short:grid short:grid-cols-7">
                    {QUICK_GUESSES.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => submitGuess(n)}
                        className="min-h-11 min-w-11 shrink-0 rounded-lg border border-neutral-300 text-lg font-medium max-sm:aspect-square max-sm:w-[calc(25%-0.375rem)] short:h-12 short:w-full dark:border-neutral-700"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </form>
              )}
            </div>
          }
          noticeKey={round.lastResult ? round.totalCount : undefined}
          noticeCompact={
            round.lastResult && (
              <Verdict
                severity={round.lastResult.correct ? 'ok' : 'error'}
                text={verdictText(round.lastResult, t)}
              />
            )
          }
          notice={
            round.lastResult && (
              <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <p
                  className={`flex items-center gap-1.5 font-semibold ${round.lastResult.correct ? 'text-green-600 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}
                >
                  {round.lastResult.correct ? (
                    <>
                      <CheckCircle2 className="size-4" /> {t('shanten.correctLabel')}
                    </>
                  ) : (
                    <>
                      <XCircle className="size-4" />{' '}
                      {t('shanten.youSaid', { guess: round.lastResult.guess })}
                    </>
                  )}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {t('shanten.previousHand', { value: round.lastResult.actual.value })}
                  {pathsLabel(round.lastResult.actual, t) &&
                    ` ${pathsLabel(round.lastResult.actual, t)}`}
                </p>
                <div className="[--tile-w:calc(var(--tile-w-base)*0.55)]">
                  <HandDisplay tiles={round.lastResult.hand} />
                </div>
              </div>
            )
          }
        />
      </div>
    </TrainerLayout>
  )
}
