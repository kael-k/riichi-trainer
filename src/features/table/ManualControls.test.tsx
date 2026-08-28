import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '../../features/i18n'
import type { PendingClaim } from '../../core/round'
import { ManualControls, manualControlsVisible } from './ManualControls'

/** Seat 3 throws an 8m; seat 0 can chi it with the 6m7m it holds. */
const CLAIM: PendingClaim = {
  kind: 'discard',
  seat: 0,
  from: 3,
  tile: { id: 7, red: false },
  options: [{ kind: 'chi', from: [5, 6] }],
  answers: {},
}

function controls(props: Partial<Parameters<typeof ManualControls>[0]> = {}) {
  return (
    <ManualControls
      acting={0}
      claim={undefined}
      riichiTiles={[]}
      riichiArmed={false}
      onArmRiichi={vi.fn()}
      onAnswer={vi.fn()}
      viewSeat={0}
      {...props}
    />
  )
}

describe('ManualControls', () => {
  it('still prompts an unanswered claim once the drill is over', () => {
    // `drillOver` is true for the whole window between the graded seat's tenpai discard and its
    // next draw, and a replayed link lands in that window with live play still running — so an
    // opponent really can offer that seat a call while the end card is up. The engine suspends
    // every turn until the claim is answered, so suppressing this prompt freezes the board.
    render(controls({ ended: true, claim: CLAIM }))
    expect(screen.getByRole('button', { name: /Pass/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Chi/ })).toBeTruthy()
  })

  it('renders nothing once the drill is over with nothing left to answer', () => {
    const { container } = render(controls({ ended: true, riichiTiles: [7] }))
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders nothing while watching a seat that does not owe the decision', () => {
    // the felt's turn glow already names that seat and the seat plate's eye rotates there — a
    // line saying it again in words was a third way of stating one fact
    const { container } = render(controls({ acting: 2, viewSeat: 0, claim: CLAIM }))
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('manualControlsVisible', () => {
  const BASE = { acting: 0, claim: undefined, riichiTiles: [], viewSeat: 0, ended: false }

  it('is false in the shipped single-seat setup with nothing to show — the render-nothing case', () => {
    expect(manualControlsVisible(BASE)).toBe(false)
  })

  it('is false once ended with nothing left to answer', () => {
    expect(manualControlsVisible({ ...BASE, ended: true })).toBe(false)
  })

  it('stays true for an unanswered claim even once ended — the race `ended` must not win', () => {
    expect(manualControlsVisible({ ...BASE, ended: true, claim: CLAIM })).toBe(true)
  })

  it('is false while a different seat owes the decision, claim or no claim', () => {
    expect(manualControlsVisible({ ...BASE, acting: 2 })).toBe(false)
    expect(manualControlsVisible({ ...BASE, acting: 2, claim: CLAIM })).toBe(false)
  })

  it('is true with a riichi declaration on offer', () => {
    expect(manualControlsVisible({ ...BASE, riichiTiles: [7] })).toBe(true)
  })
})
