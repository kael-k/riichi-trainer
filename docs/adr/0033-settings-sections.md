# ADR-0033 — Settings sections are named for what a setting is about

**Status:** Accepted · **Date:** 2026-08-24
**Source:** `features/settings/SettingsDialog.tsx`, `components/tiles/BoardStage.tsx`,
`core/round.ts` (`RoundOptions.kiriageMangan`)

## Context

The settings dialog grew by accretion. Its title changed per screen
(`t('settings.title', { title })` → "Efficiency trainer - with opponents settings") though the
dialog is the same surface everywhere. App-specific rows (scoring's eleven, folding's four, the
lab's one) were passed in as bare `children` with no heading of their own — the changing title was
what named them, informally. The one section that did have a name, "Global", mixed theme/tile
size/language with rules of the game (number of players, red fives) with the Advanced switch
itself; Kiriage mangan sat inside the scoring trainer's own rows despite being a rule, not a
scoring-trainer display option, and had no effect anywhere else a hand could be won. The Table
section rendered on every screen, including ones with no `<Table>` (home, `/shanten`), and always
resolved against a hardcoded `'efficiency'` regardless of which trainer opened it — a premise
("no field has a per-app override") that had already gone false by the time folding and the lab
started writing per-app overrides.

## Decision

The dialog's own title is constant: `t('settings.button')` ("Settings"), never templated with a
trainer name. Sections are named for what a setting is _about_, not for the screen it was opened
from:

- **{trainer title}** — the app's own rows, headed with the same translated string
  `BoardStage`/`SettingsButton` already carry as `title`. Rendered only when the caller passes
  `children`.
- **Table** — what the board shows: opponent hands, seat waits, tsumogiri/tedashi marks. Rendered
  only when the caller passes `app: TableApp` (`BoardStage`'s new prop, threaded to
  `SettingsButton`), and resolved against that app's own override layer
  (`resolveTableSettings(app, table)`) rather than a hardcoded stand-in.
- **Ruleset** — how the game itself is played: number of players (was labelled "Ruleset" on its
  own; the section now carries that name and the row is relabelled), Kiriage mangan, red fives.
- **UI** — how the interface looks: theme, tile size, language, translated terms, tile-number
  overlay, glossary-on-click. (`GlobalSettings` renamed `UiSettings`.)
- **Misc** — the Advanced-features switch, alone. Its own section rather than folded into UI:
  flipping it changes what other sections show, so nesting it inside one of them reads oddly.

Kiriage mangan becomes a real, match-wide rule: `RoundOptions.kiriageMangan?: boolean`
(`core/round.ts`), read by `tryWin`'s scoring call wherever a round can end in a priced win — not
only the scoring trainer. It stores as a **top-level** field in `settingsStore.ts`
(`kiriageMangan`/`setKiriageMangan`), not inside the `scoring` section, matching `sanma`/`aka` —
the other two fields it now sits beside in the dialog. Not threaded into the efficiency trainers:
both run `wins: false` unconditionally (ADR-0013's per-turn drill would be cut short by an
opponent's win it never causes), so `tryWin` never reaches the scoring call there and the option
would be dead weight. Not threaded into folding either: its `RULES` already pins its own `aka: true`
regardless of the setting, and the drill never surfaces a win's point value at all. Lab and scoring
are the two apps that actually price a win, so they are the two that read it.

Red fives and the tsumogiri/tedashi marks keep their existing Advanced gate
(`useAdvancedSettings.ts`, unchanged) in their new homes — a hidden row must never mean a live
value, which is exactly what that hook guarantees regardless of which section the row lives in.

## Consequences

- `BoardStageProps`/`SettingsButtonProps` gain `app?: TableApp`. A trainer with no board
  (`/shanten`) or no settings surface for one yet (`/efficiency-solo`, which gets the Table
  section but no app-specific rows) simply omits or partially uses it — there is no longer a
  hardcoded app id anywhere in the dialog.
- `ScoringOptions` (`useScoringRound.ts`) gains `kiriageMangan: boolean` as its own field rather
  than inheriting it from `Settings['scoring']`; `LabOptions` (`useLabRound.ts`) gains the same.
  Both hooks already threaded `sanma`/`aka` the identical way, so this is not a new shape, just one
  more field riding along it.
- `settings.title`/`settings.titleFallback` are deleted from every locale; `settings.global`
  becomes `settings.ui`; `settings.misc` and `settings.numberOfPlayers` are new keys;
  `scoring.settings.kiriageMangan` moves to `settings.kiriageMangan`. No other locale keys move.
- No `settingsStore` version bump ([ADR-0015](0015-what-persists.md), [ADR-0020](0020-no-back-compat-pre-release.md)):
  `kiriageMangan` is a new top-level field, so it rides the persist `merge`'s existing `...p`
  spread; the stale `scoring.kiriageMangan` key some readers already have persisted is harmless
  dead weight, same as the stale `efficiency`/`shanten` keys ADR-0015 already accepted.

## Rejected

- **Kiriage mangan travels in a share link.** `urlCodec.ts`'s `FLAGS = ['aka', 'sanma']` is
  untouched — kiriage only moves a win's point total, and no trainer today grades a payout amount
  from a link. Add it the day one does.
- **A new `ruleset`/`ui`/`misc` section in the persisted `Settings` type.** Every field these
  sections show already existed as a top-level store field (`sanma`, `aka`, `theme`, …) or moves to
  one (`kiriageMangan`); grouping them into a store section would mean extending the hand-written
  `merge` function for no reader-visible reason (ADR-0015's stated trap) to match a UI grouping
  that owes nothing to how the data persists.
