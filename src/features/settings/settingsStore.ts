import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'system' | 'light' | 'dark'

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
}

interface SettingsState extends Settings {
  theme: Theme
  setTheme: (theme: Theme) => void
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
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      update: (section, patch) => set((s) => ({ ...s, [section]: { ...s[section], ...patch } })),
    }),
    {
      name: 'riichi-trainer-settings',
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
        }
      },
    },
  ),
)
