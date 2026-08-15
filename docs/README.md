# Documentation map

Four kinds of document, one job each. Nothing here duplicates another — if two disagree, the
order below is the precedence.

| Document                    | Answers                                        | Churn                       |
| --------------------------- | ---------------------------------------------- | --------------------------- |
| `CLAUDE.md` (repo root)     | **How the code works today**, in prose          | Every behaviour change      |
| `docs/adr/`                 | **Why it works that way**, one decision per file | Only when a decision moves  |
| `docs/STRUCTURE.md`         | **Where things live** — annotated source map     | When a directory is added   |
| `docs/STATUS.md`            | **What is shipped, in flight, or broken**        | Every session               |
| `PLAN-*.md` (repo root, uncommitted) | **What this session is doing right now** | Per work item, then deleted |

`README.md` at the root is for humans arriving from GitHub: what the app is, its modes, and the
situation-URL format. It is user-facing, not architecture.

## Precedence

Code > `CLAUDE.md` > ADR > `STATUS.md`. An ADR that the code contradicts is either superseded
(write the superseding ADR) or a bug (fix the code). Never leave the disagreement standing.

## Working rules

These are what actually happens in this repo, not an aspiration:

1. **One work item = one root-level `PLAN-<slug>.md`.** Self-contained: why, settled decisions,
   numbered tasks (T0, T1, …), out-of-scope list, per-task verification. Uncommitted — it is
   scaffolding, not a record. Delete it when the last task lands.
2. **One task = one commit**, on `main`, conventional prefix (`feat`/`fix`/`refactor`/`test`/`docs`/
   `UX`), with the task id in the subject: `refactor(algorithm): the decision seam … (T3)`.
3. **Verify per task before committing:** `npm test` · `npm run lint` · `npm run build`. A UX task
   also gets a real browser check at 390x844.
4. **A behaviour change updates `CLAUDE.md` in the same wave** — usually its own final docs commit.
5. **A decision that closes a question gets an ADR**, in the same commit as the code that
   implements it. If a plan's decision table settles something, that row becomes an ADR; the plan
   file then dies without taking the reasoning with it.
6. **Reversing a decision writes a new ADR** that supersedes the old one. Old ADRs are never
   edited except to add the `Superseded by` line — the trail is the point.

## Why this and not a phase framework

This repo previously ran GSD. One phase produced ~440KB of artefacts: a RESEARCH doc (87KB), seven
PLAN files, seven SUMMARY files, plus UI-SPEC, PATTERNS, VERIFICATION, VALIDATION, UAT and REVIEW.

The durable value in all of it was roughly: sixteen decisions, four review findings, and one
acceptance list. Those are now `docs/adr/` and `docs/STATUS.md` — a few dozen KB. Everything else
was process exhaust, and the state file went stale mid-phase and stayed stale while two further
waves of work shipped straight past it.

The lesson is not "planning is waste" — the phase itself was well-planned and shipped. It is that
the **artefact count has to match the project's size**. A solo, pre-release codebase of ~18k lines
does not generate enough coordination cost to repay a per-phase document set, and a framework that
writes state files nobody updates produces documents that actively lie.

So: plan in one file, record decisions where they will be re-read, keep one status page honest,
and let git history be the log.

## Adding a new trainer

Four places, every time, or the route is half-wired:

- `src/routes/index.tsx` — the route table
- `src/routes/HomePage.tsx` — the `MODES` array
- `src/features/i18n/trainerLinks.ts` — `TRAINER_WIKI`
- `src/features/i18n/locales/{en,ja,zh,it}.json` — `trainer.<name>.*`

Then follow the trainer pattern in `CLAUDE.md`: a page component plus a `use*Round` hook.
