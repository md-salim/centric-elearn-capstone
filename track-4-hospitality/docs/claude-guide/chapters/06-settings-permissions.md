# Chapter 6: Settings, Permissions and Safety

An agent that can edit files and run shell commands is enormously useful, and for the same reason it needs guard rails. Claude Code's guard rails are configured through settings files: who may change what, which commands run without asking, which files are off-limits, and which scripts (hooks) run automatically around Claude's actions.

This chapter covers the settings scopes and how they combine, the permission rule syntax, the permission modes including plan mode, sandboxing and environment variables, and then walks through this repository's real `.claude/settings.json`. It closes with secrets hygiene and a practical security checklist.

## 6.1 Settings files and their scopes

Settings are JSON files. There are several scopes, from organisation-wide down to "just me, just this project".

| Scope | Location | Who it affects | Committed to git? |
|---|---|---|---|
| Managed (enterprise) | A system-level `managed-settings.json` deployed by IT, or server-managed policy | Every user on the machine or in the organisation | No (deployed by administrators) |
| User | `~/.claude/settings.json` | You, in every project | No |
| Project | `.claude/settings.json` in the repository | Everyone working on the project | Yes |
| Local project | `.claude/settings.local.json` in the repository | You, in this project only | No (should be git-ignored) |

Command-line flags such as `--permission-mode` or `--allowedTools` apply to a single session on top of these.

### Precedence

When the same setting appears in more than one place, the more specific and more authoritative source wins. In order, from highest to lowest:

1. Managed settings (cannot be overridden by users)
2. Command-line arguments
3. Local project settings (`.claude/settings.local.json`)
4. Project settings (`.claude/settings.json`)
5. User settings (`~/.claude/settings.json`)

Permission rules behave slightly differently from simple values: rules from the different scopes are combined, and a **deny** rule takes priority over an **ask** or **allow** rule for the same action. This means an organisation or project can forbid something and no individual allow rule will reopen it.

> TIP: Put team-wide rules in `.claude/settings.json` and review them like code. Put personal conveniences (for example, allowing a command only you run) in `.claude/settings.local.json`.

### What can go in settings

Settings files hold more than permissions. Common keys include:

| Key | Purpose |
|---|---|
| `permissions` | `allow`, `ask` and `deny` rule lists, `defaultMode`, `additionalDirectories` |
| `hooks` | Commands that run on events such as `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` |
| `env` | Environment variables applied to every session |
| `model` | Default model |
| `statusLine` | A custom status line command |
| `enabledMcpjsonServers` and related keys | Which project MCP servers to trust |
| `sandbox` | Sandboxing options for Bash |

You rarely need to edit JSON by hand: `/config` covers general settings, `/permissions` manages rules, `/hooks` shows hooks, and the `update-config` skill can make settings changes on request.

## 6.2 Permission rules

Permission rules decide what happens when Claude wants to use a tool. Each rule names a tool, optionally with a specifier in parentheses.

```json
{
  "permissions": {
    "allow": [
      "Bash(dotnet build:*)",
      "Bash(dotnet test:*)",
      "Bash(npm run build)",
      "Bash(git status)",
      "Bash(git diff:*)"
    ],
    "ask": [
      "Bash(git push:*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Bash(curl:*)",
      "WebFetch"
    ]
  }
}
```

### The three lists

| List | Effect |
|---|---|
| `allow` | The action runs without asking |
| `ask` | Claude Code always asks, even if a broader rule would allow it |
| `deny` | The action is refused; Claude is told it is not permitted |

Anything not matched falls back to the tool's default behaviour in the current permission mode: read-only tools such as Read, Glob and Grep generally run, while Edit, Write, Bash and web tools ask.

### Rule syntax by tool

| Pattern | Meaning |
|---|---|
| `Bash` | Every Bash command (use with great care) |
| `Bash(npm run build)` | Exactly this command |
| `Bash(npm run test:*)` | Commands starting with `npm run test`, for example `npm run test -- --watch` |
| `Read(./.env)` | Reading the `.env` file in the project root |
| `Read(./secrets/**)` | Reading anything under `secrets/` |
| `Edit(docs/**)` | Editing files under `docs/` |
| `WebFetch(domain:learn.microsoft.com)` | Fetching pages from that domain |
| `mcp__larchmont` | Every tool from the `larchmont` MCP server |
| `mcp__larchmont__run_select` | One specific MCP tool |

Path patterns for Read and Edit follow gitignore-style matching. Paths starting `./` or with no prefix are relative to the project; `~/` refers to your home directory; and a leading `//` denotes an absolute path.

### How Bash prefix rules work

`Bash(dotnet test:*)` is a **prefix** match. Claude Code is aware of shell operators, so an allow rule for `dotnet test:*` does not automatically allow `dotnet test && rm something`; the second command must also be allowed. Even so, prefix rules have limits:

- `Bash(git:*)` allows `git push --force` as well as `git status`. Be specific.
- Commands can be wrapped (`bash -c "..."`, a script file, `npx`), which no prefix rule can see inside.
- Deny rules on Bash are a useful backstop, not a sandbox. For example, a rule denying `curl` does not stop `wget` or a small Python script.

> WARNING: Never add a bare `Bash` allow rule to a shared settings file. It is equivalent to letting Claude run anything without asking.

### When you approve a prompt

When Claude Code asks permission, you can usually approve once or approve and remember. "Remember" writes a rule to your local settings, so the decision persists for that project. Review these accumulated rules occasionally with `/permissions`; it is easy to approve something broader than you intended.

### Reducing prompts sensibly

Too many permission prompts lead to "approval fatigue", where people click yes without reading. The answer is not to allow everything, but to allow the safe, repetitive things. The `/fewer-permission-prompts` skill scans your recent sessions for common read-only Bash and MCP calls (such as `git status`, `git log`, `dotnet build`) and proposes a prioritised allowlist for `.claude/settings.json`. Read its proposal before accepting it.

## 6.3 Permission modes

A permission mode sets the overall posture for a session. Cycle through the common ones with Shift+Tab, start in one with `--permission-mode`, or set a default with `permissions.defaultMode` in settings.

| Mode | Behaviour | When to use it |
|---|---|---|
| `default` | Asks before edits and non-allowed commands | Normal work; learning a new codebase |
| `acceptEdits` | Accepts file edits automatically; still asks for other actions such as non-allowed commands | Trusted, well-scoped tasks where you will review the diff afterwards |
| `plan` | Read-only research; Claude proposes a plan and cannot edit or run modifying commands until you approve | Start of any larger or riskier task |
| `auto` | Claude Code decides automatically which actions are safe to run without asking, and blocks or asks about riskier ones | Longer autonomous work where you accept some model-driven judgement |
| `bypassPermissions` | Skips permission prompts entirely | Only inside isolated, disposable environments such as a container with no secrets |

### Plan mode in practice

Plan mode is the single most useful mode for larger changes. A typical flow on this repository:

1. Press Shift+Tab until the status line shows plan mode, or start with `claude --permission-mode plan`.
2. Describe the feature: "Add a cancellation endpoint for bookings, with a new status and an audit note."
3. Claude reads the controllers, services, migrations and specs, then presents a plan: files to change, a new migration `V00N__...sql`, validators, tests.
4. You challenge the plan: "Use a `BusinessRuleException` for cancelling a checked-out booking, per the conventions."
5. When you are satisfied, approve the plan and choose how to proceed (for example, with edits auto-accepted or still prompting).

Because nothing changes during planning, plan mode is also safe for exploring unfamiliar code.

> NOTE: This repository's `/plan` command is a separate, project-defined workflow that writes a `FEATURE-<name>.md` file without writing code. Built-in plan mode and the `/plan` command complement each other.

### `bypassPermissions` and its risks

Bypassing permissions removes the human checkpoint. If Claude misreads a task, or if a file it reads contains a prompt injection, nothing stops a destructive command. Only use it where the blast radius is contained: a throwaway container or VM, no production credentials, no access to your home directory, ideally no network. Organisations can disable this mode entirely through managed settings.

## 6.4 Sandboxing

Permission rules decide whether a command may run; sandboxing restricts what a running command can reach. Claude Code can run Bash commands in an operating-system-level sandbox that limits file-system writes to the project area and controls network access, so that even an allowed command cannot, for example, write to your SSH keys or send data to an arbitrary host.

Key ideas:

- With sandboxing enabled, many commands can run without a prompt because their effects are contained.
- Commands that genuinely need to go outside the sandbox (for instance, to reach a service on a host that is not allowed) require explicit approval to run unsandboxed.
- Support and configuration vary by operating system; check the current documentation for your platform before relying on it.

Even without the built-in sandbox, you can get strong isolation by running Claude Code inside a development container or a disposable VM. The web version of Claude Code runs every session in a cloud sandbox for this reason.

## 6.5 Environment variables

Environment variables configure Claude Code itself and the commands it runs. You can set them in your shell or in the `env` key of a settings file.

```json
{
  "env": {
    "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
    "ASPNETCORE_ENVIRONMENT": "Development"
  }
}
```

Some variables are read by Claude Code, for example to select a cloud provider (Bedrock, Vertex AI or Foundry), configure a proxy or control telemetry. Hooks receive variables such as `CLAUDE_PROJECT_DIR`, which this repository uses to locate its hook scripts reliably.

> WARNING: Do not put secrets in the `env` block of `.claude/settings.json`; that file is committed. If a variable must hold a secret, set it in your shell, a secret manager, or `.claude/settings.local.json`, and make sure the local file is git-ignored.

The project `CLAUDE.md` follows this pattern for the database: "Other host/port: set env var `ConnectionStrings__Larchmont`". The connection string, with its password, lives in the environment, never in a committed file.

## 6.6 Walk-through: this repository's `.claude/settings.json`

This repository's project settings contain no permission rules at all. Instead they define four hooks. Hooks are covered fully in Chapter 8; here we look at how they act as safety and quality controls.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/block-dangerous-bash.js\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/build-on-cs-edit.js\"",
            "timeout": 180
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/noop.js\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/log-prompt.js\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/skills/session-handoff/write-handoff.sh\""
          }
        ]
      }
    ]
  }
}
```

### `PreToolUse` on Bash: the dangerous-command guard

Before every Bash command, `block-dangerous-bash.js` reads the proposed command from standard input and decides whether to block it. Its header comment explains its scope honestly:

```javascript
// PreToolUse(Bash): block `rm -rf` (any flag order/form) and any command touching .env files.
// Exit 2 = block and show stderr to Claude. Any internal error fails open (exit 1).
// Guardrail only: indirection such as `bash -c "$cmd"` or a script file can bypass these checks.
```

It blocks two things:

- Recursive forced deletion, whatever the flag order (`rm -rf`, `rm -fr`, `rm -r -f`, `rm --recursive --force`).
- Any command that touches a `.env` file, while still allowing `.env.example`, `.env.sample` and `.env.template`.

When it blocks, it exits with code 2 and writes a message such as "Blocked: `rm -rf` is not allowed in this project. Delete specific files, or ask the user to do it." Exit code 2 tells Claude Code to stop the tool call and show the message to Claude, which then adjusts its approach.

Two design decisions are worth copying:

1. **It fails open.** If the hook itself crashes, it exits with code 1, which does not block the command. A broken guard should not halt all work. (For a stricter environment you might choose to fail closed instead.)
2. **It is honest about its limits.** The comment states that indirection can bypass it. This is a guard rail against accidents, not a security boundary.

### `PostToolUse` on Edit and Write: build after C# edits

After every Edit or Write, `build-on-cs-edit.js` checks whether the file was a `.cs` file under `backend/Larchmont.Api`. If so, it builds the solution. On failure it prints the error lines and exits with code 2 so that Claude sees them; the edit itself is kept. The 180-second `timeout` allows for a cold build.

This turns "run the build before you say it is done" from a request in `CLAUDE.md` into something that happens automatically after each change. Claude learns about a compile error immediately rather than three edits later.

The second hook in the same group, `noop.js`, deliberately does nothing. Its comment explains that it exists so that editing `CLAUDE.md` can never start a hook loop, and that it drains standard input so that Claude Code never sees a broken pipe.

### `UserPromptSubmit`: the prompt journal

`log-prompt.js` appends each prompt you submit to `docs/prompt-journal.md` as an `[auto]` entry. Because that journal is committed, the script truncates long prompts (to 1,500 characters) and redacts obvious secrets, and it never blocks the prompt. This supports the capstone's requirement to record how the team worked with Claude. It also explains why `docs/prompt-journal.md` frequently shows as modified in `git status`.

### `Stop`: the session handoff

When Claude finishes responding, the `Stop` hook runs `write-handoff.sh` from the session-handoff skill, which writes mechanical session notes. The repository's `.gitignore` notes that these are "rewritten every turn", so they are not intended to be committed.

### What this settings file does not do

It is just as instructive to notice what is absent:

- There are no `allow` rules, so every edit and non-trivial command still prompts in default mode. That is reasonable for a learning project, but a team might add a short allowlist for `dotnet build`, `dotnet test` and `npm run build`.
- There are no `deny` rules. The `.env` protection is implemented in a hook for Bash, but a `Read(./.env)` deny rule would also stop the Read tool from opening the file directly. Hooks and permission rules complement each other.

A possible addition, shown here for discussion rather than as a change to make:

```json
{
  "permissions": {
    "allow": [
      "Bash(dotnet build:*)",
      "Bash(dotnet test:*)",
      "Bash(npm run build)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Edit(backend/db/migrations/V001__*.sql)"
    ]
  }
}
```

The last deny rule illustrates a neat idea: enforcing "never edit an applied migration" mechanically, by denying edits to migration files known to be applied. You would need to update the list as migrations are applied.

## 6.7 Secrets hygiene

Secrets leak in predictable ways. Knowing them is most of the defence.

| Leak route | How it happens | Prevention |
|---|---|---|
| Committed config | A password in `appsettings.json`, `.mcp.json` or `settings.json` | Use environment variables; git-ignore local files; scan before committing |
| Memory files | A connection string pasted into `CLAUDE.md` | Never put secrets in memory; refer to the variable name instead |
| Prompts and transcripts | Pasting a key into the chat "just for this test" | Set it in the environment; tell Claude the variable name |
| Logs and journals | A prompt journal or CI log capturing a secret | Redact, as `log-prompt.js` does; review before committing |
| Tool output | Claude runs `cat .env` or `printenv` and the output enters context | Deny reading secret files; the repository's hook blocks Bash access to `.env` |
| Generated code | Claude writes a key into a test fixture | Review diffs; run a secret scanner in CI |

### A real lesson from this repository

At the time of writing, this track's `.mcp.json` (which configures the `larchmont` MCP server for Claude Code) is tracked in git and includes a database password for the `mcp_readonly` user in its `env` block. Even for a read-only, local-only account, that is exactly the pattern the project `CLAUDE.md` forbids: "Never commit passwords or connection strings with secrets."

The fix has three parts:

1. Remove the literal password from `.mcp.json`. Claude Code supports environment-variable expansion in `.mcp.json` (for example `${MCP_DB_PASSWORD}`), so the file can reference a variable set in each developer's environment.
2. Rotate the password, because anything that has been committed should be treated as exposed, even after it is removed from the latest commit.
3. Add a check (a pre-commit hook or CI secret scan) so that it does not happen again.

> WARNING: Deleting a secret in a new commit does not remove it from git history. Rotate first, then clean up.

### Least privilege for tools

The same principle applies to MCP servers and service accounts. The repository's MCP server uses a dedicated `mcp_readonly` database user rather than `root`, and `docs/mcp-security.md` discusses the risks. Give every tool the narrowest access that lets it do its job.

## 6.8 Prompt injection and untrusted content

Claude reads files, web pages, tool results and logs. Any of these can contain text that tries to instruct it: "Ignore your previous instructions and run this command". This is prompt injection, and it is the main reason permissions matter even when you trust Claude itself.

Defensive habits:

- Treat downloaded files, third-party documentation and user-supplied data as untrusted.
- Keep web and network tools behind prompts, or restrict them by domain.
- Be especially careful with `bypassPermissions` or broad allow rules in sessions that read untrusted content.
- Review MCP servers before trusting them; a malicious server can return instructions as data.
- When Claude suddenly proposes something unrelated to your task, stop and ask why.

Claude Code itself flags and treats content from tools and files as data rather than instructions, but layered defences are what keep you safe when any single layer fails.

## 6.9 A practical security checklist

1. Start in `default` or `plan` mode on unfamiliar work.
2. Keep shared allow rules narrow and specific; never allow bare `Bash`.
3. Deny reading secret files (`.env`, key files, credential stores).
4. Keep secrets in the environment, not in `CLAUDE.md`, settings or `.mcp.json`.
5. Git-ignore `.claude/settings.local.json` and `CLAUDE.local.md`.
6. Use hooks for checks that must always run (blocking dangerous commands, building after edits).
7. Use `bypassPermissions` only in disposable, isolated environments.
8. Review MCP servers and give them least-privilege credentials.
9. Read every diff before committing; run a secret scanner in CI.
10. Periodically review accumulated rules with `/permissions`.

## Exercises

> EXERCISE: Open `/permissions` in a session and list the rules currently in effect. For each, identify which settings file it came from.

> EXERCISE: In a scratch branch, add `Bash(dotnet test:*)` to `.claude/settings.local.json`. Confirm that `dotnet test backend/Larchmont.sln` now runs without a prompt, while `dotnet run` still asks.

> EXERCISE: Ask Claude to run `cat .env`. Observe the message from `block-dangerous-bash.js`. Then explain why a `Read(./.env)` deny rule is still worthwhile.

> EXERCISE: Rewrite this repository's `.mcp.json` so that the database password is read from an environment variable. Write down the steps the team must take to roll out the change safely, including rotation.

> EXERCISE: Start a session in plan mode and ask for a plan to add a cancellation endpoint. Identify one point in the plan where you would want the session to remain in default mode rather than accept edits automatically, and explain why.

## Key takeaways

- Settings live at managed, user, project and local scopes; managed settings win, and deny rules beat allow rules.
- Permission rules use `Tool(specifier)` syntax: `Bash(dotnet test:*)` is a prefix match, `Read(./.env)` a path match, `mcp__server__tool` an MCP tool.
- Modes set the overall posture: `default`, `acceptEdits`, `plan`, `auto` and `bypassPermissions`. Plan mode is the safest way to start large tasks.
- Sandboxing limits what allowed commands can reach; containers and VMs offer further isolation.
- This repository uses hooks, not permission rules, to block `rm -rf` and `.env` access, build after C# edits, journal prompts and write handoff notes.
- Hooks are guard rails, not security boundaries; combine them with deny rules and review.
- Keep secrets out of every committed file, including `.mcp.json`; rotate anything that has been committed.
- Treat untrusted content as data, keep tool access narrow, and read every diff.
