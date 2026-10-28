# Chapter 8: Subagents

A single Claude Code session is one conversation with one context window. Everything Claude reads, every command output and every file excerpt accumulates in that window. For small tasks this is ideal. For larger tasks, two problems appear: the window fills with material that is no longer relevant, and work that could happen in parallel happens one step at a time.

Subagents address both problems. A subagent is a separate Claude instance, started by the main conversation, with its own context window, its own instructions and, optionally, its own restricted set of tools and its own model. It does a piece of work and returns a summary. This chapter explains how subagents work, when to use them and when not to, and then walks through the six agents this repository defines and the pipeline that connects them.

## 8.1 What a subagent is

When the main conversation delegates a task, Claude Code starts a new agent with:

- **A fresh context.** The subagent does not see the main conversation. It knows only its own system prompt (from its definition file) and the brief it is given.
- **Its own tools.** A definition can limit which tools the subagent may use.
- **Its own model and effort.** A definition can pick a cheaper, faster model for routine work or a stronger one for review.
- **A single return value.** When it finishes, the subagent's final message is returned to the caller. Its intermediate tool calls and file reads stay in its own context and do not flood the main one.

> NOTE: The user does not see the subagent's final report directly. The main conversation reads it and relays what matters. That is why agents in this repository are told to finish with a structured report: files changed, build and test results, and anything unverified.

### Context isolation: the main benefit and the main cost

Isolation cuts both ways.

| Benefit | Cost |
|---|---|
| The main context stays small and focused | The subagent knows nothing you did not write in its brief |
| Large searches and file reads stay out of the main window | You see only its summary, not its working |
| Several subagents can run at once | Each one costs tokens, so several at once spend tokens quickly |
| A reviewer can read code without being anchored on your reasoning | Mistakes come back in the same confident tone as findings |

The single most important skill in using subagents is writing a good brief. A brief is the whole of the subagent's knowledge of the task.

## 8.2 Defining a subagent

Project subagents are Markdown files in `.claude/agents/`. Personal ones live in `~/.claude/agents/`. Each has YAML frontmatter followed by the system prompt.

```markdown
---
name: reviewer
description: Reviews a diff against docs/review-checklist.md and writes the findings to docs/review-report.md. Use after a change is implemented and before it is merged. Reports only; does not fix code.
model: claude-sonnet-5-5
effort: medium
tools: Read, Grep, Glob, Bash, Write
---

You review changes to Larchmont Hotels. You report; you do not fix.
```

| Field | Meaning |
|---|---|
| `name` | The identifier used to call the agent, for example `@reviewer` or by the main conversation. |
| `description` | When to use the agent. The main conversation reads this to decide whether to delegate, so phrase it like a skill description. |
| `tools` | A comma-separated allow-list. If omitted, the agent inherits the available tools. `Agent(backend, frontend)` restricts which agents it may spawn. |
| `model` | Which Claude model the agent uses. Omit to inherit the caller's model. |
| `effort` | How much reasoning effort the agent applies, where supported. |

The body is the agent's system prompt: its role, its scope, how to work and what to report.

> TIP: The `/agents` command in Claude Code provides an interactive way to create and edit agent definitions. Editing the files directly is equally valid and easier to review.

## 8.3 Built-in agents

Claude Code includes a few general agents that are always available. Names and details vary by version; the common ones are:

| Agent | Purpose |
|---|---|
| `general-purpose` | Multi-step research or tasks with access to all tools. A safe default when no specialised agent fits. |
| `Explore` | Read-only, fast searching across many files and naming conventions. Returns conclusions rather than file dumps. |
| `Plan` | Designs an implementation plan: critical files, steps and trade-offs. Does not edit files. |

`Explore` is particularly useful in this repository: `/plan` allows "up to two `Explore` subagents in one message" for a wide search of `backend/Larchmont.Api` and `frontend/src`.

## 8.4 When to delegate and when not to

Subagents are not free, and they are not always faster. A good rule is: delegate when the work is independent, large, or needs a fresh pair of eyes; do it yourself when it is a handful of tool calls.

| Delegate | Do it yourself |
|---|---|
| Independent work that can run in parallel (backend, frontend and tests) | A single file read or a targeted search for a known symbol |
| A wide search across many files where only the conclusion matters | A quick check you could run inline |
| A review that should not be anchored on your reasoning | Work whose details you need to see, not just a summary |
| A side task that should not block the main thread | Anything where you cannot write a clear brief |

> WARNING: Once a task is delegated, do not also do it yourself in the main conversation. You pay twice and may end up with two conflicting answers.

### Writing a brief

A useful brief states:

1. **The goal**, in one or two sentences.
2. **What is already known or ruled out**, so the agent does not repeat it.
3. **The files and documents to read**, by path, rather than retyping their contents.
4. **The scope**: which paths the agent may edit, and which it must not touch.
5. **The contract**: routes, DTO shapes, status codes, test names.
6. **The expected report**: what to return and in what form.

`/implement` step 5 encodes exactly this: "Write one self-contained brief per agent (they do not see this conversation): the goal, the relevant acceptance criteria, the API contract (routes, DTO shapes, status codes), the paths it owns, and the file to read."

## 8.5 Parallel agents

When the main conversation launches several agents in a single message, they run concurrently. Parallelism is only safe when the agents cannot interfere with each other. This repository achieves that through **disjoint file ownership**:

| Agent | Owns |
|---|---|
| `backend` | `backend/Larchmont.Api/**` and new `backend/db/migrations/V00N__*.sql` |
| `frontend` | `frontend/src/**` |
| `test-writer` | `backend/Larchmont.Tests/**` |

No two agents ever write the same file, so their edits cannot conflict. The contract that connects their work (routes and DTO shapes) is fixed in the briefs before they start, so the frontend can call an endpoint the backend is writing at the same moment.

## 8.6 Forks and worktree isolation

Two further techniques are worth knowing.

- **Forks.** Some versions of Claude Code can fork the current agent: the fork inherits the full conversation so far and then works on one directive in the background. A fork needs no brief because it already has the context; it is useful for a side task that relies on everything discussed so far. Like any subagent, its tool output stays out of the main context.
- **Worktree isolation.** An agent can be given its own Git worktree: a separate checkout of the repository on its own branch. Its edits cannot collide with the main working tree or with other agents. This is useful when ownership cannot be made disjoint, or when you want to try an experimental change that may be thrown away. An unchanged worktree is cleaned up automatically.

## 8.7 Subagents cannot spawn subagents

A subagent cannot start further subagents. Delegation is one level deep. This has a direct consequence for orchestration: an agent whose job is to coordinate other agents only works when it is the **main-thread agent**.

This repository's `planner` is exactly such a coordinator. Its description says it "Must be run as the main-thread agent (claude --agent planner), because subagents cannot spawn other subagents." Running `claude --agent planner` starts a session in which the planner's definition is the main agent, so it can spawn `backend`, `frontend`, `test-writer`, `reviewer` and `db-analyst`. If you instead call `@planner` from an ordinary session, it becomes a subagent and cannot fan out.

The `/plan` and `/implement` commands are the other solution: they put the planner's steps into slash commands that run in the main conversation, which can spawn agents.

| Way to orchestrate | How | Can spawn workers? |
|---|---|---|
| `claude --agent planner` | Planner is the main agent | Yes |
| `/plan` then `/implement` in a normal session | Steps run in the main conversation | Yes |
| `@planner` inside a normal session | Planner becomes a subagent | No |

## 8.8 Walk-through: this repository's agents

The six agents, as summarised in `docs/agent-map.md`:

| Agent | Model | Effort | Tools | Owns (writes) |
|---|---|---|---|---|
| planner | claude-sonnet-5-5 | default | Read, Grep, Glob, Agent(...) | nothing |
| backend | claude-haiku-5-5 | default | Read, Write, Edit, Bash, Grep, Glob | `backend/Larchmont.Api/**`, new migrations |
| frontend | claude-haiku-5-5 | default | Read, Write, Edit, Bash, Grep, Glob | `frontend/src/**` |
| test-writer | claude-haiku-5-5 | default | Read, Write, Edit, Bash, Grep, Glob | `backend/Larchmont.Tests/**` |
| reviewer | claude-sonnet-5-5 | medium | Read, Grep, Glob, Bash, Write | `docs/review-report.md` only |
| db-analyst | claude-sonnet-5-5 | medium | Read, Grep, Glob, Bash, Write | `docs/db-analysis.md` only |

Notice the model choices. The three implementation agents, which follow detailed conventions and are checked by builds and tests, use the cheaper Haiku model. The agents that need judgement, planning, review and database analysis, use Sonnet.

### planner

```markdown
tools: Read, Grep, Glob, Agent(backend, frontend, test-writer, reviewer, db-analyst)
```

The planner has no `Write`, `Edit` or `Bash`. It cannot change the repository at all; its only power is to read and to delegate to the five named agents. The prompt says: "You do not write code yourself" and "Only spawn the named agents, and give each a self-contained brief; they do not see this conversation." Its seven steps are understand, schema check, split by file ownership, fan out, collect, review and summarise.

### backend

The backend agent's scope is explicit: "Edit only files under `backend/Larchmont.Api/**` and new migration files in `backend/db/migrations/`. Do not touch `backend/Larchmont.Tests/**` (test-writer owns it) or `frontend/**`." Before starting it reads `CLAUDE.md` and `.claude/rules/coding-conventions.md`, and the prompt repeats the key conventions: Controller to Service to Repository to DbContext, FluentValidation, `BusinessRuleException`/`NotFoundException`, hand-written mappers and `DateOnly` for stay dates. After every batch of edits it runs `dotnet build`, and before reporting it runs `dotnet test` "and report[s] the result honestly".

### frontend

The frontend agent edits only `frontend/src/**` and reads `frontend/CLAUDE.md` first. It must use strict TypeScript with no `any`, handle loading, empty and error states through `StateView.tsx` with `useAsync`, and send all HTTP through `src/api/client.ts`. A sensible instruction for parallel work: "If you need an API that does not exist, say so in your report instead of working around it."

### test-writer

The test-writer edits only `backend/Larchmont.Tests/**` and "Never edit[s] production code to make a test pass." Its central rule is **fail first**: run each new test against the unfixed code, record the red output, and if the test passes on the old code, treat the test as wrong. It also carries the project's warning about the InMemory provider, which "cannot prove SQL translation, indexes, locking or concurrency", and requires a real MySQL 8.4 test or an EF Core SQL log assertion for such claims.

> NOTE: Fail-first and parallel fan-out are in tension: if `backend` finishes before `test-writer` has run its tests, the red run is no longer possible. `docs/agent-map.md` acknowledges this: "its red run must happen first; if the code has already changed, it says so." Honest reporting is the fallback when the ideal ordering cannot be guaranteed.

### reviewer

The reviewer "reports; you do not fix". It writes only `docs/review-report.md` and uses Bash only for read-only commands such as `git diff`, `dotnet test` and `npm run build`. It must work through every item of `docs/review-checklist.md`, marking each Pass, Fail or Not applicable with file and line evidence, and "Check claims, don't trust them: for 'tests pass' run them." Keeping the reviewer separate from the authors gives a read of the code that is not anchored on the reasoning that produced it.

### db-analyst

The db-analyst analyses migrations, `LarchmontDbContext.cs` and repository queries, and writes `docs/db-analysis.md`. It may run `SELECT`, `EXPLAIN`, `EXPLAIN ANALYZE` and `SHOW INDEX` against a local throwaway database but "Never run DDL or DML, and never point at a shared or production server." It proposes fixes as new `V00N__name.sql` files without applying them, and must say whether each plan was measured or only reasoned.

## 8.9 The plan, implement, review pipeline

`docs/agent-map.md` contains the orchestration graph:

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

In day-to-day use with slash commands the pipeline looks like this:

1. Run `/plan <feature>`. Claude reads the brief and code, optionally spawns `Explore` and `db-analyst`, and writes `FEATURE-<name>.md`.
2. A human reviews and edits the FEATURE file. This is the cheapest point at which to correct a misunderstanding.
3. Run `/implement FEATURE-<name>.md`. The main conversation checks the branch, writes briefs and spawns `backend`, `frontend` and `test-writer` in one message.
4. The main conversation reads their results, sends fix requests to the owning agent where something failed, and reruns the build and tests itself.
5. It spawns `reviewer`, which writes `docs/review-report.md`.
6. It summarises: files changed, real build and test status, Fail items and what is unverified.

> TIP: Step 4 matters. Subagent reports can be wrong. The main conversation rerunning `dotnet test` itself is what turns "the agent said it passed" into "it passed".

## 8.10 Design principles to copy

- **One job per agent.** Each agent has a single responsibility and a single output.
- **Least privilege.** Give each agent only the tools it needs. The planner cannot edit; the reviewer can write only its report.
- **Disjoint ownership.** Parallel agents never edit the same file.
- **Self-contained briefs.** Assume the agent knows nothing except what you give it.
- **Report, then verify.** Require structured reports and check the important claims yourself.
- **Right model for the job.** Use cheaper models for well-specified, test-checked work and stronger ones for judgement.

## Exercises

> EXERCISE: Read `.claude/agents/reviewer.md` and then run it on your current branch with `@reviewer`. Compare `docs/review-report.md` with `docs/review-checklist.md`. Did it mark every item?

> EXERCISE: Start `claude --agent planner` and give it a small feature. Then, in a normal session, invoke `@planner` with the same request. Observe and explain the difference in what each can do.

> EXERCISE: Write a brief for the `frontend` agent for a new read-only screen. Include goal, contract, owned paths, files to read and the expected report. Ask a colleague whether they could do the work from your brief alone.

> EXERCISE: Design a seventh agent, for example a documentation writer that owns only `docs/`. Write its frontmatter with the narrowest sensible `tools` list and a description that makes clear when to use it.

## Key takeaways

- A subagent is a separate Claude instance with its own context, tools and model; it returns only a final summary.
- Agents are defined in `.claude/agents/*.md` with `name`, `description`, `tools`, `model` and optionally `effort` frontmatter.
- Delegate independent, large or review work; do small lookups yourself. The brief is the agent's only knowledge of the task.
- Parallel agents need disjoint ownership; worktrees provide isolation when that is not possible.
- Subagents cannot spawn subagents, so coordinators such as `planner` must run as the main agent (`claude --agent planner`), or their steps must live in main-conversation commands such as `/plan` and `/implement`.
- Always verify important claims from subagent reports yourself.
