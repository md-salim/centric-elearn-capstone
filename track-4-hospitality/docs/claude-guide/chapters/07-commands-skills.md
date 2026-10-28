# Chapter 7: Slash Commands and Skills

Every team that uses Claude Code for more than a week discovers that it keeps typing the same long prompts. "Read the spec, list the acceptance criteria, check the branch, then plan the backend, frontend and test work separately." Typing that once is fine. Typing it every morning, slightly differently each time, produces slightly different results each time. Slash commands and skills are the two mechanisms Claude Code gives you to capture a prompt once, store it in the repository, and reuse it consistently.

This chapter explains how each mechanism works, how they differ from each other and from `CLAUDE.md`, and then walks through every command and skill that ships in this repository so that you can see the ideas applied to a real project.

## 7.1 Why package prompts at all?

There are four practical reasons to turn a prompt into a command or a skill.

- **Consistency.** A stored prompt produces the same procedure every time, whoever runs it. New team members get the same quality of result as the person who wrote the prompt.
- **Review.** Because the files live in `.claude/`, they are committed, diffed and reviewed like code. A bad instruction can be spotted in a pull request rather than discovered in a broken session.
- **Brevity.** `/plan housekeeping-board` is quicker to type than three paragraphs, and it leaves less room for forgetting a step.
- **Context economy.** Skills in particular let you keep long, specialised instructions out of the context window until they are actually needed.

> NOTE: Neither commands nor skills give Claude new abilities. They are text. Their power comes from writing that text carefully, keeping it in version control, and loading it at the right moment.

## 7.2 Custom slash commands

### Where they live

A custom slash command is a Markdown file. Claude Code looks for them in two places:

| Location | Scope | Typical use |
|---|---|---|
| `.claude/commands/` in the project | Everyone who clones the repository | Team workflows such as `/plan` and `/implement` |
| `~/.claude/commands/` in your home directory | Only you, in every project | Personal habits, such as a favourite commit-message routine |

The file name becomes the command name. `.claude/commands/plan.md` is invoked as `/plan`. Subdirectories can be used to group commands, which helps once a project has many of them.

### Anatomy of a command file

A command file has optional YAML frontmatter followed by the prompt body. When you run the command, the body is sent to Claude as if you had typed it, with any arguments substituted in.

```markdown
---
description: Plan a feature and write FEATURE-<name>.md (no code is written)
argument-hint: <feature name or short description>
allowed-tools: Read, Grep, Glob, Write
---

Plan this feature: **$ARGUMENTS**

If no feature was given, ask for one and stop.
```

The common frontmatter fields are:

| Field | Purpose |
|---|---|
| `description` | Shown in the `/` menu so people know what the command does. Also helps Claude understand it. |
| `argument-hint` | A hint shown after the command name while typing, such as `<feature name>`. |
| `allowed-tools` | Tools the command may use without asking for permission each time. Supports patterns such as `Bash(git status --short)` or `Bash(date:*)`. |
| `model` | Optionally run the command on a particular model. |

### Arguments

Two forms of argument substitution are available.

- `$ARGUMENTS` is replaced by everything typed after the command name. `/plan room out-of-order flag` puts `room out-of-order flag` wherever `$ARGUMENTS` appears.
- `$1`, `$2` and so on are replaced by individual positional arguments, split on spaces. Use these when a command takes several distinct inputs, for example `/compare $1 $2`.

> TIP: Always write what the command should do when the argument is missing. Every command in this repository begins with a guard such as "If no feature was given, ask for one and stop." Without it, Claude will guess, and the guess may be expensive.

### Restricting tools

`allowed-tools` is one of the most useful and least used fields. A command that should only plan, never edit code, can be limited to reading tools plus a single `Write`. That makes the intent visible in the file and reduces the number of permission prompts for the safe operations the command needs. Precise Bash patterns are better than broad ones: `Bash(git status --short)` permits exactly that command, whereas `Bash` permits anything.

## 7.3 Skills

### What a skill is

A skill is a folder containing a `SKILL.md` file and, optionally, supporting files such as scripts, templates or reference documents. Project skills live in `.claude/skills/<name>/SKILL.md`; personal skills live in `~/.claude/skills/<name>/SKILL.md`.

```markdown
---
name: prompt-journal
description: Append a structured entry (timestamp, prompt, tools used, outcome) to docs/prompt-journal.md. Use when the user asks to journal or log a prompt, or after a prompt that gave a notable result, surprise or failure worth recording.
---

# Prompt journal
...instructions...
```

The two frontmatter fields that matter most are `name` and `description`. The name is the identifier. The description is far more important than it looks, because it is what Claude reads to decide whether the skill is relevant.

### Progressive disclosure

The key design idea behind skills is progressive disclosure. At the start of a session, Claude sees only the name and description of each available skill, which costs a handful of tokens each. The full body of `SKILL.md` is loaded only when the skill is invoked. Supporting files are read only if the instructions in `SKILL.md` point to them and the task requires them.

This means you can have many skills, each with long and detailed instructions, without paying for all of that text in every conversation. Compare this with `CLAUDE.md`, which is loaded in full every session.

| Layer | When it enters context | Cost |
|---|---|---|
| Name and description | Every session | Very small |
| `SKILL.md` body | When the skill is invoked | Moderate |
| Supporting files | Only if read during the task | Only when needed |

### How a skill gets invoked

There are two routes.

1. **By Claude, automatically.** When a request matches a skill's description, Claude may load and follow the skill. This is why descriptions should say both what the skill does and when to use it, in words a user would actually type.
2. **By the user, explicitly.** Typing `/skill-name` invokes the skill directly, and a slash command can tell Claude to use a skill, as this repository's `/handoff` does.

> WARNING: A vague description such as "Helps with docs" will either never trigger or trigger at the wrong moment. Write descriptions like the ones in this repository: a concrete action, a concrete output path, and a "Use when..." clause.

### Supporting files

Because a skill is a folder, it can carry code. The `session-handoff` skill in this repository contains `write-handoff.sh` and `write-handoff.js` alongside `SKILL.md`. Scripts are useful for anything that must be deterministic, such as parsing a transcript or formatting a date, where you do not want the model improvising each time.

## 7.4 Commands, skills or CLAUDE.md?

All three are ways of giving Claude instructions. The difference is when the instructions are loaded and who decides.

| Mechanism | Loaded | Triggered by | Best for |
|---|---|---|---|
| `CLAUDE.md` | Every session, in full | Always | Facts and rules that apply to all work: stack, commands, layering rules |
| `.claude/rules/*.md` referenced from `CLAUDE.md` | When referenced and read | Claude following `CLAUDE.md` | Longer conventions kept out of the main file |
| Slash command | When typed | The user | Explicit, repeatable workflows with arguments |
| Skill | Description always; body on use | Claude or the user | Specialised procedures that should be found automatically |
| Hook (Chapter 9) | On an event | The harness | Things that must happen every time, regardless of the model |

A useful rule of thumb from this repository's `/reflect` command: "Hooks are for things that must happen every time; skills and commands are for things done on request."

> TIP: If you find yourself adding a long procedure to `CLAUDE.md` that is only relevant to one kind of task, move it into a skill. `CLAUDE.md` should stay short because every line in it is paid for in every session.

## 7.5 Bundled skills and commands

Claude Code ships with a number of built-in skills and commands. The exact list changes between versions, so check the `/` menu in your installation. The ones most relevant to this project are:

| Command | What it does |
|---|---|
| `/init` | Scans the codebase and writes a starter `CLAUDE.md`. Use once, then edit by hand. |
| `/code-review` | Reviews the current diff, a branch or a pull request for correctness bugs at a chosen effort level. |
| `/simplify` | Looks at changed code for reuse, simplification and efficiency improvements and applies them. It does not hunt for bugs. |
| `/security-review` | Performs a security review of the pending changes on the current branch. |
| `/loop` | Runs a prompt or command repeatedly on an interval, for example polling a CI run. |

Built-in commands that are not skills, such as `/help`, `/clear`, `/compact` and `/config`, control the session itself rather than sending a prompt.

## 7.6 Plugins, briefly

When a set of commands, skills, agents and hooks proves useful in several repositories, copying the `.claude/` folder around becomes tedious. Plugins package these pieces together so they can be installed from a marketplace and updated in one place. For a single capstone project the plain `.claude/` folder is simpler and more transparent; consider a plugin only when the same tooling is shared across many projects.

## 7.7 Walk-through: this repository's commands

This repository has four project commands in `.claude/commands/`. Together they form a small workflow: plan a feature, implement it, record what happened, and reflect on the session.

### /plan

```markdown
---
description: Plan a feature and write FEATURE-<name>.md (no code is written)
argument-hint: <feature name or short description>
allowed-tools: Read, Grep, Glob, Write, Agent, Bash(git config user.name), Bash(git branch --show-current), Bash(git status --short)
---
```

Points worth noticing:

- The `allowed-tools` list contains reading tools, `Write` (for the single FEATURE file), `Agent` (to spawn `Explore` and `db-analyst`), and three exact Git commands. It cannot run `dotnet` or edit files with `Edit`. The tool list enforces the promise in the description that no code is written.
- The body says it "follows the steps of the `planner` agent" but "runs here in the main conversation because subagents cannot spawn other subagents". This is a deliberate workaround, explained in Chapter 8.
- Step 4 specifies the exact sections of `FEATURE-<kebab-name>.md`, including **Plan by area** with disjoint file ownership. The structure of the output is part of the prompt, which is why the plans come out consistent.
- It ends with a hand-off to the next command: "Tell the user to review the file and then run `/implement FEATURE-<name>.md`." Commands that point to the next step make a workflow self-documenting.

### /implement

```markdown
---
description: Implement a FEATURE or BUG file by dispatching the backend, frontend and test-writer agents, then the reviewer
argument-hint: <path to FEATURE-*.md or docs/bug-*.md>
---

Implement the plan in: **$ARGUMENTS**
```

This command has no `allowed-tools` restriction, because it genuinely needs to run builds and tests. Instead, its safety comes from the procedure:

- Step 1 refuses to continue without a valid file.
- Step 3 checks `git branch --show-current` and stops if the user is on `main`.
- Step 5 requires "one self-contained brief per agent (they do not see this conversation)", with disjoint ownership of paths.
- Step 6 spawns the agents "in a single message so they run in parallel".
- Step 8 has the main conversation re-run `dotnet build`, `dotnet test` and `npm run build` itself and "report the real output", rather than trusting the agents' summaries.
- Step 10 requires stating what is unverified, mirroring the `CLAUDE.md` rule that in-memory tests cannot prove performance or concurrency.

### /handoff

```markdown
---
description: Write a session handoff note to docs/session-logs/ using the session-handoff skill
---

Invoke the `session-handoff` skill (Skill tool, name `session-handoff`) and follow it exactly...
```

This is the smallest command and a good pattern to copy: a command that does nothing except invoke a skill. The command gives users a short, memorable entry point; the skill holds the detailed procedure and can also be triggered automatically when someone says "let's wrap up".

### /reflect

`/reflect` asks Claude to reread the conversation, find steps that were done by hand two or more times, and propose automation in `docs/reflection-<date>.md`. Its `allowed-tools` includes `Bash(date:*)` so it can get a real date, and `Bash(ls:*)` to inspect existing `.claude` folders. The instruction "Propose only; do not create the skills, commands or hooks" keeps it from changing the project's tooling unasked. The embedded Markdown template, with a table of repeated steps and a section headed "Not worth automating", is a reusable idea in its own right.

## 7.8 Walk-through: this repository's skills

### prompt-journal

The description says what it writes and when: "Append a structured entry ... to docs/prompt-journal.md. Use when the user asks to journal or log a prompt, or after a prompt that gave a notable result, surprise or failure worth recording."

Three instructions show good skill-writing habits:

- "Get the real time with the Bash tool ... Never invent a timestamp." Models cannot know the current time reliably, so the skill delegates it to a tool.
- "Collect the facts from this conversation, not from memory of what you meant to do." This guards against the model describing its intentions instead of its actions.
- "Be honest. A failed or wasted prompt is a valid and useful entry." Without this, journals drift towards reporting everything as a success.

The skill also explains how it relates to a hook: the `UserPromptSubmit` hook logs every prompt automatically as `[auto]`, and the skill adds richer `[manual]` entries. Automatic capture and thoughtful annotation are split between the mechanism that is good at each.

### session-handoff

This skill writes `docs/session-logs/YYYY-MM-DD-<slug>.md` with goal, key decisions, files touched, open questions and follow-ups. Notable features:

- **Verification against Git.** "Confirm with `git status --short` and `git diff --stat` ... Do not claim a file was changed if git shows it was not."
- **Non-overwriting.** If the file exists, add `-2`, `-3` and so on.
- **A size limit.** "Keep it under about 60 lines. Link to FEATURE-*.md, BUG files and docs instead of copying them."
- **Supporting scripts.** `write-handoff.sh` and `write-handoff.js` live in the same folder and are run by a `Stop` hook to write a mechanical note. The skill explicitly says not to edit or delete that auto file.

### spec-writer

The largest skill turns `docs/stakeholder-brief.md` into a spec at `docs/specs/<feature>.md` using `docs/specs/_template.md`. Its most instructive section is "Problems in the brief to surface", which lists seven known contradictions or gaps, such as the conflict between mandatory supervisor inspection and housekeepers marking rooms Ready themselves, and the request to track staff location at all times. For each it tells Claude to record an open question rather than resolve it.

> NOTE: The staff-location item shows a skill encoding a legal and ethical boundary: it is to be recorded as "out of scope pending HR and legal advice" with no rules, API or UI written for it. Skills are a good place to make such boundaries explicit and repeatable.

## 7.9 Writing your own: a worked example

Suppose the team repeatedly asks Claude to check a migration before it is merged. A command for it might look like this:

```markdown
---
description: Check a new DbUp migration against the EF model before merging
argument-hint: <path to backend/db/migrations/V00N__name.sql>
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*)
---

Check the migration: **$ARGUMENTS**

1. If no path was given, list the newest files in backend/db/migrations and stop.
2. Confirm with git log that no earlier migration file was modified. Applied migrations must never be edited.
3. Read the migration and backend/Larchmont.Api/Data/LarchmontDbContext.cs.
4. For every table and column, compare type, length, nullability and indexes with the EF model.
5. Report each mismatch with file and line. Do not edit any file.
```

If the same check should also happen whenever someone simply says "is this migration OK?", it would be better as a skill in `.claude/skills/migration-check/SKILL.md` with a description such as "Compare a new DbUp migration with the EF Core model and report mismatches. Use when the user asks whether a migration is correct or ready to merge."

## 7.10 Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| No guard for a missing argument | Claude guesses what you meant | Start with "If no X was given, ask and stop" |
| Vague skill description | Skill never triggers, or triggers wrongly | Name the action, the output and "Use when..." |
| Everything put in `CLAUDE.md` | Every session pays for rarely used text | Move task-specific procedures into skills |
| Broad `allowed-tools: Bash` | The command can run anything without asking | List exact commands or prefixes |
| Command claims success without checking | False reports | Require real command output in the report |
| Duplicated instructions in a command and a skill | They drift apart | Have the command invoke the skill |

## Exercises

> EXERCISE: Run `/plan` with a small feature from `docs/stakeholder-brief.md`. Compare the generated FEATURE file with the section list in `.claude/commands/plan.md`. Which instructions did Claude follow exactly, and which did it interpret?

> EXERCISE: Rewrite the description of `prompt-journal` to be deliberately vague, start a new session, and ask Claude to "log that last prompt". Does the skill still trigger? Restore the original afterwards.

> EXERCISE: Write the migration-check command from section 7.9 in your personal `~/.claude/commands/` folder and try it on an existing migration. Then decide whether it belongs in the team's `.claude/commands/` instead.

> EXERCISE: Identify one procedure in `CLAUDE.md` or `.claude/rules/` that is only relevant to certain tasks, and sketch a skill that could replace it.

## Key takeaways

- Slash commands are stored prompts in `.claude/commands/`, invoked by the user, with `$ARGUMENTS` and `$1` substitution and optional `description`, `argument-hint` and `allowed-tools` frontmatter.
- Skills are folders in `.claude/skills/<name>/` with a `SKILL.md`; only their name and description are loaded until they are used, which is called progressive disclosure.
- A skill's description decides whether Claude finds it. Write it as an action plus "Use when...".
- `CLAUDE.md` is for always-true rules, commands and skills are for on-request procedures, and hooks are for things that must happen every time.
- This repository's `/plan`, `/implement`, `/handoff` and `/reflect` form a workflow, and its skills show good habits: real timestamps, verification against Git, honest outcomes and explicit boundaries.
