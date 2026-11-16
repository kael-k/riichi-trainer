import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { doraIndex, importTenhou } from '../../core/tenhouImport'
import convlog from '../../core/testdata/convlog.json'
import { tenhouTile } from '../../core/tenhouLog'
import { parseTenhou, tileName } from '../../core/tiles'
import '../i18n'
import { MatchPage } from './MatchPage'

// pricing is up to ~2 s a row on this thread under jsdom (no Worker); the rows themselves are what
// is under test here, not their numbers
vi.mock('./statsClient', () => ({
  requestStats: () => new Promise(() => {}),
  settledStats: () => undefined,
}))

beforeAll(() => {
  // jsdom has no matchMedia; every query reads as unmatched — the phone shape, log as a drawer
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

/** The HUD is rendered twice — the strip above the board and the float held sideways, one of them
 *  `display: none` by CSS jsdom never applies — so every control is taken from the first. */
const first = (name: string) => screen.getAllByRole('button', { name })[0]
const label = () => screen.getAllByText(/honba · \d+\/\d+/)[0].textContent

async function loadFixture(json: unknown = convlog) {
  render(
    <MemoryRouter initialEntries={['/match']}>
      <MatchPage />
    </MemoryRouter>,
  )
  const input = screen.getByLabelText('Load a game')
  const file = new File([JSON.stringify(json)], 'game.json', { type: 'application/json' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('the replay', () => {
  it('loads a tenhou.net/6 log and steps through it, the log growing behind the cursor', async () => {
    await loadFixture()
    await screen.findAllByRole('button', { name: 'Next action' })
    expect(label()).toMatch(/^East 1 · 0 honba · 0\/\d+$/)
    expect(first('Previous action')).toBeDisabled()
    expect(first('Previous round')).toBeDisabled()

    fireEvent.click(first('Show log'))
    const drawer = screen.getByTestId('log-drawer')
    // the deal only, and no Clear: the rows are the recording's, not the session's
    expect(within(drawer).getByText('Log (1)')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Clear' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(first('Next action'))
    expect(label()).toMatch(/^East 1 · 0 honba · 1\//)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(label()).toMatch(/^East 1 · 0 honba · 2\//)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(label()).toMatch(/ · 2\//)

    fireEvent.click(first('Show log'))
    // the deal plus two discards — the log follows the cursor, ignoring the arrows' round trip
    expect(within(screen.getByTestId('log-drawer')).getByText('Log (3)')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(first('Next round'))
    expect(label()).toMatch(/^East 2 · 0 honba · 0\//)
    // a round's deal steps back to the previous round's end
    fireEvent.click(first('Previous action'))
    expect(label()).toMatch(/^East 1 · 0 honba · (\d+)\/\1$/)
  })

  it('draws every wall slot the record never revealed face down', async () => {
    const imported = importTenhou(convlog)
    if ('error' in imported) throw new Error(imported.error)
    const round = imported.game.rounds[0]
    await loadFixture()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Wall' }))[0])
    const tiles = within(screen.getByRole('dialog')).getAllByRole('img')
    // the dealt hands, the live wall and the dead wall run in wall order, one slot per tile
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual(
      round.wall.map((tile, i) => (round.revealed[i] ? tileName(tile.id) : 'face-down tile')),
    )
    expect(round.revealed).toContain(false)
  })

  it('leaves an indicator the record never flipped off the felt', async () => {
    // East 2's kan flips a second indicator; a record that never shows it leaves it random fill
    const json = structuredClone(convlog)
    ;(json.log[1] as unknown[])[2] = [18]
    await loadFixture(json)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Next round' }))[0])
    const range = screen.getAllByRole('slider')[0]
    fireEvent.change(range, { target: { value: range.getAttribute('max') } })
    const faceUp = within(screen.getByTestId('dora-row'))
      .getAllByRole('img')
      .filter((tile) => tile.getAttribute('aria-label') !== 'face-down tile')
    expect(faceUp.map((tile) => tile.getAttribute('aria-label'))).toEqual([tileName(7)])

    const imported = importTenhou(json)
    if ('error' in imported) throw new Error(imported.error)
    expect(imported.game.rounds[1].revealed[doraIndex(false, 1)]).toBe(false)
  })

  it('ends a round cut before a double ron on its open claim, without crashing', async () => {
    // `table.test.ts`'s double-ron record: seat 0's East, ronned by two seats at once
    const codes = (hand: string) => parseTenhou(hand).map(tenhouTile)
    await loadFixture({
      name: ['A', 'B', 'C', 'D'],
      rule: { disp: '南喰赤' },
      log: [
        [
          [0, 0, 0],
          [25000, 25000, 25000, 25000],
          codes('9p'),
          [],
          ...[
            ['123456789m123p1z', [42], [41]],
            ['123456789m456p1z', [], []],
            ['123456789m789p1z', [], []],
            ['123456789s123s1z', [], []],
          ].flatMap(([hand, takes, discards]) => [codes(hand as string), takes, discards]),
          ['和了', [-1000, 1000, 0, 0], [1, 0, 1, ''], [-1000, 0, 1000, 0], [2, 0, 2, '']],
        ],
      ],
    })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Next action' }))[0])
    expect(label()).toMatch(/^East 1 · 0 honba · 1\/1$/)
    expect(first('Next action')).toBeDisabled()
    // the claim is open, and nobody is asked: the replay mounts no controls of its own
    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull()
  })

  it('says why a file is refused, inline', async () => {
    await loadFixture({ title: 'not a log' })
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't a tenhou.net/6 game log")
  })
})
