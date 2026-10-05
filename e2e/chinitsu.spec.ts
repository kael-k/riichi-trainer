import { expect, test, type Page } from '@playwright/test'

/** `111 234 567 999` + `79p` — a kanchan on 8p and nothing else (9p completes the shape too, but
 *  the hand already holds all four). A pinned hand is honoured for the stream's first hand only. */
const PINNED = '/chinitsu?hand=1112345679999p'

/** The session panel, docked on a wide screen and a drawer below that — opened to read, and shut
 *  again before touching the board under it. */
async function openPanel(page: Page) {
  if (await page.getByTestId('session-panel').count()) return
  if (await page.getByTestId('log-drawer').count()) return
  await page.getByRole('button', { name: 'Show log' }).click()
  await expect(page.getByTestId('log-drawer')).toBeVisible()
}

function panel(page: Page) {
  return page.getByTestId('session-panel').or(page.getByTestId('log-drawer'))
}

/** The score line is mounted twice (strip and gutter HUD) and switched by CSS alone. */
function scoreLine(page: Page, text: string) {
  return page.getByText(text).filter({ visible: true })
}

function answerTile(page: Page, name: string) {
  return page.getByTestId('chinitsu-picker').getByRole('button', { name, exact: true })
}

async function handLabels(page: Page) {
  return page
    .getByTestId('chinitsu-hand')
    .getByRole('img')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
}

test('a pinned hand is posed, its waits picked and confirmed, then the stream moves on', async ({
  page,
}) => {
  await page.goto(PINNED)
  await expect(page.getByTestId('chinitsu-hand').getByRole('img')).toHaveCount(13)
  const posed = await handLabels(page)

  // the answer row is the whole suit, every tile a toggle
  await expect(page.getByTestId('chinitsu-picker').getByRole('button')).toHaveCount(9)
  const eight = answerTile(page, '8p')
  await eight.click()
  await expect(eight).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Confirm waits' }).click()

  await openPanel(page)
  await expect(panel(page).getByText(/Hand 1: waits.*correct/)).toBeVisible()
  await expect(scoreLine(page, 'Correct: 1 / 1')).toHaveCount(1)
  // the row expands into every reading of every wait
  await panel(page).getByRole('button', { name: 'Show detail' }).first().click()
  await expect(panel(page).getByText('Kanchan')).toBeVisible()
  await expect(panel(page).getByRole('group', { name: 'Waiting shape' })).toHaveCount(1)
  if (await page.getByTestId('log-drawer').count()) await page.keyboard.press('Escape')

  await expect.poll(() => handLabels(page)).not.toEqual(posed)
  await expect(
    page.getByTestId('chinitsu-picker').getByRole('button', { pressed: true }),
  ).toHaveCount(0)
})

test('a wrong set names the real waits and what was picked', async ({ page }) => {
  await page.goto(PINNED)
  await answerTile(page, '7p').click()
  await page.getByRole('button', { name: 'Confirm waits' }).click()

  await openPanel(page)
  await expect(panel(page).getByText(/Hand 1: waits.*you picked.*wrong/)).toBeVisible()
  await expect(scoreLine(page, 'Correct: 0 / 1')).toHaveCount(1)
})

test('digits toggle a tile of the suit and Enter confirms', async ({ page }) => {
  await page.goto(PINNED)
  await expect(page.getByTestId('chinitsu-hand').getByRole('img')).toHaveCount(13)

  await page.keyboard.press('8')
  await expect(answerTile(page, '8p')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Enter')

  await openPanel(page)
  await expect(panel(page).getByText(/Hand 1: waits.*correct/)).toBeVisible()
})

test('the suit and hand settings decide what is dealt next', async ({ page }) => {
  await page.goto('/chinitsu')
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Souzu', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Hands' }).selectOption('chinitsu')
  await dialog.getByRole('button', { name: 'Close' }).click()

  await expect
    .poll(async () => (await handLabels(page)).every((label) => /^[1-9]s$/.test(label ?? '')))
    .toBe(true)
  await expect(page.getByTestId('chinitsu-picker').getByRole('button')).toHaveCount(9)
})

test('with not-tenpai hands on, "Not tenpai" answers a hand that has no waits', async ({
  page,
}) => {
  // three runs and four lone honours: no tile completes it
  await page.goto('/chinitsu?hand=123456789p1234z')
  await expect(page.getByRole('button', { name: 'Not tenpai' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('checkbox', { name: 'Include hands that are not tenpai' }).check()
  await dialog.getByRole('button', { name: 'Close' }).click()

  // the setting re-deals, and the link's hand is still the one posed
  await expect(page.getByTestId('chinitsu-hand').getByRole('img')).toHaveCount(13)
  await page.getByRole('button', { name: 'Not tenpai' }).click()

  await openPanel(page)
  await expect(panel(page).getByText(/Hand 1: waits none \(not tenpai\).*correct/)).toBeVisible()
  await expect(scoreLine(page, 'Correct: 1 / 1')).toHaveCount(1)
})
