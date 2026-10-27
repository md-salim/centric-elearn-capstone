# FEATURE: Pipeline repair and .NET 10 upgrade (M4)
Owner: unassigned

Plan only. No file other than this one has been changed by `/plan`. Evidence gathered: `docs/ci-failing-run.log`, both csproj files, `compose.yaml`, `.gitignore`, `README.md`, `appsettings*.json`, the existing tests, and NuGet's public index (queried today).

## Why
CI has never passed. The 23 October run on `main` failed both jobs for two reasons (`docs/ci-failing-run.log`):
1. **backend:** `setup-dotnet` installs SDK 6.0.428, but both projects target `net8.0`: `error NETSDK1045: The current .NET SDK does not support targeting .NET 8.0`.
2. **frontend:** `working-directory: web`, but the folder is `frontend`: "No such file or directory".

The team also decided to move to .NET 10 (CLAUDE.md "Current vs target"). The same bump unblocks local testing: the review report found `dotnet test` cannot start here because only the 10.0.400 SDK is installed and the net8.0 test host needs a .NET 8 runtime (`docs/review-report.md` lines 24 and 25).
The stakeholder brief says nothing about the pipeline. This is team work (M4), not a brief item.

## Scope / out of scope
**In:** CI rewrite (three jobs), net10.0 bump with package pairing, compose fixes and `.env.example`, `.gitignore` additions, hygiene sweep, README update, `docs/dotnet-10-upgrade-note.md`, "Resolution" section appended to `docs/ci-failing-run.log`.
**Out:** new product features; building the `/board` and `/sla-breaches` screens (they do not exist, see Risks 3); EF Core 10 itself (blocked, see below); rewriting git history; rotating credentials.

## What the investigation found (these change the plan)
| Finding | Evidence | Effect |
|---|---|---|
| **No Pomelo release pairs with EF Core 10.** Latest stable is `9.0.0`, which requires `Microsoft.EntityFrameworkCore.Relational [9.0.0, 9.0.999]`. Its newest pre-release is also 9.x. | NuGet flat-container listing and the 9.0.0 nuspec | Use the fallback you named: **EF Core 9.0.x on net10.0**. EF 10 is not possible today. |
| EF Core 9.0 latest is **9.0.22**; ASP.NET/EF 10.0 latest is **10.0.14**. | NuGet | Pin `Microsoft.EntityFrameworkCore` and `...InMemory` to `9.0.22`; `Microsoft.AspNetCore.Mvc.Testing` to `10.0.14` (it follows the ASP.NET runtime, not EF). Mixing `InMemory` 10.x with EF 9.x would break. |
| FluentValidation 11.11.0 targets net8.0 and netstandard2.0. dbup-mysql 6.1.0 targets netstandard2.0. | nuspec files | Run on net10.0 unchanged. Proven only once the build and tests pass. |
| Swashbuckle 6.6.2 is netstandard2.0. The current line is 10.x, which is a major jump (Microsoft.OpenApi 2.x). | NuGet | Keep 6.6.2, prove `/swagger/v1/swagger.json` still serves, and note 10.x as a later task. |
| The git root is `centric-elearn-capstone/`, a monorepo with five tracks. This project's workflow sits at `track-4-hospitality/.github/workflows/ci.yml`. **GitHub only runs workflows from `<repo root>/.github/workflows/`.** | `git rev-parse --show-toplevel`, `git ls-files` | As things stand the workflow would never run in this repository. See Risks 1. |
| `appsettings.Development.json` is tracked and contains a DB password, a channel-manager API key labelled `prod`, and an SMTP password. `compose.yaml` and `db-setup/01-create-users.sql` hold more. | file contents | The "no secrets" sweep fails today. See Risks 2. Values are deliberately not repeated here. |
| `package.json` in `frontend/` has no `test` script. | file | Use `npm run test --if-present`. |
| The only real-MySQL test is `MySqlConcurrencyTests`, trait `Category=MySql`, driven by `LARCHMONT_MYSQL_TESTS` (a server connection string without a database). It returns early (a false "pass") when the variable is unset. | `MySqlConcurrencyTests.cs` | Your spec says `Category=Integration` and `ConnectionStrings__Larchmont`. See Risks 4. |

## Acceptance criteria
**CI**
- AC_01 Given the workflow, When parsed with a YAML parser, Then it is valid and has exactly three jobs: `backend`, `frontend`, `mcp`.
- AC_02 Given the `backend` job, Then it uses `actions/setup-dotnet` with `10.0.x`, then runs `dotnet restore`, `dotnet build -c Release --no-restore`, and `dotnet test -c Release --no-build` on `backend/Larchmont.sln`.
- AC_03 Given the `backend` job, Then it has a `mysql:8.4` service container with a health check, and the job waits for health before tests. The root password is a CI-only literal in job `env`, not a repository secret, and is not reused anywhere else.
- AC_04 Given the `backend` job, When the integration step runs, Then it executes `--filter "Category=Integration"` against that MySQL, and the job **fails if no integration test actually ran** (a skipped or early-returned test is not a pass).
- AC_05 Given the `frontend` job, Then it uses Node 20 and `working-directory: frontend`, and runs `npm ci`, `npm run build`, and `npm run test --if-present`.
- AC_06 Given the `mcp` job, Then it has `needs: [backend, frontend]`, Node 20, `working-directory: mcp`, and runs `npm ci`, `npm run build`, `npm test`.
- AC_07 Given the log's two root causes, When the new workflow runs on a clean runner, Then neither NETSDK1045 nor the `web` working-directory error occurs. (Proven only by a real GitHub run.)

**.NET 10 bump**
- AC_08 Given both csproj files, Then `TargetFramework` is `net10.0`.
- AC_09 Given the packages, Then `Microsoft.EntityFrameworkCore` and `Microsoft.EntityFrameworkCore.InMemory` are `9.0.22`, `Pomelo.EntityFrameworkCore.MySql` is `9.0.0`, `Microsoft.AspNetCore.Mvc.Testing` is `10.0.14`, and no 8.x package remains. `dotnet list package --outdated` and `--deprecated` are recorded in the note.
- AC_10 Given deleted `bin/` and `obj/` folders, When `dotnet restore`, `dotnet build backend/Larchmont.sln` and `dotnet test backend/Larchmont.sln` run, Then all succeed with 0 errors and the warning count is reported, not hidden.
- AC_11 Given the net10 build, When the in-memory test suite runs, Then every test that passed on net8.0 still passes, and any difference is listed with its cause and patch.
- AC_12 Given the running API, When `/swagger/v1/swagger.json` is requested, Then it returns 200 (Swashbuckle 6.6.2 on net10).
- AC_13 Given real MySQL 8.4 with DbUp, When the API starts, Then V001 to V007 apply and the integration test passes on Pomelo 9 / EF 9 / net10. (Needs MySQL; see Verify.)

**Compose and env**
- AC_14 Given `compose.yaml`, Then no password literal remains; the root password comes from `${MYSQL_ROOT_PASSWORD}` and compose refuses to start without it (`${VAR:?message}`).
- AC_15 Given `.env.example`, Then it lists every variable compose and the apps read, with placeholder values only, and `.env` stays ignored.
- AC_16 Given compose, Then the `mysql` service has a health check, a named volume for `/var/lib/mysql`, and a named network. The image stays `mysql:8.4`.

**Hygiene and docs**
- AC_17 Given `.gitignore`, Then it covers `node_modules`, `bin`, `obj`, `dist`, `.vs`, `*.user`, `.env`, `coverage`, `TestResults`, `publish`, `logs/`; `.env.example` is not ignored.
- AC_18 Given `git clean -ndx` (dry run only), When its output is reviewed, Then it lists only ignored or untracked build output, and `git ls-files` shows no tracked `bin/`, `obj/`, `node_modules/`, `dist/`, or binary over 1 MB. A secret scan of tracked files finds no credentials (see Risks 2: this is expected to fail until the secrets are handled).
- AC_19 Given `README.md`, Then it says .NET 10 SDK, Node 20, MySQL 8.4; uses `dotnet run --project backend/Larchmont.Api` and `frontend/`; explains `.env` and `docker compose`; explains how to build and start the MCP server; documents `GET /api/rooms/{id}/ready-by`; states that in-memory tests are not proof of performance, indexes, SQL translation or concurrency; links `docs/dotnet-10-upgrade-note.md`; and records the hygiene state with the date and commit.
- AC_20 Given `docs/dotnet-10-upgrade-note.md`, Then it records why .NET 10, the package table (from, to, why), the EF 9 fallback and its evidence, what failed and was patched, and the test matrix that proved it, with real command output.
- AC_21 Given `docs/ci-failing-run.log`, Then a "Resolution" section is appended (original lines untouched) naming the two root causes, the fixing commit, and a blame link.

## API contract
No new or changed routes. README documents the existing `GET /api/rooms/{id}/ready-by`. Environment variables used by the pipeline: `MYSQL_ROOT_PASSWORD` (compose), `ConnectionStrings__Larchmont` (API), `LARCHMONT_MYSQL_TESTS` (integration tests), `MCP_DB_*` (MCP).

## Plan by area
Disjoint paths. The existing agents are scoped narrowly, so files outside C#/React/xUnit go to `general-purpose` (same call as the MCP feature). **Do not start this until the running MCP `/implement` has finished**: it also touches `.github/workflows/ci.yml` and `README.md`.

**Order:** 1) bump (backend + tests), prove build and test locally; 2) compose and `.env.example`; 3) CI rewrite; 4) hygiene and docs; 5) reviewer.

### backend → `backend/Larchmont.Api/**` (agent `backend`)
`Larchmont.Api.csproj`: `net10.0`; `Microsoft.EntityFrameworkCore` 9.0.22; `Pomelo.EntityFrameworkCore.MySql` 9.0.0; keep FluentValidation 11.11.0, dbup-mysql 6.1.0, Swashbuckle 6.6.2 unless the build fails. Fix only what the build or tests force (nullable or obsolete-API warnings, EF 9 behaviour changes) and record each patch for the note. Delete `bin/` and `obj/` under both projects first (untracked, ignored output; list them before deleting). Keep `MySqlServerVersion(8, 4, 0)`.

### tests → `backend/Larchmont.Tests/**` (agent `test-writer`)
`Larchmont.Tests.csproj`: `net10.0`; `Mvc.Testing` 10.0.14; `InMemory` 9.0.22; keep xunit, Moq, Test.Sdk (check for newer compatible). Add `[Trait("Category","Integration")]` to the real-MySQL tests (keeping `MySql`, Risks 4). Add a guard so that when `CI=true` and `LARCHMONT_MYSQL_TESTS` is unset the integration tests fail instead of silently returning, so a CI skip cannot look green. Any new test is named `AC_NN_Description` and must fail first. Run `dotnet test backend/Larchmont.sln` and record the matrix. In-memory results are not evidence for the MySQL claims.

### ci, compose, hygiene, docs → `.github/workflows/ci.yml`, `compose.yaml`, `.env.example`, `.gitignore`, `README.md`, `CLAUDE.md`, `.claude/rules/coding-conventions.md`, `docs/dotnet-10-upgrade-note.md`, `docs/ci-failing-run.log` (append only) (agent `general-purpose`)
- **ci.yml:** three jobs as in AC_01 to AC_07. Keep the existing `mcp` job's extra steps (migrations, views, MCP user, MySQL tests) because they are what test the MCP server against real MySQL. Only add `needs` (Q5). Use `actions/checkout@v4`, `setup-dotnet@v4`, `setup-node@v4` with npm cache keyed on each lockfile. Validate the YAML with a real parser (Node `yaml` installed in a temp dir, or `actionlint`).
- **compose.yaml:** `env_file`/`${MYSQL_ROOT_PASSWORD:?set it in .env}`, `healthcheck` (`mysqladmin ping`, interval, retries, `start_period`), named volume `larchmont_mysql_data`, network `larchmont-net`. Note in README that `docker compose down -v` wipes data and that init scripts only run on an empty volume.
- **.gitignore:** append `coverage/`, `TestResults/`, `publish/`, `logs/` (generic, replacing `mcp/logs/`) and anything else missing. Do not ignore `.env.example`.
- **hygiene sweep:** `git clean -ndx` is a dry run only. **Never run `git clean -fdx`**: it would delete `.env`, `node_modules`, `mcp/logs` and other local state. Report findings, do not delete.
- **README, CLAUDE.md, coding-conventions:** fix the stale .NET 8 lines; replace "EF Core 10 / Pomelo that pairs with EF 10" with the confirmed fallback (EF Core 9.0.x on net10.0) so agents stop writing for a version that cannot run (Q6).
- **upgrade note:** write it from real outputs: `dotnet --list-sdks`, `dotnet list package`, build and test output, NuGet evidence.
- **ci log:** append "Resolution" with the two root causes, the commit that fixes them (once it exists), and the blame link in the form `https://github.com/md-salim/centric-elearn-capstone/blame/<sha>/track-4-hospitality/.github/workflows/ci.yml`. The workflow file was added whole in commit `540db4c0e607`, so blame can only point at that import commit; it cannot name a person who "caused" the bug. The log also names commit `3f9c2ab`, which is not in this repository.

## Risks and open questions
1. **Where does the workflow run?** The git root is the parent monorepo; GitHub ignores `track-4-hospitality/.github/`. Either the submission is made from this folder as its own repository (then it works as written), or the workflow must move to `<root>/.github/workflows/` with `working-directory: track-4-hospitality/...` and path filters. The failing log's paths (`/larchmont/larchmont/backend/...`) suggest a standalone repo. Please confirm; the plan assumes standalone.
2. **Committed secrets.** `appsettings.Development.json` (tracked) holds a DB password, a channel-manager API key marked `prod`, and an SMTP password; `compose.yaml` and `db-setup/01-create-users.sql` hold more. Moving values out of the file does not remove them from history. The plan only reports them. Decide: remove from the file now, and who rotates the real credentials (the `prod` key in particular), and whether history is rewritten. Until then AC_18's secret scan will fail and README must say so rather than claim "clean".
3. **README asks for `/board` and `/sla-breaches` screens. They do not exist.** The frontend has only Hotels, Bookings, Guests and Occupancy pages; the late-rooms API is `/api/hotels/{id}/late-rooms`, not `sla-breaches`. The README will describe only what exists and list the board as planned (spec `housekeeping-board`). Say if you want the screens built as a separate feature.
4. **`Category=Integration` and `ConnectionStrings__Larchmont`.** The existing real-MySQL test is `Category=MySql`, uses `LARCHMONT_MYSQL_TESTS`, and creates its own throw-away database; it does not read `ConnectionStrings__Larchmont`. Plan: add the `Integration` trait alongside `MySql`, set both variables in CI, and leave the test's own connection logic alone. There is one real-MySQL test today; "a new integration suite" is therefore only one test unless you want more (for example the housekeeping AC_19/AC_25 races). Confirm the scope.
5. **mcp job.** You asked for `npm ci` and `npm test` only. The existing job also builds, creates the schema, and runs the MySQL tests, so it proves more. Keeping the extra steps is the plan; say if you want it trimmed.
6. **CLAUDE.md and `.claude/rules/coding-conventions.md` say "EF Core 10"**; the plan changes them to EF Core 9.0.x on net10.0 because Pomelo has no EF 10 release. Is that edit in scope?
7. **Not provable here.** Docker is not installed and the MySQL on 3306 rejects known credentials, so AC_07, AC_13 and the integration test can only be proven by the first real CI run. The local proof is limited to build, in-memory tests and swagger. State this in the note; do not claim more.
8. **EF 9 and net10 behaviour changes** (nullability, obsolete APIs, query translation) only show up in the build and tests, so the patch list in the note is written after the fact. A real-MySQL run is needed to rule out SQL-translation changes.
9. **Release branch.** "Before merging to release/*": no such branch exists locally. The PR description (to justify the EF 9 fallback) is text only; nothing is committed, pushed or opened without your say-so.
10. Persistence changes behaviour: a named volume keeps data across `docker compose down`; first-time init scripts will not rerun on an existing volume.

## Verify
- `dotnet --list-sdks`, then delete ignored `bin/` and `obj/` under `backend/`, then `dotnet restore backend/Larchmont.sln`
- `dotnet build backend/Larchmont.sln -c Release --nologo` (0 errors; report warnings)
- `dotnet test backend/Larchmont.sln -c Release --nologo` (report totals; in-memory only)
- `dotnet list backend/Larchmont.sln package --outdated` and `--deprecated`, `--vulnerable`
- `dotnet run --project backend/Larchmont.Api`, then `GET http://localhost:5080/swagger/v1/swagger.json` returns 200
- `cd frontend && npm ci && npm run build`; `cd mcp && npm ci && npm run build && npm test`
- `docker compose config` (validates compose; fails without `.env`), `docker compose up -d` and `docker compose ps` shows healthy (needs Docker)
- Real MySQL: `LARCHMONT_MYSQL_TESTS=... dotnet test backend/Larchmont.sln --filter "Category=Integration"`, and confirm it executed (not early-returned)
- YAML parse of `ci.yml`; first push shows three green jobs and `mcp` waiting on the other two
- `git clean -ndx` (dry run), `git ls-files` size and path checks, secret scan of tracked files
- Then run `reviewer` against `docs/review-checklist.md`

Next: review this file, answer Risks 1, 2, 3, 4 and 6, then run `/implement FEATURE-pipeline.md` once the MCP implementation has finished.
