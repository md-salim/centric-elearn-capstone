# Agent map

Six subagents live in `.claude/agents/`. `planner` coordinates; the others do one job each.

## Agents

| Agent | Model | Effort | Tools | Owns (writes) | Output |
|---|---|---|---|---|---|
| planner | claude-sonnet-5-5 | default | Read, Grep, Glob, Agent(...) | nothing | Brief per worker; final summary |
| backend | claude-haiku-5-5 | default | Read, Write, Edit, Bash, Grep, Glob | `backend/Larchmont.Api/**`, new `backend/db/migrations/V00N__*.sql` | Code; `dotnet build` and `dotnet test` result |
| frontend | claude-haiku-5-5 | default | Read, Write, Edit, Bash, Grep, Glob | `frontend/src/**` | Code; `npm run build` result |
| test-writer | claude-haiku-5-5 | default | Read, Write, Edit, Bash, Grep, Glob | `backend/Larchmont.Tests/**` | xUnit tests `AC_NN_Description` with a recorded red run |
| reviewer | claude-sonnet-5-5 | medium | Read, Grep, Glob, Bash, Write | `docs/review-report.md` only | Checklist findings |
| db-analyst | claude-sonnet-5-5 | medium | Read, Grep, Glob, Bash, Write | `docs/db-analysis.md` only | Schema reasoning, query plans |

## Orchestration graph

```
                       feature request
                              |
                           planner
                              |
        (needs schema change / perf / concurrency?)
                     yes |          | no
                         v          |
                    db-analyst      |
                         |          |
                         +----+-----+
                              |
              planner splits work, disjoint file ownership
                              |
          +-------------------+-------------------+
          |                   |                   |
       backend            frontend           test-writer      <- parallel fan-out
  (Larchmont.Api)        (frontend/src)    (Larchmont.Tests)
          |                   |                   |
          +-------------------+-------------------+
                              |
                  planner collects, fixes failures
                              |
                           reviewer   (runs docs/review-checklist.md over the diff)
                              |
                       docs/review-report.md
                              |
                      planner final summary
```

## How to run it
- Start the orchestration with `claude --agent planner`. **Subagents cannot spawn other subagents**, so `planner` only fans out when it is the main-thread agent. If you call it from another agent or via `@planner` inside a normal session, it cannot spawn the workers.
- Each worker can also be used on its own (for example `@reviewer` after a manual change).

## Rules the agents follow
- **Disjoint ownership.** Two agents never edit the same file, so parallel work cannot conflict. Contracts (routes, DTO shapes, status codes) are fixed in the planner's briefs.
- **Fail first.** `test-writer` runs each new test against the unfixed code and records the red output before the production change is relied on. Because it runs in parallel with `backend`, its red run must happen first; if the code has already changed, it says so.
- **Build after edits.** `backend` runs `dotnet build`; `frontend` runs `npm run build`.
- **Reviewer reports, never fixes.** Findings go back to the planner, which sends fix requests to the owning agent.
- **No false proof.** The in-memory tests cannot prove performance, indexes or concurrency; those need a real MySQL 8.4 test or the EF Core SQL log.
- **Conventions** live in `CLAUDE.md`, `.claude/rules/coding-conventions.md`, `.claude/rules/testing-conventions.md` and `frontend/CLAUDE.md`.

## Notes
- Tests are xUnit (not NUnit), matching `Larchmont.Tests.csproj`.
- `effort: medium` is set in the frontmatter of `reviewer` and `db-analyst`.
