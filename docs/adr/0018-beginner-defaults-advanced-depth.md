# ADR-0018 — Beginner-safe defaults, advanced depth behind settings

**Status:** Accepted · **Date:** 2026-08-11
**Source:** CLAUDE.md audience note; `features/i18n/glossary.ts`, `TrainerLayout.tsx` (today
`BoardStage.tsx`, [ADR-0025](0025-one-interface.md))

## Context

The audience is both: advanced players who want fu itemisation and per-threat tier reasons, and
beginners who have never scored a hand. Building for one produces a tool the other cannot use, and
"add a setting" only helps if the _default_ is the beginner's.

## Decision

Keep adding the precise, advanced feature — and ship it behind a setting whose **default reads
plainly to someone who has never scored a hand**. A new option must never be something a beginner
has to find and change before the screen makes sense.

Concretely: fu and yaku breakdowns are opt-in; yaku are named "Pure straight" rather than "Ittsuu"
until the reader asks otherwise (and that row is hidden under ja/zh, where those _are_ the local
names); tile-number overlays default on except in ja/zh.

Two beginner-facing surfaces built on the same principle:

- **The trainer info button.** Each trainer page and each home-page card takes an
  `intro: TrainerIntro` — what the drill teaches, plus an optional riichi.wiki link — surfaced
  behind an `Info` icon rather than as permanent on-page text, so it costs nothing once the player
  knows the trainer.
- **The glossary.** Jargon the app uses without defining — `ukeire`, `tedashi`, `tsumogiri`,
  `shanten`, `genbutsu`, `suji`, `dora`, `ura dora` — is registered once in
  `features/i18n/glossary.ts` (label, description, **hand-checked** riichi.wiki URL) and marked
  inline with `<GlossaryTerm>`. Never derive the URL from the term id: a naming-convention guess
  drifts the moment the wiki's slugs do not match.

Terms mid-sentence inside a translated string are wrapped `<term>…</term>` in the locale JSON and
rendered via `Trans`, so word order stays correct per language and the term appears exactly once.
Do not hand-split a translation into prefix/suffix keys to fake it.

## Consequences

- Basic terms a player is assumed to know (riichi, ippatsu) are deliberately **not** in the
  glossary — a glossary that defines everything defines nothing.
- `iconOnly` exists for the case where the surrounding label already spells the term out;
  otherwise the trigger repeats the term's name and reads as a duplicate.

## Rejected

A single "beginner mode" toggle. It makes the split a mode the reader has to discover, instead of
a set of defaults that are simply already right.
