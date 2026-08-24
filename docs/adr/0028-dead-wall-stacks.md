# ADR-0028 — The dead wall is seven stacks, not three blocks

**Status:** Accepted · **Date:** 2026-08-24
**Source:** `core/round.ts#createRound`/`drawReplacement`
**Amends:** ADR-0005 (the wall format's trailing 14 only; everything else there stands)

## Context

`createRound` cut the trailing 14 tiles of the wall into three flat blocks: the five dora
indicators, then the five ura dora, then the four rinshan tiles. Two things about that were wrong,
and the first of them is a scoring bug rather than a cosmetic one.

A dead wall is seven **stacks** of two. An indicator and the ura dora that pays out under it are
the top and bottom of one stack — so slicing indicators out of one block and ura out of another
paired every indicator with the underside of a different stack. A riichi win's ura dora came off
tiles that had nothing to do with the indicators showing.

The second is where the deal's own indicator sits. Replacement tiles come off the two stacks
nearest the break, and the flipped indicator is the third stack from that same end; each kan dora
is then flipped on the stack beyond it, walking back toward the live wall. Four kans is four
rinshan tiles and five indicators — exactly the seven stacks, which is why the dead wall is that
size at all. Laid flat in draw order the block read indicator-first, i.e. backwards.

## Decision

The trailing `DEAD_WALL_SIZE` tiles are read as seven stacks in draw order — `[stack7, stack6,
stack5, stack4, stack3, rinshan, rinshan]`, each stack being an indicator over its own ura dora.

- **A stack's two tiles stay adjacent.** `doraStack[n]` is `chunk[stack * 2]` and `uraStack[n]` is
  `chunk[stack * 2 + 1]` — the top tile is drawn first, so it is the indicator.
- **Indicators are read off that block backwards.** The stack nearest the rinshan (`chunk[8]` of a
  full 14) is flipped at the deal; `chunk[0]` would be the fourth kan dora.
- **The rinshan tiles stay at the tail**, which is what `drawReplacement` already popped from,
  backfilling at the head from the live wall's own tail. That half was right and is unchanged.
- **`uraStack` stays whole and parallel** to the indicators in flip order, so a reader still slices
  it by `doraIndicators.length`.

## Consequences

- The wall format's trailing 14 now means something different: a `?wall=` link's dora indicator is
  the 9th of those 14 rather than the 1st, and the tile after it is its ura. Pre-release, no shims
  (ADR-0020). `README.md` and the `Situation.wall` doc comment say so.
- The golden event-stream hashes (`round.golden.test.ts`) moved — different tiles are dora, so the
  seeded algorithms value hands differently and decide differently. Third time they have been
  regenerated; the comment there names all three.
- The wall reveal draws the dead wall as a flat row, so the reordering is invisible there beyond
  which tile is flipped. Greying the last `replacements` tiles stays correct.

## Rejected

**Modelling top and bottom explicitly** — a `{ top, bottom }[]` of stacks instead of a flat array.
It would make the pairing unmissable, but the wall is one flat `ParsedTile[]` everywhere else (the
URL codec, `wallWithHands`, `validateWall`'s index zones, the reveal), and the stack structure is
read in exactly one place. Adjacency in the flat array carries it.

**Drawing the dead wall as stacks in the reveal.** The information a reader wants there is which
tiles are gone, not how they were piled. Revisit if kan dora ever need showing in flip order.
