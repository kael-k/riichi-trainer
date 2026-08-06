/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GITHUB_SHA is set by Actions; fall back to the local checkout for dev builds
const commitSha = (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString())
  .trim()
  .slice(0, 7)

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
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
