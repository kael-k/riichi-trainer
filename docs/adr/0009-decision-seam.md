# ADR-0009 — The decision seam: an `ALGORITHMS` dispatch over a curated `SeatView`

**Status:** Accepted · **Date:** 2026-08-15
**Source:** `core/algorithm.ts`; commits `afff775`, `9196285`, `e8774eb`
**Amended by** [ADR-0023](0023-round-inside-match.md): the last rejected row below (points, honba
and riichi sticks off the view) no longer holds — `SeatView.match` carries them, now that
`core/match.ts` models them and no field is left permanently `undefined`.

## Context

Five decision points — discard, pon/chi, riichi declaration, take-a-win, kita — were five
scattered conditionals inside `match.ts`, each hand-rolling its own `policy === 'defense'` check.
Kita had no branch at all: every non-manual seat pulled by the efficiency rule. A third algorithm
meant five engine edits.

## Decision

**One dispatch table of plain objects.** `ALGORITHMS: Record<AIAlgorithm, Algorithm>` in
`core/algorithm.ts`, where `AIAlgorithm` is `SeatAlgorithm` minus `'manual'` — deliberately never
a key, since `match.ts` short-circuits on `isManual` before reaching the table. `Algorithm` is
five methods; `match.ts`'s five call sites collapse to
`ALGORITHMS[player.algorithm].<method>(view, …)`.

- **All five decisions belong to the algorithm**, `kita` and `win` included — you skip kita
  holding daisuushii tenpai, and you decline a ron waiting to tsumo sanankou.
- **`win(view, candidate)`** is the one method with a second argument: `WinCandidate { tile, from?,
  score }`, already priced by `tryWin` before it asks. An algorithm that cannot see what it
  declines cannot price it — which is what makes `defense.win` an honest `() => false` rather
  than a carve-out inside `tryWin`.
- **`discard` returns `{ tile, fromDrawn }`**, `fromDrawn` being the algorithm's advisory read of
  tedashi vs tsumogiri. It decides at kind level and never sees redness, so `finishTurn` still
  re-derives the river's actual flag from the tile `pickTile` resolves.
- **What an algorithm may know is a curated `SeatView`, never raw `MatchState`** — raw state means
  an algorithm can read concealed hands. Public information only (every seat's river, melds,
  riichi, nuki) plus its own hand and the board. `seen` and `threats` are **lazy getters**: the
  call gate builds a view for every seat on every discard, and both cost real work an algorithm
  that never reads them should not pay for.
- **Purity is a hard rule**: same view ⇒ same choice; every ranking a total order with explicit
  tie-breaks, never sort stability. That is what lets a whole match reproduce from its seed.

## Consequences

- Adding an algorithm is one ~10-line object literal plus its `AIAlgorithm` member, and **zero**
  engine edits. `tsumogiri` shipped exactly that way and is the proof.
- Two behaviour changes rode in with the seam, not before: `defense.kita` is now `false` (a
  folding player is leaving the hand, not chasing dora), and declining a win became expressible
  per algorithm.
- Golden hashes ([ADR-0016](0016-testing-strategy.md)) move when the seam changes behaviour, which
  is the test doing its job.

## Rejected

- A base class or `Partial` merge over a default algorithm. `efficiency`, `defense` and
  `tsumogiri` are independent object literals; inheritance would make "what does defense do about
  kita" a question you answer by reading two files.
- Points, honba and riichi sticks on the view. Not modelled anywhere in the engine, and a
  permanently-`undefined` field is one every algorithm must defend against. Additive later.
