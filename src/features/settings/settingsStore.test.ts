import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('settingsStore table section', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('defaults table to empty global/apps layers on a fresh install', async () => {
    const { useSettings } = await import('./settingsStore')
    expect(useSettings.getState().table).toEqual({ global: {}, apps: {} })
  })

  it('persists a table update, read back by resolveTableSettings', async () => {
    const { useSettings } = await import('./settingsStore')
    const { resolveTableSettings } = await import('./tableSettings')
    useSettings.getState().update('table', { global: { showOpponentHands: true } })
    expect(useSettings.getState().table.global.showOpponentHands).toBe(true)
    expect(resolveTableSettings('efficiency', useSettings.getState().table).showOpponentHands).toBe(true)
  })

  it('drops a v2 blob instead of merging it, falling back to table defaults', async () => {
    localStorage.setItem(
      'riichi-trainer-settings',
      JSON.stringify({
        state: {
          table: { global: { showOpponentHands: true }, apps: {} },
          showOpponentHands: true,
          efficiency: { showShanten: true, timerEnabled: true, showUkeire: true, deadWall: true },
        },
        version: 2,
      }),
    )
    const { useSettings } = await import('./settingsStore')
    expect(useSettings.getState().table).toEqual({ global: {}, apps: {} })
  })

  it('merges every section, including table, so a partial v3 blob keeps new defaults intact', async () => {
    localStorage.setItem(
      'riichi-trainer-settings',
      JSON.stringify({
        state: { efficiency: { showShanten: false } },
        version: 3,
      }),
    )
    const { useSettings } = await import('./settingsStore')
    const state = useSettings.getState()
    expect(state.efficiency.showShanten).toBe(false)
    // a field the persisted blob omitted still comes from the fresh default, not `undefined`
    expect(state.efficiency.showUkeire).toBe(true)
    expect(state.table).toEqual({ global: {}, apps: {} })
  })

  it('bumps persist version to 3', async () => {
    const { useSettings } = await import('./settingsStore')
    expect(useSettings.persist.getOptions().version).toBe(3)
  })
})

describe('useAdvancedSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('no longer exposes showWall, while showTsumogiri/aka/exactFu still resolve', async () => {
    const { useAdvancedSettings } = await import('./useAdvancedSettings')
    const { result } = renderHook(() => useAdvancedSettings())
    expect(result.current).not.toHaveProperty('showWall')
    expect(result.current.showTsumogiri).toBe(false) // advanced is off by default
    expect(result.current.aka).toBe(true) // aka's default is true regardless of advanced
    expect(result.current.exactFu).toBe(false)
  })
})
