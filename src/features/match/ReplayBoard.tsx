import { ChevronLeft, ChevronRight, SkipBack, SkipForward, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ResetButton } from '../../components/TrainerControls'
import { BoardStage } from '../../components/tiles/BoardStage'
import { Table, type SeatView } from '../../components/tiles/Table'
import { HandDisplay, WallDetails } from '../../components/tiles/Tile'
import { replayTo, snapshotTable, splitDrawn, type ReplayRules } from '../../core/table'
import { doraIndex, type ImportedGame } from '../../core/tenhouImport'
import { HONOR } from '../../core/tiles'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { useTableSettings } from '../settings/tableSettings'
import { WINDS } from '../situation/urlCodec'
import { SeatStrip } from '../table/SeatStrip'
import { replayRows, rowsBefore } from './matchRows'

/** Where the replay stands: `round` indexes `game.rounds`, `step` runs `0..log.length` and is
 *  `replayTo`'s own `at` — the board shows the position *before* `log[step]`. */
interface Cursor {
  round: number
  step: number
}

/** One action on: the end of a round steps into the next one's deal. `null` at the very end. */
function nextOf(game: ImportedGame, { round, step }: Cursor): Cursor | null {
  if (step < game.rounds[round].log.length) return { round, step: step + 1 }
  return round + 1 < game.rounds.length ? { round: round + 1, step: 0 } : null
}

/** One action back: a round's deal steps back to the previous round's end. */
function prevOf(game: ImportedGame, { round, step }: Cursor): Cursor | null {
  if (step > 0) return { round, step: step - 1 }
  return round > 0 ? { round: round - 1, step: game.rounds[round - 1].log.length } : null
}

const NAV_BUTTON = 'flex size-11 shrink-0 items-center justify-center rounded disabled:opacity-30'

function NavButton({
  label,
  icon: Icon,
  to,
  onGo,
  className,
}: {
  label: string
  icon: LucideIcon
  to: Cursor | null
  onGo: (to: Cursor) => void
  className: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!to}
      onClick={() => to && onGo(to)}
      className={`${NAV_BUTTON} ${className}`}
    >
      <Icon className="size-5" />
    </button>
  )
}

/**
 * A recorded tenhou.net/6 game, stepped through action by action: every hand face up, nothing to
 * click on the felt, the eye on each plate rotating the board. The board at a cursor is rebuilt
 * from scratch through `replayTo` — the one way to rebuild a recorded position — and the log is
 * the game's rows up to it, computed once (`replayRows`) and handed to the log directly, so a
 * replay never writes the log store.
 */
export function ReplayBoard({ game, onExit }: { game: ImportedGame; onExit: () => void }) {
  const { t } = useTranslation()
  const { showSeatWaits } = useTableSettings('match')
  const [cursor, setCursor] = useState<Cursor>({ round: 0, step: 0 })
  const [viewSeat, setViewSeat] = useState(0)

  // a recorded game's rules are its own, never the reader's settings — and every field
  // `ReplayRules` has, a tenhou record can say, so there is nothing to refuse here
  const rules = useMemo<ReplayRules>(
    () => ({
      sanma: game.rules.sanma,
      aka: game.rules.aka,
      kiriageMangan: game.rules.kiriageMangan,
    }),
    [game],
  )
  const rows = useMemo(() => replayRows(game, rules), [game, rules])
  const logEntries = useMemo(() => rowsBefore(rows, cursor), [rows, cursor])
  const recorded = game.rounds[cursor.round]
  const snap = useMemo(
    () => snapshotTable(replayTo(recorded, rules, cursor.step), true),
    [recorded, rules, cursor.step],
  )
  // the importer fills every slot the record never shows at random: the wall draws those face
  // down, and the felt leaves off an indicator the engine flipped that the record never did
  const shown = useMemo(
    () => recorded.wall.map((tile, i) => (recorded.revealed[i] ? tile : undefined)),
    [recorded],
  )
  const dealt = snap.dealtTiles.length
  const dead = dealt + snap.liveWallSnapshot.length

  // ←/→ step from anywhere but a field that takes its own arrows — the range input among them
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const el = e.target
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
      ) {
        return
      }
      e.preventDefault()
      setCursor((c) => (e.key === 'ArrowRight' ? nextOf(game, c) : prevOf(game, c)) ?? c)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [game])

  const players = snap.rivers.length
  const drawnOf = (seat: number) => (snap.drawn?.seat === seat ? snap.drawn.tile : undefined)
  const seats: SeatView[] = snap.rivers.map((river, seat) => {
    const own = seat === viewSeat
    const { tiles, drawn } = splitDrawn(snap.hands[seat], drawnOf(seat))
    return {
      river,
      melds: own ? undefined : snap.melds[seat],
      nuki: own ? undefined : snap.nuki[seat],
      riichi: snap.riichi[seat],
      hand: own ? undefined : tiles,
      drawn: own ? undefined : drawn,
      concealed: false,
      points: snap.match.points[seat],
      claiming: snap.claim?.kind === 'discard' && snap.claim.from === seat,
    }
  })
  const bottom = splitDrawn(snap.hands[viewSeat], drawnOf(viewSeat))

  const total = recorded.log.length
  const wind = WINDS[recorded.match.prevalentWind - HONOR] ?? 'E'
  const position = t('match.replay.position', {
    round: t('table.roundLine', { wind: t(`windFull.${wind}`), number: recorded.match.round }),
    honba: recorded.match.honba,
    step: cursor.step,
    total,
  })
  const lastRound = game.rounds.length - 1

  return (
    <BoardStage
      title={t('trainer.match.title')}
      app="match"
      logHero={viewSeat}
      logEntries={logEntries}
      intro={{
        text: `${t('trainer.match.intro')}\n\n${t('common.alphaNote')}`,
        wikiUrl: TRAINER_WIKI.match,
      }}
      chrome={<ResetButton onReset={onExit} resetLabel={t('match.replay.close')} />}
      wall={
        <WallDetails
          dealt={shown.slice(0, dealt)}
          liveWall={shown.slice(dealt, dead)}
          liveWallDrawn={snap.liveWallDrawn}
          deadWall={shown.slice(dead)}
          replacements={snap.replacements}
          players={players}
          seat={viewSeat}
        />
      }
      status={
        // one row of buttons around the label, the range under it — a constant height whatever
        // the label says. Held sideways this is the narrow card in the board's right gutter, so
        // the same cells stack: the label, ◀ ▶, ⏮ ⏭, the range
        <div className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center short:grid-cols-2">
          <NavButton
            label={t('match.replay.prevRound')}
            icon={SkipBack}
            to={cursor.round > 0 ? { round: cursor.round - 1, step: 0 } : null}
            onGo={setCursor}
            className="short:order-4"
          />
          <NavButton
            label={t('match.replay.prevAction')}
            icon={ChevronLeft}
            to={prevOf(game, cursor)}
            onGo={setCursor}
            className="short:order-2"
          />
          <span
            data-testid="replay-position"
            className="truncate px-1 text-center tabular-nums short:order-1 short:col-span-2 short:whitespace-normal"
          >
            {position}
          </span>
          <NavButton
            label={t('match.replay.nextAction')}
            icon={ChevronRight}
            to={nextOf(game, cursor)}
            onGo={setCursor}
            className="short:order-3"
          />
          <NavButton
            label={t('match.replay.nextRound')}
            icon={SkipForward}
            to={cursor.round < lastRound ? { round: cursor.round + 1, step: 0 } : null}
            onGo={setCursor}
            className="short:order-5"
          />
          <input
            type="range"
            aria-label={t('match.replay.scrub')}
            min={0}
            max={total}
            value={cursor.step}
            onChange={(e) => setCursor({ round: cursor.round, step: Number(e.target.value) })}
            className="col-span-5 h-11 w-full short:order-6 short:col-span-2"
          />
        </div>
      }
      board={
        <Table
          seatInfo={(seat, seatWind) => (
            <SeatStrip
              seat={seat}
              players={players}
              defaultOrientation={0}
              dealer={snap.match.dealer}
              config={null}
              onChange={() => undefined}
              viewSeat={viewSeat}
              onWatch={setViewSeat}
              read={snap.seatReads[seat]}
              showWaits={showSeatWaits}
              wind={seatWind}
              requireManual={false}
              name={game.names[seat]}
            />
          )}
          seats={seats}
          seatIndex={viewSeat}
          round={wind}
          roundNumber={snap.match.round}
          dealerRepeat={snap.match.dealerRepeat}
          dealer={snap.match.dealer}
          doraIndicators={snap.doraIndicators.filter(
            (_, i) => recorded.revealed[doraIndex(rules.sanma, i)],
          )}
          wallCount={snap.liveWall.length}
          honba={snap.match.honba}
          activeSeat={snap.ended ? undefined : snap.seat}
        />
      }
      hand={
        <div className="flex justify-center">
          <HandDisplay
            tiles={bottom.tiles}
            drawn={bottom.drawn}
            melds={snap.melds[viewSeat]}
            nuki={snap.nuki[viewSeat]}
          />
        </div>
      }
    />
  )
}
