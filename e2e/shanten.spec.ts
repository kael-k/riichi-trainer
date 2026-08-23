import { expect, test, type Page } from '@playwright/test'

/** `123m 456m 789m 11p 23p` — three sets, a pair and a ryanmen, so exactly tenpai. A pinned hand
 *  is honoured only for the stream's first hand, which is what makes "posed once, then the stream
 *  carries on" testable at all. */
const PINNED = '/shanten?hand=123456789m1123p'
const PINNED_SHANTEN = 0

/** The score line and the log both live in the session panel: docked open on a wide screen, behind
 *  the log button below that — where it covers the board, so a narrow-viewport test opens it to
 *  read and closes it again before touching anything underneath. */
async function openPanel(page: Page) {
  if (await page.getByTestId('session-panel').count()) return
  if (await page.getByTestId('log-drawer').count()) return
  await page.getByRole('button', { name: 'Show log' }).click()
  await expect(page.getByTestId('log-drawer')).toBeVisible()
}

/** The session panel itself, whichever shape it is in. Feedback is on screen twice on a wide
 *  viewport — `BoardStage` floats the compact verdict over the board *and* keeps the full notice
 *  in the docked panel — so an assertion about the full breakdown has to say which one it means
 *  or it resolves to both. */
function panel(page: Page) {
  return page.getByTestId('session-panel').or(page.getByTestId('log-drawer'))
}

async function closePanel(page: Page) {
  if (!(await page.getByTestId('log-drawer').count())) return
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('log-drawer')).toHaveCount(0)
}

/** The tiles the trainer is asking about, by name. Scoped: the feedback notice draws the hand you
 *  just answered, and that is a different question from what is on the table now. */
function handTiles(page: Page) {
  return page.getByTestId('shanten-hand').getByRole('img')
}

/** The score line (`BoardStage`'s `status`) is mounted twice — once for the plain portrait row,
 *  once for the floating gutter HUD — and switched between by CSS media query rather than JS, so
 *  only one is ever `:visible` at a time. Scope to that one instead of the raw text match. */
function scoreLine(page: Page, text: string) {
  return page.getByText(text).filter({ visible: true })
}

test('a pinned hand is posed, graded, and then the stream moves on', async ({ page }) => {
  await page.goto(PINNED)

  const tiles = handTiles(page)
  await expect(tiles).toHaveCount(13)
  const posed = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

  await page.getByRole('button', { name: String(PINNED_SHANTEN), exact: true }).click()

  // the full verdict and the running score both live in the session panel
  await openPanel(page)
  await expect(panel(page).getByText('Correct', { exact: true })).toBeVisible()
  await expect(scoreLine(page, 'Correct: 1 / 1')).toHaveCount(1)
  await closePanel(page)

  // the stream deals the next hand straight away, already revealed — there is no next-hand button
  await expect(tiles).toHaveCount(13)
  await expect
    .poll(async () => tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))
    .not.toEqual(posed)
})

test('a wrong guess names both the guess and the real answer', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  await page.getByRole('button', { name: '3', exact: true }).click()

  await openPanel(page)
  await expect(panel(page).getByText('You said 3')).toBeVisible()
  await expect(panel(page).getByText(`actual shanten: ${PINNED_SHANTEN}`)).toBeVisible()
  await expect(scoreLine(page, 'Correct: 0 / 1')).toHaveCount(1)
})

test('a new hand abandons the current one rather than pausing it', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  await page.getByRole('button', { name: 'New hand' }).click()

  // abandoned, not paused: the hand goes face down and the answer buttons go with it, so a peeked
  // hand cannot be put back on the clock
  await expect(page.getByRole('button', { name: 'Reveal hand' })).toBeVisible()
  await expect(page.getByRole('button', { name: '0', exact: true })).toHaveCount(0)
  await openPanel(page)
  await expect(scoreLine(page, 'Correct: 0 / 0')).toHaveCount(1)
  await closePanel(page)

  await page.getByRole('button', { name: 'Reveal hand' }).click()
  await expect(page.getByRole('button', { name: '0', exact: true })).toBeVisible()
})

test('the answer buttons are the whole answer on every viewport', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  // chiitoitsu caps shanten at 6, so every reachable answer is on screen — no field to hide on a
  // phone any more, since a guess can also be typed via the global keyboard handler
  for (const n of [0, 1, 2, 3, 4, 5, 6]) {
    await expect(page.getByRole('button', { name: String(n), exact: true })).toBeVisible()
  }
})

test('typing a digit on the keyboard submits the guess', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  await page.keyboard.press(String(PINNED_SHANTEN))

  await openPanel(page)
  await expect(panel(page).getByText('Correct', { exact: true })).toBeVisible()
  await expect(scoreLine(page, 'Correct: 1 / 1')).toHaveCount(1)
})
