# FEATURE: rewrite CLAUDE.md for the real Larchmont stack

## Why
The old CLAUDE.md described another project (minimal APIs, MediatR, Dapper, SQL Server, CRA, NUnit). Agents following it write wrong code and run wrong commands. Rewrite it for the target state (net10.0, EF Core 10) and add scoped rules.

## Facts verified from the repo
- API: controllers -> services -> repositories -> `LarchmontDbContext`; FluentValidation; hand-written mappers; `BusinessRuleException`/`NotFoundException` mapped by `ApiExceptionHandler` to ProblemDetails.
- DB: MySQL 8.4 (`compose.yaml`); schema via DbUp, embedded `backend/db/migrations/V00N__*.sql`, skipped in the `Testing` environment.
- csproj targets net8.0 today (EF 8.0.13, Pomelo 8.0.3); M4 bumps to net10.0 in the pipeline PR.
- Frontend: Vite 6, React 19, react-router 7, strict TS; `/api` proxied to `localhost:5080`. No test runner installed yet.
- Tests: **xUnit + Moq** (not NUnit/MSTest), `WebApplicationFactory` + EF InMemory.

## Decisions
1. Document xUnit as it is. New tests are named `AC_NN_Description`; existing `Method_Condition_Result` tests stay.
2. Pomelo version for EF Core 10 is not named; M4 confirms and pins it.
3. Frontend test runner (RTL/Playwright) must be added with the first frontend test.
4. README (.NET 8 SDK) and the secret in compose.yaml are out of scope here.

## Deliverables
- `CLAUDE.md` (< 60 lines)
- `.claude/rules/coding-conventions.md`
- `.claude/rules/testing-conventions.md`
- `frontend/CLAUDE.md` (nested)

## Verify
- Line count under 60; every path and command exists; no stale terms (MediatR, Dapper, LocalDB, NUnit, Redux, AutoMapper).
