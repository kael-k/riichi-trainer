import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EvModelName } from '../../core/evModel'
import { FOLD_EV_BANDS, PUSH_EV_BANDS, type EvBands } from '../table/evGrade'
import type { TableApp, TableSettings } from './tableSettings'

export type Theme = 'system' | 'light' | 'dark'

/** Languages with a translation; 'auto' resolves from the browser at apply time. */
export const LOCALES = ['en', 'ja', 'zh', 'it'] as const
export type Locale = 'auto' | (typeof LOCALES)[number]

export interface Settings {
  scoring: {
    /** Show the round context as a table (winds in position, melds on your side) instead of
     *  a flat text bar. */
    table: boolean
    /** At least one of these three must stay true; the UI disables unchecking the last one. */
    testHan: boolean
    testFu: boolean
    testPoints: boolean
    /** Grade the exact pre-rounding fu instead of the rounded-up-to-10 value. */
    exactFu: boolean
    /** Stop grading fu once the hand reaches a limit, where fu no longer moves the payment.
     *  On by default: asking for a number that cannot change the answer teaches nothing. */
    ignoreFuOnLimit: boolean
  }
  folding: {
    /** Hold every graded turn back until the hand is over — feedback, running score and the log
     *  rows alike — and show them together at the end. Off by default, since immediate feedback
     *  is how the trainer teaches; on, it stops the panel naming safe tiles that are still safe
     *  next turn, so the whole fold is read from the board. */
    feedbackAtEnd: boolean
    /** Grade discards on the EV model's fold branch instead of ordinal danger tiers — Advanced
     *  only, and read as `advanced && evGrading` (`useAdvancedSettings.ts`), so turning Advanced
     *  off returns the drill to tiers rather than leaving an invisible mode running. **Alpha**:
     *  alpha; tiers stay the permanent default. */
    evGrading: boolean
    /** Which `EvModel` prices the fold branch it grades against. */
    evModel: EvModelName
    /** ε₁/ε₂ per model — kept per-model so switching `evModel` back and forth
     *  keeps each one's own calibration rather than sharing a single stored pair. */
    evBands: Record<EvModelName, EvBands>
  }
  efficiency: {
    /** Grade plain discards on the EV model's push branch instead of ukeire — Advanced only, table
     *  app only (`useEfficiencyRound.ts` is the only reader; solo never builds this field at all,
     *  so the mode is structurally unreachable there rather than merely defaulted off). Read as
     *  `advanced && evGrading` (`useAdvancedSettings.ts`), the same rule folding's own flag
     *  follows. **Alpha.** */
    evGrading: boolean
    /** Which `EvModel` prices the push branch it grades against. */
    evModel: EvModelName
    /** ε₁/ε₂ per model — kept per-model for the same reason folding's own
     *  `evBands` is. */
    evBands: Record<EvModelName, EvBands>
  }
  /** The five table settings shared by every board-rendering app (ADR-0015, ADR-0015): a global default
   *  layer plus a per-app override layer, both `Partial` since an absent key means inherit —
   *  resolved by `resolveTableSettings`/`useTableSettings` (`tableSettings.ts`), never read
   *  straight off this section. */
  table: {
    global: Partial<TableSettings>
    apps: Partial<Record<TableApp, Partial<TableSettings>>>
  }
}

/** Trainer tile size presets (S-XL); multiplies the base tile width. Four, not five: a fifth
 *  button crowds the row on a phone. */
export const TILE_SCALES = [1, 1.25, 1.5, 1.8] as const

/** The board half of that same setting, paired with `TILE_SCALES` by index: XL is all the room
 *  there is. Applied **only on `sizable:`** (`index.css`) — a tablet or desktop has more room than
 *  the board needs, so how much of it to take is a choice; a phone does not, and there a square
 *  smaller than its room pulls the side seats' hands off the screen edge. `BoardStage` hands it
 *  down as `--board-scale`; the felt's own tiles derive from the felt's width and so follow it. */
export const BOARD_SCALES = [0.7, 0.8, 0.9, 1] as const

/** The `sizable:` variant (`index.css`) as a query, for the one thing CSS cannot do on its own:
 *  telling the reader *why* the size buttons are dead. Both halves of the size setting — the board
 *  and the tiles — apply only here; below it a phone gets `DEFAULT_TILE_SCALE` and a board that
 *  fills its room, which is the only size that fits either way up. Keep in step with the variant. */
export const SIZABLE_QUERY = '(min-width: 768px) and (min-height: 521px)'

/** Size used until the reader picks one: M, big enough to read a hand on a phone. */
export const DEFAULT_TILE_SCALE = 1.25

/** How long a board holds before a seat nobody plays commits its action, until the reader picks
 *  their own. Enough that a four-seat go-around reads as four separate turns rather than one jump,
 *  without making the reader wait on three opponents every time round; the slider goes to
 *  `BOT_DELAY_MAX` for a reader who wants to watch, and to 0, which is the old instantaneous burst
 *  exactly (`useRound`'s `pace`: at 0 the driver takes no `await` at all). */
export const DEFAULT_BOT_DELAY = 1000
export const BOT_DELAY_MAX = 5000
export const BOT_DELAY_STEP = 250

interface SettingsState extends Settings {
  theme: Theme
  setTheme: (theme: Theme) => void
  /** Overlay the tenhou code (e.g. "3m") on each tile face, for players still learning to read
   *  pips. `null` means "never chosen", which resolves per language — see `useShowTileNumbers`. */
  showTileNumbers: boolean | null
  setShowTileNumbers: (show: boolean) => void
  /** Trainer tile size multiplier; one of TILE_SCALES, or `null` for "never chosen" — read it
   *  as `tileScale ?? DEFAULT_TILE_SCALE` so the default can move without overriding a choice.
   *  Does not affect the log panel. */
  tileScale: number | null
  setTileScale: (scale: number) => void
  /** Milliseconds a board holds before a seat nobody plays commits its action — `useRound`'s
   *  `pace`, threaded down by each board trainer's own hook. `null` is "never chosen", the same
   *  idiom `tileScale` uses: read it as `botDelay ?? DEFAULT_BOT_DELAY` so the shipped default can
   *  move later without overriding a stored 0. Top-level rather than a section, and not part of
   *  the per-app `table` layer: how fast the opponents play is one preference for the whole app,
   *  not a property of any one board. */
  botDelay: number | null
  setBotDelay: (delay: number) => void
  /** Animate the board — discards flying into the river, a meld appearing, the call banner. On by
   *  default; off leaves every state change instantaneous while the delay above still applies, and
   *  an OS-level "reduce motion" removes the motion regardless (`motion-safe:` at every use
   *  site). */
  boardAnimation: boolean
  setBoardAnimation: (animate: boolean) => void
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats, nukidora. Applies to both trainers. */
  sanma: boolean
  setSanma: (sanma: boolean) => void
  /** Round a 4-han/30-fu or 3-han/60-fu hand up to a flat mangan instead of scoring its exact fu.
   *  A rule of the match (`RoundOptions.kiriageMangan`, `core/round.ts`), not a display option —
   *  it moves points the same way in every trainer that prices a win, not just scoring's. */
  kiriageMangan: boolean
  setKiriageMangan: (kiriageMangan: boolean) => void
  /** Shade discards that were tsumogiri (taken straight off the draw), leaving tedashi plain.
   *  Off by default: it is a reading cue for players already tracking opponents' hands, and it
   *  puts a mark on most of the table until you know what it means. */
  showTsumogiri: boolean
  setShowTsumogiri: (show: boolean) => void
  /** Seed one red five per suit into random walls. Shared across efficiency and scoring so a
   *  wall built for one trainer isn't seeded differently from the other. */
  aka: boolean
  setAka: (aka: boolean) => void
  /** Surfaces options that only make sense once the reader already knows the terms involved
   *  (tsumogiri/tedashi, exact fu, wall reveal, red fives). Off by default so a first-time
   *  player's settings panel stays short. */
  advanced: boolean
  setAdvanced: (advanced: boolean) => void
  locale: Locale
  setLocale: (locale: Locale) => void
  /** Name yaku and win conditions in the reader's language ("Pure straight") instead of the
   *  Japanese terms ("Ittsuu"). Meaningless under ja/zh, where those *are* the local names, so
   *  the settings row hides there. */
  translatedTerms: boolean
  setTranslatedTerms: (translated: boolean) => void
  /** Force `GlossaryTerm` open on click/tap only. Off by default: on a device that actually
   *  supports hover (Tailwind's `hover:`/`group-hover:` already compile to `@media (hover:
   *  hover)`, so this never fires on touch regardless), hovering the term shows the explanation
   *  inline — click still opens the full popover either way, wiki link included. */
  glossaryOnClick: boolean
  setGlossaryOnClick: (onClick: boolean) => void
  /** Dismissed the "install to Home Screen" hint (`IOSInstallHint.tsx`) — iOS Safari has no
   *  element fullscreen at all, so a tab there can never lose its own bars; installing to the
   *  Home Screen is the only real fix, and this is permanent once closed, same as the hint
   *  itself never coming back for that reader. */
  iosInstallHintDismissed: boolean
  setIosInstallHintDismissed: (dismissed: boolean) => void
  update: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      scoring: {
        table: true,
        testHan: true,
        testFu: true,
        testPoints: true,
        exactFu: false,
        ignoreFuOnLimit: true,
      },
      folding: {
        feedbackAtEnd: false,
        evGrading: false,
        evModel: 'statistical',
        evBands: FOLD_EV_BANDS,
      },
      efficiency: {
        evGrading: false,
        evModel: 'statistical',
        evBands: PUSH_EV_BANDS,
      },
      table: { global: {}, apps: {} },
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      showTileNumbers: null,
      setShowTileNumbers: (showTileNumbers) => set({ showTileNumbers }),
      tileScale: null,
      setTileScale: (tileScale) => set({ tileScale }),
      botDelay: null,
      setBotDelay: (botDelay) => set({ botDelay }),
      boardAnimation: true,
      setBoardAnimation: (boardAnimation) => set({ boardAnimation }),
      sanma: false,
      setSanma: (sanma) => set({ sanma }),
      kiriageMangan: false,
      setKiriageMangan: (kiriageMangan) => set({ kiriageMangan }),
      showTsumogiri: false,
      setShowTsumogiri: (showTsumogiri) => set({ showTsumogiri }),
      aka: true,
      setAka: (aka) => set({ aka }),
      advanced: false,
      setAdvanced: (advanced) => set({ advanced }),
      locale: 'auto',
      setLocale: (locale) => set({ locale }),
      translatedTerms: true,
      setTranslatedTerms: (translatedTerms) => set({ translatedTerms }),
      glossaryOnClick: false,
      setGlossaryOnClick: (glossaryOnClick) => set({ glossaryOnClick }),
      iosInstallHintDismissed: false,
      setIosInstallHintDismissed: (iosInstallHintDismissed) => set({ iosInstallHintDismissed }),
      update: (section, patch) => set((s) => ({ ...s, [section]: { ...s[section], ...patch } })),
    }),
    {
      name: 'riichi-trainer-settings',
      // pre-v2 schemas are dropped, not migrated: those installs fall back to defaults. v3 did
      // the same again — the table settings moved out of `efficiency`/`folding` and the old
      // top-level `showWall`/`showOpponentHands` into the new `table` section, so an old blob's
      // now-removed keys are dropped rather than merged into a schema that no longer has
      // anywhere to put them.
      //
      // Deliberately *not* bumped when the `efficiency` and `shanten` sections were removed: a
      // bump drops the whole blob, which would cost every existing reader their theme, language
      // and scoring settings to clear two keys that nothing reads any more. A stale `shanten`
      // object (and any stale key of `efficiency`'s own old shape, from before EV grading gave the
      // section a real reason to exist again) stays in the persisted JSON and is spread back onto
      // state by the merge below, off the `Settings` type and unread.
      version: 3,
      // zustand's default merge is shallow at the top level, so a persisted `scoring`/`folding`/
      // `efficiency` object from an older schema would wholesale overwrite (not fill in defaults
      // for) new fields added to those sections later — merge each section too
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...p,
          scoring: { ...current.scoring, ...p.scoring },
          folding: { ...current.folding, ...p.folding },
          efficiency: { ...current.efficiency, ...p.efficiency },
          table: { ...current.table, ...p.table },
        }
      },
    },
  ),
)

/** The board pacing setting resolved to a real number of milliseconds, for the four board
 *  trainers to hand `useRound` as its `pace`. A hook of its own only so the `?? DEFAULT_BOT_DELAY`
 *  is written once — every page that draws a `<Table>` needs the same resolution. */
export function useBotDelay(): number {
  return useSettings((s) => s.botDelay) ?? DEFAULT_BOT_DELAY
}
