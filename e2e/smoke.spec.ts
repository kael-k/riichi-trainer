import { test, expect } from '@playwright/test'

/** Lab is deliberately absent: its design is still open, so it has nothing stable to assert. */
const TRAINERS = ['efficiency', 'efficiency-solo', 'shanten', 'scoring', 'folding'] as const

test('home links every trainer', async ({ page }) => {
  await page.goto('/')
  for (const trainer of TRAINERS) {
    await expect(page.locator(`a[href$="/${trainer}"]`)).toBeVisible()
  }
})

for (const trainer of TRAINERS) {
  test(`${trainer} loads a hand`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`/${trainer}`)

    // Every tile is an <svg role="img">; a dealt hand is at least 13 of them.
    const tiles = page.getByRole('img')
    await expect(tiles.first()).toBeVisible()
    expect(await tiles.count()).toBeGreaterThanOrEqual(13)
    expect(errors).toEqual([])
  })
}

/**
 * The docs are a separate static site under `/docs/`, not a route this app knows about, so the
 * link to them has to cause a real document navigation. A react-router `<Link>` renders the same
 * `<a href>` and would pass an href assertion while silently rendering the crash page instead —
 * so the assertion is that the document itself was replaced.
 *
 * The dev server this suite runs against does not serve `/docs/` (only the production build
 * stitches the two sites together), so what lands there is not asserted. That it was fetched at
 * all is the whole point.
 */
test('the docs link leaves the app instead of routing inside it', async ({ page }) => {
  await page.goto('/')

  // survives a client-side route, dies with the document
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__stayed = true))

  const link = page.getByRole('link', { name: 'Documentation' })
  await expect(link).toHaveAttribute('href', '/docs/')

  await Promise.all([page.waitForURL('**/docs/'), link.click()])

  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__stayed),
  ).toBeUndefined()
})
