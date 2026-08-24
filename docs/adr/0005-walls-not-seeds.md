# ADR-0005 — Boards are shared as explicit validated walls, not seeds

**Status:** Accepted · **Date:** 2026-08-12
**Source:** `core/match.ts#createMatch`, `core/wall.ts#completeWall`,
`features/situation/urlCodec.ts`

## Context

A seed reproduces a board only as long as the generator never changes, and it cannot express a
board somebody _authored_. The statistical lab's whole premise is authoring or editing a wall and
opening it elsewhere, which a seed cannot carry.

## Decision

`createMatch(wall: ParsedTile[], players, options, fillSeed?)` takes the wall as data.

- **Format:** one flat `wall` param in draw order — the whole deal (`players * 13`), then the live
  draws, then the last 14 tiles as the dead wall (dora indicator first). How that leading block is
  handed out moved in [ADR-0024](0024-real-dealing-order.md): four tiles at a time round the seats,
  three times, then one each, rather than one contiguous thirteen per seat. How that trailing 14 is
  cut moved in [ADR-0028](0028-dead-wall-stacks.md): seven indicator-over-ura stacks with the
  rinshan tiles at the tail, so the flipped indicator is the 9th of the 14, not the 1st.
- **A short wall is a prefix:** given tiles are used in order and the remainder is completed at
  random from the copies they leave, which is what makes partial hand-authoring usable.
- **Length implies the ruleset** (108 = sanma), and a loaded wall's length wins over the global
  `sanma` setting for table apps.
- **Validate on load, reject by name.** Untrusted input: length bounds, no kind over four copies
  (exactly four when full), at most one red per suit, no 2m-8m under sanma. Errors name the
  offending zone and tile. This is the one codec in the repo that rejects rather than silently
  repairs — contrast `parseTenhou`, which drops a malformed digit — because a wall is
  positionally meaningful and repairing it hands back a different board than the link claimed.
- `buildWall(seed, sanma)` is **kept** for random generation and every seeded test.

## Consequences

- A wall built in the lab opens as the identical board in the table efficiency trainer.
- Links are longer. Accepted knowingly.
- Positional zone boundaries are confusing to hand-author. Also accepted knowingly — validation
  naming the zone is the mitigation.
- The shanten trainer stays on `seed` + `hand`: it deals no wall, so it has nothing to share.

## Rejected

A zone-named two-param format (`wall=` + `dead=`). The user picked the flat single param; the
boundary tradeoff was the price.
