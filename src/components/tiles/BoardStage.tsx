import { ArrowLeft, Info, ScrollText } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { SettingsButton } from '../../features/settings/SettingsDialog'
import {
  BOARD_SCALES,
  DEFAULT_TILE_SCALE,
  TILE_SCALES,
  useSettings,
} from '../../features/settings/settingsStore'
import type { TableApp } from '../../features/settings/tableSettings'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useLog } from '../../store/log'
import { InfoPopover } from '../InfoPopover'
import { LogList } from '../LogList'
import { ChromeLabel, CHROME_BUTTON } from '../TrainerControls'
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
  /** The trainer's own score/accuracy/clock lines. A boxed HUD reserved above the board, top-left,
   *  rather than living in the session panel — a clock behind a drawer tap is a clock nobody reads.
   *  Real flow, not a float: the board is pushed down to make room for it rather than covering
   *  whatever seat's plate would otherwise sit there. Always on screen, panel open or shut. */
  status?: ReactNode
  /** Per-action feedback, one `Verdict` line (icon, colour, short text,
   *  `features/table/Verdict.tsx`) — what floats over the board. The only density there is: the
   *  full breakdown, tile lists and all, is a tap away on the action's own log row. */
  noticeCompact?: ReactNode
  /** Bumped whenever `noticeCompact` is a *new* one — that is what re-shows a faded
   *  floating notice. A notice whose key has not moved stays hidden, so re-renders do not
   *  resurrect it. The panel's own copy never fades and ignores this. */
  noticeKey?: string | number
  /** Shown once the hand is over, as a centred card over the board. */
  end?: ReactNode
  /** The trainer's own extras — share link, the lab's rankings. They live in the session panel
   *  beside the log, since they are things you read *about* the board rather than play on it. */
  panel?: ReactNode
  /** The wall reveal (`WallDetails`, which is its own button + dialog), given a place of its own
   *  in the chrome row rather than a row in the panel behind a setting. Omitted only by a trainer
   *  that has no wall to show — shanten deals no wall at all, and the board trainers pass nothing
   *  until they have dealt one. */
  wall?: ReactNode
  /** Board-area content for a trainer that has no felt (shanten's puzzle, solo's river), and the
   *  place a trainer with nothing dealt yet says so (folding's "dealing…", the lab's empty state).
   *  Centred where the board would otherwise be. */
  children?: ReactNode
  /** Read `children` as something that grows down the page rather than one block posed in the
   *  middle of the stage. It is anchored to the top of the board area and given its full width
   *  to size itself off, and from `roomy:` up the area stops reserving the height it isn't using,
   *  so the hand rides up under the content instead of standing at the bottom of an empty screen.
   *  Below that gate — a phone either way up, a tablet — nothing moves: the hand keeps the bottom
   *  edge the way a felt gives it (`Table`), and the content scrolls in what is left. Content that
   *  rides up has to be a fixed height whatever it holds, or the hand walks down the screen as it
   *  fills; that is the page's own job, not this one's. Solo efficiency's river is the one thing shaped like this — the other
   *  boardless slots hold a single line ("Dealing…"), which reads better centred. */
  flow?: boolean
  /** Called with `true` while the session panel is covering the board, so a graded trainer can
   *  stop its clock — reading back over the log is not thinking time. Only fires for the drawer:
   *  a panel docked beside the board hides nothing and must never pause the hand. */
  onLogOpen?: (open: boolean) => void
  /** The page's own command buttons for the chrome row: its start/pause, undo and reset. Back to
   *  home, the info button, the log toggle and the settings dialog are this component's own —
   *  every trainer has those, and their order must not be a per-page decision. */
  chrome?: ReactNode
  /** Form controls rendered inside the settings dialog, in their own section headed `title`; omit
   *  to show the shared sections alone. */
  settings?: ReactNode
  /** The trainer's table-settings id (`tableSettings.ts`), if it draws a `Table` — gates the
   *  dialog's Table section. Omitted by trainers with no board (shanten) or no settings surface
   *  for it yet (efficiency-solo). */
  app?: TableApp
  /** The trainer's own title: names the settings section and the info popover. */
  title: string
  /** Shown behind the info button in the chrome row; omit to hide that button. */
  intro?: TrainerIntro
}

/** How long a floating notice stays up. Long enough to read a discard's feedback, short enough
 *  that it is gone before the next turn's decision — it never blocks the board either way. */
const NOTICE_MS = 6000

/** Info button explaining what the trainer drills, with an optional link to the full
 *  rules/theory on riichi.wiki. Also used by the home page's own trainer cards — which is why the
 *  name beside the icon is opt-in: it belongs to the chrome row, where it tells a line of
 *  unlabelled icons apart. On the home page every card already carries its own title, and six
 *  "About"s down the right-hand edge are six repetitions of nothing. */
export function InfoButton({
  title,
  intro,
  labelled,
}: {
  title: string
  intro: TrainerIntro
  labelled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <InfoPopover
      triggerLabel={t('common.aboutTrainer')}
      trigger={
        <>
          <Info className="size-5" />
          {labelled && <ChromeLabel>{t('common.aboutTrainer')}</ChromeLabel>}
        </>
      }
      triggerClassName={CHROME_BUTTON}
      dialogTitle={t('common.aboutTrainerTitle', { title })}
      text={intro.text}
      wikiUrl={intro.wikiUrl}
    />
  )
}

/** The stats HUD's own card — shared by its two placements (real flow on a narrow portrait phone,
 *  floating everywhere else) so the two can't drift out of style with each other. */
function StatusCard({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="stats-hud"
      className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 bg-white/95 px-3 py-2 text-xs text-neutral-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-400"
    >
      {children}
    </div>
  )
}

/**
 * Everything that is not the board or the hand: whatever the trainer wants to say about the board
 * (the lab's rankings and wall authoring, the one remaining consumer), and the log menu — which is
 * now the feedback surface too, every turn of it rather than the last one. One renderer
 * for both surfaces it appears on — docked beside the board from `lg` up, pulled over the top in a
 * drawer below that — so the two cannot drift apart.
 */
function SessionPanel({ panel }: Pick<BoardStageProps, 'panel'>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {panel && (
        // `flex-auto` on both halves rather than a fixed share: each is based on its own content
        // and only gives ground in proportion to it, so a long ranking gets the room an empty log
        // is not using, and a log that has run all game still keeps its own.
        // Tiles here are read, not played, and the column is 320px on a laptop: at the hand's own
        // size a single ukeire list filled the panel on its own, so they draw at the log's scale
        // instead. `--tile-w-base`, not `--tile-w` alone, so a nested override (`UkeireTiles`
        // scales 0.8 off the base) composes with this one rather than ignoring it
        <div className="flex min-h-0 flex-auto flex-col gap-3 overflow-y-auto [--tile-w-base:calc(var(--tile-w-raw)*var(--tile-scale,1)*0.6)] [--tile-w:var(--tile-w-base)]">
          {panel}
        </div>
      )}
      {/* `-mx-2` spends the panel's own padding: the log's verdict rail then starts on the
          panel's border rather than 8px short of it, and the rule above it reads as a divider
          across the column instead of a line floating inside it */}
      <LogList className="-mx-2 flex-auto border-t border-neutral-200 dark:border-neutral-800" />
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
  noticeCompact,
  noticeKey,
  end,
  panel,
  wall,
  children,
  flow,
  onLogOpen,
  chrome,
  settings,
  app,
  title,
  intro,
}: BoardStageProps) {
  const { t } = useTranslation()
  const tileScale = useSettings((s) => s.tileScale) ?? DEFAULT_TILE_SCALE
  // paired by index rather than stored separately, so the one S-XL row keeps its one meaning
  const boardScale = BOARD_SCALES[(TILE_SCALES as readonly number[]).indexOf(tileScale)] ?? 1
  const clearLog = useLog((s) => s.clear)
  const wide = useMediaQuery(WIDE_QUERY)
  const [logOpen, setLogOpen] = useState(wide)
  const [noticeShown, setNoticeShown] = useState(false)
  // the stage element itself, so the settings sheet can mount inside it rather than on <body> and
  // inherit the `ultrawide:` cap the way the docked panel and the log drawer already do
  const [stage, setStage] = useState<HTMLElement | null>(null)
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
    // `ultrawide:` only, a wrapper around the stage rather than a class on it: the stage's own
    // `relative` is load-bearing (the log drawer and the `end` card are `absolute inset-0` against
    // it), so the cap has to live one level out. The tint is here rather than on `body` — `body`
    // is shared with the home page, which has no stage and must not be tinted — one step off the
    // stage's own bg-white/dark:bg-neutral-950, so the seam reads without a border in either theme.
    <div className="flex h-svh w-full justify-center ultrawide:bg-neutral-100 ultrawide:dark:bg-black">
      <div
        // the board claims the viewport rather than sharing it with a header, a status bar and a
        // log panel. The strips this layout keeps for itself are not reserved by a
        // `100svh`-minus-chrome estimate any more: the board area below declares itself a size
        // container, so `100cqh` is the room genuinely left over and the square measures itself
        // against that alone
        // Both halves of the size setting are gated by the *variant*, not by JS: the preference is
        // always declared, and only a `sizable:` screen resolves it into the variable the board and
        // the tiles read. Below that the board fills its room and the tiles stay at the default,
        // which on a phone is the only size that fits either way up — the setting says so itself
        // (`SIZABLE_QUERY`, `SettingsDialog`) rather than leaving four dead buttons.
        // `ultrawide:max-w-[var(--stage-max)]` stops the stage — and everything docked to its right
        // edge (the session panel) — before it reaches a 21:9 screen's physical edge. `--stage-max`
        // is the square's own height budget plus the panel plus a HUD gutter, so it can never come
        // out narrower than the board needs; the board, the chrome row and the hand
        // are all already centred inside this box, so capping it moves nothing but the panel.
        // the settings sheet portals in here, not onto <body>: this is the box the `ultrawide:` cap
        // is on, so the sheet lands on the same right edge as the panel and its scrim stops at the
        // stage rather than dimming the surround. The wrapper above is uncapped — not that one.
        ref={setStage}
        className="relative flex h-svh w-full bg-white [--board-scale:1] [--tile-scale:var(--tile-scale-default)] sizable:[--board-scale:var(--board-scale-pref)] sizable:[--tile-scale:var(--tile-scale-pref)] ultrawide:max-w-[var(--stage-max)] dark:bg-neutral-950"
        style={
          {
            '--tile-w-base': 'calc(var(--tile-w-raw) * var(--tile-scale))',
            '--tile-scale-pref': tileScale,
            '--tile-scale-default': DEFAULT_TILE_SCALE,
            '--board-scale-pref': boardScale,
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
            button here that is about the app rather than about this hand — and it is pushed to
            the row's right-hand end (`ml-auto`), the corner it keeps on the home page.
            Centred in a capped width like the home page's own column rather than run edge to
            edge: on an ultrawide the buttons would otherwise sit a screen's width away from the
            board they act on. The cap grows for `labelled:`, where every button carries its name
            beside it and the row genuinely needs more than 48rem. Neither applies `short:`, where
            the row is a 44px gutter column instead.
            The air between the buttons goes on the narrowest phones: eight 44px targets plus the
            row's own padding come to 368px, which an iPhone SE's 375px holds — it was the 28px of
            gaps that pushed the settings gear off the end. The buttons themselves never shrink,
            the 44px touch target being the invariant; the space between them is not. */}
          <div className="z-40 mx-auto flex w-full max-w-3xl shrink-0 items-center gap-1 bg-white px-2 pt-[env(safe-area-inset-top)] max-[400px]:gap-0 dark:bg-neutral-950 short:absolute labelled:max-w-5xl short:mx-0 short:max-w-none short:inset-y-0 short:left-0 short:w-11 short:flex-col short:justify-center short:px-0 short:pt-[env(safe-area-inset-top)] short:pb-[env(safe-area-inset-bottom)] short:pl-[env(safe-area-inset-left)]">
            <Link to="/" aria-label={t('common.back')} className={CHROME_BUTTON}>
              <ArrowLeft className="size-5" />
              <ChromeLabel>{t('common.back')}</ChromeLabel>
            </Link>
            {intro && <InfoButton title={title} intro={intro} labelled />}
            {chrome}
            {wall}
            <button
              type="button"
              aria-label={t('table.logDrawer')}
              aria-expanded={logOpen}
              onClick={() => setLogOpen(!logOpen)}
              className={CHROME_BUTTON}
            >
              <ScrollText className="size-5" />
              <ChromeLabel>{t('table.logDrawer')}</ChromeLabel>
            </button>
            {/* right-hand end of the row, the corner it keeps on the home page too */}
            <div className="ml-auto short:ml-0">
              <SettingsButton title={title} app={app} labelled container={stage}>
                {settings}
              </SettingsButton>
            </div>
          </div>

          {/* the gutter offset lives on this outer column, so both the HUD row below and the
            centring row under it stay clear of the chrome column held sideways */}
          {/* `flow` hands the leftover height back here as well as in the board area below: this
            column is what actually reserves it, so a board area that has stopped growing past its
            content only moves the hand up once this one stops too */}
          <div
            className={`flex min-h-0 flex-1 flex-col short:pl-[calc(2.75rem+env(safe-area-inset-left))] ${flow && !board ? 'roomy:flex-initial' : ''}`}
          >
            {status && (
              // Portrait: a row of its own, full width, above the board — upright there is no gutter
              // beside the square to stand in (the board fills the width), and the room left over is
              // all above and below it. Reserved rather than floating, so it can never sit on
              // toimen's plate. It costs the square nothing: upright the square is limited by the
              // width, not by the height this row takes. Hidden in the two shapes that *do* have a
              // gutter (`short:`, `roomy:`), where the block inside the board area below stands in it.
              <div className="shrink-0 p-2 pt-3 short:hidden roomy:hidden">
                <StatusCard>{status}</StatusCard>
              </div>
            )}
            {/* `container-type: size` is what makes the square actually fit: `Table` caps itself at
              `100cqh` of *this* row, which is the height genuinely left over once the chrome row,
              the hand strip and (upright) the HUD row have taken theirs. The margin is `roomy:`,
              not `lg:`: a window with room on both axes can spend 1rem on air around the board,
              while a phone (either way up) and a wide-but-shallow window cannot — there every
              pixel of it is the square's. Padding on the size container itself, so `100cqh` is the
              room inside it and the square shrinks to fit rather than overflowing by that much. */}
            <div
              data-testid="board-area"
              className={
                flow && !board
                  ? // `flow`: the content is a river that grows, not a board that is posed. Anchored
                    // to the top (`items-start`), and from `sizable:` up `flex-initial` hands back
                    // the height it is not using so the hand strip below rides up under it — the
                    // stage stops reserving a screenful for six discards. It still shrinks when the
                    // content outgrows the room (`flex: 0 1 auto` plus `min-h-0`), which is the
                    // whole-wall case: the area fills, the wrapper scrolls, and `pb-6` is the gap
                    // that keeps the last river row off the hand. `min-h-36` is for the floating HUD
                    // that is absolutely positioned in here — a board area shorter than that card
                    // would let it hang out over the hand. `container-type` drops to `inline-size`:
                    // size containment would make this box ignore its own content and collapse, and
                    // `100cqh` belongs to `Table`'s square, which a flow page does not have.
                    'relative flex min-h-0 flex-1 items-start justify-center px-2 pt-2 pb-16 [container-type:inline-size] roomy:min-h-36 roomy:flex-initial roomy:px-4 roomy:pt-4'
                  : 'relative flex min-h-0 flex-1 items-center justify-center [container-type:size] roomy:p-4'
              }
            >
              {board ? (
                board
              ) : (
                // a boardless trainer (shanten, solo) has nothing to put in the middle of the stage,
                // and neither has one that has not dealt yet — solo's river lives in here, and a table
                // where you cannot see your own discards is not a table
                <div className={`max-h-full overflow-auto ${flow ? 'w-full' : 'px-2'}`}>
                  {children}
                </div>
              )}
              {status && (
                // Held sideways and on a window with room to spare, the square is limited by its
                // height, so what is left over is a gutter down each side of it — the HUD stands in
                // the left one rather than over the felt (a 338px board cannot spare its top-left
                // corner: that is a seat's plate and a third of its river). Which edge of that
                // gutter it hugs is the difference between the two:
                //  - held sideways it tucks against the chrome column, `left-2`/`top-2` — the same
                //    inset off the bar and off the screen's own top edge;
                //  - `roomy:` it hangs off the square instead, its top-left corner on the square's
                //    own top-left: `left: gutter - width` puts its right edge exactly on the board's
                //    left edge (the gutter being how far the square starts from this box's left
                //    edge), and `top-0` sits on the board's top edge, the area's own margin having
                //    already pushed both clear of the chrome row above. Positioned from the left
                //    with a `max(0px, …)` rather than anchored with `right`, so a window tall enough
                //    to leave a gutter narrower than the card (a 4:3 desktop, or a tall window with
                //    the panel docked) has it overlap the square's edge rather than slide off screen.
                // Capped either way rather than filling the gutter it stands in: a card the width of
                // the gutter beside a 338px felt is a HUD the size of the board, which reads as the
                // board being small. `--gutter` is measured off the same container the square
                // measures itself against, and `roomy:inset-4` matches the board area's own margin
                // so that both stay in the same coordinates.
                <div className="pointer-events-none absolute inset-0 hidden [--gutter:calc((100cqw-min(100cqw,100cqh)*var(--board-scale,1))/2)] [--hud-w:clamp(7rem,calc(var(--gutter)-1rem),8rem)] short:block roomy:inset-4 roomy:block roomy:[--hud-w:clamp(7rem,calc(var(--gutter)-0.5rem),10rem)]">
                  <div className="pointer-events-auto absolute top-2 left-2 w-[var(--hud-w)] roomy:top-0 roomy:left-[max(0px,calc(var(--gutter)-var(--hud-w)))]">
                    <StatusCard>{status}</StatusCard>
                  </div>
                </div>
              )}
              {!drawerOpen && noticeCompact && noticeShown && (
                // pointer-events-none: a notice must never sit between the reader and a tile they are
                // about to click, which is the whole difference between this and a dialog. Held
                // sideways it stops floating over the board at all and stands in the right-hand
                // gutter instead — sized so it cannot reach the square (the board is `100cqh` wide
                // there, centred in what is left after the chrome column), because feedback that
                // covers the tiles it is talking about is feedback you have to wait out. Compact here:
                // a phone mid-drill has no room for `notice`'s tile lists and ukeire counts, and the
                // full breakdown is a tap away in the panel. Gated on the *drawer* alone: that shape
                // is over the top of the board, so a float under it is one nobody can see. A docked
                // panel covers nothing, and a verdict that only ever appeared on phones was one a
                // desktop reader had to go looking for in the log
                // `flow` moves it to the foot of the board area instead: that content is anchored to
                // the top and starts with the wall count and the dora indicator, which is exactly
                // what a notice at the top covers — and dora is something you read *while* deciding.
                // The `pb-16` the flow area carries is the strip it lands in, so it never reaches
                // the river above it either
                <div
                  className={`pointer-events-none absolute inset-x-2 top-2 flex justify-center short:inset-x-auto short:top-2 short:right-2 short:bottom-2 short:items-center ${flow && !board ? 'top-auto bottom-2' : ''}`}
                >
                  <div className="max-h-[45%] max-w-md overflow-y-auto rounded-xl bg-white/95 p-3 text-sm shadow-lg ring-1 ring-black/10 short:max-h-full short:max-w-[calc((100svw-2.75rem-100cqh)/2-0.5rem)] dark:bg-neutral-900/95 dark:ring-white/10">
                    {noticeCompact}
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
          </div>

          {/* capped: the claim prompt and the kita/kan row make this strip taller some turns, and it
            must take that out of its own scroll rather than out of the board. Always the bottom-
            most (and, held sideways, still the full-width) row regardless of orientation, so it
            carries the bottom inset (the home indicator) plus the side ones (a landscape notch)
            rather than the chrome row above, which only ever owns one edge at a time */}
          <div
            data-testid="hand-strip"
            className="flex max-h-[35svh] shrink-0 justify-center overflow-auto pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] [container-type:inline-size]"
          >
            {/* the hand is 14 tiles wide and cannot exceed the room under the board without
              wrapping, and a wrapped hand costs the board a tile row of height wherever the board
              is limited by height (a tablet held sideways, a desktop) — which is how asking for
              bigger tiles used to make the *table* smaller. So on the same screens the size
              setting applies to, it is a **ceiling** rather than a width: the tiles take it while
              it fits and shrink to the strip when it doesn't. Below `sizable:` nothing is capped
              — the tiles are at the default there, and on a phone held upright the board is
              limited by width, so a second hand row costs it nothing and is easier to read than
              the sliver a cap would leave. Measured against the strip (a container, so `100cqw`
              is its content box) rather than the viewport, since the docked session panel is not
              room the hand has. The 4.5rem is what the tiles do not get: `p-0.5` each side of all
              14 tile buttons, the 0.5rem gap before the drawn one, and 0.5rem of slack, an exact
              fit wrapping anyway with fractional widths. Re-declaring `--tile-w` is not optional:
              its `var()` resolved once at the stage root, so overriding only the base would leave
              every plain tile uncapped */}
            <div className="sizable:[--tile-w-base:min(calc(var(--tile-w-raw)*var(--tile-scale)),calc((100cqw-4.5rem)/14))] sizable:[--tile-w:var(--tile-w-base)]">
              {hand}
            </div>
          </div>
        </div>

        {/* wide enough to hold both: the panel is a column of its own beside the board rather than
          something you open over it, so the full feedback, the score and the log are all readable
          without ever hiding a tile. Its width is a ramp rather than one number: 320px where the
          board still wants every pixel (1024px, where it docks at all), growing to 448px on a
          desktop, where a 16:9 board is limited by its height and the width is spare. What the
          extra buys is the log's own tiles — a full hand reads on one line either way, at the
          size the column can afford (`LogList`'s own cap) */}
        {docked && (
          <aside
            data-testid="session-panel"
            className="flex w-[clamp(20rem,26vw,28rem)] shrink-0 flex-col border-l border-neutral-200 bg-white p-2 pt-[calc(0.5rem+env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] dark:border-neutral-800 dark:bg-neutral-950"
          >
            <SessionPanel panel={panel} />
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
              <SessionPanel panel={panel} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
