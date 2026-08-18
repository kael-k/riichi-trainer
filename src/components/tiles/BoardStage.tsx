import { ArrowLeft, ScrollText } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useLog } from '../../store/log'
import { InfoButton, LogList, type TrainerIntro } from '../TrainerLayout'

/** Where the session panel stops being a drawer and becomes a column of its own, docked beside the
 *  board and open by default — Tailwind's `lg`. Below it the board needs every pixel of width it
 *  can get, so the same content is a drawer you pull over the top instead. */
export const WIDE_QUERY = '(min-width: 1024px)'

interface BoardStageProps {
  /** The `Table` itself, built by the page. Omitted by the boardless trainers (shanten, solo):
   *  their content goes through the ordinary slots below instead. Each seat's own info strip
   *  lives on the felt itself (`Table`'s `seatInfo`), not here; the fullscreen toggle is a single
   *  global button in `TrainerLayout`'s header, not part of the board at all — see
   *  `useFullscreenBoard`. The `chrome` row below draws its own copy since this overlay hides
   *  that header. */
  board?: ReactNode
  /** Whether the board is currently filling the viewport — a global session flag
   *  (`useFullscreenBoard()`), threaded through here (and into the page's own `chrome`) rather
   *  than this component reading the hook itself, since the button that flips it lives outside
   *  this component's own subtree (the trainer header, and `chrome`'s own exit button). */
  full: boolean
  /** Your hand and the controls that belong to it (kita/kan, riichi, the claim prompt) — the
   *  only part of the column that follows the board into fullscreen. Omitted by shanten: it has
   *  no felt, and puts its puzzle (tiles plus the guess controls) through `board` instead so
   *  fullscreen centres it rather than pinning it to the hand strip. */
  hand?: ReactNode
  /** The trainer's own score/accuracy/clock lines, as plain children of a small column — the
   *  session panel styles them. Lifted out of the page's status bar so fullscreen can say how the
   *  session is going without being left to guess from the board. */
  status?: ReactNode
  /** Per-action feedback, in full: tile lists, ukeire counts, the lot. It is what the session
   *  panel shows, and what the inline column has always shown. */
  notice?: ReactNode
  /** The same feedback, one `Verdict` line (icon, colour, short text, `features/table/Verdict.tsx`)
   *  — what floats over the board when the session panel is not on screen to hold the full one,
   *  since a phone mid-drill has no room for tile lists and the full breakdown is a tap away in
   *  the panel either way. Falls back to `notice` when omitted, so a caller with nothing compact
   *  to say (or a page that has not adopted the split yet) still gets *something* rather than a
   *  silent gap. */
  noticeCompact?: ReactNode
  /** Bumped whenever `notice`/`noticeCompact` is a *new* one — that is what re-shows a faded
   *  floating notice. A notice whose key has not moved stays hidden, so re-renders do not
   *  resurrect it. The panel's own copy never fades and ignores this. */
  noticeKey?: string | number
  /** Shown once the hand is over: in the column inline, as a centred card in fullscreen. */
  end?: ReactNode
  /** The trainer's own extras — wall reveal, share link, the lab's rankings. They live in the
   *  session panel beside the log, since they are things you read *about* the board rather than
   *  play on it. */
  panel?: ReactNode
  /** Board-area content for a trainer that has no felt (shanten's puzzle, solo's river) — centred
   *  where the board would otherwise be. */
  children?: ReactNode
  /** Called with `true` while the session panel is covering the board, so a graded trainer can
   *  stop its clock — reading back over the log is not thinking time. Only fires for the drawer:
   *  a panel docked beside the board hides nothing and must never pause the hand. */
  onLogOpen?: (open: boolean) => void
  /** The page's own buttons for the fullscreen chrome: its settings dialog and its start/stop
   *  controls, the two things fullscreen used to have no answer for but leaving it. Back-to-home,
   *  the log drawer and the exit toggle are this component's own — every board has those. */
  chrome?: ReactNode
  /** The trainer's own title, passed straight to `InfoButton` alongside `intro` — needed here
   *  only because fullscreen hides `TrainerLayout`'s header, info button included. */
  title: string
  /** Shown behind an info button in the fullscreen chrome row — the one item the inline layout's
   *  `TrainerLayout` header already has that fullscreen otherwise has no answer for. */
  intro?: TrainerIntro
}

/** How long a floating notice stays up. Long enough to read a discard's feedback, short enough
 *  that it is gone before the next turn's decision — it never blocks the board either way. */
const NOTICE_MS = 6000

/**
 * Everything that is not the board or the hand: how the session is going, what the last decision
 * was worth in full, whatever the trainer wants to say about the board, and the log. One renderer
 * for both surfaces it appears on — docked beside the board from `lg` up, pulled over the top in a
 * drawer below that — so the two cannot drift apart.
 */
function SessionPanel({
  status,
  notice,
  panel,
}: Pick<BoardStageProps, 'status' | 'notice' | 'panel'>) {
  const { t } = useTranslation()
  const { entries, clear } = useLog()
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {(status || notice || panel) && (
        // `flex-auto` on both halves rather than a fixed share: each is based on its own content
        // and only gives ground in proportion to it, so a long ukeire list gets the room an empty
        // log is not using, and a log that has run all game still keeps its own
        <div className="flex min-h-0 flex-auto flex-col gap-3 overflow-y-auto">
          {status && <div className="flex flex-col gap-1 text-sm text-neutral-500">{status}</div>}
          {notice}
          {panel}
        </div>
      )}
      <div className="flex min-h-0 flex-auto flex-col border-t border-neutral-200 dark:border-neutral-800">
        <div className="flex min-h-11 items-center gap-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">
          {t('common.log', { count: entries.length })}
          {entries.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="ml-auto rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {t('common.clear')}
            </button>
          )}
        </div>
        <LogList className="min-h-0 flex-1" />
      </div>
    </div>
  )
}

/**
 * The shared board layout, in its two shapes: stacked in the page (board, then the column beside
 * or under it), or filling the viewport like a real client's table. `full` (see
 * `useFullscreenBoard`) picks the shape; the overlay below is what actually lays fullscreen out,
 * the browser's own `requestFullscreen` only ever drops the surrounding chrome on top of it.
 */
export function BoardStage({
  board,
  full,
  hand,
  status,
  notice,
  noticeCompact,
  noticeKey,
  end,
  panel,
  children,
  onLogOpen,
  chrome,
  title,
  intro,
}: BoardStageProps) {
  const { t } = useTranslation()
  const wide = useMediaQuery(WIDE_QUERY)
  const [logOpen, setLogOpen] = useState(wide)
  const [noticeShown, setNoticeShown] = useState(false)
  // the same panel in its two shapes: docked beside the board it covers nothing, so it is open by
  // default and the full feedback lives there; as a drawer it is over the top of the board, so it
  // is shut by default and pauses the clock for as long as it is open
  const docked = wide && logOpen
  const drawerOpen = full && logOpen && !wide

  // re-show on a genuinely new notice, then hide it again on a timer. Keyed rather than watching
  // `notice` itself: the node is rebuilt every render, so its identity says nothing
  useEffect(() => {
    if (noticeKey === undefined) return
    setNoticeShown(true)
    const id = setTimeout(() => setNoticeShown(false), NOTICE_MS)
    return () => clearTimeout(id)
  }, [noticeKey])

  // whichever shape the panel is in, it goes back to that shape's own default when the shape
  // changes: docked and open beside a wide board, shut on anything narrower (a drawer left
  // standing over the board after a resize would be covering tiles nobody asked to hide), and
  // shut again outside fullscreen, where the inline column shows all of this anyway
  useEffect(() => {
    setLogOpen(full && wide)
  }, [full, wide])

  // the pause is owed to the *drawer* alone, since only that shape hides the board — reported from
  // an effect on that one derived fact rather than from the click handler, so every way it can
  // change (a resize, leaving fullscreen, Escape) resumes the clock exactly once, and a pause the
  // reader pressed themselves is never lifted by a panel that was already shut
  useEffect(() => {
    onLogOpen?.(drawerOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen])

  // the drawer covers the chrome row, so it dismisses the way every other overlay in the app
  // does (`SeatPanel`, `InfoPopover`): Escape, or a press on the scrim outside it
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLogOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  if (!full) {
    return (
      // the hand stays under the board at every size. Held sideways it used to move *beside* it,
      // which fits more on screen but is not the table anyone has ever played on: a real client
      // (and every physical table) puts your tiles along your own edge of the felt
      <div className="flex flex-col gap-4">
        {board}
        <div className="flex min-w-0 flex-col gap-4">
          {hand}
          {notice}
          {end}
          {children}
          {panel}
        </div>
      </div>
    )
  }

  return (
    <div
      // the board claims the viewport instead of sharing it with the header, status bar and log
      // panel — `--board-max-h` is what `Table` sizes its square against, so the strips this
      // layout keeps for itself are reserved here rather than guessed at there. Held sideways
      // that is the hand alone: the chrome has moved into the gutter beside the square.
      // `--table-max` is the desktop "don't balloon" cap, which is exactly what fullscreen is
      // for — lifted out of the way here so `--board-max-h` is what actually sizes the square
      className="fixed inset-0 z-40 flex bg-white [--board-max-h:calc(100svh-6rem)] [--table-max:100svh] short:[--board-max-h:calc(100svh-4rem)] dark:bg-neutral-950"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* a row above the board normally; standing in the left gutter held sideways, where it
            costs the square no height at all. Everything a hand needs mid-drill is here, so
            fullscreen is somewhere you can stay rather than somewhere you visit. `viewport-fit=
            cover` (index.html) puts the whole page under Safari's bars, so this — the topmost row
            either way — pads itself clear of them: the status bar/notch above in portrait, and
            whichever physical edge is now "left" (env() tracks the current orientation, not a
            fixed side) once the row itself has moved there for `short:` */}
        {/* z-40 and opaque so it sits over the board area; the log drawer below is the one thing
            that outranks it (`z-50`), since a drawer is a dialog and dismisses on its own scrim
            rather than through the button it covers */}
        <div className="z-40 flex shrink-0 items-center gap-1 bg-white px-2 pt-[env(safe-area-inset-top)] dark:bg-neutral-950 short:absolute short:inset-y-0 short:left-0 short:w-11 short:flex-col short:justify-center short:px-0 short:pt-[env(safe-area-inset-top)] short:pb-[env(safe-area-inset-bottom)] short:pl-[env(safe-area-inset-left)]">
          <Link
            to="/"
            aria-label={t('common.back')}
            className="flex size-11 shrink-0 items-center justify-center"
          >
            <ArrowLeft className="size-5" />
          </Link>
          {intro && <InfoButton title={title} intro={intro} />}
          {chrome}
          <button
            type="button"
            aria-label={t('table.logDrawer')}
            aria-expanded={logOpen}
            onClick={() => setLogOpen(!logOpen)}
            className="flex size-11 shrink-0 items-center justify-center"
          >
            <ScrollText className="size-5" />
          </button>
        </div>

        {/* padded clear of the gutter chrome, so the square still centres on what is left — widened
            by the same inset the chrome column itself just grew by, so the reservation still
            matches its real width.
            `container-type: size` is what makes the square actually fit: `Table` caps itself at
            `100cqh` of *this* box, which is the height genuinely left over after the chrome row and
            the hand strip have taken theirs — the `--board-max-h` guess below can only estimate
            those. Outside a size container that same term falls back to the small viewport, which
            is why the inline layout is unaffected. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size] short:pl-[calc(2.75rem+env(safe-area-inset-left))]">
          {board ? (
            board
          ) : (
            // a boardless trainer (shanten, solo) has nothing to put in the middle of the stage, so
            // its column content goes here rather than being dropped for the duration — solo's
            // river lives in there, and a fullscreen where you cannot see your own discards is not
            // a table
            <div className="max-h-full overflow-auto px-2">{children}</div>
          )}
          {!docked && (noticeCompact ?? notice) && noticeShown && (
            // pointer-events-none: a notice must never sit between the reader and a tile they are
            // about to click, which is the whole difference between this and a dialog. Held
            // sideways it stops floating over the board at all and stands in the right-hand
            // gutter instead — sized so it cannot reach the square (the board is `--board-max-h`
            // wide there, centred in what is left after the chrome column), because feedback that
            // covers the tiles it is talking about is feedback you have to wait out. Compact here:
            // a phone mid-drill has no room for `notice`'s tile lists and ukeire counts, and the
            // full breakdown is a tap away in the panel — `noticeCompact` is what actually renders,
            // falling back to `notice` only for a caller with nothing compact to say. With the
            // panel docked it does not render at all: the full feedback is already on screen
            <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center short:inset-x-auto short:top-2 short:bottom-2 short:right-2 short:items-center">
              <div className="max-h-[45%] max-w-md overflow-y-auto rounded-xl bg-white/95 p-3 text-sm shadow-lg ring-1 ring-black/10 short:max-h-full short:max-w-[calc((100svw-2.75rem-var(--board-max-h))/2-0.5rem)] dark:bg-neutral-900/95 dark:ring-white/10">
                {noticeCompact ?? notice}
              </div>
            </div>
          )}
          {end && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 p-3">
              <div className="max-h-full w-[min(92vw,28rem)] overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-neutral-900">
                {end}
              </div>
            </div>
          )}
        </div>

        {/* capped: the claim prompt and the kita/kan row make this strip taller some turns, and it
            must take that out of its own scroll rather than out of the board. Always the bottom-
            most (and, held sideways, still the full-width) row regardless of orientation, so it
            carries the bottom inset (the home indicator) plus the side ones (a landscape notch)
            rather than the chrome row above, which only ever owns one edge at a time */}
        <div
          data-testid="hand-strip"
          className="flex max-h-[35svh] shrink-0 justify-center overflow-auto pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))]"
        >
          {hand}
        </div>
      </div>

      {/* wide enough to hold both: the panel is a column of its own beside the board rather than
          something you open over it, so the full feedback, the score and the log are all readable
          without ever hiding a tile */}
      {docked && (
        <aside
          data-testid="session-panel"
          className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white p-2 pt-[calc(0.5rem+env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <SessionPanel status={status} notice={notice} panel={panel} />
        </aside>
      )}

      {/* below `lg` the same panel is a drawer, and it is the stage's own rather than the board
          area's: it spans the whole overlay so it covers the hand strip too. Opened from a row
          that sits above the hand, a panel that stopped at the board's bottom edge left the tiles
          it was meant to be read over showing underneath it.
          It sits *above* the chrome row (`z-50` against its `z-40`) and brings a scrim with it,
          the same shape every dialog in the app has: pressing outside closes it, so covering the
          button that opened it costs nothing */}
      {drawerOpen && (
        <div
          onClick={(e) => e.target === e.currentTarget && setLogOpen(false)}
          className="absolute inset-0 z-50 bg-black/40"
        >
          <div
            data-testid="log-drawer"
            // it reaches the top of the overlay now, so it owns the top inset too — under Safari's
            // bars the first log row would otherwise start beneath the notch
            className="absolute inset-y-0 right-0 flex w-[min(90vw,22rem)] flex-col border-l border-neutral-200 bg-white p-2 pt-[calc(0.5rem+env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] dark:border-neutral-800 dark:bg-neutral-950"
          >
            <SessionPanel status={status} notice={notice} panel={panel} />
          </div>
        </div>
      )}
    </div>
  )
}
