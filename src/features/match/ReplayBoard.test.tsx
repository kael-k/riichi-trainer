import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import convlog from '../../core/testdata/convlog.json'
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

  it('says why a file is refused, inline', async () => {
    await loadFixture({ title: 'not a log' })
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't a tenhou.net/6 game log")
  })
})
