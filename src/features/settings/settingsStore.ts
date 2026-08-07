import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
    /** Simulated opponents that draw and tsumogiri every turn. */
    opponents: boolean
    /** Reserve a dead wall and show its dora indicator. */
    deadWall: boolean
    /** Seed one red five per suit into random walls. */
    aka: boolean
    /** Reveal the live wall in draw order. */
    showWall: boolean
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
    /** Show the itemized yaku list on reveal, instead of just the han total. */
    showYaku: boolean
    /** Show the fu itemization on reveal, instead of just the fu total. */
    showFu: boolean
    kiriageMangan: boolean
    /** Add random honba sticks to generated hands and require them in the points total. */
    honba: boolean
    ignoreFuOnLimit: boolean
    /** Generate hands with called melds, not just closed ones. */
    openHands: boolean
    aka: boolean
    /** Reveal the live and dead wall. Only has tiles to show once the hand actually played out
     *  through a real match — a link-pinned or constructed hand has no wall behind it. */
    showWall: boolean
  }
  folding: {
    timerEnabled: boolean
    /** Seats that must already be in riichi when the drill starts. Capped at one fewer than the
     *  player count; generation falls back to fewer rather than failing when a seed search cannot
     *  find that many. */
    threats: number
    /** Reveal the live and dead wall. */
    showWall: boolean
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
  /** Dismissal of the "turn your phone" tip shown over the table on a narrow portrait screen. */
  hideRotateHint: boolean
  setHideRotateHint: (hide: boolean) => void
  /** Shade discards that were tsumogiri (taken straight off the draw), leaving tedashi plain.
   *  Off by default: it is a reading cue for players already tracking opponents' hands, and it
   *  puts a mark on most of the table until you know what it means. */
  showTsumogiri: boolean
  setShowTsumogiri: (show: boolean) => void
  locale: Locale
  setLocale: (locale: Locale) => void
  /** Name yaku and win conditions in the reader's language ("Pure straight") instead of the
   *  Japanese terms ("Ittsuu"). Meaningless under ja/zh, where those *are* the local names, so
   *  the settings row hides there. */
  translatedTerms: boolean
  setTranslatedTerms: (translated: boolean) => void
  update: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      efficiency: {
        showShanten: true,
        timerEnabled: true,
        showUkeire: true,
        opponents: false,
        deadWall: true,
        aka: true,
        showWall: false,
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
        ignoreFuOnLimit: false,
        openHands: true,
        aka: true,
        showWall: false,
      },
      folding: { timerEnabled: true, threats: 1, showWall: false },
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      showTileNumbers: null,
      setShowTileNumbers: (showTileNumbers) => set({ showTileNumbers }),
      tileScale: null,
      setTileScale: (tileScale) => set({ tileScale }),
      sanma: false,
      setSanma: (sanma) => set({ sanma }),
      hideRotateHint: false,
      setHideRotateHint: (hideRotateHint) => set({ hideRotateHint }),
      showTsumogiri: false,
      setShowTsumogiri: (showTsumogiri) => set({ showTsumogiri }),
      locale: 'auto',
      setLocale: (locale) => set({ locale }),
      translatedTerms: true,
      setTranslatedTerms: (translatedTerms) => set({ translatedTerms }),
      update: (section, patch) => set((s) => ({ ...s, [section]: { ...s[section], ...patch } })),
    }),
    {
      name: 'riichi-trainer-settings',
      // pre-v2 schemas are dropped, not migrated: those installs fall back to defaults
      version: 2,
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
        }
      },
    },
  ),
)
