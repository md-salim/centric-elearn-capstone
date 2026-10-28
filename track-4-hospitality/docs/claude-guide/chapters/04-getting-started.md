# Chapter 4: Getting Started with Claude Code

Claude Code is Anthropic's agentic coding tool. Unlike a chat window where you paste code in and copy answers out, Claude Code works directly inside your repository: it reads files, searches the codebase, edits code, runs commands such as `dotnet test` or `npm run build`, and reports back. You stay in charge of what it is allowed to do, and you review what it has done.

This chapter takes you from installation to your first productive session on the Larchmont Hotels repository. By the end you should understand how a session works, which tools Claude uses, which commands and shortcuts matter day to day, and how to drive Claude Code from scripts.

## 4.1 What Claude Code is, and what it is not

It helps to fix a mental model before installing anything.

- Claude Code is an **agent**: given a goal, it decides which files to read, which commands to run and which edits to make, in a loop, until it believes the goal is met.
- It is **local-first**: it runs on your machine (or in a cloud sandbox if you use the web version), with your files and your shell.
- It is **permissioned**: by default it asks before editing files or running commands that have not been approved. You can loosen or tighten this (see Chapter 6).
- It is **context-driven**: what it knows about your project comes from what it reads in the session, plus memory files such as `CLAUDE.md` (see Chapter 5).

It is not a replacement for your judgement. It can be confidently wrong, it can misread a requirement, and it cannot know about a meeting decision that nobody wrote down. Treat it as a fast, capable colleague whose work you review.

> NOTE: Throughout this guide, "Claude" means the model and "Claude Code" means the tool that hosts it, gives it tools and enforces permissions.

## 4.2 Installing Claude Code

There are two common ways to install the command-line tool. Either gives you a `claude` command.

### The native installer

The native installer is the recommended route. It installs a self-contained binary and keeps itself up to date.

```bash
# macOS, Linux, WSL
curl -fsSL https://claude.ai/install.sh | bash
```

```powershell
# Windows PowerShell
irm https://claude.ai/install.ps1 | iex
```

On Windows, Claude Code uses Git Bash as its shell when it runs commands, so install Git for Windows first. This is why the Bash tool in this repository uses Unix syntax (`/dev/null`, forward slashes) even on Windows Server.

### Installing with npm

If your organisation standardises on Node tooling, you can install the npm package globally. You need Node.js 18 or later; this repository already requires Node 20+ for the frontend.

```bash
npm install -g @anthropic-ai/claude-code
```

> WARNING: Do not use `sudo npm install -g`. Permission problems with global npm installs are better fixed by configuring an npm prefix in your home directory, or by using the native installer.

### Checking the installation

```bash
claude --version
claude doctor
```

`claude doctor` checks the installation type, version and common configuration problems. Run it first whenever something seems off.

## 4.3 Authentication

The first time you run `claude`, it asks you to log in. The main options are:

| Option | Who it suits | Notes |
|---|---|---|
| Claude subscription (Pro, Max, Team, Enterprise) | Individuals and teams using claude.ai | Log in through the browser; usage counts against your plan |
| Claude Console account | Teams paying per API usage | Billed by tokens; administrators can set spend limits |
| Cloud provider (Amazon Bedrock, Google Vertex AI, Microsoft Foundry) | Organisations that route model traffic through their cloud | Configured with environment variables and cloud credentials |

You can switch account later with `/login` and sign out with `/logout`. Credentials are stored securely by the tool; you should never paste an API key into a prompt, a `CLAUDE.md` file or a committed settings file.

> TIP: If your team uses a shared organisation, ask your administrator which login method to use before you start. Mixing a personal subscription and an organisation account on a work repository causes confusion about who is paying and which policies apply.

## 4.4 Where you can use Claude Code

The same agent is available through several surfaces. They share the same underlying behaviour, memory files and settings, so skills you learn in one carry over.

| Surface | How you start it | Best for |
|---|---|---|
| Terminal (CLI) | `claude` in a project folder | Full control, scripting, any editor |
| VS Code extension | Install "Claude Code" from the marketplace; open the Claude panel | Seeing diffs inline, selecting code to give context |
| JetBrains plugin | Install from the JetBrains marketplace | IntelliJ, Rider (useful for this .NET backend), WebStorm |
| Desktop app | Claude desktop app for macOS and Windows | Running several sessions side by side |
| Web | claude.ai/code | Working on a GitHub repository in a cloud sandbox, from any machine |

The IDE integrations add a few conveniences: the current selection in your editor is shared with Claude as context, proposed edits can appear as diffs you accept or reject, and file references become clickable links. The terminal version remains the reference implementation, and every command in this chapter works there.

> NOTE: This guide was itself produced from a Claude Code session running inside the VS Code extension on this repository. File references in the extension are rendered as clickable links.

## 4.5 Your first session on this repository

Let us walk through a realistic first session on the Larchmont Hotels codebase.

### Step 1: Start in the right folder

Claude Code treats the folder you start in as the project root. It loads `CLAUDE.md` from there, reads `.claude/settings.json`, and scopes file access to that folder by default.

```bash
cd capstone-repo/centric-elearn-capstone/track-4-hospitality
claude
```

Starting in the track folder matters: the project `CLAUDE.md`, the `.claude/agents/` folder and the hooks all live here. Starting one level up would miss them.

### Step 2: Ask for orientation, not changes

A good first prompt asks Claude to read and explain, not to edit. This builds your own understanding and lets you check that Claude has understood the project.

```text
Give me a ten-line overview of this repository: what the system does,
how a request flows through the backend, and how I run the tests.
Don't change anything.
```

Claude will typically read `CLAUDE.md` (already in context), list the `backend/Larchmont.Api` folders, open a controller and its service, and answer. You will see each tool call it makes. Because it is only reading, you will not be asked for permission in the default mode.

### Step 3: Ask a focused question

```text
How does BookingService check for overlapping bookings?
Show me the relevant method and point out any edge cases you can see.
```

This is where Claude's search tools earn their keep: it will Grep for the class, Read the file and summarise. You can then follow up conversationally.

### Step 4: Make a small, verifiable change

```text
Add a FluentValidation rule so that a booking's check-out date must be
after its check-in date. Add an xUnit test named after the acceptance
criterion, then run dotnet test and show me the result.
```

Now Claude needs to edit files and run a command, so it will ask permission (unless already granted). Read each proposed diff. When it runs `dotnet test`, read the output yourself rather than trusting the summary.

### Step 5: Review and finish

Before you commit, ask Claude to show the full diff, or run `git diff` yourself. In this repository the `.claude/settings.json` hooks will already have built the backend after each C# edit (see Chapter 6), which gives you an early warning if something does not compile.

> EXERCISE: Start a session in the track folder and ask Claude to explain the purpose of each file in `.claude/hooks/`. Compare its answer with your own reading of the files.

## 4.6 The agentic loop

Every Claude Code session follows the same basic loop. Understanding it helps you write better prompts and spot when things are going wrong.

1. **Gather context**: Claude reads `CLAUDE.md`, your prompt and any files you mention, then searches and reads more as needed.
2. **Plan**: it decides on an approach. For larger tasks it may write a to-do list or, in plan mode, present a plan for approval.
3. **Act**: it edits files and runs commands using its tools.
4. **Verify**: it runs tests, builds or other checks, and reads the results.
5. **Iterate or report**: if verification fails, it goes back round the loop; otherwise it reports what it did.

You can intervene at any point. Pressing Esc interrupts Claude mid-step so that you can redirect it. You can also simply type a correction while it is working; the message is picked up at the next opportunity.

### Why verification is the step that matters

The loop is only as good as its verification step. If your project has fast, reliable tests and a build command, Claude can check its own work. If it does not, Claude is guessing. This is why the project `CLAUDE.md` ends with:

```text
- Keep changes small, and run `dotnet test` (and `npm run build` for
  frontend changes) before saying work is done.
```

It is also why the testing conventions warn that in-memory tests "cannot prove performance, indexes, SQL translation or concurrency". A passing test is evidence only for what the test actually exercises.

> TIP: When you give Claude a task, tell it how to verify it: "run `dotnet test`", "open the page and check the empty state", "compare the CSV output with `docs/sample-channel-export.csv`". Explicit success criteria produce noticeably better results.

## 4.7 Built-in tools

Claude does not act on your machine directly. It calls tools that Claude Code provides, and each call is subject to permissions. Knowing the tools helps you read a session transcript and write precise permission rules.

| Tool | What it does | Needs permission by default? |
|---|---|---|
| Read | Reads a file (text, images, PDFs, notebooks) | No |
| Glob | Finds files by pattern, e.g. `backend/**/*.cs` | No |
| Grep | Searches file contents with regular expressions | No |
| Edit | Makes an exact string replacement in a file | Yes |
| Write | Creates or overwrites a whole file | Yes |
| Bash | Runs a shell command | Yes (unless allowed) |
| WebFetch | Fetches a URL and summarises its content | Yes |
| WebSearch | Runs a web search | Yes |
| Agent | Launches a subagent with its own context for a sub-task | Depends on the subagent's tools |
| NotebookEdit | Edits cells in a Jupyter notebook | Yes |
| TodoWrite / task tools | Keeps a visible checklist of the steps in a task | No |

A few practical points:

- **Edit versus Write.** Edit changes a precise fragment and must match the existing text exactly, so it is safe and reviewable. Write replaces a whole file. Prefer Edit for existing files.
- **Read before edit.** Claude Code requires a file to have been read in the session before it can be edited, which prevents blind overwrites.
- **Grep and Glob are cheap.** Encourage Claude to search before it assumes. "Find every place that constructs a Booking" is better than "update the Booking constructor everywhere".
- **Bash is powerful and therefore the main risk.** Most permission rules, and this repository's `block-dangerous-bash.js` hook, focus on Bash.
- **MCP tools** appear alongside the built-in ones once you configure an MCP server; they are named like `mcp__server__tool` (see Chapter 9).

### Subagents through the Agent tool

The Agent tool lets Claude hand a sub-task to another instance with a fresh context window. The subagent does its work, perhaps reading dozens of files, and returns only a summary. This keeps the main conversation focused. This repository defines specialised subagents in `.claude/agents/` (backend, frontend, test-writer, reviewer, db-analyst, planner); Chapter 7 covers them in depth.

## 4.8 Slash commands

Typing `/` at the prompt opens the command menu. Built-in commands control the session; custom commands and skills (Chapter 7) extend it. These are the ones you will use most.

| Command | What it does |
|---|---|
| `/help` | Lists commands and basic usage |
| `/init` | Analyses the repository and drafts a `CLAUDE.md` |
| `/clear` | Clears the conversation and starts fresh in the same session |
| `/compact` | Summarises the conversation so far to free up context; accepts optional focus instructions |
| `/config` | Opens the settings interface (theme, model, behaviour options) |
| `/model` | Shows or switches the model for the session |
| `/memory` | Opens memory files such as `CLAUDE.md` for editing |
| `/agents` | Lists, creates and edits subagents |
| `/mcp` | Shows MCP server status and handles authentication |
| `/hooks` | Shows the configured hooks |
| `/permissions` | Views and edits allow, ask and deny rules |
| `/cost` | Shows token usage and cost for the session |
| `/resume` | Picks a previous conversation to continue |
| `/review` | Asks Claude to review a pull request or the current changes |
| `/login`, `/logout` | Switch or remove the signed-in account |
| `/doctor` | Checks the installation |

### `/clear` versus `/compact`

Both deal with a conversation that has grown too long, but they are different tools.

- Use `/clear` when you are switching to an unrelated task. Old context about a previous bug only distracts Claude from the new one.
- Use `/compact` when you are midway through one task and want to keep the important decisions. You can steer it: `/compact keep the decisions about the booking overlap rule and the failing test names`.

Claude Code also compacts automatically when the context window fills, so you rarely lose work, but a deliberate `/clear` between tasks is one of the simplest habits that improves results.

### Project commands in this repository

This repository adds its own commands in `.claude/commands/` and skills in `.claude/skills/`. For example, `/plan` writes a `FEATURE-<name>.md` plan without writing code, `/implement` dispatches the backend, frontend and test-writer agents and then the reviewer, and `/handoff` writes a session handoff note. Type `/` in a session to see them alongside the built-ins.

> EXERCISE: Run `/cost` after your first orientation prompt and again after asking Claude to read a large file. Note how reading files drives token usage.

## 4.9 Keyboard shortcuts and input tricks

A small number of shortcuts make a large difference.

| Shortcut | Effect |
|---|---|
| Esc | Interrupt Claude mid-response or mid-tool call; your conversation is kept |
| Esc, Esc (pressed twice) | Rewind: jump back to an earlier message to edit it or restore an earlier state |
| Shift+Tab | Cycle permission modes (normal, auto-accept edits, plan mode) |
| `@` followed by a path | Mention a file or folder so it is added to context, e.g. `@backend/Larchmont.Api/Program.cs` |
| `!` at the start of a line | Run a shell command directly and add its output to the conversation |
| Up arrow | Recall previous prompts |
| Ctrl+C | Cancel the current input; press again to exit |

### Mentioning files with `@`

`@` mentions are the quickest way to point Claude at the right place. Compare:

```text
Fix the validation bug in the booking stuff.
```

```text
@backend/Larchmont.Api/Validators/Validators.cs: `BookingRequestValidator` rejects
same-day bookings. It should allow check-out equal to check-in plus one day.
Fix it and add an AC_ test.
```

The second prompt removes a search step and, more importantly, removes ambiguity.

### Rewinding

Double Esc opens a list of earlier messages. Choosing one lets you continue from that point, and Claude Code can also restore the code to the state it was in at that message. This is useful when Claude has gone down the wrong path for several steps: rather than asking it to undo, rewind and rephrase. Treat rewind as a convenience, not a version-control system; commit or stash work you care about.

### Mode cycling with Shift+Tab

Shift+Tab cycles through permission modes. The status line under the prompt shows the current one. Plan mode is particularly useful at the start of a larger task: Claude researches and proposes a plan but cannot edit files until you approve. Chapter 6 explains each mode.

## 4.10 Command-line flags

`claude` accepts flags that control how a session starts. These are the ones worth memorising.

| Flag | Meaning | Example |
|---|---|---|
| `-p`, `--print` | Non-interactive: run one prompt, print the result, exit | `claude -p "summarise docs/bug-LH-56.md"` |
| `-c`, `--continue` | Continue the most recent conversation in this folder | `claude -c` |
| `-r`, `--resume` | Resume a specific conversation, by ID or from a picker | `claude -r` |
| `--model` | Choose the model for the session | `claude --model opus` |
| `--agent` | Run the session as a named subagent definition | `claude --agent planner` |
| `--permission-mode` | Start in a given permission mode | `claude --permission-mode plan` |
| `--add-dir` | Give Claude access to an extra directory | `claude --add-dir ../track-3-retail` |
| `--output-format` | With `-p`: `text`, `json` or `stream-json` | `claude -p "..." --output-format json` |
| `--allowedTools` | Pre-approve specific tools for this run | `claude -p "..." --allowedTools "Read,Grep"` |

### Running as the planner agent

This repository's `planner` subagent is a good example of why `--agent` exists. Its description says it "must be run as the main-thread agent (claude --agent planner), because subagents cannot spawn other subagents". Starting the whole session as the planner gives it the ability to dispatch the backend, frontend, test-writer and reviewer agents itself.

```bash
claude --agent planner
```

### Print mode for scripts and CI

Print mode turns Claude Code into a Unix-style command you can pipe into and out of.

```bash
# Summarise a failing CI log
cat docs/ci-failing-run.log | claude -p "What is the root cause of this failure? One paragraph."

# Machine-readable output for a script
claude -p "List the controllers in backend/Larchmont.Api/Controllers" --output-format json
```

In print mode there is no one to answer permission prompts, so anything not already allowed is refused. Pre-approve exactly the tools the task needs with `--allowedTools`, or configure permissions in settings. Avoid broad bypass flags in shared pipelines.

> WARNING: Piping untrusted content (a downloaded log, a user-submitted file) into Claude means that content can try to instruct Claude. Keep tools in print-mode jobs as narrow as the job allows.

## 4.11 Choosing a model

`/model` (or `--model`) selects the model. You can usually pick by alias, such as `opus`, `sonnet` or `haiku`, rather than a full model ID.

| Model family | Character | When to use it in Claude Code |
|---|---|---|
| Opus | Most capable mainstream model | Complex multi-file changes, design work, tricky debugging |
| Sonnet | Strong and faster, lower cost | Everyday coding, reviews, routine features |
| Haiku | Fastest and cheapest | Quick lookups, simple subagent work, high-volume scripted tasks |

Subagents can each specify their own model in their front matter, so a reading-heavy helper can run on a cheaper model while the main session uses a stronger one. Chapter 10 covers the current model line-up and pricing in more detail.

## 4.12 Good habits from day one

- **Start each task with a clean context.** `/clear` between unrelated tasks.
- **Ask before you act.** For anything bigger than a small fix, ask for a plan first, or use plan mode.
- **Give success criteria.** Name the test, the build command or the expected behaviour.
- **Point, do not describe.** Use `@` mentions and exact error messages.
- **Review every diff.** Approving edits without reading them is how bugs and secrets slip in.
- **Keep sessions small.** Several short, focused sessions beat one sprawling one.
- **Commit often.** Small commits make it easy to see, and undo, what Claude changed.

## Exercises

> EXERCISE: Install Claude Code using the native installer, run `claude doctor`, and record the installation type and version it reports.

> EXERCISE: Start a session in `track-4-hospitality` and ask Claude to trace one HTTP request (for example, creating a booking) from controller to database. Check its answer against the "Controller -> Service -> Repository -> DbContext" rule in `CLAUDE.md`.

> EXERCISE: Use print mode to summarise `docs/stakeholder-brief.md` into five bullet points. Then repeat with `--output-format json` and inspect the fields returned.

> EXERCISE: Switch to plan mode with Shift+Tab and ask Claude to plan adding a "cancelled" status to bookings. Do not approve the plan; instead, critique it. What did it miss?

> EXERCISE: Deliberately let Claude take a wrong turn, then use Esc Esc to rewind and rephrase your prompt. Compare the two outcomes.

## Key takeaways

- Claude Code is an agent that reads, edits and runs commands in your repository, within permissions you control.
- Install it with the native installer (or npm), authenticate with a subscription, Console account or cloud provider, and check with `claude doctor`.
- The same agent runs in the terminal, IDEs, desktop app and web; the terminal is the reference.
- Every session is a loop of gather, plan, act and verify. Good verification commands make Claude far more reliable.
- Read, Glob and Grep explore; Edit and Write change files; Bash runs commands and is the main risk; Agent delegates.
- Learn `/clear`, `/compact`, `/model`, `/permissions`, `/cost` and `/resume`, plus Esc, Esc Esc, Shift+Tab and `@`.
- `-p` makes Claude scriptable; `-c` and `-r` continue past work; `--agent` runs a session as a named subagent.
