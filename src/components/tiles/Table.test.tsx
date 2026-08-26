import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '../../features/i18n'
import { useSettings } from '../../features/settings/settingsStore'
import { Table } from './Table'

/** The grid classes are the layout: which cell a seat lands in *is* where it sits at the table. */
function seatBlock(container: HTMLElement, seat: number): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-seat="${seat}"]`)!
}

describe('Table', () => {
  it('puts you at the bottom and the rest clockwise around you', () => {
    const { container } = render(<Table seats={[{}, {}, {}, {}]} seatIndex={1} round="E" />)
    expect(seatBlock(container, 1).className).toContain('col-start-2 row-start-3') // you
    expect(seatBlock(container, 2).className).toContain('col-start-3 row-start-2') // shimocha
    expect(seatBlock(container, 3).className).toContain('col-start-2 row-start-1') // toimen
    expect(seatBlock(container, 0).className).toContain('col-start-1 row-start-2') // kamicha
  })

  it('seats sanma’s third player on the left — there is no toimen', () => {
    const { container } = render(<Table seats={[{}, {}, {}]} seatIndex={0} round="E" />)
    expect(seatBlock(container, 2).className).toContain('col-start-1 row-start-2')
    expect(seatBlock(container, 2).className).not.toContain('row-start-1')
  })

  it('lays the riichi tile sideways, and shades tsumogiri only when the setting is on', () => {
    const river = [
      { id: 0, red: false, tsumogiri: true },
      { id: 1, red: false },
      { id: 2, red: false, riichi: true },
    ]
    const table = <Table seats={[{ river }, {}, {}, {}]} seatIndex={0} round="E" />
    const shades = (c: HTMLElement) => seatBlock(c, 0).querySelectorAll('[class*="bg-neutral-500"]')

    // showTsumogiri is an advanced setting: it only takes effect once `advanced` is also on
    useSettings.setState({ advanced: true, showTsumogiri: false })
    const off = render(table).container
    expect(seatBlock(off, 0).querySelectorAll('[class*="rotate-90"]')).toHaveLength(1)
    expect(shades(off)).toHaveLength(0)

    useSettings.setState({ showTsumogiri: true })
    expect(shades(render(table).container)).toHaveLength(1)
  })

  it('lights the felt edge on the side of the seat that owes a decision, and only then', () => {
    const seats = [{}, {}, {}, {}]
    const idle = render(<Table seats={seats} seatIndex={0} round="E" />).container
    expect(idle.querySelectorAll('[data-testid="turn-mark"]')).toHaveLength(0)

    // the rotation is the whole point of the mark: an unturned bar lights the wrong side of the
    // felt, so every seat's own spin is pinned here — watched from seat 1, seat 1 is the bottom
    // edge, 2 the right, 3 the top, 0 the left
    const spins = ['rotate-90', 'rotate-0', '-rotate-90', 'rotate-180']
    for (const [seat, spin] of spins.entries()) {
      const lit = render(
        <Table seats={seats} seatIndex={1} round="E" activeSeat={seat} />,
      ).container.querySelectorAll<HTMLElement>('[data-testid="turn-mark"]')
      expect(lit).toHaveLength(1)
      expect(lit[0].dataset.seat).toBe(String(seat))
      // by word, not by substring: `rotate-90` is a substring of `-rotate-90`
      expect(lit[0].className.split(' ')).toContain(spin)
    }
  })
})
