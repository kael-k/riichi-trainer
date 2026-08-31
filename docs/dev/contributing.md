# Contributing

## Commands

Node 26, pinned in `.nvmrc`.

```sh
npm run dev                  # dev server
npm test                     # all tests (vitest run)
npm run lint                 # oxlint
npm run build                # tsc -b + vite build
npm run ui-test              # playwright
npm run format               # prettier

npm run docs:dev             # docs site, with hot reload
npm run docs:build           # docs site, into dist/docs
```

Two of those have an ordering trap worth knowing once:

**`npm run build` empties `dist/`.** So `docs:build` runs _after_ it, never before — the other way
round silently deletes the docs, and would sweep the whole site into the PWA precache manifest.
CI does them in that order and then asserts the output landed.

**`npm run docs:dev` serves the docs on their own port.** The app's dev server does not proxy
`/docs`; the two are only stitched together at build time.

Two files are **generated and committed**, so their generators run only when their inputs move:
`src/assets/tiles/sprite.svg` (`npm run tiles`) and `src/core/hououPrior.ts`
(`npm run build-ev-models`). Edit the generator, never the output — including its comments, which
the generator emits.

## The three tests that carry the engine

The engine's failure modes are not the kind unit tests catch by example. A shanten optimisation can
be right for every hand you thought to write down and wrong for one you did not. A tile can go
missing from bookkeeping without any single assertion noticing. A tie-break can silently reorder and
change every board in the app while every test still passes.

So three invariant-shaped tests carry it, one per failure mode.

**A reference implementation as the specification.** `referenceStandardShanten` is the old
whole-hand search, kept _solely_ as the thing the fast per-suit decomposition is proved against over
thousands of random hands. **It is not dead code.** Change either one and re-run that comparison.

**A census.** Every tile kind is accounted for exactly four times — zero for 2m–8m under sanma —
across hands, melds, rivers, wall and dead wall, and each seat's stored tiles still agree with its
own counts. This is what catches bookkeeping slips no feature test would.

**A golden hash.** Seeded rounds are played out, each event stream serialised, and a hash frozen per
seed. It is the only thing that catches a silently reordered tie-break.

The protocol around that last one matters as much as the test: **freeze the hashes before a refactor,
and regenerate them deliberately — in the commit that changes behaviour, saying so in the message.**
A refactor's proof is "the hashes are unchanged", not "the tests still pass". A commit that
regenerates them without explaining why is itself the finding.

## Compatibility

**Situation URLs.** A shared link must keep resolving. These get pasted into chat and sat on for
months, and a training link that rots is worse than no link.

**The persisted settings schema.** A change to it needs a real migration in the settings store's
hand-written section-wise `merge`. Note what that rules out: the persist version must **not** be
bumped to drop a stale key, because a bump discards the whole stored blob and costs every reader
their theme, language and settings. Extend the `merge` instead — and extend it whenever a new
section is added, or old stored data silently loses the new fields.

## The app is responsive

It is mobile-first and has to work on a phone and on a desktop alike. Touch targets are at least
44px. Layouts are verified at phone widths in both orientations.

The browser suite runs a real WebKit, not a Chrome device emulation, because the board-squareness
bug class is invisible to emulation.

## Working rules

One task, one commit, on a conventional prefix. Verify before committing: `npm test`, `npm run lint`,
`npm run build` — and for anything that touches layout, a real browser at phone size.

A behaviour change updates `CLAUDE.md` in the same wave.

### Where documentation goes

Three places, one job each, and nothing repeats another.

|                            | Answers                                                                                                                            | Churn                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `CLAUDE.md`                | **How the code works today** — commands, layer rules, and the invariants whose default guess is wrong and whose breakage is silent | Every behaviour change |
| Docs site                  | **Why the models say what they say** — the deep dive a popover cannot carry                                                        | When a model moves     |
| The app's own locale files | **What a trainer is and how to use it**                                                                                            | With the feature       |

The test for `CLAUDE.md` is a single question: _would somebody get this wrong by guessing, and would
the breakage be silent?_ If not, it belongs here or nowhere.

The test for this site is the opposite: it explains numbers and decisions a reader could not
reconstruct from the source. It is **English only** and is never the source of an in-app string —
the app ships four languages and this does not, and generating one from the other would drift on the
first edit.

General riichi rules are documented at [riichi.wiki](https://riichi.wiki) and are not repeated here.
The app's glossary links there with hand-checked URLs, never with a slug guessed from the term id.

### Adding a trainer

Four places, every time, or the route is half-wired:

- `src/routes/index.tsx` — the route table
- `src/routes/HomePage.tsx` — the `MODES` array
- `src/features/i18n/trainerLinks.ts` — the wiki link
- `src/features/i18n/locales/{en,ja,zh,it}.json` — `trainer.<name>.*`

Then follow the trainer pattern: a page component plus a `use*Round` hook.

Locale note: `ja` and `zh` currently carry fewer keys than `en` and `it`. A new shared key can
therefore land in two locales only without anything failing — add all four.
