import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  efficiency: { showShanten: boolean; turns: number }
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
      efficiency: { showShanten: true, turns: 10 },
      shanten: { timerEnabled: true },
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      update: (section, patch) => set((s) => ({ ...s, [section]: { ...s[section], ...patch } })),
    }),
    { name: 'riichi-trainer-settings' },
  ),
)
