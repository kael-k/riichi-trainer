import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TableApp, TableSettings } from './tableSettings'

export type Theme = 'system' | 'light' | 'dark'

/** Languages with a translation; 'auto' resolves from the browser at apply time. */
export const LOCALES = ['en', 'ja', 'zh', 'it'] as const
export type Locale = 'auto' | (typeof LOCALES)[number]

export interface Settings {
  efficiency: {
    showShanten: boolean
    timerEnabled: boolean
    /** Show the improving tiles under discard feedback, not just the count. */
    showUkeire: boolean
  }
  shanten: { timerEnabled: boolean }
  scoring: {
    timerEnabled: boolean
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
    /** Show the itemized yaku list on reveal, instead of just the han total. */
    showYaku: boolean
    /** Show the fu itemization on reveal, instead of just the fu total. */
    showFu: boolean
    kiriageMangan: boolean
    /** Add random honba sticks to generated hands and require them in the points total. */
    honba: boolean
    /** Generate hands with called melds, not just closed ones. */
    openHands: boolean
  }
  folding: {
    timerEnabled: boolean
    /** After a correct discard, also list the other tiles that tied it. Off by default: the
     *  answer was already right, and naming the alternatives hands over part of next turn's
     *  reading for free. */
    showEquallySafe: boolean
    /** Hold every graded turn back until the hand is over — feedback, running score and the log
     *  rows alike — and show them together at the end. Off by default, since immediate feedback
     *  is how the trainer teaches; on, it stops the panel naming safe tiles that are still safe
     *  next turn, so the whole fold is read from the board. */
    feedbackAtEnd: boolean
  }
  /** The six table settings shared by every board-rendering app (ADR-0015, ADR-0015): a global default
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

/** Size used until the reader picks one: M, big enough to read a hand on a phone. */
export const DEFAULT_TILE_SCALE = 1.25

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
  /** Three-player rules: 108-tile wall (no 2m-8m), 3 seats, nukidora. Applies to both trainers. */
  sanma: boolean
  setSanma: (sanma: boolean) => void
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
      efficiency: {
        showShanten: true,
        timerEnabled: true,
        showUkeire: true,
      },
      shanten: { timerEnabled: true },
      scoring: {
        timerEnabled: true,
        table: true,
        testHan: true,
        testFu: true,
        testPoints: true,
        exactFu: false,
        showYaku: false,
        showFu: false,
        kiriageMangan: false,
        honba: false,
        ignoreFuOnLimit: true,
        openHands: true,
      },
      folding: {
        timerEnabled: true,
        showEquallySafe: false,
        feedbackAtEnd: false,
      },
      table: { global: {}, apps: {} },
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      showTileNumbers: null,
      setShowTileNumbers: (showTileNumbers) => set({ showTileNumbers }),
      tileScale: null,
      setTileScale: (tileScale) => set({ tileScale }),
      sanma: false,
      setSanma: (sanma) => set({ sanma }),
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
      // anywhere to put them
      version: 3,
      // zustand's default merge is shallow at the top level, so a persisted `efficiency`/
      // `shanten` object from an older schema would wholesale overwrite (not fill in
      // defaults for) new fields added to those sections later — merge each section too
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...p,
          efficiency: { ...current.efficiency, ...p.efficiency },
          shanten: { ...current.shanten, ...p.shanten },
          scoring: { ...current.scoring, ...p.scoring },
          folding: { ...current.folding, ...p.folding },
          table: { ...current.table, ...p.table },
        }
      },
    },
  ),
)
