import { describe, expect, it } from 'vitest'
import {
  resolveSeatConfig,
  resolveTableSettings,
  TABLE_DEFAULTS,
  type SeatConfig,
  type TableApp,
} from './tableSettings'

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

describe('resolveSeatConfig', () => {
  it('puts every seat on efficiency but the default seat, with no configuration at all', () => {
    expect(resolveSeatConfig(null, 4, 2).modes).toEqual([
      'efficiency',
      'efficiency',
      'manual',
      'efficiency',
    ])
  })

  it('keeps a second manual seat alongside the default one', () => {
    const config: SeatConfig = { modes: ['efficiency', 'manual', 'manual', 'efficiency'] }
    expect(resolveSeatConfig(config, 4, 2).modes).toEqual(config.modes)
  })

  it('honours the default seat being given away, as long as another seat stays manual', () => {
    // the graded seat number itself never moves with the config (D13) — resolveSeatConfig only
    // ever fills in modes, it does not decide which seat is graded
    const config: SeatConfig = { modes: ['efficiency', 'manual', 'efficiency', 'efficiency'] }
    expect(resolveSeatConfig(config, 4, 0).modes).toEqual(config.modes)
  })

  it('forces the default seat back to manual when the config leaves nobody manual at all', () => {
    const config: SeatConfig = { modes: ['efficiency', 'efficiency', 'efficiency', 'efficiency'] }
    expect(resolveSeatConfig(config, 4, 2).modes).toEqual([
      'efficiency',
      'efficiency',
      'manual',
      'efficiency',
    ])
  })
})
