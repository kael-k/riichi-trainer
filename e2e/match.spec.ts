import { expect, test, type Page } from '@playwright/test'

/**
 * `/match`'s replay of a recorded tenhou.net/6 game: loaded from the setup screen, stepped with
 * the HUD and the arrow keys, its log growing behind the cursor and pricing each free discard
 * under both EV models in the stats worker — the part only a real browser runs.
 */

const FIXTURE = 'src/core/testdata/convlog.json'

/** The HUD is in the DOM twice (the strip, and the float held sideways); one is `display: none`,
 *  which role queries already skip but a test id does not. */
function position(page: Page) {
  return page.locator('[data-testid="replay-position"]:visible')
}

function nav(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true })
}

test('a loaded game steps forward, its log growing and priced', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto('/match')
  await page.getByLabel('Load a game').setInputFiles(FIXTURE)
  await expect(position(page)).toHaveText(/^East 1 · 0 honba · 0\/\d+$/)
  await expect(nav(page, 'Previous action')).toBeDisabled()

  const board = page.getByTestId('board').first()
  await expect(board).toBeVisible()
  const box = (await board.boundingBox())!
  // one physical pixel of tolerance: a device pixel ratio of 3 rounds the CSS box
  expect(Math.abs(box.width - box.height), `board ${box.width}x${box.height}`).toBeLessThanOrEqual(
    1,
  )

  await nav(page, 'Next action').click()
  await expect(position(page)).toHaveText(/ · 1\/\d+$/)
  await page.keyboard.press('ArrowRight')
  await expect(position(page)).toHaveText(/ · 2\/\d+$/)
  // the strip's height never moves with what the label says
  const hud = page.locator('[data-testid="stats-hud"]:visible')
  const before = (await hud.boundingBox())!.height
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight')
  await expect(position(page)).toHaveText(/ · 11\/\d+$/)
  expect((await hud.boundingBox())!.height).toBe(before)

  if (!(await page.getByTestId('session-panel').count())) {
    await page.getByRole('button', { name: 'Show log' }).click()
  }
  const log = page.getByTestId('session-panel').or(page.getByTestId('log-drawer'))
  await expect(log.getByText(/discarded/).first()).toBeVisible()
  // the watched seat's first free discard, priced under both models (up to ~2 s a row, queued)
  await expect(log.getByText(/^Statistic \(/).first()).toBeVisible({ timeout: 60_000 })
  await expect(log.getByText(/^Houou \(/).first()).toBeVisible({ timeout: 60_000 })

  expect(errors).toEqual([])
})
