# Riichi Trainer

Documentation for [riichi-trainer.kael-k.io](https://riichi-trainer.kael-k.io/).

These pages are a deep dive, not a manual. The app explains itself as you use it — every trainer
carries an intro behind its info button, and the terms it uses have their own glossary. What a
popover cannot carry is the layer underneath: where the numbers come from, which of them are
measured and which are derived, and where the models are known to be wrong.

Rules of the game itself are not here. For those, see [riichi.wiki](https://riichi.wiki), which is
where the app's own glossary links too.

## Where to start

- **[What a tile costs](./model/danger.md)** — the eight danger tiers, and the deal-in probability
  model that sits beside them.
- **[What a hand is worth](./model/win-probability.md)** — the one-player DP behind win probability
  and expected score.
- **[Push, fold, and everything in between](./model/push-fold.md)** — the identity both branches
  share, and every decision priced through it.
- **[Where the measured numbers come from](./model/houou.md)** — the houou logs, the sample, and what
  is missing from it.
- **[What the models get wrong](./model/limits.md)** — the stated boundaries of all of it.

## Every number is measured, derived, or stated

This is the vocabulary the rest of the documentation runs on, and the distinction is kept visible
wherever a number lives, because it is the difference between a figure you can check and a figure
somebody chose.

**Derived** means combinatorics over the tiles nobody has seen. It can be rebuilt from first
principles by a reader with a pencil, and it depends on nothing but the board.

**Measured** means extracted from real games — Tenhou houou logs, at a pinned commit, with the sample
size shipped alongside the number so a thin cell can be recognised as thin.
[How that extraction works](./model/houou.md).

**Stated** means somebody chose it. There are very few, each is labelled as chosen in the code that
holds it, and each says what argument it rests on. A stated constant is not a failure — some
quantities genuinely cannot be derived, and pretending otherwise produces a number that looks
objective and is not.

The clearest example: **which wait a hand ends on is a decision, not a sample.** A player breaks the
penchan and keeps the ryanmen. Combinatorics cannot see a choice that was already taken, so a model
that lets it decide produces a distribution nobody plays. That is why the derived prior's shape
weights are stated, and why the derived model needs a stated constant for what a typical closed hand
is worth.

## The models may not borrow from each other

There are two EV models. One derives every price from combinatorics; the other measures every price
over houou logs. Each supplies the complete set — a wait prior, a deal-in cost, a give-up cost, a
riichi uplift, a win value, and a declaration of which rulesets it may speak about.

**Neither may take a number from the other.** A measured fold price against a derived deal-in cost
would be a third model that nobody chose, whose terms no longer decompose and whose disagreements
with reality could not be attributed to anything. Where a model cannot answer — the measured one has
no three-player data — it says so, and says why, rather than silently substituting the other one's
number.

It is also why the derived model's numbers are checked against the measured ones for **ordering
only**, and never fitted to them.

## Two descriptions of danger, on purpose

Danger is described twice: an ordinal tier ladder that ranks tiles without pricing them, and a
probability model that prices them. Neither replaces the other. The tiers are the vocabulary a player
reasons in and the permanent default for grading; the probabilities answer the question the tiers
cannot, which is _by how much_.

Both read **public information only**, so a choice that was correct and unlucky still grades as
correct.

## About this site

The docs are **English only**, and they are never the source of any string in the app. The trainer
intros and the glossary ship in four languages and stay the app's own — nothing here is generated
from them, or generates them.

There are no per-trainer pages and no settings reference. The app carries that itself, and a second
copy would only be a second thing to go stale.
