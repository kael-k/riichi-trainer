import { ArrowLeft, Info, ScrollText } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { SettingsButton } from '../../features/settings/SettingsDialog'
import { boardScale, DEFAULT_TILE_SCALE, useSettings } from '../../features/settings/settingsStore'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useLog } from '../../store/log'
import { InfoPopover } from '../InfoPopover'
import { LogList } from '../LogList'
import { useMobileFullscreen } from './useMobileFullscreen'

/** Where the session panel stops being a drawer and becomes a column of its own, docked beside the
 *  board and open by default — Tailwind's `lg`. Below it the board needs every pixel of width it
 *  can get, so the same content is a drawer you pull over the top instead. */
export const WIDE_QUERY = '(min-width: 1024px)'

export interface TrainerIntro {
  /** Beginner-facing explanation of what the trainer drills. */
  text: string
  /** riichi.wiki page with the full rules/theory, if one exists for this trainer's topic. */
  wikiUrl?: string
}

interface BoardStageProps {
  /** The `Table` itself, built by the page. Omitted by the boardless trainers (shanten, solo):
   *  their content goes through `children` instead, centred where the felt would be. Each seat's
   *  own info strip lives on the felt itself (`Table`'s `seatInfo`), not here. */
  board?: ReactNode
  /** Your hand and the controls that belong to it (kita/kan, riichi, the claim prompt), along the
   *  bottom edge of the stage the way a real table puts your tiles along your own edge of the
   *  felt. Omitted by shanten: it has no felt, and puts its puzzle (tiles plus the guess controls)
   *  through `board` instead so the stage centres it rather than pinning it to the hand strip. */
  hand?: ReactNode
  /** The trainer's own score/accuracy/clock lines, as plain children of a small column — the
   *  session panel styles them. */
  status?: ReactNode
  /** Per-action feedback, in full: tile lists, ukeire counts, the lot. What the session panel
   *  shows. */
  notice?: ReactNode
  /** The same feedback, one `Verdict` line (icon, colour, short text, `features/table/Verdict.tsx`)
   *  — what floats over the board when the session panel is not on screen to hold the full one,
   *  since a phone mid-drill has no room for tile lists and the full breakdown is a tap away in
   *  the panel either way. Falls back to `notice` when omitted, so a caller with nothing compact
   *  to say still gets *something* rather than a silent gap. */
  noticeCompact?: ReactNode
  /** Bumped whenever `notice`/`noticeCompact` is a *new* one — that is what re-shows a faded
   *  floating notice. A notice whose key has not moved stays hidden, so re-renders do not
   *  resurrect it. The panel's own copy never fades and ignores this. */
  noticeKey?: string | number
  /** Shown once the hand is over, as a centred card over the board. */
  end?: ReactNode
  /** The trainer's own extras — wall reveal, share link, the lab's rankings. They live in the
   *  session panel beside the log, since they are things you read *about* the board rather than
   *  play on it. */
  panel?: ReactNode
  /** Board-area content for a trainer that has no felt (shanten's puzzle, solo's river), and the
   *  place a trainer with nothing dealt yet says so (folding's "dealing…", the lab's empty state).
   *  Centred where the board would otherwise be. */
  children?: ReactNode
  /** Called with `true` while the session panel is covering the board, so a graded trainer can
   *  stop its clock — reading back over the log is not thinking time. Only fires for the drawer:
   *  a panel docked beside the board hides nothing and must never pause the hand. */
  onLogOpen?: (open: boolean) => void
  /** The page's own command buttons for the chrome row: its start/pause, undo and reset. Back to
   *  home, the info button, the log toggle and the settings dialog are this component's own —
   *  every trainer has those, and their order must not be a per-page decision. */
  chrome?: ReactNode
  /** Form controls rendered inside the settings dialog, above the shared sections; omit to show
   *  the shared ones alone. */
  settings?: ReactNode
  /** The trainer's own title: names the settings dialog and the info popover. */
  title: string
  /** Shown behind the info button in the chrome row; omit to hide that button. */
  intro?: TrainerIntro
}

/** How long a floating notice stays up. Long enough to read a discard's feedback, short enough
 *  that it is gone before the next turn's decision — it never blocks the board either way. */
const NOTICE_MS = 6000

/** Info button explaining what the trainer drills, with an optional link to the full
 *  rules/theory on riichi.wiki. Also used by the home page's own trainer cards. */
export function InfoButton({ title, intro }: { title: string; intro: TrainerIntro }) {
  const { t } = useTranslation()
  return (
    <InfoPopover
      triggerLabel={t('common.aboutTrainer')}
      trigger={<Info className="size-5" />}
      triggerClassName="flex size-11 items-center justify-center"
      dialogTitle={t('common.aboutTrainerTitle', { title })}
      text={intro.text}
      wikiUrl={intro.wikiUrl}
    />
  )
}

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
 * The trainer interface. Not one of two shapes any more — the board fills the viewport at every
 * size, the way a real client's table does, and everything a hand needs is on it: the command row
 * along the top (or down the left gutter held sideways), the felt, your own tiles along the bottom
 * edge, and the session panel beside them.
 */
export function BoardStage({
  board,
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
  settings,
  title,
  intro,
}: BoardStageProps) {
  const { t } = useTranslation()
  const tileScale = useSettings((s) => s.tileScale) ?? DEFAULT_TILE_SCALE
  const clearLog = useLog((s) => s.clear)
  const wide = useMediaQuery(WIDE_QUERY)
  const [logOpen, setLogOpen] = useState(wide)
  const [noticeShown, setNoticeShown] = useState(false)
  // the same panel in its two shapes: docked beside the board it covers nothing, so it is open by
  // default and the full feedback lives there; as a drawer it is over the top of the board, so it
  // is shut by default and pauses the clock for as long as it is open
  const docked = wide && logOpen
  const drawerOpen = logOpen && !wide

  useMobileFullscreen()

  // The log store is a single global instance; each trainer page starts its own log. Cleared on
  // this component's first render rather than from a mount effect: effects run children-first, so
  // a page whose round writes rows as it mounts (efficiency logs the discards a shared link
  // replays) would have them wiped a moment later by the stage around it.
  const cleared = useRef(false)
  if (!cleared.current) {
    cleared.current = true
    clearLog()
  }

  // re-show on a genuinely new notice, then hide it again on a timer. Keyed rather than watching
  // `notice` itself: the node is rebuilt every render, so its identity says nothing
  useEffect(() => {
    if (noticeKey === undefined) return
    setNoticeShown(true)
    const id = setTimeout(() => setNoticeShown(false), NOTICE_MS)
    return () => clearTimeout(id)
  }, [noticeKey])

  // crossing the breakpoint changes what the panel *is*, so it goes back to that shape's own
  // default: docked and open beside a wide board, shut on anything narrower — a drawer left
  // standing over the board after a resize would be covering tiles nobody asked to hide
  useEffect(() => {
    setLogOpen(wide)
  }, [wide])

  // the pause is owed to the *drawer* alone, since only that shape hides the board — reported from
  // an effect on that one derived fact rather than from the click handler, so every way it can
  // change (a resize, Escape, the scrim) resumes the clock exactly once, and a pause the reader
  // pressed themselves is never lifted by a panel that was already shut
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

  return (
    <div
      // the board claims the viewport rather than sharing it with a header, a status bar and a log
      // panel — `--board-max-h` is what `Table` sizes its square against, so the strips this layout
      // keeps for itself are reserved here rather than guessed at there. Held sideways that is the
      // hand alone: the chrome has moved into the gutter beside the square
      className="relative flex h-svh w-full bg-white [--board-max-h:calc(100svh-6rem)] short:[--board-max-h:calc(100svh-4rem)] dark:bg-neutral-950"
      style={
        {
          '--tile-w-base': `calc(var(--tile-w-raw) * ${tileScale})`,
          // one size setting over the whole table: the tiles scale by the line above, and the felt
          // they lie on scales with them by this one, so S is a small board with small tiles
          // rather than small tiles marooned on the same board XL gets
          '--board-scale': boardScale(tileScale),
          // re-declared here (not just --tile-w-base) so plain, non-overriding tile usages (the
          // hand itself) actually pick up the scale: --tile-w's var() reference resolves once at
          // whichever element declares it, not freshly per inheriting descendant
          '--tile-w': 'var(--tile-w-base)',
        } as CSSProperties
      }
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* a row above the board normally; standing in the left gutter held sideways, where it
            costs the square no height at all. Everything a hand needs mid-drill is here.
            `viewport-fit=cover` (index.html) puts the whole page under Safari's bars, so this —
            the topmost row either way — pads itself clear of them: the status bar/notch above in
            portrait, and whichever physical edge is now "left" (env() tracks the current
            orientation, not a fixed side) once the row itself has moved there for `short:`.
            z-40 and opaque so it sits over the board area; the log drawer below is the one thing
            that outranks it (`z-50`), since a drawer is a dialog and dismisses on its own scrim
            rather than through the button it covers.
            Settings is last, after the page's own controls and the log toggle: it is the one
            button here that is about the app rather than about this hand. */}
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
          <SettingsButton title={title}>{settings}</SettingsButton>
        </div>

        {/* padded clear of the gutter chrome, so the square still centres on what is left — widened
            by the same inset the chrome column itself just grew by, so the reservation still
            matches its real width.
            `container-type: size` is what makes the square actually fit: `Table` caps itself at
            `100cqh` of *this* box, which is the height genuinely left over after the chrome row and
            the hand strip have taken theirs — the `--board-max-h` guess above can only estimate
            those. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size] short:pl-[calc(2.75rem+env(safe-area-inset-left))]">
          {board ? (
            board
          ) : (
            // a boardless trainer (shanten, solo) has nothing to put in the middle of the stage,
            // and neither has one that has not dealt yet — solo's river lives in here, and a table
            // where you cannot see your own discards is not a table
            <div className="max-h-full overflow-auto px-2">{children}</div>
          )}
          {!logOpen && (noticeCompact ?? notice) && noticeShown && (
            // pointer-events-none: a notice must never sit between the reader and a tile they are
            // about to click, which is the whole difference between this and a dialog. Held
            // sideways it stops floating over the board at all and stands in the right-hand
            // gutter instead — sized so it cannot reach the square (the board is `--board-max-h`
            // wide there, centred in what is left after the chrome column), because feedback that
            // covers the tiles it is talking about is feedback you have to wait out. Compact here:
            // a phone mid-drill has no room for `notice`'s tile lists and ukeire counts, and the
            // full breakdown is a tap away in the panel. With the panel open in either shape it
            // does not render at all: the full feedback is already on screen, and saying the same
            // thing twice is how a reader ends up looking for a difference that isn't there
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

      {/* below `lg` the same panel is a drawer spanning the whole stage, so it covers the hand
          strip too. Opened from a row that sits above the hand, a panel that stopped at the
          board's bottom edge left the tiles it was meant to be read over showing underneath it.
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
            // it reaches the top of the stage, so it owns the top inset too — under Safari's bars
            // the first log row would otherwise start beneath the notch
            className="absolute inset-y-0 right-0 flex w-[min(90vw,22rem)] flex-col border-l border-neutral-200 bg-white p-2 pt-[calc(0.5rem+env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] dark:border-neutral-800 dark:bg-neutral-950"
          >
            <SessionPanel status={status} notice={notice} panel={panel} />
          </div>
        </div>
      )}
    </div>
  )
}
