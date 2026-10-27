---
description: Implement a FEATURE or BUG file by dispatching the backend, frontend and test-writer agents, then the reviewer
argument-hint: <path to FEATURE-*.md or docs/bug-*.md>
---

Implement the plan in: **$ARGUMENTS**

This runs in the main conversation so it can spawn the agents. Follow the graph in `docs/agent-map.md`.

## Before dispatching
1. If no file was given or it does not exist, say so and stop (list `FEATURE-*.md` and `docs/bug-*.md` as options).
2. Read the file in full, plus `CLAUDE.md` and `.claude/rules/*`. If it has unresolved **open questions** that block the work, show them to the user and ask before going on.
3. Check `git branch --show-current` and `git status --short`. If on `main`, stop and ask the user to switch to a feature branch. If there are unrelated uncommitted changes, tell the user.
4. Work out which areas are needed (backend, frontend, tests). A bug fix may need only backend and tests. If the plan has a schema change or a performance or concurrency requirement and `docs/db-analysis.md` does not cover it, spawn `db-analyst` first.

## Dispatch
5. Write one self-contained brief per agent (they do not see this conversation): the goal, the relevant acceptance criteria, the API contract (routes, DTO shapes, status codes), the paths it owns, and the file to read. Ownership must be disjoint:
   - `backend` -> `backend/Larchmont.Api/**` and new migrations. Builds after every edit batch.
   - `frontend` -> `frontend/src/**`. Runs `npm run build` after edits.
   - `test-writer` -> `backend/Larchmont.Tests/**`. xUnit, `AC_NN_Description`, and it must record a failing run against the unfixed code first (for a bug file the test must fail on the original code).
6. Spawn the needed agents **in a single message** so they run in parallel.

## After
7. Read each result. If a build or test failed, send the owning agent a fix request; do not hide failures.
8. Run the checks yourself: `dotnet build backend/Larchmont.sln --nologo`, `dotnet test backend/Larchmont.sln`, and `cd frontend && npm run build` if the frontend changed. Report the real output.
9. Spawn `reviewer` on the combined diff. It writes `docs/review-report.md`.
10. **Summarise** for the user: what changed (files), build and test status, the reviewer's Fail items, and what is unverified (in-memory tests cannot prove performance, indexes or concurrency).

Do not commit or push unless the user asks.
