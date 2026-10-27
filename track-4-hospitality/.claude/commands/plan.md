---
description: Plan a feature and write FEATURE-<name>.md (no code is written)
argument-hint: <feature name or short description>
allowed-tools: Read, Grep, Glob, Write, Agent, Bash(git config user.name), Bash(git branch --show-current), Bash(git status --short)
---

Plan this feature: **$ARGUMENTS**

If no feature was given, ask for one and stop. Do **not** write any code or edit any file other than the FEATURE file below.

This follows the steps of the `planner` agent (`.claude/agents/planner.md`). It runs here in the main conversation because subagents cannot spawn other subagents.

## Steps
1. **Understand.** Read `CLAUDE.md`, `.claude/rules/*`, `docs/stakeholder-brief.md`, and `docs/specs/<feature>.md` if it exists (if it does not and the feature comes from the brief, suggest the `spec-writer` skill first). List the acceptance criteria as `AC_01`, `AC_02`, and so on.
2. **Explore the code.** Search `backend/Larchmont.Api` and `frontend/src` for what already exists and can be reused. For a wide search, spawn up to two `Explore` subagents in one message.
3. **Schema check.** If the feature needs a schema change, a heavy query, or has a performance or concurrency requirement, spawn the `db-analyst` agent and read `docs/db-analysis.md`.
4. **Write `FEATURE-<kebab-name>.md`** at the repo root (the same folder as `CLAUDE.md`). If it already exists, ask before overwriting. Use these sections:
   - `# FEATURE: <name>` and a line `Owner: <output of git config user.name, or "unassigned">`
   - **Why** - the problem and who it is for, with the stakeholder-brief paragraph it comes from
   - **Scope / out of scope**
   - **Acceptance criteria** - `AC_01 ...` as Given / When / Then
   - **API contract** - routes, request and response shapes, status codes and error messages
   - **Plan by area**, each with the paths it owns so the agents never edit the same file:
     - backend -> `backend/Larchmont.Api/**` and any new `backend/db/migrations/V00N__*.sql`
     - frontend -> `frontend/src/**` (loading, empty and error states via `StateView`)
     - tests -> `backend/Larchmont.Tests/**` (xUnit, `AC_NN_Description`; a real-MySQL test for any performance or concurrency claim)
   - **Risks and open questions** - including anything the brief leaves unclear; do not guess
   - **Verify** - the commands that prove it: `dotnet build backend/Larchmont.sln`, `dotnet test backend/Larchmont.sln`, `cd frontend && npm run build`
5. **Report** the file path, the number of acceptance criteria, and the open questions. Tell the user to review the file and then run `/implement FEATURE-<name>.md`.

Do not commit or push.
