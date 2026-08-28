import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import '../features/i18n'
import { useLog, type LogDetail, type LogEntry } from '../store/log'
import { LogList } from './LogList'

/** The list reads `useSearchParams` for its rewind button, so it only renders inside a router. */
function renderLog(detail: LogDetail[]) {
  useLog.setState({ entries: [] })
  useLog.getState().log({ key: 'log.wentBack', detail })
  const utils = render(
    <MemoryRouter>
      <LogList />
    </MemoryRouter>,
  )
  return utils
}

function renderEntry(entry: Omit<LogEntry, 'id'>) {
  useLog.setState({ entries: [] })
  useLog.getState().log(entry)
  return render(
    <MemoryRouter>
      <LogList />
    </MemoryRouter>,
  )
}

/** The detail lines only exist once the row is expanded — the chevron is the only way in. */
function expand() {
  fireEvent.click(screen.getByLabelText('Show details'))
}

describe('LogList detail lines', () => {
  beforeEach(() => useLog.setState({ entries: [] }))

  it('draws a header as a label rather than a detail line, and never with tiles', () => {
    // a header carrying tiles is a caller bug; the renderer simply does not draw them
    const { container } = renderLog([
      { key: 'log.detail.yaku', header: true, tiles: [{ id: 0, red: false }] },
    ])
    expand()

    const header = screen.getByText('Yaku')
    expect(header.className).toContain('uppercase')
    expect(header.querySelector('svg')).toBeNull()
    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(0)
  })

  it('draws a wrong answer in the error colour and everything else in the neutral one', () => {
    renderLog([
      {
        key: 'log.scoring.field',
        params: { labelKey: 'scoring.hanLabel', expected: 3, answer: 2 },
      },
      { key: 'log.scoring.field', params: { labelKey: 'scoring.fuLabel', expected: 30 } },
    ])
    expand()

    const wrong = screen.getByText(/you answered 2/).closest('div')!
    expect(wrong.className).toContain('text-neutral-500')
    expect(wrong.className).not.toContain('text-red')
  })

  it('tones a line only when it says it is wrong', () => {
    renderLog([
      {
        key: 'log.scoring.field',
        params: { labelKey: 'scoring.hanLabel', expected: 3, answer: 2 },
        tone: 'error',
      },
    ])
    expand()

    const line = screen.getByText(/you answered 2/).closest('div')!
    expect(line.className).toContain('text-red-600')
    expect(line.className).not.toContain('text-neutral-500')
  })

  it('separates the subject tile from the evidence behind it at the seam', () => {
    const tiles = [
      { id: 8, red: false },
      { id: 5, red: false },
    ]
    const { container } = renderLog([
      { key: 'log.folding.yourTile', params: { tier: 'suji' }, tiles, seam: 1 },
    ])
    expand()

    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(2)
    expect(container.querySelectorAll('.border-l')).toHaveLength(1)
  })

  it('draws no seam rule when a line has only its subject', () => {
    const { container } = renderLog([
      {
        key: 'log.folding.yourTile',
        params: { tier: 'genbutsu' },
        tiles: [{ id: 8, red: false }],
        seam: 1,
      },
    ])
    expand()

    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(1)
    expect(container.querySelectorAll('.border-l')).toHaveLength(0)
  })

  it('draws one bar per candidate, normalized on the best entry', () => {
    const { container } = renderLog([
      {
        key: 'log.folding.evBand',
        params: { model: 'statistical', near: 100, wrong: 400, delta: 0 },
        bars: [
          { tile: 27, value: -300, fraction: 1, best: true, chosen: true },
          { tile: 10, value: -900, fraction: 0.4 },
          { tile: 3, value: -1500, fraction: 0 },
        ],
      },
    ])
    expand()

    expect(screen.getByText('Statistic', { exact: false })).toBeTruthy()
    const fills = container.querySelectorAll<HTMLElement>('.h-1.rounded-full[style]')
    expect(fills).toHaveLength(3)
    expect(fills[0].style.width).toBe('100%')
    expect(fills[1].style.width).toBe('40%')
    expect(fills[2].style.width).toBe('0%')
    // the chosen tile is also the best one here, so it takes the best (green) colour, never both
    // classes fighting for the same bar
    expect(fills[0].className).toContain('green')
    expect(fills[0].className).not.toContain('red')
  })

  it('marks a chosen tile that is not the best one in the wrong colour', () => {
    const { container } = renderLog([
      {
        key: 'log.folding.evBand',
        params: { model: 'houou', near: 200, wrong: 800, delta: 900 },
        bars: [
          { tile: 27, value: -300, fraction: 1, best: true },
          { tile: 10, value: -1200, fraction: 0, chosen: true },
        ],
      },
    ])
    expand()

    const fills = container.querySelectorAll<HTMLElement>('.h-1.rounded-full[style]')
    expect(fills[0].className).toContain('green')
    expect(fills[1].className).toContain('red')
  })
})

describe('LogList sentences', () => {
  beforeEach(() => useLog.setState({ entries: [] }))

  it('draws the tiles a sentence names instead of their tenhou codes', () => {
    const { container } = renderEntry({
      key: 'log.efficiency.discardMistakeDrew',
      params: { turn: 4, drawn: '4z', tile: '0p', yours: 57, best: '3z', bestUkeire: 68 },
    })

    // three codes in, three tile faces out — and not one of them left as text
    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(3)
    expect(container.textContent).not.toContain('0p')
    expect(container.textContent).toContain('Turn 4')
  })
})
