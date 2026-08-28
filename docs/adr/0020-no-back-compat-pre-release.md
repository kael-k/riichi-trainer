# ADR-0020 — No backward compatibility while pre-release

**Status:** Accepted · **Date:** 2026-08-12
**Source:** "it's a beta project" — the project owner's standing constraint, stated repeatedly

## Context

Several decisions in this repo break links and persisted state: seats replacing seeds as the
shared record ([ADR-0005](0005-walls-not-seeds.md)), `opponents` leaving the codec
([ADR-0013](0013-efficiency-split.md)), `modes` leaving the settings store
([ADR-0015](0015-what-persists.md)). Each one could be given a migration path.

## Decision

**Do not.** The project is pre-release with no external users to strand. Old `?opponents=` links,
old seed-based board links and stale persisted keys are not migrated, redirected or supported.

Two qualifications that are _not_ exceptions:

- **A stale persisted key is left in place, not purged.** The settings store `version` was
  deliberately not bumped to drop the dead `seats` key, because bumping it drops every setting for
  everyone — a worse outcome than a key nothing reads.
- **The settings store's section-wise `merge` still has to be maintained.** Adding a section
  without extending the merge silently wipes it on load for anyone with existing persisted state.
  That is not back-compat; that is a live bug for current users.

## Consequences

- Refactors move quickly and land clean.
- **This decision expires at release.** When the app has users who share links, revisit it — and
  write the ADR that supersedes this one rather than quietly starting to add shims.

## Rejected

Version-tagging the URL formats now. A version tag with one version is a field, not a migration
path; add it when there is a second format worth distinguishing.
