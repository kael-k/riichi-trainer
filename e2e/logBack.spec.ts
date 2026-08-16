import { expect, test, type Page } from '@playwright/test'

/** `123m 456m 789m 11p 23p` — three sets, a pair and a ryanmen, tenpai. Pinned so the stream's
 *  first hand (and so the "back" target it leaves behind) is deterministic. */
const PINNED = '/shanten?hand=123456789m1123p'

test.beforeEach(async ({ context }) => {
  // fullscreen off, so the inline status bar is the only command bar mounted — the button under
  // test would otherwise exist twice (inline plus the fullscreen chrome's own copy)
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(
      JSON.stringify({ state: { mobileFullscreen: false }, version: 3 }),
    )})`,
  )
})

function handTiles(page: Page) {
  return page.getByTestId('shanten-hand').getByRole('img')
}

async function tileLabels(page: Page): Promise<(string | null)[]> {
  return handTiles(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
}

function undoButton(page: Page) {
  return page.getByRole('button', { name: 'Undo last action' })
}

test('undo is disabled until a decision has been made', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  await expect(undoButton(page)).toBeDisabled()
  await expect(page.getByText('Log (0)')).toBeVisible()
})

test('undo re-poses the previous hand, and works more than once', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  const hand1 = await tileLabels(page)

  // hand 1 answered — the stream moves on to hand 2
  await page.getByRole('button', { name: '0', exact: true }).click()
  await expect(handTiles(page)).toHaveCount(13)
  const hand2 = await tileLabels(page)
  expect(hand2).not.toEqual(hand1)

  // hand 2 answered — the stream moves on to hand 3
  await page.getByRole('button', { name: '0', exact: true }).click()
  await expect(handTiles(page)).toHaveCount(13)
  const hand3 = await tileLabels(page)
  expect(hand3).not.toEqual(hand2)

  await expect(undoButton(page)).toBeEnabled()
  await expect(page.getByText('Log (2)')).toBeVisible()

  // one step back: hand 2 is on screen again, ungraded
  await undoButton(page).click()
  await expect.poll(() => tileLabels(page)).toEqual(hand2)
  await expect(page.getByText('Log (3)')).toBeVisible()
  await expect(page.getByText('Went back one step')).toBeVisible()

  // pressing it again goes one further back: hand 1
  await undoButton(page).click()
  await expect.poll(() => tileLabels(page)).toEqual(hand1)
  await expect(page.getByText('Log (4)')).toBeVisible()

  // nothing left to undo — the button disables itself rather than looping back to hand 3
  await expect(undoButton(page)).toBeDisabled()
})
