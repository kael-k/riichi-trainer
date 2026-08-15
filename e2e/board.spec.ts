import { expect, test, type Page } from '@playwright/test'

/** The trainers that draw a `Table`. Scoring keeps its board behind its own setting and the lab's
 *  design is still open, so neither is asserted here. */
const TABLE_TRAINERS = ['efficiency', 'folding'] as const

/** Advanced on, so every seat draws its info strip (the plate whose old home — a ring outboard of
 *  the felt — is what these tests exist to keep it out of), and waits on, which is the tallest
 *  that plate ever gets. `version` must match the store's own or zustand drops the blob. */
const SETTINGS = JSON.stringify({
  state: { advanced: true, mobileFullscreen: true, table: { showSeatWaits: true } },
  version: 3,
})

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(SETTINGS)})`,
  )
})

/** The fullscreen stage is the only layout with a hand strip of its own; phones auto-enter it, so
 *  every other viewport clicks the toggle. */
async function enterFullscreen(page: Page) {
  const strip = page.getByTestId('hand-strip')
  const toggle = page.getByRole('button', { name: 'Full screen table' })
  // folding searches fresh random walls for a hand worth drilling, so neither is on screen the
  // instant the route loads — wait for whichever this viewport is going to offer
  await expect(strip.or(toggle).first()).toBeVisible({ timeout: 20_000 })
  if (!(await strip.isVisible())) await toggle.click()
  await expect(strip).toBeVisible()
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

for (const trainer of TABLE_TRAINERS) {
  test(`${trainer}: the board is square`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    const board = page.getByTestId('board').first()
    await expect(board).toBeVisible()
    const box = (await board.boundingBox())!
    // one physical pixel of tolerance: a device pixel ratio of 3 rounds the CSS box
    expect(
      Math.abs(box.width - box.height),
      `board ${box.width}x${box.height}`,
    ).toBeLessThanOrEqual(1)
  })

  test(`${trainer}: fullscreen fits the whole board and the hand on screen`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    await enterFullscreen(page)

    const viewport = page.viewportSize()!
    const board = (await page.getByTestId('board').first().boundingBox())!
    const hand = (await page.getByTestId('hand-strip').boundingBox())!

    expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1)
    expect(board.x).toBeGreaterThanOrEqual(-1)
    expect(board.y).toBeGreaterThanOrEqual(-1)
    expect(board.x + board.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(board.y + board.height).toBeLessThanOrEqual(viewport.height + 1)
    // the hand is the rest of what has to fit: below the board, not over it, not off the bottom
    expect(hand.y).toBeGreaterThanOrEqual(board.y + board.height - 1)
    expect(hand.y + hand.height).toBeLessThanOrEqual(viewport.height + 1)
  })

  test(`${trainer}: no seat plate lands on a river`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    await expect(page.getByTestId('board').first()).toBeVisible()

    const plates = await page.getByTestId('seat-strip').all()
    expect(plates.length).toBeGreaterThan(0)
    const rivers = await page.getByTestId('river').all()

    for (const plate of plates) {
      const p = await plate.boundingBox()
      if (!p) continue
      const seat = await plate.getAttribute('data-seat')
      for (const river of rivers) {
        const r = await river.boundingBox()
        if (!r) continue
        const on = await river.getAttribute('data-seat')
        expect(
          overlaps(p, r),
          `seat ${seat} plate ${JSON.stringify(p)} overlaps seat ${on} river ${JSON.stringify(r)}`,
        ).toBe(false)
      }
    }
  })
}

test('efficiency-solo: your river is on screen in fullscreen', async ({ page }) => {
  await page.goto('/efficiency-solo')
  await enterFullscreen(page)

  // discard, so the river holds something to be seen at all
  await page.getByTestId('hand-strip').getByRole('button').first().click()

  const river = page.getByText('(you)')
  await expect(river).toBeVisible()
  const box = (await river.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
})

test('efficiency-solo: the log drawer covers the hand', async ({ page }) => {
  await page.goto('/efficiency-solo')
  await enterFullscreen(page)

  const hand = (await page.getByTestId('hand-strip').boundingBox())!
  await page.getByRole('button', { name: 'Show log' }).click()

  const drawer = page.getByTestId('log-drawer')
  await expect(drawer).toBeVisible()
  const box = (await drawer.boundingBox())!
  // the drawer spans the stage: it starts at or above the hand strip and ends at or below it,
  // rather than stopping at the board's bottom edge and leaving the tiles showing underneath
  expect(box.y).toBeLessThanOrEqual(hand.y)
  expect(box.y + box.height).toBeGreaterThanOrEqual(hand.y + hand.height - 1)
  // and it is genuinely on top: the topmost element over the hand's right edge is the drawer
  const onTop = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
    [hand.x + hand.width - 4, hand.y + hand.height / 2],
  )
  expect(onTop).toBe('log-drawer')
})
