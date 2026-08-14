import { ArrowLeft, Maximize2, Minimize2, ScrollText } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LogList } from '../TrainerLayout'

interface BoardStageProps {
  /** The `Table` itself, built by the page. The fullscreen toggle is handed back to it through
   *  its own `controls` prop rather than wrapped around it — see `Table`'s note on why the width
   *  has to live on the board's own box. Each seat's own info strip lives on the felt itself
   *  (`Table`'s `seatInfo`), not here. */
  board: (controls: ReactNode) => ReactNode
  /** Your hand and the controls that belong to it (kita/kan, riichi, the claim prompt) — the
   *  only part of the column that follows the board into fullscreen. */
  hand: ReactNode
  /** Per-action feedback. Inline it sits in the column as it always has; in fullscreen it floats
   *  over the board as a notice that fades on its own and never takes a click. */
  notice?: ReactNode
  /** Bumped whenever `notice` is a *new* one — that is what re-shows a faded notice. A notice
   *  whose key has not moved stays hidden, so re-renders do not resurrect it. */
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
}

/** How long a fullscreen notice stays up. Long enough to read a discard's feedback, short enough
 *  that it is gone before the next turn's decision — it never blocks the board either way. */
const NOTICE_MS = 6000

/**
 * The shared board layout, in its two shapes: stacked in the page (board, then the column beside
 * or under it), or filling the viewport like a real client's table.
 *
 * Fullscreen is entered by an explicit button rather than by orientation, so it is reachable on
 * any device and never takes the screen from someone who did not ask. It is a fixed overlay
 * *and* a real `requestFullscreen` where the browser has one — the overlay is what actually lays
 * the board out, the API call is only there to drop the browser chrome on a phone.
 */
export function BoardStage({
  board,
  hand,
  notice,
  noticeKey,
  end,
  children,
  onLogOpen,
  chrome,
}: BoardStageProps) {
  const { t } = useTranslation()
  const [full, setFull] = useState(false)
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
    void stage.current?.requestFullscreen?.().catch(() => {})
    // Escape (or the browser's own control) leaves fullscreen without going through our button
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
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
        if (full) toggleLog(false)
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
        {board(fullscreenButton)}
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
          fullscreen is somewhere you can stay rather than somewhere you visit */}
      <div className="z-10 flex shrink-0 items-center gap-1 px-2 short:absolute short:inset-y-0 short:left-0 short:w-11 short:flex-col short:justify-center short:px-0">
        <Link
          to="/"
          aria-label={t('common.back')}
          className="flex size-11 shrink-0 items-center justify-center text-neutral-500"
        >
          <ArrowLeft className="size-5" />
        </Link>
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

      {/* padded clear of the gutter chrome, so the square still centres on what is left */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center short:pl-11">
        {board(null)}
        {notice && noticeShown && (
          // pointer-events-none: a notice must never sit between the reader and a tile they are
          // about to click, which is the whole difference between this and a dialog. Held
          // sideways it stops floating over the board at all and stands in the right-hand
          // gutter instead — sized so it cannot reach the square (the board is `--board-max-h`
          // wide there, centred in what is left after the chrome column), because feedback that
          // covers the tiles it is talking about is feedback you have to wait out
          <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center short:inset-x-auto short:top-2 short:bottom-2 short:right-2 short:items-center">
            <div className="max-h-[45%] max-w-md overflow-y-auto rounded-xl bg-white/95 p-3 text-sm shadow-lg ring-1 ring-black/10 short:max-h-full short:max-w-[calc((100svw-2.75rem-var(--board-max-h))/2-0.5rem)] dark:bg-neutral-900/95 dark:ring-white/10">
              {notice}
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
        {logOpen && (
          <div className="absolute inset-y-0 right-0 flex w-[min(90vw,22rem)] flex-col border-l border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-950">
            <LogList />
          </div>
        )}
      </div>

      {/* capped: the claim prompt and the kita/kan row make this strip taller some turns, and it
          must take that out of its own scroll rather than out of the board */}
      <div className="flex max-h-[35svh] shrink-0 justify-center overflow-auto px-2 pb-2">
        {hand}
      </div>
    </div>
  )
}
