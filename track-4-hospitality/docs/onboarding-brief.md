# Onboarding brief

For new team members on the Larchmont capstone track. Read this first, then `CLAUDE.md`.

## 1. What the project is

Larchmont Hotels runs six hotels (Edinburgh, Manchester, Leeds, London Bridge, Bath, Brighton). The reservations team uses one small internal system for hotels, room types, rooms, guests, bookings, rates and staff, plus an occupancy report and a channel-manager booking importer. A contractor built it quickly and left. We inherited it.

**Our job (track 4):** build a housekeeping and room-status board for Sofia Lindqvist, Director of Rooms. Her request is in `docs/stakeholder-brief.md`:
- Rooms move through Dirty, Cleaning, Inspected, Ready; out-of-order rooms can never be sold or assigned.
- A turnaround target with a breach list, housekeepers assigned by floor, and a "when will this room be ready?" answer for the front desk.
- Screens: a live board by floor and an SLA breach list, each with loading, empty and error states.

Two things in the brief need care. Several rules contradict each other (supervisor inspection vs housekeepers marking rooms Ready; 45 vs 75 minute targets; when the clock starts). And the request to track housekeepers' location all the time, including off-shift and on breaks, is a privacy and legal problem. **Do not build it.** Record it as an open question for HR and legal. The `spec-writer` skill handles both.

Also open: the occupancy report is wrong (`docs/bug-LH-56.md`), the CI run is failing (`docs/ci-failing-run.log`), and `docs/review-checklist.md` is the standard code is reviewed against.

**Stack:** ASP.NET Core Web API with controllers, services and repositories; FluentValidation; DbUp migrations; EF Core with Pomelo on MySQL 8.4; React + TypeScript with Vite. Tests are xUnit. The projects still say `net8.0`; the plan is `net10.0` (see `CLAUDE.md`).

## 2. Get running

You need the .NET 10 SDK, Node 20 or later, and Docker (or a MySQL 8.4 server on port 3306).

```
docker compose up -d
mysql -h 127.0.0.1 -P 3306 -u root -p < db-setup/01-create-users.sql
dotnet run --project backend/Larchmont.Api        # http://localhost:5080/swagger
cd frontend && npm install && npm run dev         # http://localhost:5173
dotnet test backend/Larchmont.sln
```

Never put passwords in files you commit. Use the `ConnectionStrings__Larchmont` environment variable for real credentials.

## 3. How the `.claude/` setup works

| Piece | Where | What it does |
|---|---|---|
| Project memory | `CLAUDE.md`, `frontend/CLAUDE.md` | Stack, commands, rules. Claude reads it every session. |
| Rules | `.claude/rules/coding-conventions.md`, `testing-conventions.md` | Backend and test conventions, scoped to those folders. |
| Agents | `.claude/agents/` | `backend`, `frontend`, `test-writer`, `reviewer`, `db-analyst`, `planner`. Each owns its own files. See `docs/agent-map.md`. |
| Skills | `.claude/skills/` | `spec-writer` (brief to spec), `session-handoff` (handoff note), `prompt-journal` (journal entry). |
| Commands | `.claude/commands/` | `/plan`, `/implement`, `/reflect`, `/handoff`. |
| Hooks | `.claude/settings.json`, `.claude/hooks/` | See below. |
| Plugin | `plugins/ponytail/` | Session-start banner. |

**Hooks (they run automatically):**
- Before a Bash command: blocks `rm -rf` (any flag order) and anything touching `.env` files (`.env.example` is fine). This is a guardrail, not a sandbox; a determined command can get around it.
- After editing a `.cs` file under `backend/Larchmont.Api`: runs `dotnet build backend/Larchmont.sln --nologo` and shows you the errors if it fails.
- When you send a prompt: appends it with a timestamp to `docs/prompt-journal.md` as `[auto]`. Secrets such as `password=...` are redacted and long prompts are cut, but **do not paste real secrets or personal data into prompts**. The journal is committed.
- When a session stops: writes a short mechanical note to `docs/session-logs/<date>-auto-<session>.md` (branch, files edited inside the repo, git status). These notes are git-ignored because they are rewritten every turn. Use `/handoff` for the full note.

Hooks are read when a session starts. After changing `.claude/settings.json`, start a new session or review it with `/hooks`.

**Plugin.** Start Claude with the banner: `claude --plugin-dir plugins/ponytail`. At session start it shows the branch, whether you have uncommitted changes, and your FEATURE file (matched by the `Owner:` line, your git name, or your branch name), plus the reminder: plan before coding, use the stakeholder brief, never commit secrets.

## 4. Your first feature: `/plan` then `/implement`

1. **Branch.** Work on your own branch, never `main`.
2. **Spec (if needed).** Ask Claude to use the `spec-writer` skill for the feature. It writes `docs/specs/<feature>.md` and lists the open questions.
3. **Plan.** Run `/plan <feature>`. It reads the brief, any spec and the code, then writes `FEATURE-<name>.md` at the repo root with acceptance criteria, API contract, a plan per area, risks and an `Owner:` line. It writes no code. If typing `/plan` opens Claude's built-in plan mode instead of our command, say "follow `.claude/commands/plan.md` for <feature>".
4. **Review the FEATURE file yourself.** Answer or flag the open questions. A wrong plan is cheap to fix now and expensive later.
5. **Implement.** Run `/implement FEATURE-<name>.md`. It sends the work to `backend`, `frontend` and `test-writer` in parallel (each in its own folder), checks the build and tests, then runs `reviewer`.
6. **Read the results.** Open `docs/review-report.md`. Every Fail needs a fix or a written reason. Tests are named `AC_NN_Description`, and each new test must have failed first.
7. **Hand off.** Run `/handoff` to write `docs/session-logs/<date>-<slug>.md`. Optionally run `/reflect` to find steps worth automating.
8. **Commit** when you are happy. Nothing here commits or pushes for you.

## 5. Limits to know about

- **In-memory tests prove less than they look.** They cannot show performance, indexes, SQL translation or concurrency. Those claims need a test against real MySQL or the EF Core SQL log.
- **Subagents cannot start other subagents.** `/plan` and `/implement` run in your main session for this reason. The `planner` agent only fans out if run as the main agent (`claude --agent planner`).
- **No frontend test runner yet.** Add Vitest with React Testing Library or Playwright in the same change as the first frontend test.
- **The `/plan` name** may clash with the built-in; see step 3 above.
- **Hooks were tested with piped sample input**, not across many real sessions.

## 6. When something is wrong

- Build error after an edit: the hook prints it; run `dotnet build backend/Larchmont.sln` for the full output.
- Command blocked: read the message. Delete files one by one, or ask a teammate.
- Not sure of a rule: `CLAUDE.md`, then `.claude/rules/`, then `docs/review-checklist.md`.
- Unsure what the stakeholder meant: write it down as an open question; do not guess.
