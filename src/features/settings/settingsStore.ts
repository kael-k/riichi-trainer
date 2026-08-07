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
  }
}

/** Trainer tile size presets (XS-XL); multiplies the base tile width. */
export const TILE_SCALES = [0.8, 1, 1.25, 1.5, 1.8] as const

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
        opponents: true,
        deadWall: true,
        aka: true,
        showWall: false,
      },
      shanten: { timerEnabled: true },
      scoring: {
        timerEnabled: true,
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
      },
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      showTileNumbers: null,
      setShowTileNumbers: (showTileNumbers) => set({ showTileNumbers }),
      tileScale: null,
      setTileScale: (tileScale) => set({ tileScale }),
      sanma: false,
      setSanma: (sanma) => set({ sanma }),
      locale: 'auto',
      setLocale: (locale) => set({ locale }),
      translatedTerms: true,
      setTranslatedTerms: (translatedTerms) => set({ translatedTerms }),
      update: (section, patch) => set((s) => ({ ...s, [section]: { ...s[section], ...patch } })),
    }),
    {
      name: 'riichi-trainer-settings',
      version: 1,
      // v0 stored `showTileNumbers` and `tileScale` as plain values, so an install that never
      // touched either is indistinguishable from one that deliberately picked the old default.
      // Both old defaults are read as "never chosen" and fall back to the current default; a
      // non-default value is a real choice and survives.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        if (version >= 1) return p
        return {
          ...p,
          showTileNumbers: p.showTileNumbers === false ? null : p.showTileNumbers,
          tileScale: p.tileScale === 1 ? null : p.tileScale,
        }
      },
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
        }
      },
    },
  ),
)
