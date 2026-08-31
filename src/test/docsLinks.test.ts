import { describe, expect, it } from 'vitest'

/**
 * Comments that cite a page of the docs site must cite one that exists.
 *
 * Most model comments do not link out at all — a citation survives only where the doc explains a
 * number or a formula the file cannot state itself. That leaves few enough pointers to be worth
 * keeping honest and too few to notice by hand: rewording one heading in `docs/model/` silently
 * breaks every comment aimed at it, and nothing else in the toolchain looks at prose inside a
 * comment. VitePress' own dead-link check covers links *between* doc pages, not links *into* them.
 *
 * The same shape as `formatLogEntry.test.ts`' walk over the locale files, and for the same reason:
 * what is being checked is a convention, so the check has to be a walk. Both sides are read
 * through `import.meta.glob` rather than `node:fs`, so this needs no Node types in the app's own
 * tsconfig — which would also hand them to production code.
 */

const sources = import.meta.glob('/{src,e2e,scripts}/**/*.{ts,tsx,mjs}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const pages = import.meta.glob('/docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** `docs/model/limits.md#the-grading-band`, anchor optional. */
const POINTER = /docs\/[a-z0-9/-]+\.md(?:#([a-z0-9-]+))?/g
const HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*$/gm

/** GitHub and VitePress agree on this, which is why one pointer form serves both. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

const pointers = Object.entries(sources).flatMap(([file, text]) =>
  [...text.matchAll(POINTER)].map((match) => ({
    file,
    target: `/${match[0].split('#')[0]}`,
    anchor: match[1],
  })),
)

describe('doc pointers in source comments', () => {
  it('finds some, so a regex that stops matching cannot make this vacuous', () => {
    expect(pointers.length).toBeGreaterThan(0)
    expect(Object.keys(pages).length).toBeGreaterThan(0)
  })

  it.each(pointers)('$file -> $target#$anchor', ({ target, anchor }) => {
    const page = pages[target]
    expect(page, `${target} does not exist`).toBeTypeOf('string')
    if (!anchor) return
    expect([...page.matchAll(HEADING)].map((match) => slug(match[1]))).toContain(anchor)
  })
})
