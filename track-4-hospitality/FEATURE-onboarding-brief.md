# FEATURE: onboarding brief (`docs/onboarding-brief.md`)

Owner: alok

## Why
A new team member should be productive on day one: know what the project is, how our Claude Code setup works, and how to go from a feature idea to reviewed code with `/plan` then `/implement`.

## Audience
New team members on the Larchmont capstone track (developers who know C# or React but not this repo or our `.claude/` setup).

## Contents
1. What the project is: Larchmont Hotels, six hotels, the inherited system, the stakeholder (Sofia Lindqvist), the housekeeping and room-status board, and the stack.
2. Get running: prerequisites and commands (from `CLAUDE.md` and the README).
3. How the `.claude/` setup works: memory files, rules, agents, skills, commands, hooks, plugin. One short table, linking `docs/agent-map.md`.
4. First feature walkthrough: `/plan <feature>` -> review the FEATURE file -> `/implement FEATURE-<name>.md` -> read `docs/review-report.md` -> `/handoff`.
5. Guardrails and limits, stated honestly (hook patterns are not a sandbox, subagents cannot nest, in-memory tests cannot prove performance, `/plan` may collide with the built-in, staff location tracking is out of scope).
6. Where to look when something is wrong.

## Rules for writing it
- Only describe things that exist in the repo; check paths and commands against the files.
- Short sentences, no jargon without a gloss.
- Say what is unverified (for example, the hooks have only been tested with piped input).

## Verify
- Every path, command and name in it exists (checked with a script).
