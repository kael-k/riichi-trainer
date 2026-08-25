import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import '../features/i18n'
import { useLog, type LogDetail } from '../store/log'
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
})
