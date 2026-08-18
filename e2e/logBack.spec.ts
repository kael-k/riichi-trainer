import { expect, test, type Page } from '@playwright/test'

/** `123m 456m 789m 11p 23p` — three sets, a pair and a ryanmen, tenpai. Pinned so the stream's
 *  first hand (and so the "back" target it leaves behind) is deterministic. */
const PINNED = '/shanten?hand=123456789m1123p'

/** The score line and the log both live in the session panel: docked open on a wide screen, behind
 *  the log button below that — where it covers the board, so a narrow-viewport test opens it to
 *  read and closes it again before touching anything underneath. */
async function openPanel(page: Page) {
  if (await page.getByTestId('session-panel').count()) return
  if (await page.getByTestId('log-drawer').count()) return
  await page.getByRole('button', { name: 'Show log' }).click()
  await expect(page.getByTestId('log-drawer')).toBeVisible()
}

async function closePanel(page: Page) {
  if (!(await page.getByTestId('log-drawer').count())) return
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('log-drawer')).toHaveCount(0)
}

function handTiles(page: Page) {
  return page.getByTestId('shanten-hand').getByRole('img')
}

async function tileLabels(page: Page): Promise<(string | null)[]> {
  return handTiles(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
}

/** Waits for the stream to pose the next hand, and returns it. The count never moves — a graded
 *  hand is replaced in place by another thirteen tiles — so "a new hand is up" can only be waited
 *  for by what the tiles *are*. Reading them straight after the click raced the re-render and
 *  sometimes captured the hand that had just been answered. */
async function nextHandAfter(page: Page, previous: (string | null)[]) {
  await expect.poll(() => tileLabels(page)).not.toEqual(previous)
  return tileLabels(page)
}

function undoButton(page: Page) {
  return page.getByRole('button', { name: 'Undo last action' })
}

test('undo is disabled until a decision has been made', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  await expect(undoButton(page)).toBeDisabled()
  await openPanel(page)
  await expect(page.getByText('Log (0)')).toBeVisible()
})

test('undo re-poses the previous hand, and works more than once', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  const hand1 = await tileLabels(page)

  // hand 1 answered — the stream moves on to hand 2
  await page.getByRole('button', { name: '0', exact: true }).click()
  const hand2 = await nextHandAfter(page, hand1)

  // hand 2 answered — the stream moves on to hand 3, which nothing below needs by name: the two
  // undos walk back to hand 2 and hand 1
  await page.getByRole('button', { name: '0', exact: true }).click()
  await nextHandAfter(page, hand2)

  await expect(undoButton(page)).toBeEnabled()
  await openPanel(page)
  await expect(page.getByText('Log (2)')).toBeVisible()
  await closePanel(page)

  // one step back: hand 2 is on screen again, ungraded
  await undoButton(page).click()
  await expect.poll(() => tileLabels(page)).toEqual(hand2)
  await openPanel(page)
  await expect(page.getByText('Log (3)')).toBeVisible()
  await expect(page.getByText('Went back one step')).toBeVisible()
  await closePanel(page)

  // pressing it again goes one further back: hand 1
  await undoButton(page).click()
  await expect.poll(() => tileLabels(page)).toEqual(hand1)
  await openPanel(page)
  await expect(page.getByText('Log (4)')).toBeVisible()
  await closePanel(page)

  // nothing left to undo — the button disables itself rather than looping back to hand 3
  await expect(undoButton(page)).toBeDisabled()
})
