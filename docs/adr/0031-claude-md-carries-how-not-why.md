# ADR-0031 — `CLAUDE.md` carries how, not why

**Status:** Accepted · **Date:** 2026-08-24
**Source:** the charter in `docs/README.md`, never enforced against the file it describes

## Context

`docs/README.md` sets four documents against four jobs: `CLAUDE.md` answers **how the code works
today**, `docs/adr/` answers **why**, `docs/STRUCTURE.md` answers **where**, `docs/STATUS.md`
answers **what state it is in**. "Nothing here duplicates another."

`CLAUDE.md` had drifted into carrying all four. At 87KB it held the rejected alternatives, the
things that were tried and failed, and the historical reason behind most current behaviour —
material that by the project's own rule belongs in an ADR, and in most cases was **already** in one.
The UI section alone was 29KB, restating ADRs 0019, 0025, 0026 and 0027.

That is not a tidiness problem. `CLAUDE.md` is the only document in the set that is loaded **in
full, at the start of every session, before a single file is read** — the ADRs and the source map
are read on demand, when the work touches them. 87KB is roughly 22,000 tokens paid per session for
context most sessions do not need, and it grew by default: every behaviour change appended its own
reasoning, and nothing ever removed any.

## Decision

`CLAUDE.md` holds the commands, the layer rules, the **invariants**, and pointers. Nothing else.

The test for a paragraph is one question: **would an agent get this wrong by guessing, and would the
breakage be silent?**

- **Yes ⇒ it stays**, as a rule, in one line, with no story attached. `forcedTsumogiri` is
  `finishTurn`'s first branch and not its fallback. `drawn === concealed.at(-1)`. Log rows are
  written imperatively, never from effects. Override `--tile-w-base`, not `--tile-w`. `||`, not
  `??`. These are cheap to state and expensive to rediscover.
- **No, and an ADR already says it ⇒ the prose goes**, replaced by the claim in one clause and a
  link. The ADR is not edited to receive it: accepted ADRs are frozen (`docs/adr/README.md`), and
  what is being removed is a restatement, not new content.
- **No, and nothing says it ⇒ write the ADR.** That is what [ADR-0029](0029-calls-on-the-hand-ring.md)
  and [ADR-0030](0030-the-felt-sizes-itself.md) are.

Every `###` section ends with a `**Why:**` line naming its ADRs, so the reasoning is one hop from
the rule rather than inlined ahead of it.

The existing working rule stands and gains a second half: **a behaviour change updates `CLAUDE.md`
in the same wave** — with the _rule_. Its _reason_ goes to an ADR in the same commit.

## Consequences

- A soft budget: a `###` section past ~10KB is carrying rationale, and that is the signal to check
  what belongs in an ADR. Applying the rule took the file from 87KB to 50KB — less than the 25KB
  first estimated, because the invariants alone have a floor: this codebase holds roughly 120 of
  them and each costs 150–200 bytes to state. The cut came almost entirely out of rationale and
  description; nothing that warns was dropped to hit a number.
- Sessions start ~9,000 tokens lighter, and the reasoning is still one link away for the sessions
  that need it — which is the same trade the ADR directory was created to make.
- The trail gets **better**, not worse: rationale that was buried mid-paragraph in a 29KB section
  now sits under a Rejected heading where the supersession rule can reach it.
- A cost: an agent that reads only `CLAUDE.md` and never opens an ADR knows the rules but not the
  forces behind them. Accepted deliberately — knowing the rule is what prevents the bug; knowing the
  force is what is needed to _change_ the rule, and that work should be reading the ADR anyway.

## Rejected

**Leaving it.** The file was accurate and hard-won. It is also a tax on every session, and it grew
monotonically because nothing in the process ever removed a paragraph.

**Cutting to a pure index (~10KB), with all detail in `docs/`.** Cheapest of all, and it moves the
invariants out of the one file guaranteed to be read. An invariant behind a link an agent may not
follow is an invariant that gets broken.

**Compressing the prose rather than relocating it** — the same content, tersely. It saves less,
reads worse, and leaves the charter violation in place, so the file re-inflates on the next wave.
