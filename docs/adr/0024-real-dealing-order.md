# ADR-0024 — The wall's leading block is a real deal: 4/4/4+1, not four slabs of thirteen

**Status:** Accepted · **Date:** 2026-08-17
**Source:** `core/wall.ts#DEAL_CHUNKS`/`dealtSeat`/`dealtIndices`/`wallWithHands`,
`core/round.ts#createRound`
**Amends:** ADR-0005 (the wall format's leading block only; everything else there stands)

## Context

`createRound` dealt `wall[0..12]` to seat 0, `wall[13..25]` to seat 1, and so on. That is not how
a deal comes off a wall. A live table takes four tiles at a time, going round the seats three
times, then one apiece — and the wall reveal (`WallDetails`) is about to draw that leading block
back to the reader with their own tiles marked, so what it shows has to be what a deal looks like.

## Decision

The leading `players * 13` tiles of a wall are dealt in `DEAL_CHUNKS = [4, 4, 4, 1]`: three rounds
of four per seat, then one each.

- **Seats are served in index order**, not from the dealer. With the dealer at seat 0 — every board
  this app builds — that is wind order, and keeping `MatchState` out of it is what lets
  `dealtSeat(index, players)` map a wall index back to a seat with no round in hand. A board with
  the dealer elsewhere deals in seat order regardless; nothing in the app produces one today.
- **`dealtSeat` / `dealtIndices` are the one walk**, read forward and backward. `zoneAt`
  (validation error zones), `wallWithHand`/`wallWithHands` (walls built around known hands) and the
  wall reveal all go through them rather than re-deriving an offset.
- **A short wall stays a prefix**, and it is still consumed in order — but a 13-tile prefix is now
  the start of a _deal_ rather than one seat's hand. Pinning a hand means `wallWithHand`, which
  places it in the slots that seat is actually dealt.
- **A solo round (`players: 1`) is unaffected**: the walk collapses to `wall[0..12]`. So is the
  shanten trainer, which deals through `wall.ts#deal` and has one hand to fill.

## Consequences

- Every `?wall=` link deals different hands than it did before this change. Pre-release, no shims
  (ADR-0020).
- The golden event-stream hashes (`round.golden.test.ts`) moved — every seat is dealt different
  tiles off the same wall. Second time they have been regenerated; the comment there names both.
- A hand-written short prefix no longer pins seat 0: `wall=123456789m1122z` spreads those thirteen
  tiles over four seats. The lab's authoring surface is unaffected (it builds through
  `wallWithHand`), and a test that needs an exact shape on both sides of a discard builds its wall
  through `wallWithHands` instead of concatenating hands.

## Rejected

**Dealing from the dealer's seat.** Faithful, but it makes every wall-index-to-seat mapping depend
on `MatchState.dealer` — `wallWithHand`, `validateWall`'s error zones and the wall reveal would all
have to be handed a dealer they otherwise have no reason to know. Revisit if a dealer other than
seat 0 ever becomes reachable.

**Modelling the real cut** (the dice roll, the wall break point, the dealer's chonchon jump on the
last tile). It changes which tiles land where by an amount no reader can verify, and the app has no
physical wall to break — the deal order is the only part of the ritual that shows.
