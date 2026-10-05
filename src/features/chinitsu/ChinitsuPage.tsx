import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { BoardStage } from '../../components/tiles/BoardStage'
import { HandDisplay, Tile } from '../../components/tiles/Tile'
import { Timer, TrainerToggles } from '../../components/TrainerControls'
import type { FlushHands, FlushSuit } from '../../core/flush'
import { FLUSH_SUIT_BASE } from '../../core/flush'
import { suitOf, type TileId } from '../../core/tiles'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { useTermName } from '../i18n/useTermName'
import { SegmentedButton, SettingRow } from '../settings/SettingsDialog'
import { useSettings } from '../settings/settingsStore'
import { useUrlData } from '../situation/useUrlData'
import { Verdict } from '../table/Verdict'
import { decodeChinitsuLink } from './chinitsuUrl'
import { singleSuit, useChinitsuRound, type RoundResult } from './useChinitsuRound'

const SUITS: FlushSuit[] = ['m', 'p', 's']

/** The suit a hand is actually dealt in. Sanma has no 2m-8m, so a manzu flush cannot exist there:
 *  the stored choice reads as pinzu (the default) while sanma is on, and comes straight back when
 *  it is turned off — a disabled button must not leave a hand running that the ruleset forbids. */
function resolveFlushSuit(suit: FlushSuit, sanma: boolean): FlushSuit {
  return sanma && suit === 'm' ? 'p' : suit
}

/** The verdict's own words; the waits themselves are drawn beside it as tiles, since they are the
 *  answer — the same job shanten's "actual shanten: N" does in its own verdict. */
function verdictText(result: RoundResult, t: TFunction): string {
  const label = t(result.correct ? 'chinitsu.correctLabel' : 'chinitsu.wrongLabel')
  return result.waits.length > 0
    ? t('chinitsu.verdictWaits', { label })
    : t('chinitsu.verdictNoWaits', { label })
}

/** Every answer tile, grouped per suit so the row breaks between the suit and the honours rather
 *  than inside either. A toggle each — `aria-pressed`, raised and ringed while on — so the answer is
 *  built up and read back before it is confirmed as one. Each is a ≥44px target (`min-h-11` plus
 *  the tile's own width at every size this is drawn at). */
function WaitPicker({
  candidates,
  selected,
  onToggle,
}: {
  candidates: TileId[]
  selected: TileId[]
  onToggle: (tile: TileId) => void
}) {
  const groups: TileId[][] = []
  for (const id of candidates) {
    const last = groups.at(-1)
    if (last && suitOf(last[0]) === suitOf(id)) last.push(id)
    else groups.push([id])
  }
  return (
    <div
      data-testid="chinitsu-picker"
      data-wait-picker
      className="flex flex-wrap items-end justify-center gap-x-3 gap-y-2"
    >
      {groups.map((group) => (
        <div key={group[0]} className="flex">
          {group.map((id) => {
            const on = selected.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(id)}
                className={`flex min-h-11 min-w-11 flex-col items-center justify-end rounded p-0.5 transition-transform active:scale-95 ${
                  on ? '-translate-y-1.5' : ''
                }`}
              >
                <span
                  className={`flex rounded-[10%] ${
                    on ? 'outline-2 outline-offset-1 outline-amber-500' : 'opacity-80'
                  }`}
                >
                  <Tile id={id} />
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function ChinitsuPage() {
  const { t } = useTranslation()
  const termName = useTermName()
  const link = useUrlData(decodeChinitsuLink)
  const sanma = useSettings((s) => s.sanma)
  const settings = useSettings((s) => s.chinitsu)
  const update = useSettings((s) => s.update)
  const suit = resolveFlushSuit(settings.suit, sanma)

  const round = useChinitsuRound(link, { suit, hands: settings.hands })
  const { canBack, back } = useLogBack()
  const keySuit = singleSuit(round.candidates)

  // Space reveals/pauses, as in shanten. A digit toggles that rank of the hand's suit (only when
  // the answer row is one suit, so a digit names exactly one tile), Enter confirms. A focused
  // button keeps Space for itself — pressing it is what Space means there — and Enter too, except
  // on an answer tile: a tile tapped with the mouse keeps focus, and Enter there toggling it back
  // off would silently undo the last pick of an answer the reader meant to confirm. Space still
  // toggles a focused tile, so the row stays fully usable from the keyboard
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl/⌘+digit switches browser tabs; that is never an answer
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const onButton = tag === 'BUTTON'
      if (e.code === 'Space' && !onButton) {
        e.preventDefault()
        if (!round.revealed) round.reveal()
        else round.togglePause()
        return
      }
      if (round.concealed) return
      if (e.key === 'Enter' && (!onButton || target?.closest('[data-wait-picker]'))) {
        e.preventDefault()
        round.submit()
        return
      }
      const rank = Number(e.key)
      if (keySuit && Number.isInteger(rank) && rank >= 1 && rank <= 9) {
        e.preventDefault()
        round.toggle(FLUSH_SUIT_BASE[keySuit] + rank - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [round, keySuit])

  const toggles = {
    paused: !round.revealed || round.paused,
    onToggle: round.revealed ? round.togglePause : round.reveal,
    toggleLabel: !round.revealed
      ? t('chinitsu.revealHand')
      : t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer'),
    canBack,
    onBack: back,
    backLabel: t('common.undoAction'),
    onReset: round.stop,
    resetLabel: t('common.resetHand'),
  }

  const settingsRows = (
    <>
      <SettingRow label={t('chinitsu.settings.suit')}>
        <div className="flex gap-1">
          {SUITS.map((s) => (
            <SegmentedButton
              key={s}
              // the suit actually dealt, which under sanma is never manzu whatever is stored
              active={suit === s}
              disabled={sanma && s === 'm'}
              onClick={() => update('chinitsu', { suit: s })}
              // named outright: inside `SettingRow`'s <label> the first button would otherwise take
              // the whole row's text as its name
              label={t(`chinitsu.suit.${s}`)}
            >
              {t(`chinitsu.suit.${s}`)}
            </SegmentedButton>
          ))}
        </div>
      </SettingRow>
      <SettingRow
        // the two hands by name, each its own glossary link, rather than "Hands" beside two bare
        // icons nobody could tell apart. Named the way the options below are (`translatedTerms`),
        // so the label and the choice say the same words
        label={
          <>
            <GlossaryTerm id="chinitsu">{termName('yaku', 'chinitsu')}</GlossaryTerm>
            {' / '}
            <GlossaryTerm id="honitsu">{termName('yaku', 'honitsu')}</GlossaryTerm>
          </>
        }
      >
        <select
          // the glossary buttons in the label come first, so the label does not name this
          aria-label={t('chinitsu.settings.hands')}
          value={settings.hands}
          onChange={(e) => update('chinitsu', { hands: e.target.value as FlushHands })}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-2 text-neutral-900 [color-scheme:light] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark]"
        >
          <option value="both">{t('chinitsu.settings.handsBoth')}</option>
          <option value="chinitsu">{termName('yaku', 'chinitsu')}</option>
          <option value="honitsu">{termName('yaku', 'honitsu')}</option>
        </select>
      </SettingRow>
    </>
  )

  return (
    <BoardStage
      title={t('trainer.chinitsu.title')}
      intro={{ text: t('trainer.chinitsu.intro'), wikiUrl: TRAINER_WIKI.chinitsu }}
      settings={settingsRows}
      onLogOpen={(open) => open !== round.paused && round.togglePause()}
      status={
        <>
          <Timer elapsedNow={round.elapsedNow} running={round.running} />
          <span>
            {t('chinitsu.correctScore', { correct: round.correctCount, total: round.totalCount })}
          </span>
          <span>{t('chinitsu.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
        </>
      }
      chrome={<TrainerToggles {...toggles} />}
      board={
        // boardless, like shanten: the puzzle goes through `board` so the stage centres it where
        // the felt would be. The hand and the answer row are named apart for the UI suite — both
        // are rows of tiles, and only one of them is the question
        <div className="flex flex-col items-center gap-6 short:gap-3">
          <div data-testid="chinitsu-hand">
            <HandDisplay tiles={round.hand} concealed={round.concealed} />
          </div>
          {!round.concealed && (
            <div className="flex flex-col items-center gap-3 short:gap-2">
              <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">
                {t('chinitsu.hint')}
              </p>
              <WaitPicker
                candidates={round.candidates}
                selected={round.selected}
                onToggle={round.toggle}
              />
              <button
                type="button"
                onClick={round.submit}
                className="min-h-11 rounded-lg bg-neutral-900 px-5 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                {t('chinitsu.confirm')}
              </button>
            </div>
          )}
        </div>
      }
      noticeKey={round.lastResult ? round.totalCount : undefined}
      noticeCompact={
        round.lastResult && (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <Verdict
              severity={round.lastResult.correct ? 'ok' : 'error'}
              text={verdictText(round.lastResult, t)}
            />
            {round.lastResult.waits.length > 0 && (
              <span className="flex [--tile-w:calc(var(--tile-w-base)*0.6)]">
                {round.lastResult.waits.map((id) => (
                  <Tile key={id} id={id} />
                ))}
              </span>
            )}
          </div>
        )
      }
    />
  )
}
