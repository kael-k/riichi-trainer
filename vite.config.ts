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
      includeAssets: ['favicon.svg', 'icon-square.svg'],
      manifest: {
        name: 'Riichi Trainer',
        short_name: 'Riichi Trainer',
        description: 'Mobile-first riichi mahjong efficiency and shanten trainer',
        theme_color: '#863bff',
        background_color: '#ffffff',
        display: 'standalone',
        // `favicon.svg` (300x400, transparent) is the browser tab icon. Home-screen launchers force
        // a square icon, so `icon-square.svg` is a separate 400x400 asset with the same tile centred
        // at full height on transparent — never `purpose: 'maskable'`, since a maskable safe-zone
        // crop would clip the top/bottom of a tile that tall.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-square.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
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
