# The board and the page

Why the UI rules in `CLAUDE.md` are what they are. Each rule there is one line; the reason it
exists, and what broke before it did, is here. The headings follow that file's own.

## The board

**The caller owns the river's width.** A river that widened as it filled would push the hand drawn
under it a little further every discard.

**`showsHands` counts melds and nuki too.** Calls ride on the hand ring, so a board that shows no
hands but carries a single call still has to make room for the ring.

**Points are board truth, not `seatInfo`.** They sit with `riichi` and `melds` because what the felt
says must not depend on whether the seat panel happens to be enabled.

**The tedashi gap.** A face-down row cannot hold the thrown tile's own slot open: its tiles are
`BACK_TILE` filler with no readable sort, so the throw's sorted position always lands past the last
tile. It takes the hole in its middle instead (`gapIndex` with its `concealed` flag).

**The call banner is a value.** Which call a meld represents is game logic, and a pure view that
derived it would be the first piece of game logic in `Table`.

**Mount-once motion.** River tiles and melds are keyed by position, so a tile that lands is a new
DOM node and an unconditional CSS `animation` on it runs exactly once. Nothing has to remember what
was there before: no refs, no comparing lengths between renders. Discard origins are written in the
river's own frame, before its seat rotates it, so one keyframe pair serves all four seats.

**The score overlay carries the seat's rotation.** A CSS transform moves what is drawn, not the box
it was laid out in, so a score positioned against the unrotated box lands on the wrong side.

**`||`, not `??`, for the wind.** A caller writing `seatsEnabled && <SeatStrip/>` hands back
`false` when the panel is off, and a nullish check reads `false` as a node to render.

**Transient controls live in the `controls` overlay.** The hand strip is `shrink-0` and its height
feeds the board area's `100cqh`: a claim prompt in flow there resizes the felt the moment it
appears and walks the hand out from under the reader's finger. An empty overlay card is still
`pointer-events-auto`, a dead zone on the felt, which is why an absent control is `undefined` and
never a node that happens to render nothing.

## Sizing

**`--tile-w` goes on the outer div.** Set on the square itself, a `w-full` child collapses whenever
the board is a flex item.

**Tracks stay `minmax(0,…)`.** A seat block is measured before it is rotated, so its unrotated
width would otherwise force the track open.

**The felt is `aspect-square w-full`.** A percentage height against a box sized only by
`aspect-ratio` is indefinite in WebKit, so `h-full` leaves a board that is not square on an iPhone
and perfectly square under Chrome or Firefox device emulation. That bug class is why the UI suite
runs a real WebKit, and `e2e/board.spec.ts` asserts the square.

**The cap uses `100cqh`.** Against a declared size container it is the height genuinely left over,
not an estimate of the chrome above and below.

**Touch targets come from a pseudo-element.** A fixed `h-11` on a plate ran a phone-sized board's
plate off the felt; `after:size-11` grows the hit area without growing the box.

**The ultrawide cap has one owner.** Everything docked to the stage's right edge is a child of the
capped box: the settings sheet portals into the stage element, `absolute inset-0`, and `HomePage`
wraps its menu in the same capped box off the same variable (`h-svh overflow-hidden`, the menu
scrolling inside). Nothing re-derives the number, so the app box keeps its width between home and a
trainer.

**`flow` uses `inline-size` containment.** `size` containment collapses a box that sizes itself to
its own content, so whatever rides up in that layout has to be a fixed size on its own.

## The session panel

**The log overrides `--tile-w-base`.** Overriding `--tile-w` alone would ignore a nested component's
own scale (`0.6`) instead of composing with it.

**The clock pauses on the drawer, not the panel.** A docked panel hides nothing, so reading it is
not a reason to stop the clock. The pause is reported from an effect on that one derived flag, so a
resize, Escape and the scrim each resume exactly once, and none of them lifts a pause the reader
pressed themselves.

## The log

**No severity is not `'ok'`.** A rewind, a replayed discard, the tenpai note and every `/match` row
are not graded decisions, and a green spine beside one claims a verdict nobody gave. The spine's
width carries the signal as well as its colour, for a colour-blind reader.

**Gated at render.** `folding.equallySafe` is logged on every row and hidden or shown when drawn, so
flipping the toggle reaches rows already on the record.

**`seam`.** A line's tiles are split into the subject and the evidence after it. A tier whose
evidence is the subject (genbutsu) drops the evidence, or the same tile is drawn twice.

**Ordinals before filtering.** Numbering the visible rows only would make `log.rewound` point at
the wrong decision once a filter hides some.

**Seat-less rows always show.** The deal and the result belong to every seat, so the seat filter
never hides them. `/match`'s rows are built in `matchRows.ts`, never inline in a hook, so a replay
writes byte-identical rows.

**The deal rows carry no tiles.** A hand is drawn on exactly one row: the one that grades it.

**A bare code in a locale string becomes a tile.** `splitTileCodes` tokenizes the already
translated sentence and draws every tenhou code where it stood, so `0p` in a translation would
silently turn into a red five.

## Feedback, chrome and settings

**`status` is a strip, never panel content.** A clock behind a drawer tap goes unread. It is not
`pointer-events-none` as a whole because efficiency's ukeire line carries a live glossary trigger.

**No `wall` until dealt.** The button is absent rather than empty. A name beside an icon is the
string the `aria-label` already used, so the accessible name never depends on the viewport.

**Misc holds only the Advanced switch**, since flipping it changes what every other section shows.
The docs are not a route: a `<Link>` to them renders the router's crash page.

**Dialogs and the keyboard.** Neither `InfoPopover` nor the settings sheet moves focus into itself,
so while one is open a key press still lands on the trigger or the body. A `document` listener
therefore asks whether a modal is open rather than where the event came from.

## Fullscreen and assets

**Fullscreen on the first `pointerdown`.** `requestFullscreen` is rejected outside a real user
gesture. iOS Safari has no element fullscreen at all, so the install hint points at the PWA instead.

**`/docs/` is off the navigation fallback.** Without the denylist an installed service worker
answers a docs URL with the app shell, which the router crashes on. A first visit works, so it ships
unnoticed.

**The icons are `purpose: 'any'`.** A maskable crop would clip a tile that runs the square's full
height.

## The glossary

**Wiki URLs are hand-checked.** A slug guessed from the term id drifts the moment the wiki's naming
does not match.

**`<term>` in the locale string.** `Trans` with a `term` component keeps word order right in each
language and the term appearing exactly once; a string split into prefix and suffix keys gets
neither.

**The furiten mark uses `InfoPopover` directly.** The plate rotates with its seat, so an inline
hover card would hang sideways and draw at the page's 16px instead of the board's `cqw` scale.
