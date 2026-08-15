import { expect, test, type Page } from '@playwright/test'

/** `123m 456m 789m 11p 23p` — three sets, a pair and a ryanmen, so exactly tenpai. A pinned hand
 *  is honoured only for the stream's first hand, which is what makes "posed once, then the stream
 *  carries on" testable at all. */
const PINNED = '/shanten?hand=123456789m1123p'
const PINNED_SHANTEN = 0

test.beforeEach(async ({ context }) => {
  // fullscreen off, so both the inline column and its status bar are the layout under test on
  // every project — the reveal/new-hand controls are the one pair that exists in both places
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(
      JSON.stringify({ state: { mobileFullscreen: false }, version: 3 }),
    )})`,
  )
})

/** The tiles the trainer is asking about, by name. Scoped: the feedback notice draws the hand you
 *  just answered, and that is a different question from what is on the table now. */
function handTiles(page: Page) {
  return page.getByTestId('shanten-hand').getByRole('img')
}

test('a pinned hand is posed, graded, and then the stream moves on', async ({ page }) => {
  await page.goto(PINNED)

  const tiles = handTiles(page)
  await expect(tiles).toHaveCount(13)
  const posed = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

  await page.getByRole('button', { name: String(PINNED_SHANTEN), exact: true }).click()

  await expect(page.getByText('Correct', { exact: true })).toBeVisible()
  await expect(page.getByText('Correct: 1 / 1')).toHaveCount(1)

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

  await expect(page.getByText('You said 3')).toBeVisible()
  await expect(page.getByText(`actual shanten: ${PINNED_SHANTEN}`)).toBeVisible()
  await expect(page.getByText('Correct: 0 / 1')).toHaveCount(1)
})

test('a new hand abandons the current one rather than pausing it', async ({ page }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  // the inline status bar and the fullscreen chrome draw the same pair, and the status bar stays
  // mounted under the fullscreen overlay — `.last()` is the one actually on top either way
  await page.getByRole('button', { name: 'New hand' }).last().click()

  // abandoned, not paused: the hand goes face down and the answer buttons go with it, so a peeked
  // hand cannot be put back on the clock
  await expect(page.getByRole('button', { name: 'Reveal hand' }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: '0', exact: true })).toHaveCount(0)
  await expect(page.getByText('Correct: 0 / 0')).toHaveCount(1)

  await page.getByRole('button', { name: 'Reveal hand' }).last().click()
  await expect(page.getByRole('button', { name: '0', exact: true })).toBeVisible()
})

test('the answer buttons are the whole answer on a phone', async ({ page, viewport }) => {
  await page.goto(PINNED)
  await expect(handTiles(page)).toHaveCount(13)

  // typing a number needs a keyboard, and a keyboard on a phone covers the hand you are counting,
  // so the field is a tablet-and-up control. The 0-6 buttons have to carry it alone below that —
  // chiitoitsu caps shanten at 6, so every reachable answer is on screen
  const field = page.getByPlaceholder('shanten?')
  const phone = !!viewport && (viewport.width <= 640 || viewport.height <= 520)
  if (phone) await expect(field).toBeHidden()
  else await expect(field).toBeVisible()

  for (const n of [0, 1, 2, 3, 4, 5, 6]) {
    await expect(page.getByRole('button', { name: String(n), exact: true })).toBeVisible()
  }
})
