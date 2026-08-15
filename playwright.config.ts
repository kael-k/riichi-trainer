import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
// `localhost`, not `127.0.0.1`: vite binds the hostname, which resolves to ::1 first on a
// dual-stack box, and the readiness poll then never connects.
const baseURL = `http://localhost:${PORT}`

/** UI tests. WebKit is the point: the mobile layout bugs this suite exists for reproduce on
 *  iPhone and not in Chrome/Firefox device emulation, and Playwright is the only runner that
 *  drives a real WebKit. Desktop Chrome rides along so a regression there is caught too. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // a failing layout assertion is a picture, not a stack: the shot is what says *how* the board
  // came out wrong
  use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile', use: devices['iPhone 13'] },
    { name: 'mobile-landscape', use: devices['iPhone 13 landscape'] },
    { name: 'desktop', use: devices['Desktop Chrome'] },
  ],
  // Dev server, not `vite preview`: no build step to wait on, and these tests are about layout,
  // which the dev bundle renders identically. Swap to preview if a test ever needs the PWA
  // service worker or a production-only asset path.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
