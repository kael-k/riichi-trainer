import { ArrowLeft, Maximize2, Minimize2, ScrollText } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSettings } from '../../features/settings/settingsStore'
import { InfoButton, LogList, type TrainerIntro } from '../TrainerLayout'

/** A phone-sized viewport — the breakpoint `mobileFullscreen` auto-enters at. The height half is
 *  the same 520px the `short:` variant keys on: a phone held sideways is the viewport with the
 *  least room of all, and on the width test alone it was the one that never auto-entered — the
 *  inline layout there spends its whole height budget on the header, the status row and the hand,
 *  leaving a 214px board on a 750x342 screen. */
const MOBILE_QUERY = '(max-width: 640px), (max-height: 520px)'

interface BoardStageProps {
  /** The `Table` itself, built by the page. Omitted by the boardless trainers (shanten, solo):
   *  their content goes through the ordinary slots below instead, and the fullscreen toggle
   *  moves into its own small row above `hand`. The fullscreen toggle is handed back to it
   *  through its own `controls` prop rather than wrapped around it — see `Table`'s note on why
   *  the width has to live on the board's own box. Each seat's own info strip lives on the felt
   *  itself (`Table`'s `seatInfo`), not here. */
  board?: (controls: ReactNode) => ReactNode
  /** Your hand and the controls that belong to it (kita/kan, riichi, the claim prompt) — the
   *  only part of the column that follows the board into fullscreen. */
  hand: ReactNode
  /** Per-action feedback. Inline it sits in the column as it always has, full detail (tile lists,
   *  ukeire counts) included — there is space for it there, and it is what Req 1.3 calls "check
   *  the log if you want full feedback". */
  notice?: ReactNode
  /** The same feedback, one `Verdict` line (icon, colour, short text, `features/table/Verdict.tsx`)
   *  — what floats over the board in fullscreen instead of `notice`, since a phone mid-drill has
   *  no room for tile lists and the full breakdown is a tap away in the log either way. Falls back
   *  to `notice` when omitted, so a caller with nothing compact to say (or a page that has not
   *  adopted the split yet) still gets *something* in fullscreen rather than a silent gap. */
  noticeCompact?: ReactNode
  /** Bumped whenever `notice`/`noticeCompact` is a *new* one — that is what re-shows a faded
   *  notice. A notice whose key has not moved stays hidden, so re-renders do not resurrect it. */
  noticeKey?: string | number
  /** Shown once the hand is over: in the column inline, as a centred card in fullscreen. */
  end?: ReactNode
  /** Everything else the column holds (wall reveal, share link, round summaries) — inline only.
   *  Fullscreen is the board and the hand; the rest is what you leave fullscreen to read. */
  children?: ReactNode
  /** Called with `true` while the fullscreen log drawer is open, so a graded trainer can stop its
   *  clock — reading back over the log is not thinking time. */
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

/** How long a fullscreen notice stays up. Long enough to read a discard's feedback, short enough
 *  that it is gone before the next turn's decision — it never blocks the board either way. */
const NOTICE_MS = 6000

/**
 * The shared board layout, in its two shapes: stacked in the page (board, then the column beside
 * or under it), or filling the viewport like a real client's table.
 *
 * Auto-entered on phone-sized viewports behind `mobileFullscreen`, a persisted setting that
 * defaults on — every trainer, board or boardless, comes up already filling the screen on a
 * phone. The explicit toggle button still exists for every other viewport, and exiting on a
 * phone writes the opt-out rather than just closing for that one visit. It is a fixed overlay
 * *and* a real `requestFullscreen` where the browser has one — the overlay is what actually lays
 * the board out; the API call only drops the browser chrome, and only ever fires inside a real
 * user gesture (a load-time call is rejected outright), so an auto-entered stage waits for the
 * reader's first tap before attempting it, rather than trying at mount and failing silently.
 */
export function BoardStage({
  board,
  hand,
  notice,
  noticeCompact,
  noticeKey,
  end,
  children,
  onLogOpen,
  chrome,
  title,
  intro,
}: BoardStageProps) {
  const { t } = useTranslation()
  const mobileFullscreen = useSettings((s) => s.mobileFullscreen)
  const setMobileFullscreen = useSettings((s) => s.setMobileFullscreen)
  const [full, setFull] = useState(() => mobileFullscreen && matchMedia(MOBILE_QUERY).matches)
  // whether *this* entry into fullscreen happened with no gesture behind it yet (true only for
  // an auto-entered stage, and only until the first tap resolves it) — captured once per entry,
  // not just at mount, so leaving and manually re-entering later still requests real fullscreen
  // immediately like any other button press
  const enteredWithoutGesture = useRef(full)
  const [logOpen, setLogOpen] = useState(false)
  const [noticeShown, setNoticeShown] = useState(false)
  const stage = useRef<HTMLDivElement>(null)

  // re-show on a genuinely new notice, then hide it again on a timer. Keyed rather than watching
  // `notice` itself: the node is rebuilt every render, so its identity says nothing
  useEffect(() => {
    if (noticeKey === undefined) return
    setNoticeShown(true)
    const id = setTimeout(() => setNoticeShown(false), NOTICE_MS)
    return () => clearTimeout(id)
  }, [noticeKey])

  // the browser's own fullscreen, where it exists. Failures are ignored on purpose: iOS Safari
  // has no element fullscreen at all, and the fixed overlay below is the part that matters
  useEffect(() => {
    if (!full) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      return
    }
    const el = stage.current
    const requestReal = () => {
      if (!document.fullscreenElement) void el?.requestFullscreen?.().catch(() => {})
    }
    // StrictMode replays this effect (mount, cleanup, mount again) with no real pointerdown in
    // between, so the flag can only be cleared *inside* the listener itself — clearing it eagerly
    // here would have the synthetic second mount see it already false and fire the real call with
    // no gesture behind it after all
    let onFirstPointerDown: (() => void) | undefined
    if (enteredWithoutGesture.current) {
      onFirstPointerDown = () => {
        enteredWithoutGesture.current = false
        requestReal()
      }
      el?.addEventListener('pointerdown', onFirstPointerDown, { once: true })
    } else {
      requestReal()
    }
    // Escape (or the browser's own control) leaves fullscreen without going through our button
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      if (onFirstPointerDown) el?.removeEventListener('pointerdown', onFirstPointerDown)
      document.removeEventListener('fullscreenchange', onChange)
    }
  }, [full])

  const toggleLog = (open: boolean) => {
    setLogOpen(open)
    onLogOpen?.(open)
  }

  const fullscreenButton = (
    <button
      type="button"
      aria-label={t(full ? 'table.exitFullscreen' : 'table.fullscreen')}
      aria-pressed={full}
      onClick={() => {
        if (full) {
          toggleLog(false)
          // the persisted opt-out: closing it once on a phone means "not by default" from here
          // on, not just "not this visit" — the settings row is how it comes back
          if (matchMedia(MOBILE_QUERY).matches) setMobileFullscreen(false)
        } else {
          enteredWithoutGesture.current = false
        }
        setFull(!full)
      }}
      className="flex size-11 items-center justify-center text-neutral-500"
    >
      {full ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
    </button>
  )

  if (!full) {
    return (
      // the hand stays under the board at every size. Held sideways it used to move *beside* it,
      // which fits more on screen but is not the table anyone has ever played on: a real client
      // (and every physical table) puts your tiles along your own edge of the felt
      <div className="flex flex-col gap-4">
        {board ? (
          board(fullscreenButton)
        ) : (
          // boardless trainers (shanten, solo) have no `Table` to hand the toggle to — it gets
          // its own row instead of vanishing along with the board
          <div className="flex justify-end">{fullscreenButton}</div>
        )}
        <div className="flex min-w-0 flex-col gap-4">
          {hand}
          {notice}
          {end}
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={stage}
      // the board claims the viewport instead of sharing it with the header, status bar and log
      // panel — `--board-max-h` is what `Table` sizes its square against, so the strips this
      // layout keeps for itself are reserved here rather than guessed at there. Held sideways
      // that is the hand alone: the chrome has moved into the gutter beside the square, and so
      // has `Table`'s own control row (`--board-controls`, zeroed by the same `short:` variant)
      // `--table-max` is the desktop "don't balloon" cap, which is exactly what fullscreen is
      // for — lifted out of the way here so `--board-max-h` is what actually sizes the square
      className="fixed inset-0 z-40 flex flex-col bg-white [--board-max-h:calc(100svh-6rem)] [--table-max:100svh] short:[--board-max-h:calc(100svh-4rem)] dark:bg-neutral-950"
    >
      {/* a row above the board normally; standing in the left gutter held sideways, where it
          costs the square no height at all. Everything a hand needs mid-drill is here, so
          fullscreen is somewhere you can stay rather than somewhere you visit. `viewport-fit=
          cover` (index.html) puts the whole page under Safari's bars, so this — the topmost row
          either way — pads itself clear of them: the status bar/notch above in portrait, and
          whichever physical edge is now "left" (env() tracks the current orientation, not a
          fixed side) once the row itself has moved there for `short:` */}
      {/* z-40 and opaque: the log drawer below spans the whole overlay (it has to cover the hand
          strip), so this row has to stay above it — otherwise the drawer buries the very button
          that closes it */}
      <div className="z-40 flex shrink-0 items-center gap-1 bg-white px-2 pt-[env(safe-area-inset-top)] dark:bg-neutral-950 short:absolute short:inset-y-0 short:left-0 short:w-11 short:flex-col short:justify-center short:px-0 short:pt-[env(safe-area-inset-top)] short:pb-[env(safe-area-inset-bottom)] short:pl-[env(safe-area-inset-left)]">
        <Link
          to="/"
          aria-label={t('common.back')}
          className="flex size-11 shrink-0 items-center justify-center text-neutral-500"
        >
          <ArrowLeft className="size-5" />
        </Link>
        {intro && <InfoButton title={title} intro={intro} />}
        {chrome}
        <button
          type="button"
          aria-label={t('table.logDrawer')}
          aria-expanded={logOpen}
          onClick={() => toggleLog(!logOpen)}
          className="flex size-11 shrink-0 items-center justify-center text-neutral-500"
        >
          <ScrollText className="size-5" />
        </button>
        <span className="ml-auto short:ml-0">{fullscreenButton}</span>
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
          board(null)
        ) : (
          // a boardless trainer (shanten, solo) has nothing to put in the middle of the stage, so
          // its column content goes here rather than being dropped for the duration — solo's
          // river lives in there, and a fullscreen where you cannot see your own discards is not
          // a table
          <div className="max-h-full overflow-auto px-2">{children}</div>
        )}
        {(noticeCompact ?? notice) && noticeShown && (
          // pointer-events-none: a notice must never sit between the reader and a tile they are
          // about to click, which is the whole difference between this and a dialog. Held
          // sideways it stops floating over the board at all and stands in the right-hand
          // gutter instead — sized so it cannot reach the square (the board is `--board-max-h`
          // wide there, centred in what is left after the chrome column), because feedback that
          // covers the tiles it is talking about is feedback you have to wait out. Compact here:
          // a phone mid-drill has no room for `notice`'s tile lists and ukeire counts, and the
          // full breakdown is a tap away in the log — `noticeCompact` is what actually renders,
          // falling back to `notice` only for a caller with nothing compact to say
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

      {/* the drawer is the stage's own, not the board area's: it spans the whole overlay so it
          covers the hand strip too. Opened from a row that sits above the hand, a panel that
          stopped at the board's bottom edge left the tiles it was meant to be read over showing
          underneath it */}
      {logOpen && (
        <div
          data-testid="log-drawer"
          className="absolute inset-y-0 right-0 z-30 flex w-[min(90vw,22rem)] flex-col border-l border-neutral-200 bg-white p-2 pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <LogList />
        </div>
      )}
    </div>
  )
}
