import { describe, expect, it } from 'vitest'
import { resolveTableSettings, TABLE_DEFAULTS, type TableApp } from './tableSettings'

const APPS: TableApp[] = ['efficiency', 'efficiencySolo', 'folding', 'scoring', 'lab']

describe('resolveTableSettings', () => {
  it('returns the app defaults untouched when both layers are empty', () => {
    expect(resolveTableSettings('folding', { global: {}, apps: {} })).toEqual(
      TABLE_DEFAULTS.folding,
    )
  })

  it('applies a global override to every app', () => {
    expect(resolveTableSettings('folding', { global: { threats: 2 }, apps: {} }).threats).toBe(2)
    expect(resolveTableSettings('scoring', { global: { threats: 2 }, apps: {} }).threats).toBe(2)
  })

  it('lets a per-app override win over the global layer, for that app only', () => {
    const table = { global: { threats: 2 }, apps: { folding: { threats: 3 } } }
    expect(resolveTableSettings('folding', table).threats).toBe(3)
    expect(resolveTableSettings('scoring', table).threats).toBe(2)
  })

  it('inherits a key absent from both layers', () => {
    const resolved = resolveTableSettings('efficiency', {
      global: { showWall: true },
      apps: {},
    })
    expect(resolved.deadWall).toBe(TABLE_DEFAULTS.efficiency.deadWall)
    expect(resolved.showWall).toBe(true)
  })

  it('resolves every field for every TableApp', () => {
    for (const app of APPS) {
      const resolved = resolveTableSettings(app, { global: {}, apps: {} })
      expect(resolved.opponentWins).toBeDefined()
      expect(resolved.deadWall).toBeDefined()
      expect(resolved.threats).toBeDefined()
      expect(resolved.showOpponentHands).toBeDefined()
      expect(resolved.showWall).toBeDefined()
    }
  })

  it('matches the shipped folding defaults', () => {
    expect(TABLE_DEFAULTS.folding.threats).toBe(1)
    expect(TABLE_DEFAULTS.folding.opponentWins).toBe(true)
  })

  it('defaults deadWall to true for both efficiency apps', () => {
    expect(TABLE_DEFAULTS.efficiency.deadWall).toBe(true)
    expect(TABLE_DEFAULTS.efficiencySolo.deadWall).toBe(true)
  })

  it('does not let an app override leak into a sibling app', () => {
    const table = { global: {}, apps: { efficiency: { showOpponentHands: true } } }
    expect(resolveTableSettings('efficiency', table).showOpponentHands).toBe(true)
    expect(resolveTableSettings('scoring', table).showOpponentHands).toBe(false)
  })
})
