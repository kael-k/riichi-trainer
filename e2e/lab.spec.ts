import { expect, test } from '@playwright/test'

/**
 * The lab's EV panel — the priced decision on screen, and the only place in the app that reads
 * `core/ev.ts` at all. The point of driving it in a browser rather than the hook alone is that the
 * arithmetic has to survive being *rendered*: a term is a probability, a value and their product
 * on one line, and a reader checking the multiplication by eye is the whole reason to prefer a
 * formula to a network that would be more accurate.
 */
test.describe('the lab', () => {
  // the session panel this lives in is docked from `lg` up and a drawer below it, and a drawer is
  // a different test — what is being checked here is the arithmetic, not how the panel opens
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 1024,
    'the session panel is a drawer below lg',
  )

  test('prices a turn when asked, and shows the terms behind the number', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))

    await page.goto('/lab')
    // the lab opens with no wall at all: build one, then deal it
    await page.getByRole('button', { name: /Build wall/i }).click()
    await page.getByRole('button', { name: /Load wall/i }).click()

    // asked for, never computed on every turn — an exact ranking is hundreds of milliseconds
    const price = page.getByRole('button', { name: /Price this turn/i })
    await expect(price).toBeVisible()
    await price.click()

    // the header says which seat, which model and which currency, because none of the numbers
    // below it means anything without all three — both halves are `DEFAULT_EV_SEAT`'s own defaults
    // (`core/ev.ts`), rendered through `seats.evModel.*` / `seats.evObjective.*`
    await expect(page.getByText(/Statistic model, playing for Placement/i)).toBeVisible()
    // both branches of the identity, and at least one term decomposed
    await expect(page.getByText(/push/i).first()).toBeVisible()
    await expect(page.getByText(/no win/i).first()).toBeVisible()
    expect(errors).toEqual([])
  })
})
