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
