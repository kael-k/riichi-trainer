import { defineConfig } from 'vitepress'

// The docs are a second static site inside the app's own deploy: `vitepress build docs` writes
// into `dist/docs`, which `.github/workflows/ci.yml` then uploads to Pages along with the app.
// Three things here are load-bearing and are explained where they are set.
export default defineConfig({
  title: 'Riichi Trainer',
  description: 'How the trainer models danger, wins and the push/fold decision.',
  lang: 'en-US',

  // The app owns `/`; the docs live under `/docs/`, served as real files so Pages finds them
  // before the SPA's own `404.html` fallback ever runs.
  base: '/docs/',
  // Relative to `srcDir` (which is `docs/`), so this is the repo's own `dist/docs`. The workflow
  // runs `docs:build` *after* `npm run build`, since vite empties `dist/` on the way in.
  outDir: '../dist/docs',
  // Every internal link therefore carries `.html` and nothing depends on Pages' extensionless-URL
  // behaviour, which is not the same on every host this could move to.
  cleanUrls: false,

  themeConfig: {
    nav: [
      { text: 'Model', link: '/model/danger' },
      { text: 'Development', link: '/dev/architecture' },
      { text: 'App', link: 'https://riichi-trainer.kael-k.io/' },
    ],
    sidebar: [
      {
        text: 'Model',
        items: [
          { text: 'Danger', link: '/model/danger' },
          { text: 'Win probability', link: '/model/win-probability' },
          { text: 'Push and fold', link: '/model/push-fold' },
          { text: 'The houou model', link: '/model/houou' },
          { text: 'Limits', link: '/model/limits' },
        ],
      },
      {
        text: 'Development',
        items: [
          { text: 'Architecture', link: '/dev/architecture' },
          { text: 'Contributing', link: '/dev/contributing' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/kael-k/riichi-trainer' }],
    editLink: {
      pattern: 'https://github.com/kael-k/riichi-trainer/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
  },
})
