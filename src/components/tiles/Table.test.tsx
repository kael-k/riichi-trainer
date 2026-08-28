import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '../../features/i18n'
import { useSettings } from '../../features/settings/settingsStore'
import { tileName } from '../../core/tiles'
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

  it('names each seat by the wind it is sitting, not by its own index', () => {
    // a seat index is only a wind while the dealer is seat 0 — which is every trainer but
    // `/match`, where the dealer rotates and the felt used to keep calling seat 0 East all game
    const winds = (dealer?: number) => {
      const { container } = render(
        <Table seats={[{}, {}, {}, {}]} seatIndex={0} round="E" dealer={dealer} />,
      )
      return Array.from({ length: 4 }, (_, seat) =>
        container
          .querySelector<HTMLElement>(`[data-testid="seat-plate"][data-seat="${seat}"]`)!
          .textContent?.trim(),
      )
    }
    // dealer 0: the identity mapping the default has always drawn
    expect(winds()).toEqual(winds(0))
    expect(winds(0)).toEqual(['E', 'S', 'W', 'N'])
    // dealer 2 is East, and the seats before it have wrapped round
    expect(winds(2)).toEqual(['W', 'N', 'E', 'S'])
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
    // the standing mark and the transient one are the same grey and have to be told apart by the
    // animation alone: the flash exists precisely *because* the standing mark is normally absent
    const shades = (c: HTMLElement) =>
      seatBlock(c, 0).querySelectorAll(
        '[class*="bg-neutral-500"]:not([class*="animate-tsumogiri-flash"])',
      )
    const flashes = (c: HTMLElement) =>
      seatBlock(c, 0).querySelectorAll('[class*="animate-tsumogiri-flash"]')

    // showTsumogiri is an advanced setting: it only takes effect once `advanced` is also on
    useSettings.setState({ advanced: true, showTsumogiri: false })
    const off = render(table).container
    expect(seatBlock(off, 0).querySelectorAll('[class*="rotate-90"]')).toHaveLength(1)
    expect(shades(off)).toHaveLength(0)
    expect(flashes(off)).toHaveLength(1)

    useSettings.setState({ showTsumogiri: true })
    const on = render(table).container
    expect(shades(on)).toHaveLength(1)
    // no double mark: the standing shade is the read, so the flash stands down
    expect(flashes(on)).toHaveLength(0)
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

  it('holds a tedashi\u2019s own slot open, where the thrown tile sorted', () => {
    // 3p thrown out of 1p2p 4p5p: the hole opens before the 4p, which is what says the tile came
    // out of the hand rather than straight off the draw
    const hand = [
      { id: 9, red: false },
      { id: 10, red: false },
      { id: 12, red: false },
      { id: 13, red: false },
    ]
    const table = (tedashi?: { id: number; red: boolean }) => (
      <Table seats={[{}, { hand, tedashi }, {}, {}]} seatIndex={0} round="E" />
    )
    const gaps = (c: HTMLElement) => c.querySelectorAll('[class*="ml-(--tile-w)"]')

    expect(gaps(render(table()).container)).toHaveLength(0)

    const held = render(table({ id: 11, red: false })).container
    const marked = gaps(held)
    expect(marked).toHaveLength(1)
    expect(marked[0].getAttribute('aria-label')).toBe(tileName(12))
  })

  it('opens a face-down row\u2019s hole in its middle, not past its end', () => {
    // what every other trainer actually hands the felt for a hidden seat: thirteen copies of one
    // filler tile (`BACK_TILE`, id 0). Sorted, the thrown tile belongs past all of them, so the
    // old read put the hole after the last tile — a centred row shifting half a tile, not a hole
    const backs = Array.from({ length: 13 }, () => ({ id: 0, red: false }))
    const held = render(
      <Table
        seats={[{}, { hand: backs, concealed: true, tedashi: { id: 20, red: false } }, {}, {}]}
        seatIndex={0}
        round="E"
      />,
    ).container.querySelectorAll('[class*="ml-(--tile-w)"]')
    expect(held).toHaveLength(1)
    // inside the row, so it draws as a gap — and it says nothing about where the tile sorted
    expect([...held[0].parentElement!.children].indexOf(held[0])).toBe(6)
  })

  it('draws the call it is handed on that seat\u2019s own edge, and nothing without one', () => {
    const seats = [{}, {}, {}, {}]
    const quiet = render(<Table seats={seats} seatIndex={0} round="E" />).container
    expect(quiet.querySelectorAll('[data-testid="call-banner"]')).toHaveLength(0)

    // same rotation contract as the turn mark above, for the same reason: a banner drawn without
    // its seat's spin announces the call on somebody else's edge
    const spins = ['rotate-90', 'rotate-0', '-rotate-90', 'rotate-180']
    for (const [seat, spin] of spins.entries()) {
      const shown = render(
        <Table seats={seats} seatIndex={1} round="E" call={{ seat, kind: 'pon' }} />,
      ).container.querySelectorAll<HTMLElement>('[data-testid="call-banner"]')
      expect(shown).toHaveLength(1)
      expect(shown[0].dataset.seat).toBe(String(seat))
      expect(shown[0].dataset.kind).toBe('pon')
      expect(shown[0].className.split(' ')).toContain(spin)
    }
  })
})
