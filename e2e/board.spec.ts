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

/** A shared folding link whose seats call heavily — the corner cell has to hold several melds and
 *  the seat plate at once, which is the case that broke first. */
const CALLED_BOARD =
  '/folding?wall=0s32m4s2z3p98m9p2s9p44m8p5s32z6m45z1p8234s2z74p67m35s61z3p2m6p80m5z2s9m4s3p6z4s8p3m64z4m1z7s7473z2p1m2p3z36s5m8s1m7z8641p81s9m7p6s55m5z0p99s35p2m1z8p9s9m6s6m8s1z3s1m7z26p236m1s17p7s4m259s3m4z41975p25z7s7m4p1m95p7m2p8m3z7s6z8m6p161s7m&sanma=0&threats=1&wins=1'

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

test('a called hand keeps its melds and plate inside the felt', async ({ page }) => {
  await page.goto(CALLED_BOARD)
  const board = page.getByTestId('board').first()
  await expect(board).toBeVisible()
  const square = (await board.boundingBox())!

  const rivers = await page.getByTestId('river').all()
  const riverBoxes = (await Promise.all(rivers.map((r) => r.boundingBox()))).filter((b) => !!b)

  // the fixture is only worth anything if it really is a heavily called board: a corner cell holds
  // one child per call, plus the seat's own plate, so four children is three calls
  const busiest = await page
    .getByTestId('corner')
    .evaluateAll((cells) => Math.max(...cells.map((c) => c.children.length)))
  expect(
    busiest,
    'the fixture link no longer produces a heavily called board',
  ).toBeGreaterThanOrEqual(4)

  for (const corner of await page.getByTestId('corner').all()) {
    const seat = await corner.getAttribute('data-seat')
    // the cell's own box is its grid track; what can overflow is its content
    const content = await corner.evaluate((el) => {
      const rects = [...el.children].map((c) => c.getBoundingClientRect())
      const x = Math.min(...rects.map((r) => r.left))
      const y = Math.min(...rects.map((r) => r.top))
      return {
        x,
        y,
        width: Math.max(...rects.map((r) => r.right)) - x,
        height: Math.max(...rects.map((r) => r.bottom)) - y,
      }
    })

    expect(content.x, `seat ${seat} corner runs off the board`).toBeGreaterThanOrEqual(square.x - 1)
    expect(content.y, `seat ${seat} corner runs off the board`).toBeGreaterThanOrEqual(square.y - 1)
    expect(content.x + content.width).toBeLessThanOrEqual(square.x + square.width + 1)
    expect(content.y + content.height).toBeLessThanOrEqual(square.y + square.height + 1)
    for (const river of riverBoxes) {
      expect(overlaps(content, river), `seat ${seat} corner overlaps a river`).toBe(false)
    }
  }
})

test('only a phone-sized viewport comes up fullscreen', async ({ page, viewport }) => {
  // held sideways is the viewport with the least room of all, so it is the one that most needs
  // this — and on a width-only check it was the one that never auto-entered. Anywhere roomier the
  // stage must stay inline until the reader asks for it, which is the same rule read the other way
  const phone = !!viewport && (viewport.width <= 640 || viewport.height <= 520)
  await page.goto('/efficiency')

  const strip = page.getByTestId('hand-strip')
  if (phone) {
    await expect(strip).toBeVisible()
    return
  }
  await expect(page.getByRole('button', { name: 'Full screen table' })).toBeVisible()
  await expect(strip).toHaveCount(0)
  await enterFullscreen(page)
})

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
