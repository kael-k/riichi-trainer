import type { TFunction } from 'i18next'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Timer, TrainerToggles } from '../../components/TrainerControls'
import { HandDisplay } from '../../components/tiles/Tile'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
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

/** The one-line verdict that floats over the board — same shape as every other trainer's
 *  `noticeCompact` (`Verdict`): a label plus the actual shanten and, when it's not the plain
 *  standard decomposition, which path it came from. No guess/tile breakdown — that stays in the
 *  full `notice` the session panel holds, and in the log. */
function verdictText(result: RoundResult, t: TFunction): string {
  const label = t(result.correct ? 'shanten.correctLabel' : 'shanten.wrongLabel')
  const actual = t('shanten.actualShanten', { value: result.actual.value })
  const via = pathsLabel(result.actual, t)
  return via ? `${label} — ${actual} ${via}` : `${label} — ${actual}`
}

export function ShantenPage() {
  const { t } = useTranslation()
  const situation = useUrlData(decodeSituation)
  const sanma = useSettings((s) => s.sanma)

  const round = useShantenRound(situation, situation.sanma ?? sanma)

  const submitGuess = (value: number) => {
    if (Number.isNaN(value) || value < 0) return
    round.submit(value)
  }

  // Space toggles reveal/stop; once a hand is up, digit keys 0-6 submit a guess directly
  // (every quick-guess answer is a single digit, so there's nothing to buffer before Enter)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!round.revealed) round.reveal()
        else round.togglePause()
        return
      }
      if (!round.concealed && QUICK_GUESSES.includes(Number(e.key))) {
        e.preventDefault()
        submitGuess(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.revealed, round.concealed, round.togglePause, round.reveal])

  const { canBack, back } = useLogBack()

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
  }

  // how the session is going — passed to BoardStage's `status`, which floats it as a HUD over the board
  const scoreLines = (
    <>
      <span>
        {t('shanten.correctScore', { correct: round.correctCount, total: round.totalCount })}
      </span>
      <span>{t('shanten.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
    </>
  )

  return (
    <BoardStage
      title={t('trainer.shanten.title')}
      intro={{ text: t('trainer.shanten.intro'), wikiUrl: TRAINER_WIKI.shanten }}
      status={
        <>
          <Timer elapsedNow={round.elapsedNow} running={round.running} />
          {scoreLines}
        </>
      }
      chrome={<TrainerToggles {...toggles} />}
      board={
        // named for the UI suite: the feedback notice draws a `HandDisplay` of its own (the
        // hand just answered), so "the tiles on screen" needs to say which. Passed as `board`
        // rather than `hand`: shanten has no felt, and this is what the stage centres in the
        // viewport instead of pinning it to the hand strip at the bottom
        <div data-testid="shanten-hand" className="flex flex-col items-center gap-8">
          <HandDisplay tiles={round.hand} concealed={round.concealed} />

          {!round.concealed && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {t('shanten.guessHint')}
              </p>
              {/* seven answers, so a phone gets four per row with the last three (4-6)
                      centred under them rather than stuck to the left of an empty fourth cell —
                      flex-wrap centres an incomplete line the way grid's fixed tracks can't, and
                      a fixed square `basis` (not `w-full` against a grid track) is what keeps
                      every button, full row or not, the same size. 0 through 6 are all reachable
                      (chiitoitsu caps shanten at 6). Held sideways they go on one row: height is
                      the only axis short of room there, and a second row would come out of the
                      board's */}
              <div className="flex flex-wrap justify-center gap-2 short:grid short:grid-cols-7">
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
            </div>
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
  )
}
