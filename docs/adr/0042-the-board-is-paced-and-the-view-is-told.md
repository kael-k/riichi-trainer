# ADR-0042 — The board is paced by its driver, and the view is told what to draw

**Status:** Accepted · **Date:** 2026-08-28
**Source:** `features/table/useRound.ts` (`pace`, `show`, `callBanner`),
`components/tiles/Table.tsx` (`call`), `components/tiles/Tile.tsx`, `src/index.css`,
`core/round.ts#stepRound`

## Context

Every AI seat's whole turn — draw, discard, reactions — was played in one synchronous burst inside
`useRound#drive`, and React saw exactly one `setSnapshot` at the end of it. The board therefore
teleported: on the reader's own discard, three opponents' turns appeared at once, with no way to
tell which tile any of them threw, whether it was tedashi or tsumogiri, or that somebody had
called. `/match` (ADR-0040) is where that stopped being tolerable — a whole game against the bots
is watched, not just graded.

There was no animation vocabulary in the repo either: no `@keyframes`, no animation dependency, one
`animate-*` utility in the whole codebase.

Two questions, and they are separate. _Who_ holds the board still, and _who_ decides what a call
looks like.

## Decision

**Pacing belongs to `useRound` — timing over an event stream. Animation is CSS in the view.
`Table` is told which banner to draw and never derives it.**

- **`UseRoundInput.pace`** is milliseconds to hold before a seat nobody plays commits its action.
  **0 is not "fast", it is the old code path**: the `await` lives inside `show`, behind a
  `pace.current > 0 &&` short-circuit, so an unpaced board evaluates no `await` at all and the
  whole AI burst still lands in the single terminal `setSnapshot` it always did. That is what keeps
  every existing caller that settles a round inside a synchronous `act()` working — an `await` on a
  plain value still defers to a microtask, which is enough to break them.
- For the same reason **`discard` and `answer` return `void`, never the promise** their bodies
  produce. An `async` function hands back a promise even when it never awaits, and a thenable
  returned from an `act(() => …)` callback switches React's `act` to its asynchronous path.
- Pacing reads `pace` through a **ref refreshed every render**, so the slider takes effect on the
  next turn without redealing (ADR-0008), and re-checks the drive `generation` across every pause,
  the same guard the synchronous path already applies after every command.
- **The pre-reaction frame is a real engine seam, not a delay.** `finishTurn` already owned
  `beforeReactions` (the folding drill's blanket-fold hook); `stepRound` simply forwards it now —
  **the only engine edit this change made**. `finishTurn` resolves a whole turn before it yields
  anything, so without that frame a ponned tile is only ever on screen inside the meld it ends up
  in. A paced board commits it, so the tile is seen where it landed.
- **`Table.call` is one prop beside `activeSeat`: board truth in, no logic.** Deriving "chi" from a
  meld-count diff plus `meld.kind` would be game logic in a pure view, which ADR-0014 forbids. Its
  lifetime belongs to whoever raised it — `useRound` clears it on a timer.
- **Everything else is free, because a CSS animation on a newly mounted element runs once by
  itself.** River tiles and melds are keyed positionally, so the tile that just landed is a
  genuinely new DOM node on the render it appears: an unconditional `animation` on every discard
  animates each tile exactly once, at its own mount. No refs, no length diffing, no
  "which one is new" state. Only the banner needs a lifetime, because it has to disappear.
- Discard origins are written in the river's **own unrotated frame** — the river box carries its
  seat's spin and row 0 sits nearest the felt centre — so one keyframe pair covers all four seats.
- **Tedashi and tsumogiri are read from two ends of the same throw**, because the tile in flight
  looks identical either way: a tsumogiri comes in from the drawn tile's own slot and pulses the
  grey the advanced mark uses, and a tedashi holds its slot open in the hand it left (one tile of
  space at the position it sorted into) for exactly the flight time — on the felt
  (`SeatView.tedashi`) **and** in the hand below the board (`HandDisplay.tedashi`), which is the
  one the reader is looking straight at. The hole is the half that says _which hand it came out of_, and it is the driver's to time
  for the same reason the banner is — only it knows when the tile lands.
- Both are settings, top-level rather than sectioned (`botDelay: number | null` on `tileScale`'s
  "never chosen" idiom, `boardAnimation: boolean`), so the persist version stays at 3 and the
  custom section-wise `merge` needs no edit (ADR-0033, ADR-0015). Every use site is `motion-safe:`,
  so an OS-level reduce-motion removes the motion and leaves the pacing alone.
- They live in **UI**, not Table: how fast the opponents play and whether the board moves is how
  the board _reads_, not a property of any one trainer's felt — so they are reachable from the home
  screen like theme and tile size. The delay itself sits **behind Advanced** (ADR-0018): the
  shipped default already reads as an opponent thinking, and a beginner should never have to find
  a slider before the board makes sense. Hidden is not off — `useBotDelay` resolves the same stored
  value either way, exactly as red fives stay on with their Ruleset row hidden.

## Consequences

- **Delay 0 with animation off is bit-for-bit the old board**, which is what let this ship without
  touching a single graded drill's golden hash.
- A tsumogiri now reads without the advanced `showTsumogiri` mark: the same grey overlay, animated
  out to nothing, drawn only when the standing mark is off. It is a transient echo of an existing
  convention, not a second one.
- One accepted cost: a full board mount — a fresh deal, a replayed link — mounts every river tile
  at once, so they animate together as a single ~260ms shimmer. Cheaper than tracking which tile is
  new, and it reads as the board dealing itself in.
- Folding's board search is unaffected: it is a plain async loop that deliberately does not route
  through `{ restart }`, so `useRound` only ever plays the already-handed-over board and generation
  stays instant.
- A kita raises no banner (bookkeeping nobody calls out at a real table, and near-constant in
  sanma), and a riichi's banner rides the discard it was declared with rather than going up a beat
  early.

## Rejected

- **A meld-count diff inside `Table`.** The view would have to know that a new `'chi'` meld means
  somebody called chi — game logic in the one component that is required not to have any
  (ADR-0014). One prop says it without inference.
- **Per-event snapshots with no pre-reaction frame.** Simpler, and it never shows the ponned tile:
  by the time the `discard` event is yielded, the pon has already popped that tile off the river.
  The whole point of pacing is to make a call legible.
- **A `setTimeout` inside `core/round.ts`.** The engine is pure and synchronous, and every drill
  that plays a hundred boards in a search would then wait through them.
- **An animation dependency.** Mount-once CSS keyframes cover every case here, and positional keys
  already give each new tile its own mount.
- **A `pace` that stayed async at 0** (one `await` per event, unconditionally). One line shorter,
  and it moves every commit out of its caller's synchronous `act()` — the whole existing test suite
  and the guarantee that this change costs an unpaced board nothing.
