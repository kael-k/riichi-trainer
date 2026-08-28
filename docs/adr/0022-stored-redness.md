# ADR-0022 — Redness is stored, not inferred

**Status:** Accepted · **Date:** 2026-08-16
**Source:** `core/round.ts` (`PlayerState.concealed`), `core/hand.ts`; `PLAN-match-context.md` T1

Supersedes [ADR-0003](0003-hand-counts-only.md).

## Context

ADR-0003 kept `Hand` counts-only and let redness travel beside it: `PlayerState.reds: Set<TileId>`
recorded which _kinds_ a seat held a red copy of. Kinds, not copies — so every consumer that needed
to know _which physical tile_ was involved re-derived it, from `reds` plus `counts`, in six places
(the river's tedashi flag, pon/chi meld tiles, ankan, kita, the win's concealed hand, the display
split). An audit found no live bug; all six happened to be right. They were right independently,
which is the part that does not survive a seventh consumer.

The same gap forced ADR-0003's one documented exception, `Hand.drawn?: ParsedTile` — the redness of
_the draw specifically_ is not reconstructable from a set of kinds, so the drawn tile had to be
carried whole, on `Hand`, in a field the shanten hot path never reads.

## Decision

**Store the concealed hand as held.** `PlayerState.concealed: ParsedTile[]` is the real thing:
ordered, redness included, kept sorted except for its last element while a 14th tile is held —
that one is appended rather than sorted in, which is what makes tedashi/tsumogiri a field read.
`PlayerState.drawn?: ParsedTile` names it and is always `concealed.at(-1)` while set, cleared the
moment the tile leaves (discard, kita, ankan) so no decision ever sees a `drawn` naming a tile no
longer held.

`Hand` goes back to being counts and a meld count and nothing else — `Hand.drawn` is deleted, and
with it ADR-0003's exception. Also deleted: `PlayerState.reds` and every read/write site it had,
`SeatView.reds` (zero readers — deleted rather than migrated), and `handToTiles`'s `reds?`
parameter, whose one caller passed nothing.

`concealedTiles(player)` was planned for deletion and **kept**: its five display/scoring callers
want the hand _sorted_, drawn tile in its natural position, and split back out by identity
(`splitDrawn`) rather than by array position. It is now a sort over `concealed` instead of a
reconstruction from `counts` + `reds`, which is the whole of what changed for them.

Two things this deliberately does **not** simplify away:

- **`pickTile` stays.** It looked like an inference (`counts[id] === 1` ⇒ that copy) but it encodes
  a _policy_: given a plain and a red copy of one kind, throw the plain one. It is now an explicit
  prefer-`!red` find over `concealed` — same behaviour, stated instead of derived.
- **The duplication is guarded.** `concealed` and `counts` are two records of one fact and can
  drift, so `round.test.ts`'s census asserts, per player, that `concealed` tallies to `counts` per
  kind and that `drawn === concealed.at(-1)` whenever set. It runs across every censused round and
  once mid-turn, where a hand sits at 14 with `drawn` set — the state the end-of-round censuses
  never see.

## Consequences

- Redness is read where it is needed instead of reconstructed, and a new consumer inherits
  correctness rather than re-deriving it.
- `shanten()` is untouched: `Hand` is still a flat `Uint8Array(34)` on the hot path, and nothing in
  the per-suit decomposition learned about `ParsedTile`.
- One deliberate duplication now exists (`concealed` vs `counts`) where none did, paid for by an
  invariant in the census rather than by trust. Mutation-checked: breaking the removal path fails
  4 of `round.test.ts`'s 48 tests.
- Golden hashes did not move ([ADR-0016](0016-testing-strategy.md)) — the change is representation
  only.

## Rejected

**The 136-tile-id format** (every physical copy its own id, tenhou-log style). It would make
redness intrinsic rather than stored beside — but the only thing it actually buys this codebase is
tenhou-log interop, which is not a near-term goal, and it would touch every id-indexed array in the
engine. The per-suit shanten speedup is an algorithm property, not a storage one, so no performance
argument turns on the choice either. If log interop ever becomes a goal, this is the ADR to
supersede.

**Dora-in-hand as a field**, again — it is a function of `concealed` + `doraIndicators`, so it
belongs in a helper. ADR-0003's reasoning survives its own supersession here.
