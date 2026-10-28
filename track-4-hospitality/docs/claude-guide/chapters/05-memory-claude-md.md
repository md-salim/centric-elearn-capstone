# Chapter 5: Memory and CLAUDE.md

Every Claude Code session starts with an empty conversation. Claude does not remember yesterday's session, the decision you reached in a stand-up, or the fact that this team never uses AutoMapper. Memory files are how you give it that knowledge, every time, without retyping it.

The most important memory file is `CLAUDE.md`. This chapter explains where memory files live, how they are loaded, what belongs in them and what does not, and then walks through the real memory files in this repository line by line.

## 5.1 Why memory matters

Think of a new contractor joining the team. On day one you would tell them how to run the tests, which folders matter, and the handful of rules that, if broken, cause real trouble. You would not hand them the entire wiki. `CLAUDE.md` is that day-one briefing, delivered at the start of every session.

Good memory files have three effects:

- **Fewer wasted steps.** Claude does not have to discover the test command or the folder layout by trial and error.
- **Fewer convention breaches.** Rules such as "never edit an applied migration" are followed because they are stated up front.
- **More consistent results across the team.** Everyone's sessions start from the same briefing because the project file is committed to version control.

> NOTE: Memory files are context, not enforcement. Claude reads and generally follows them, but a rule in `CLAUDE.md` is not a guarantee. If something must never happen, back it with a permission rule or a hook (Chapter 6 and Chapter 8).

## 5.2 The memory hierarchy

Claude Code loads memory from several locations. More specific files are loaded in addition to broader ones, so they layer rather than replace.

| Level | Location | Shared with | Typical contents |
|---|---|---|---|
| Managed (enterprise) policy | A system-wide location set by IT administrators | Everyone in the organisation | Company-wide rules, security and compliance requirements |
| User | `~/.claude/CLAUDE.md` | Only you, all projects | Personal preferences: language, tone, tooling habits |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` | The team, via git | Build and test commands, architecture, project rules |
| Project rules | `./.claude/rules/*.md` | The team, via git | Topic-specific rules, optionally scoped to paths |
| Local project | `./CLAUDE.local.md` | Only you, this project | Personal notes for this repo; keep it out of git |
| Nested directory | `CLAUDE.md` in a subfolder, e.g. `frontend/CLAUDE.md` | The team, via git | Rules for that part of the codebase |

### How files are found

When you start Claude Code in a folder, it reads `CLAUDE.md` files from that folder and from parent folders up towards the root of the file system. This is why starting a session in `track-4-hospitality` picks up that track's `CLAUDE.md`.

Files in **subfolders** below the starting folder are not all loaded at the start. Instead, a nested `CLAUDE.md` is pulled in when Claude works with files in that subfolder. In this repository, `frontend/CLAUDE.md` comes into play when Claude reads or edits files under `frontend/`. This keeps the start-up context small while still giving Claude the right rules when it needs them.

### A real example of layering

In the session that produced this guide, two memory files were visible at the start:

```text
C:\Users\labuser\.claude\CLAUDE.md         (user level)
    Always reply in British English.

track-4-hospitality\CLAUDE.md               (project level)
    # Larchmont Hotels - agent briefing
    ...
```

The user file sets a personal preference that applies to every project on that machine; the project file carries the team's shared rules. Neither knows about the other, and both apply.

> TIP: Put personal preferences (language, verbosity, "explain before you edit") in your user file, not in the project file. Your teammates may not share them.

## 5.3 Imports with `@`

A `CLAUDE.md` file can pull in other files using `@path` syntax. This lets you keep the main file short while pointing to fuller documents.

```markdown
# Project briefing

See @README.md for the project overview and @docs/review-checklist.md
for what reviewers check.

## Personal
- @~/.claude/my-larchmont-notes.md
```

Points to bear in mind:

- Relative paths are resolved relative to the file that contains the import.
- Imports can be nested, up to a limited depth.
- Imports inside code spans and code blocks are not treated as imports.
- Importing a file from your home directory is a tidy way to keep personal instructions for a shared project without committing them.

Use imports deliberately. Every imported file is loaded into context, so importing a 20-page specification into every session wastes tokens and dilutes the important rules. Prefer a one-line pointer ("specs live in `docs/specs/`") when Claude only needs to know where something is.

## 5.4 Project rules in `.claude/rules/`

As a project grows, a single `CLAUDE.md` tends to become long. The `.claude/rules/` folder lets you split rules into topic files, each a Markdown file. They are loaded as project memory alongside `CLAUDE.md`.

Rule files can declare which paths they apply to using YAML front matter. A rule with a `paths` list is applied only when Claude works with matching files, so backend rules do not clutter a frontend task.

```markdown
---
paths:
  - "backend/**"
---

# Backend coding conventions
...
```

This repository has two rule files, `coding-conventions.md` (scoped to `backend/**`) and `testing-conventions.md` (scoped to `backend/Larchmont.Tests/**`). We will read them in section 5.8.

## 5.5 What to put in, and what to keep out

The single most common mistake is writing too much. Context is a shared budget: every line of memory competes for Claude's attention with your prompt and the code it reads.

### Put in

| Category | Example |
|---|---|
| Commands Claude cannot guess | `dotnet test backend/Larchmont.sln`, `npm run build` |
| Non-obvious architecture | "Request flow is Controller -> Service -> Repository -> DbContext" |
| Hard rules with consequences | "Never edit an applied migration; add the next `V00N__name.sql`" |
| Project-specific conventions | "Name tests `AC_NN_Description`" |
| Known traps | "In-memory tests cannot prove performance, indexes, SQL translation or concurrency" |
| Where things live | "Specs, tickets and the review checklist are in `docs/`" |
| Current-versus-target state | "Both csproj files still say `net8.0`; write new code for net10.0" |

### Keep out

| Category | Why |
|---|---|
| Secrets, passwords, connection strings | Memory files are committed and shared; Claude also repeats them into transcripts |
| Things Claude can read from the code | Folder listings and class inventories go stale and waste context |
| Generic advice | "Write clean code" and "be careful" add nothing |
| Long specifications | Point to them instead of importing them |
| History and changelogs | Git already records them |
| Personal preferences in the shared file | Use the user file or `CLAUDE.local.md` |
| Instructions that contradict each other | Claude will pick one, and you will not know which |

### Write rules that can be checked

Compare these two rules:

```text
Be careful with database changes.
```

```text
Schema changes are new files in backend/db/migrations/ named
V00N__description.sql (next number, never reuse). Never edit one that has
been applied.
```

The second tells Claude exactly what to do and gives a reviewer something concrete to check. Prefer rules that name a file, a command, a pattern or a number.

### Explain the why, briefly

A short reason helps Claude handle cases the rule did not anticipate. "Use `DateOnly` for stay dates" is good; "Use `DateOnly` for stay dates. Do not introduce timezone conversion without agreeing it first" is better, because it tells Claude that the underlying concern is time zones, and that it should stop and ask rather than improvise.

## 5.6 Creating memory with `/init` and `/memory`

### `/init`

Running `/init` in a project asks Claude to analyse the codebase and draft a `CLAUDE.md`: build commands, test commands, layout and conventions it can infer. It is an excellent starting point, but treat the result as a first draft.

1. Run `/init` in the project root.
2. Read the draft critically. Delete anything Claude could discover on its own.
3. Add the rules only your team knows: the decisions, the traps, the "never do this".
4. Commit it, and review changes to it in pull requests like any other code.

### `/memory`

`/memory` opens your memory files in an editor so that you can change them directly. It also shows which memory files are currently loaded, which is the quickest way to answer "why is Claude doing that?" when an unexpected rule is in play.

> TIP: When Claude makes the same mistake twice, that is a signal to add or sharpen a rule. When a rule never seems to matter, that is a signal to delete it.

## 5.7 Walk-through: this repository's `CLAUDE.md`

Here is the project `CLAUDE.md` for the Larchmont Hotels track, taken section by section, with notes on what each part does and why it works.

### The heading and summary

```markdown
# Larchmont Hotels - agent briefing

Internal system for six hotels: hotels, room types, rooms, guests, bookings,
rates, staff, an occupancy report and a channel-manager CSV importer.
```

One sentence tells Claude what the domain is and lists the main entities. This is enough for Claude to interpret terms such as "rate" and "channel" correctly without reading the whole codebase first.

### Stack, including current versus target

```markdown
## Stack (target state)
- API: ASP.NET Core 10 Web API with controllers, FluentValidation, Swashbuckle.
  Project: `backend/Larchmont.Api`.
- Data: EF Core 10 with Pomelo.EntityFrameworkCore.MySql (use the release M4
  confirms pairs with EF Core 10) on MySQL 8.4.
- Schema: DbUp runs embedded `backend/db/migrations/V00N__*.sql` at startup.
  No EF migrations.
- Frontend: Vite + React 19 + TypeScript (strict) in `frontend/`,
  react-router-dom.
- Tests: xUnit + Moq + `WebApplicationFactory` with the EF Core InMemory
  provider (`backend/Larchmont.Tests`).
- **Current vs target:** both csproj files still say `net8.0` (EF 8.0.13,
  Pomelo 8.0.3). The pipeline PR (M4) bumps them to `net10.0`. Write new code
  for net10.0.
```

Two things stand out. First, "No EF migrations" heads off a very natural mistake: Claude's default instinct with EF Core is to run `dotnet ef migrations add`. Second, the "Current vs target" line is unusually valuable. Without it, Claude would read `net8.0` in the csproj and reasonably write .NET 8 code. The file states the gap explicitly and says what to do about it.

> NOTE: Statements like "the pipeline PR (M4) bumps them" go stale. When M4 merges, this line must be updated or removed, otherwise it becomes misleading. Time-bound facts need an owner.

### Requirements and commands

```markdown
## Commands
- MySQL: `docker compose up -d` (root of repo), then
  `mysql -h 127.0.0.1 -P 3306 -u root -p < db-setup/01-create-users.sql`
- API: `dotnet run --project backend/Larchmont.Api`
  (http://localhost:5080/swagger)
- Frontend: `cd frontend && npm install && npm run dev`
  (http://localhost:5173, proxies `/api` to 5080)
- Frontend build/typecheck: `cd frontend && npm run build`
- Tests: `dotnet test backend/Larchmont.sln`
- Other host/port: set env var `ConnectionStrings__Larchmont`.
```

This is the highest-value section of any `CLAUDE.md`. Each line is a command Claude can run as-is, with the port it should expect. Note the last line: it says how to point at a different database without telling anyone a password.

### Layout

```markdown
## Layout
- `backend/Larchmont.Api` - Controllers, Services, Repositories, Data
  (DbContext), Domain, Dtos, Mappers, Validators, Infrastructure
- `backend/Larchmont.Tests` - `ApiFactory.cs`, `ApiTests.cs`, `UnitTests.cs`
- `backend/db/migrations` - DbUp scripts
- `db-setup/` - one-off MySQL user/view scripts
- `frontend/` - React app (has its own CLAUDE.md)
- `docs/` - specs, tickets, review checklist
```

The layout is short and names folders rather than individual files, so it will not go stale every time a class is added. The note "has its own CLAUDE.md" tells Claude to expect further rules when it moves into the frontend.

### Rules

```markdown
## Rules
- Details: `.claude/rules/coding-conventions.md`,
  `.claude/rules/testing-conventions.md`, `frontend/CLAUDE.md`.
- Request flow is Controller -> Service -> Repository -> DbContext.
  Do not skip layers.
- Never edit an applied migration; add the next `V00N__name.sql`.
- Never commit passwords or connection strings with secrets.
- The in-memory tests cannot prove performance, indexes, SQL translation or
  concurrency. Those claims need a test against real MySQL 8.4 or the EF Core
  SQL log.
- Keep changes small, and run `dotnet test` (and `npm run build` for frontend
  changes) before saying work is done.
```

Every rule here is specific and checkable. The in-memory testing rule is a particularly good example of encoding a known trap: it stops Claude (and humans) from claiming "the index works" on the strength of a test that never touched an index. The final rule defines what "done" means.

## 5.8 Walk-through: `frontend/CLAUDE.md` and `.claude/rules/`

### `frontend/CLAUDE.md`

```markdown
# Frontend conventions (frontend/)

Vite 6 + React 19 + TypeScript + react-router-dom 7. Applies to everything
under `frontend/`; the root CLAUDE.md still applies.
```

The opening line states its scope and confirms that it adds to, rather than replaces, the root file.

```markdown
## Rules
- TypeScript strict mode stays on (`tsconfig.app.json` also sets
  `noUnusedLocals`/`noUnusedParameters`). No `any`; no `@ts-ignore` without
  a comment saying why.
- Every screen handles loading, empty and error states by rendering through
  `src/components/StateView.tsx` with the `useAsync` hook
  (`src/hooks/useAsync.ts`). Give `StateView` a specific `emptyText`.
- All HTTP goes through `src/api/client.ts` (`getJson`, `ApiError`).
  No `fetch` calls in components or pages. ...
```

These rules point to the exact files that embody the convention. Rather than describing how to build a loading state, the file says "use `StateView` with `useAsync`", so Claude will reuse the existing component instead of writing a new one. "No `@ts-ignore` without a comment saying why" is a good pattern: it allows exceptions but makes them visible.

```markdown
## Tests
- Name tests `AC_NN_Description` ...
- Use React Testing Library for component tests or Playwright for end-to-end.
  Neither is installed yet: add the runner and its `npm` script in the same
  change as the first test.
```

The "neither is installed yet" line is another explicit statement of current state, which prevents Claude from assuming a test runner exists and then failing.

### `.claude/rules/coding-conventions.md`

This file starts with front matter that scopes it to the backend:

```markdown
---
paths:
  - "backend/**"
---
```

Its sections cover layering, errors and validation, data and style. Some highlights:

```markdown
- Controllers are thin: bind the request, call one service method, return
  the result. No EF queries or business rules in controllers.
- Services throw `BusinessRuleException` (rule violated, 4xx) or
  `NotFoundException` (missing entity) from `Infrastructure/Exceptions.cs`.
  `ApiExceptionHandler` turns them into ProblemDetails. Do not catch them to
  return ad-hoc status codes, and do not return raw `Exception` messages.
- Read-only queries use `AsNoTracking()`. Avoid N+1: project or `Include`
  deliberately, and filter in SQL, not after `ToListAsync()`.
- Map entities to DTOs in `Mappers/` by hand (no AutoMapper).
- No secrets in `appsettings*.json`. Use `ConnectionStrings__Larchmont` for
  real credentials.
```

Notice how each rule names the specific class, folder or method. "No AutoMapper" is the kind of team decision Claude could never infer and might otherwise "helpfully" introduce.

### `.claude/rules/testing-conventions.md`

Scoped to `backend/Larchmont.Tests/**`, this file explains the two kinds of test and, crucially, what in-memory tests cannot prove:

```markdown
## What InMemory cannot prove
The InMemory provider does not run SQL, enforce constraints or indexes, or
behave under real concurrency. Any claim about performance, schema or
indexes, SQL translation, transactions or locking, or concurrent updates
needs one of:
- a test against real MySQL 8.4 (use `compose.yaml`, with a throwaway
  database), or
- the EF Core SQL log (`LogTo` / `EnableSensitiveDataLogging` in the test
  only) showing the generated SQL.

Say which evidence you used. Do not report an in-memory pass as proof.
```

"Say which evidence you used" is a lovely instruction: it changes Claude's reporting behaviour, which makes its claims easier to review.

```markdown
## Regression and characterisation
- A bug-fix test must fail on the original code. Run it before the fix and
  keep that output.
- Before refactoring `ChannelImportService`, write characterisation tests
  that pin current behaviour (use `docs/sample-channel-export.csv`).
```

These rules encode a disciplined testing workflow that the `test-writer` subagent also follows.

### Why the split works

| File | Loaded when | Size of concern |
|---|---|---|
| `CLAUDE.md` | Every session in the track | Whole-project essentials |
| `.claude/rules/coding-conventions.md` | Work under `backend/` | Backend design rules |
| `.claude/rules/testing-conventions.md` | Work under `backend/Larchmont.Tests/` | Test rules |
| `frontend/CLAUDE.md` | Work under `frontend/` | Frontend rules |

A frontend task never pays the context cost of the backend rules, and vice versa, yet each rule is present when it is needed.

## 5.9 Auto memory

Alongside the files you write, Claude Code can keep its own memory: notes it saves as it learns about you and your project, so that later sessions benefit. These are stored per project under your user profile, not in the repository, and are therefore private to you.

In the session that produced this guide, the auto-memory folder was configured at a path under `~/.claude/projects/.../memory/`, with an index file, `MEMORY.md`, listing one line per memory. Each memory is a small Markdown file with a name, a description and a type, such as:

| Type | What it records | Example |
|---|---|---|
| user | Who you are and how you like to work | "Prefers British English; is a .NET developer new to React" |
| feedback | Corrections and confirmed approaches | "Do not run the frontend build for backend-only changes" |
| project | Ongoing goals and constraints not in the code | "M4 pipeline PR due before the .NET 10 bump" |
| reference | Pointers to external resources | "CI dashboard URL" |

### Using auto memory well

- Say "remember that ..." when you want something kept across sessions.
- Say "forget that ..." when a memory is wrong or out of date.
- Do not use auto memory for things that belong to the whole team; put those in `CLAUDE.md` so that everyone benefits and the change is reviewed.
- Treat recalled memories as background, not truth. A memory that names a file or function may be out of date; Claude should check that it still exists.

> NOTE: The details of auto memory can vary between Claude Code versions and can be switched off in settings. The principle is stable: shared knowledge goes in committed files; personal knowledge goes in personal memory.

## 5.10 Keeping memory short and current

Memory files decay. Folders get renamed, the M4 pull request merges, a rule that mattered last quarter no longer does. Stale memory is worse than none, because Claude follows it confidently.

Practical habits:

1. **Review `CLAUDE.md` in pull requests.** Changes to memory change how every session behaves.
2. **Date or own time-bound statements.** "Until M4 merges, ..." is better than an undated "currently".
3. **Prune regularly.** If you cannot say what would go wrong without a rule, delete it.
4. **Prefer pointers to copies.** Point at `docs/review-checklist.md` instead of pasting it.
5. **Fix the cause, not the symptom.** If Claude keeps getting something wrong, check whether a memory file is telling it to.
6. **Aim for a size you would read.** A project `CLAUDE.md` of one or two screens is usually right; this repository's is a good benchmark.

> TIP: The `/claude-api prompt-audit` skill can audit `CLAUDE.md`, rule files, commands and subagent definitions for dated or contradictory instructions and propose a diff. It is worth running every few months.

## Exercises

> EXERCISE: Run `/memory` in a session in `track-4-hospitality` and list every memory file that is loaded. Then open a file under `frontend/src` and check whether the frontend rules are now in effect.

> EXERCISE: Find one statement in the project `CLAUDE.md` that will become false in the next few months. Rewrite it so that it is clearly time-bound and owned.

> EXERCISE: Create a `CLAUDE.local.md` with a personal instruction (for example, "Explain your plan in three bullets before editing"). Confirm that git ignores it, or add it to `.gitignore`.

> EXERCISE: Write a new rule file, `.claude/rules/migrations.md`, scoped to `backend/db/migrations/**`, containing the migration rules currently spread across `CLAUDE.md` and `coding-conventions.md`. Decide whether this improves or harms clarity, and justify your answer.

> EXERCISE: In a scratch repository, run `/init` and compare the draft with this repository's `CLAUDE.md`. Which sections did `/init` produce, and which only a human could write?

## Key takeaways

- `CLAUDE.md` is the day-one briefing Claude receives at the start of every session.
- Memory layers: managed policy, user (`~/.claude/CLAUDE.md`), project (`CLAUDE.md`, `.claude/rules/`), local (`CLAUDE.local.md`) and nested folders.
- Nested `CLAUDE.md` files and path-scoped rules load when Claude works in those areas, keeping start-up context small.
- `@path` imports pull in other files; use them sparingly because they cost context.
- Include commands, non-obvious architecture, hard rules, conventions and known traps. Exclude secrets, generic advice, long specs and anything Claude can read from the code.
- Write rules that are specific and checkable, with a brief reason.
- `/init` drafts a starting file; `/memory` shows and edits what is loaded.
- Memory decays: review it in pull requests, own time-bound statements and prune regularly.
- Memory guides behaviour but does not enforce it; use permissions and hooks for hard guarantees.
