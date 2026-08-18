/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GITHUB_SHA is set by Actions; fall back to the local checkout for dev builds. Full sha, not
// abbreviated: the footer is what a bug report quotes back, and a full sha is unambiguous.
const commitSha = (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString()).trim()

export default defineConfig({
  define: {
    __COMMIT_SHA__: JSON.stringify(commitSha),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Riichi Trainer',
        short_name: 'Riichi Trainer',
        description: 'Mobile-first riichi mahjong efficiency and shanten trainer',
        theme_color: '#863bff',
        background_color: '#ffffff',
        display: 'standalone',
        // `maskable` as well as `any`: the artwork is a square felt field with the tile inside the
        // middle 78%, so an adaptive launcher can crop it to its own shape without clipping the
        // tile. Declaring it while the tile still ran the full height is what made it stretch.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  test: {
    // Explicit, so vitest never collects `e2e/*.spec.ts` — those are Playwright's.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
