import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BoardStage } from '../../components/tiles/BoardStage'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Table, type SeatView } from '../../components/tiles/Table'
import { Timer, TrainerToggles } from '../../components/TrainerControls'
import { HandDisplay, Tile, WallDetails } from '../../components/tiles/Tile'
import { concealedTiles, wallDrawnCount } from '../../core/round'
import { HONOR, serializeTenhou } from '../../core/tiles'
import { INITIAL_HAND_SIZE } from '../../core/wall'
import { WINDS } from '../situation/urlCodec'
import { formatElapsedMs } from '../../lib/formatElapsed'
import { useLogBack } from '../../lib/useLogBack'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { useTermName } from '../i18n/useTermName'
import { SettingRow } from '../settings/SettingsDialog'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useSettings } from '../settings/settingsStore'
import { useTableSettings } from '../settings/tableSettings'
import { Verdict } from '../table/Verdict'
import { decodeScoringUrl } from './scoringUrl'
import { useUrlData } from '../situation/useUrlData'
import { useScoringRound, type Answer, type RoundResult, type ScoringOptions } from './useScoringRound'

const FLAG_KEYS = [
  'riichi',
  'doubleRiichi',
  'ippatsu',
  'haitei',
  'houtei',
  'rinshan',
  'chankan',
] as const

/** How the answer row is packed when the strip below the board holds it and nothing else — the
 *  boardless presentation. There it has to fit whole, and it does not at the comfortable size: the
 *  strip is capped at 35svh, which three fields plus the submit overflow on a 667px-tall phone and
 *  a dealer tsumo's four fields overflow on any phone. So the fields take half a line each while
 *  the screen is too narrow for one row, and drop from 3.5rem to 3rem on a screen only as tall as
 *  a phone — over the 44px touch target either way.
 *
 *  With the felt up this row shares the strip with the hand and is left exactly as it was: the
 *  question is then the board's to answer, and that presentation stays byte-for-byte unchanged. */
const TIGHT_LABEL = 'grow basis-[calc(50%-0.375rem)] sm:basis-0 short:basis-0'
const TIGHT_HEIGHT = '[@media(max-height:680px)]:min-h-12'
const TIGHT_INPUT = `${TIGHT_HEIGHT} [@media(max-height:680px)]:pt-4 [@media(max-height:680px)]:text-base`

/** One numeric answer field; the value is read at submit from the form's `FormData`. */
function NumberField({
  name,
  label,
  step,
  autoFocus,
  tight,
}: {
  name: string
  label: string
  step?: number
  autoFocus?: boolean
  tight?: boolean
}) {
  return (
    // the label is a hint inside the field rather than a word parked beside it: "Han" against an
    // empty box says the same thing in a third of the width, which is what lets the fields stand
    // in one row on anything wider than a phone held upright. It rides up to the field's top edge
    // once there is a value to read, so the question never disappears behind the answer
    <label className={`relative flex min-w-28 flex-col ${tight ? TIGHT_LABEL : 'flex-1'}`}>
      <input
        type="number"
        name={name}
        min={0}
        step={step}
        autoFocus={autoFocus}
        inputMode="numeric"
        // `placeholder=" "`: `:placeholder-shown` is the only pure-CSS read of "this field is
        // empty", and it needs a placeholder to shadow
        placeholder=" "
        className={`peer min-h-14 w-full rounded-lg border border-neutral-300 bg-transparent px-3 pt-5 pb-1 text-lg tabular-nums [appearance:textfield] focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${tight ? TIGHT_INPUT : ''}`}
      />
      <span className="pointer-events-none absolute top-1 left-3 text-xs text-neutral-500 transition-all peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-focus:top-1 peer-focus:translate-y-0 peer-focus:text-xs">
        {label}
      </span>
    </label>
  )
}

/** The one-line verdict that floats over the board once a hand is checked — same shape as every
 *  other trainer's `noticeCompact` (`Verdict`): a label plus the correct answer for every field
 *  under test, so the reader isn't left guessing what they got wrong without opening the log. The
 *  full breakdown (yaku, fu items, which fields were wrong) lives on the log row instead. */
function verdictText(result: RoundResult, options: ScoringOptions, t: TFunction): string {
  const { actual } = result
  const label = t(result.correct ? 'scoring.correctLabel' : 'scoring.wrongLabel')
  const parts: string[] = []
  if (options.testHan) parts.push(t('scoring.hanCount', { count: actual.han }))
  const skipFu = options.ignoreFuOnLimit && actual.han >= 5
  if (options.testFu && !skipFu) {
    parts.push(t('scoring.fuCount', { count: options.exactFu ? actual.fuExact : actual.fu }))
  }
  const split = actual.payments.fromDealer !== undefined
  if (options.testPoints) {
    parts.push(
      split
        ? `${actual.payments.main} / ${actual.payments.fromDealer}`
        : String(actual.payments.main),
    )
  }
  if (actual.limit) parts.push(t(`scoring.limit.${actual.limit}`))
  return parts.length > 0 ? `${label} — ${parts.join(' · ')}` : label
}

export function ScoringPage() {
  const { t } = useTranslation()
  const urlData = useUrlData(decodeScoringUrl)
  const termName = useTermName()
  const settings = useSettings((s) => s.scoring)
  const update = useSettings((s) => s.update)
  const sanma = useSettings((s) => s.sanma)
  const kiriageMangan = useSettings((s) => s.kiriageMangan)
  const advanced = useSettings((s) => s.advanced)
  const { aka, exactFu } = useAdvancedSettings()
  const { showOpponentHands } = useTableSettings('scoring')

  // the scoring section supplies the round's options, but a link can pin the rules the round was
  // simulated under — without them the same seed would replay into a different hand. exactFu is
  // the advanced-resolved value, not settings.exactFu straight — grading must fall back the same
  // way the display does when Advanced is off
  const options = useMemo<ScoringOptions>(
    () => ({
      ...settings,
      exactFu,
      kiriageMangan,
      sanma: urlData.sanma ?? sanma,
      aka: urlData.aka ?? aka,
    }),
    [urlData, sanma, aka, exactFu, kiriageMangan, settings],
  )

  const round = useScoringRound(urlData, options)
  // a hook, so called unconditionally ahead of the loading early return below
  const { canBack, back } = useLogBack()

  if (round.loading || !round.situation || !round.actual) {
    return (
      <BoardStage title={t('trainer.scoring.title')} app="scoring">
        <p className="p-8 text-center text-neutral-500">{t('scoring.dealing')}</p>
      </BoardStage>
    )
  }

  const split = round.actual.payments.fromDealer !== undefined
  const ctx = round.situation.ctx
  const dealer = ctx.seat === HONOR
  // a single points field is either a ron total or a dealer tsumo, where every other seat pays
  // that same amount — the "(each)" label the split fields already use says exactly that
  const singlePointsLabel = t(ctx.tsumo ? 'scoring.pointsMainLabel' : 'scoring.pointsLabel')

  const submit = (form: HTMLFormElement) => {
    const fields = new FormData(form)
    const num = (name: string) => Number(fields.get(name))
    const answer: Answer = {
      han: settings.testHan ? num('han') : undefined,
      fu: settings.testFu ? num('fu') : undefined,
      points: settings.testPoints && !split ? num('points') : undefined,
      pointsMain: settings.testPoints && split ? num('pointsMain') : undefined,
      pointsFromDealer: settings.testPoints && split ? num('pointsFromDealer') : undefined,
    }
    round.check(answer)
  }

  const winIndex = round.situation.concealed.findIndex((tile) => tile.id === ctx.winTile)
  // the hand reads as a hand, sorted, with the winning tile pulled out to the right; melds keep
  // their called order
  const restConcealed = (
    winIndex >= 0
      ? [
          ...round.situation.concealed.slice(0, winIndex),
          ...round.situation.concealed.slice(winIndex + 1),
        ]
      : [...round.situation.concealed]
  ).sort((a, b) => a.id - b.id)
  const winTile =
    winIndex >= 0 ? round.situation.concealed[winIndex] : { id: ctx.winTile, red: false }
  // nuki are counted, not held: the situation carries how many norths were pulled, and each one
  // draws as a plain north beside the melds
  const handNuki = Array.from({ length: round.situation.kita }, () => ({
    id: HONOR + 3,
    red: false,
  }))
  // a ron tile belongs to the discarder's river, where the board rings it; only a tsumo is
  // genuinely a tile you drew. Without the board there is no river to read it from, so it has
  // to sit beside the hand regardless.
  const showWinTileInHand = ctx.tsumo || !settings.table || !round.round

  const badge = (text: string) => (
    <span className="rounded bg-neutral-100 px-2 py-0.5 font-medium dark:bg-neutral-800">
      {text}
    </span>
  )
  // the win conditions read the same in either presentation, so they are built once and handed
  // either to the table's centre panel or to the flat bar. The ron/tsumo badge is separate
  // because the table does not need it: the winning tile is ringed wherever it lies, so a ron
  // rings it in the discarder's river as well as in the hand, and a tsumo only in the hand
  const flagBadges = FLAG_KEYS.filter((key) => ctx[key]).map((key) => (
    <span key={key}>{badge(termName('flags', key))}</span>
  ))
  // a hand that was really played says all of this on the board, and reading the board is the
  // drill: riichi is the bet stick (double riichi, the declaration lying on the first discard),
  // haitei/houtei is the wall count at zero, ippatsu is the win landing before the declarer's own
  // next discard. A link-pinned or generated hand has no rivers and no wall behind it, so there
  // the badges are the only place those conditions exist and they stay.
  const tableFlagBadges = round.round
    ? []
    : FLAG_KEYS.filter((key) => key !== 'riichi' && ctx[key]).map((key) => (
        <span key={key}>{badge(termName('flags', key))}</span>
      ))
  const winBadge = badge(t(ctx.tsumo ? 'scoring.tsumo' : 'scoring.ron'))

  // the hand was actually played, so the board shows the real thing: every seat's real river,
  // the ronned tile ringed where it truly was discarded, real melds. A link-pinned or fallback
  // hand has no round behind it and still shows only the winds and the winner's melds.
  const players = options.sanma ? 3 : 4
  const tableSeatIndex = Math.min(round.seat, players - 1)
  // the seat the board is drawn from has no hand out on the felt — it is the one below the board —
  // so its calls do not belong out there either: they ride at the right-hand end of `HandDisplay`
  // instead, the same split every other board trainer makes. Left on the felt they piled up on the
  // seat's own edge, above the hand they belong beside
  const seats: SeatView[] = round.round
    ? round.round.players.map((player, seat) => ({
        river: player.river,
        ...(seat !== tableSeatIndex && { melds: player.melds, nuki: player.nuki }),
        riichi: player.riichiAt !== undefined,
        hand: seat !== round.seat ? concealedTiles(player) : undefined,
        concealed: !showOpponentHands,
      }))
    : Array.from({ length: players }, (_, seat) => ({
        ...(seat === tableSeatIndex && { riichi: ctx.riichi || ctx.doubleRiichi }),
      }))

  const testsEnabled = [settings.testHan, settings.testFu, settings.testPoints].filter(
    Boolean,
  ).length
  const toggle = (key: keyof typeof settings, labelKey: string, disableWhenLast = false) => (
    <SettingRow label={t(labelKey)}>
      <input
        type="checkbox"
        checked={settings[key] as boolean}
        disabled={disableWhenLast && (settings[key] as boolean) && testsEnabled === 1}
        onChange={(e) => update('scoring', { [key]: e.target.checked })}
        className="size-5"
      />
    </SettingRow>
  )

  const settingsRows = (
    <>
      {toggle('testHan', 'scoring.settings.testHan', true)}
      {toggle('testFu', 'scoring.settings.testFu', true)}
      {toggle('testPoints', 'scoring.settings.testPoints', true)}
      {toggle('table', 'scoring.settings.table')}
      {advanced && toggle('exactFu', 'scoring.settings.exactFu')}
      {toggle('ignoreFuOnLimit', 'scoring.settings.ignoreFuOnLimit')}
    </>
  )

  const toggles = {
    paused: round.paused,
    onToggle: round.togglePause,
    toggleLabel: t(round.paused ? 'common.resumeTimer' : 'common.pauseTimer'),
    canBack,
    onBack: back,
    backLabel: t('common.undoAction'),
    onReset: round.next,
    resetLabel: t('common.resetHand'),
  }

  // how the session is going — passed to BoardStage's `status`, which floats it as a HUD over the board
  const scoreLines = (
    <>
      <span>
        {t('scoring.correctScore', { correct: round.correctCount, total: round.totalCount })}
      </span>
      <span>{t('scoring.avgTime', { time: formatElapsedMs(round.averageTime) })}</span>
    </>
  )

  // Everything the question is made of, built once here and placed by whichever presentation is
  // up. With the felt on, all of it rides in the hand strip, the board above it carrying the
  // round's own context. With the felt off the strip was carrying the entire page — context bar,
  // hand, three fields and the submit — and on a phone the answer fell out of its 35svh cap while
  // ~500px of board area sat empty above it. Off, the question stands in that empty area and the
  // strip keeps only the answer.
  const invalidLinkNotice = round.invalidLink && (
    // the link named a hand that could not be rebuilt, so this one is a fresh deal — said beside
    // the question rather than in the panel, which can be shut
    <p className="rounded-lg border border-amber-400 p-3 text-sm text-amber-700 dark:text-amber-400">
      {t('scoring.invalidLink')}
    </p>
  )

  // the round/seat/dora readout the felt would otherwise carry. Only ever built for the boardless
  // shape — with the table up every line of it is on the board itself
  const contextBar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
        {t('scoring.roundWind')} <Tile id={ctx.round} />
      </span>
      <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
        {t('scoring.seatWind')} <Tile id={ctx.seat} />
        {dealer && <span className="text-neutral-500">({t('scoring.dealer')})</span>}
      </span>
      {round.situation.doraIndicators.length > 0 && (
        <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
          <GlossaryTerm id="dora">{t('scoring.doraIndicator')}</GlossaryTerm>
          {round.situation.doraIndicators.map((id, i) => (
            <Tile key={i} id={id} />
          ))}
        </span>
      )}
      {round.situation.uraIndicators.length > 0 && (
        <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
          <GlossaryTerm id="uraDora">{t('scoring.uraIndicator')}</GlossaryTerm>
          {round.situation.uraIndicators.map((id, i) => (
            <Tile key={i} id={id} />
          ))}
        </span>
      )}
      {round.situation.honba > 0 && (
        <span>{t('scoring.honbaCount', { count: round.situation.honba })}</span>
      )}
      {round.situation.kita > 0 && (
        <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
          {t('scoring.kitaLabel')}
          {Array.from({ length: round.situation.kita }, (_, i) => (
            <Tile key={i} id={HONOR + 3} />
          ))}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-2 text-xs">
        {winBadge}
        {flagBadges}
      </span>
    </div>
  )

  // which tile completed the hand decides the wait fu and menzen ron, so it is part of the
  // question, not part of the answer — always ringed, never gated on the reveal. The slot beside
  // the hand means "you drew this", so it is only right for a tsumo: on a ron the tile is a
  // discard, and the board already rings it in the river it was discarded into. With no board up
  // there is nothing to point at, so it stays here.
  //
  // The calls sit at the right-hand end of the hand, not on a row of their own under it — an open
  // hand is read left to right along one line, and stacked they read as a second hand. True with
  // the board up or down: the felt drops this seat's melds for exactly this reason (see `seats`).
  const handBlock = (
    <HandDisplay
      tiles={restConcealed}
      drawn={showWinTileInHand ? winTile : undefined}
      drawnClassName="rounded-sm outline-2 outline-red-500"
      melds={round.situation.melds}
      nuki={handNuki}
    />
  )

  // the strip holds this row alone with the felt off, and everything else with it up — which is
  // what decides whether the row may pack itself to fit
  const tight = !settings.table
  const answer = round.checked ? (
    // takes the form's exact place once the hand is graded — the verdict is a floating
    // chip now (`noticeCompact`), and the full breakdown is a tap away on the log row, so
    // nothing needs to hold the board any more
    <button
      type="button"
      onClick={round.next}
      className="min-h-14 shrink-0 rounded-lg bg-neutral-900 px-5 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
    >
      {t('scoring.newHand')}
    </button>
  ) : (
    // uncontrolled: the form is keyed to the hand, so a new hand remounts it empty
    <form
      key={serializeTenhou(round.situation.concealed)}
      onSubmit={(e) => {
        e.preventDefault()
        submit(e.currentTarget)
      }}
      // one field per line on a phone held upright — two, packed, when this row is all the
      // strip holds (`tight`) — and one row everywhere there is width for it: a tablet, a
      // desktop, or a phone held sideways (`short:`, the same viewport test the board itself
      // uses). The submit button joins the row rather than sitting under it: the answer is one
      // thought, so it reads as one line
      className={
        tight
          ? 'flex flex-wrap items-stretch gap-3 [@media(max-height:680px)]:gap-2'
          : 'flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch short:flex-row short:flex-wrap short:items-stretch'
      }
    >
      {settings.testHan && (
        <NumberField name="han" label={t('scoring.hanLabel')} autoFocus tight={tight} />
      )}
      {settings.testFu && <NumberField name="fu" label={t('scoring.fuLabel')} tight={tight} />}
      {settings.testPoints && !split && (
        <NumberField name="points" label={singlePointsLabel} step={100} tight={tight} />
      )}
      {settings.testPoints && split && (
        <>
          <NumberField
            name="pointsMain"
            label={t('scoring.pointsMainLabel')}
            step={100}
            tight={tight}
          />
          <NumberField
            name="pointsFromDealer"
            label={t('scoring.pointsFromDealerLabel')}
            step={100}
            tight={tight}
          />
        </>
      )}
      <button
        type="submit"
        // packed, it fills whatever is left of its line upright (usually one of its own) and
        // keeps its own width in a single row, the shape it has always had there
        className={`min-h-14 shrink-0 rounded-lg bg-neutral-900 px-5 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900 ${tight ? `${TIGHT_HEIGHT} grow sm:grow-0 short:grow-0` : ''}`}
      >
        {t('scoring.checkAnswer')}
      </button>
    </form>
  )

  return (
    <BoardStage
      title={t('trainer.scoring.title')}
      app="scoring"
      intro={{ text: t('trainer.scoring.intro'), wikiUrl: TRAINER_WIKI.scoring }}
      settings={settingsRows}
      onLogOpen={(open) => open !== round.paused && round.togglePause()}
      status={
        <>
          <Timer elapsedNow={round.elapsedNow} running={round.running} />
          {scoreLines}
        </>
      }
      chrome={<TrainerToggles {...toggles} />}
      // the table itself is opt-in (`settings.table`) — off, this is the boardless shape
      // shanten/solo use: no `board` prop, and the question moves into `children`, which the
      // stage centres where the felt would be
      board={
        settings.table ? (
          <Table
            seats={seats}
            seatIndex={tableSeatIndex}
            round={WINDS[ctx.round - HONOR]}
            doraIndicators={round.situation!.doraIndicators.map((id) => ({
              id,
              red: false,
            }))}
            uraIndicators={round.situation!.uraIndicators.map((id) => ({
              id,
              red: false,
            }))}
            wallCount={round.round?.liveWall.length}
            honba={round.situation!.honba}
          >
            {tableFlagBadges.length > 0 && (
              <span className="flex flex-wrap items-center justify-center gap-[1cqw]">
                {tableFlagBadges}
              </span>
            )}
          </Table>
        ) : undefined
      }
      hand={
        settings.table ? (
          <div className="flex flex-col gap-4">
            {invalidLinkNotice}
            {handBlock}
            {answer}
          </div>
        ) : (
          // the strip holds the answer alone. It needs a width of its own now that the hand is
          // no longer standing in the middle of it lending it one: a `flex-col` of fields left to
          // size themselves collapses to `min-w-28`. `100cqw` is the strip's own content box
          // (it declares the container), capped so the row does not run the width of a desktop
          <div className="flex w-[min(100cqw,40rem)] flex-col">{answer}</div>
        )
      }
      noticeKey={round.lastResult ? round.totalCount : undefined}
      noticeCompact={
        round.lastResult && (
          <Verdict
            severity={round.lastResult.correct ? 'ok' : 'error'}
            text={verdictText(round.lastResult, options, t)}
          />
        )
      }
      wall={
        round.round ? (
          <WallDetails
            dealt={round.round.wall.slice(0, round.round.players.length * INITIAL_HAND_SIZE)}
            liveWall={round.round.liveWallSnapshot}
            liveWallDrawn={wallDrawnCount(round.round)}
            deadWall={round.round.deadWallSnapshot}
            replacements={round.round.replacements}
          />
        ) : undefined
      }
    >
      {/* the question, posed where the felt would be. Uncapped on a screen with room — the block
        is vertically centred and the HUD hangs off the top-left corner, so they never meet — but
        held sideways (`short:`) the area is only as tall as a phone's short side and the HUD and
        the verdict chip stand in the gutters either side of it. There the column is held to the
        width the felt itself would have taken between them: `100cqh`, the same measure `Table`
        sizes its square by. */}
      {!settings.table && (
        <div className="flex flex-col gap-4 short:max-w-[100cqh]">
          {invalidLinkNotice}
          {contextBar}
          {handBlock}
        </div>
      )}
    </BoardStage>
  )
}
