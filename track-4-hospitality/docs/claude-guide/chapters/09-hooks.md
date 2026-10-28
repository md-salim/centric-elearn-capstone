# Chapter 9: Hooks

Everything covered so far, `CLAUDE.md`, rules, commands, skills and agent prompts, is advice to the model. Claude usually follows it, but "usually" is not good enough for some things. You may want every edit to a C# file to be followed by a build, every prompt to be logged, or every `rm -rf` to be refused. For these, Claude Code provides hooks.

A hook is a shell command that the Claude Code harness runs automatically when a particular event happens. The model does not decide whether a hook runs; the harness does. That is the essential difference between hooks and everything else in `.claude/`: hooks are deterministic.

## 9.1 When to use a hook

| Requirement | Best mechanism |
|---|---|
| "Prefer small changes" | `CLAUDE.md` rule |
| "When asked to plan, follow these steps" | Slash command or skill |
| "Build after every C# edit, every time" | `PostToolUse` hook |
| "Never run `rm -rf`" | `PreToolUse` hook plus permission rules |
| "Log every prompt" | `UserPromptSubmit` hook |
| "Write a note when the session stops" | `Stop` hook |

The `/reflect` command in this repository puts it simply: "Hooks are for things that must happen every time; skills and commands are for things done on request."

## 9.2 Hook events

Claude Code raises a number of events during a session. The main ones are:

| Event | When it fires | Typical use |
|---|---|---|
| `PreToolUse` | Before a tool call runs | Validate or block a command; auto-approve safe calls |
| `PostToolUse` | After a tool call succeeds | Run a formatter, linter or build; report problems to Claude |
| `UserPromptSubmit` | When the user submits a prompt, before Claude sees it | Log prompts, add context, block prompts containing secrets |
| `Stop` | When the main agent finishes responding | Write summaries; insist on more work if checks fail |
| `SubagentStop` | When a subagent finishes | Check or record subagent output |
| `SessionStart` | When a session starts or resumes | Load context such as recent changes or open tickets |
| `SessionEnd` | When a session ends | Clean-up and final logging |
| `Notification` | When Claude Code sends a notification, for example waiting for permission | Desktop alerts |
| `PreCompact` | Before the conversation is compacted | Save information before it is summarised |

> NOTE: The set of events grows over time. Check the hooks documentation for your Claude Code version, or run `/hooks` to see what is configured.

## 9.3 Configuration

Hooks are configured in settings files:

| File | Scope | Committed? |
|---|---|---|
| `~/.claude/settings.json` | You, in every project | No |
| `.claude/settings.json` | Everyone in this project | Yes |
| `.claude/settings.local.json` | You, in this project | No (normally git-ignored) |

The structure is: event name, then a list of matcher groups, each with a list of hook commands.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/build-on-cs-edit.js\"", "timeout": 180 }
        ]
      }
    ]
  }
}
```

- **`matcher`** applies to tool events (`PreToolUse`, `PostToolUse`) and selects tools by name. It accepts an exact name such as `Bash`, an alternation such as `Edit|Write`, or a regular expression. MCP tools have names of the form `mcp__<server>__<tool>`, so `mcp__github__.*` matches every tool from one server. Events without tools, such as `UserPromptSubmit` and `Stop`, omit the matcher.
- **`type`** is `command` for a shell command.
- **`command`** is what runs. `$CLAUDE_PROJECT_DIR` is set to the project root, so hooks work wherever Claude was started from. Quote it, because paths can contain spaces.
- **`timeout`** is in seconds. Hooks that run builds need more than the default.

> TIP: Several hooks in one group run for the same event. If the order or interaction of hooks matters, keep them in separate, simple scripts and test them together.

## 9.4 Input: JSON on standard input

Each hook receives a JSON object on standard input describing the event. Common fields include `session_id`, `transcript_path` (the path to the session transcript file), `cwd` and `hook_event_name`. Event-specific fields are added:

| Event | Extra fields |
|---|---|
| `PreToolUse` | `tool_name`, `tool_input` (for Bash, `tool_input.command`; for Edit and Write, `tool_input.file_path`) |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response` |
| `UserPromptSubmit` | `prompt` |
| `Stop`, `SubagentStop` | `stop_hook_active` (true if Claude is already continuing because of a stop hook) |

A `PreToolUse` input for a Bash call looks roughly like this:

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/me/.claude/projects/.../abc123.jsonl",
  "cwd": "/repo",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf build", "description": "Delete build folder" }
}
```

## 9.5 Output: exit codes and JSON

The simplest way for a hook to communicate is its exit code.

| Exit code | Meaning | Effect |
|---|---|---|
| 0 | Success | Carry on. For `UserPromptSubmit` and `SessionStart`, standard output is added to Claude's context. |
| 2 | Blocking error | Standard error is fed back. For `PreToolUse` the tool call is blocked and Claude sees the reason. For `PostToolUse` the tool has already run, but Claude sees the message and can react. For `UserPromptSubmit` the prompt is blocked. For `Stop` Claude is told to keep going. |
| Any other | Non-blocking error | Standard error is shown to the user; execution continues. |

For finer control a hook can print a JSON object to standard output and exit 0. Fields such as `decision` (for example `"block"`) with a `reason`, `continue: false` to stop processing, and, for `PreToolUse`, a permission decision of allow, deny or ask, let a hook do more than pass or fail. Exit codes are enough for most project hooks, and every hook in this repository uses them.

> WARNING: Exit code 1 does not block anything. If you want a hook to stop a dangerous action, it must exit 2 (or return a JSON deny). A guard that exits 1 is only a warning.

## 9.6 Security cautions

Hooks run arbitrary commands with your user account's permissions, automatically, without asking. Treat them with the same care as any script you run.

- **Review hook changes** in pull requests as carefully as production code. A malicious or careless hook in `.claude/settings.json` runs for everyone who opens the project.
- **Do not trust input blindly.** `tool_input.command` and `prompt` are text that may contain anything. Quote variables and avoid passing them to a shell.
- **Use absolute paths** via `$CLAUDE_PROJECT_DIR` so the right script runs.
- **Avoid sensitive files.** Hooks should not read or print `.env` files, keys or credentials.
- **Do not treat guards as a sandbox.** A pattern-matching guard can be bypassed by indirection. Combine hooks with permission deny rules and normal operating-system protections.
- **Fail safely.** Decide deliberately whether an internal error in your hook should block (fail closed) or allow (fail open), and document it.

## 9.7 Walk-through: this repository's hooks

This repository's `.claude/settings.json` registers five hook commands across four events:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/block-dangerous-bash.js\"" } ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/build-on-cs-edit.js\"", "timeout": 180 },
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/noop.js\"" }
        ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/log-prompt.js\"" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/skills/session-handoff/write-handoff.sh\"" } ] }
    ]
  }
}
```

(Reformatted slightly for space; the content is unchanged.)

All the scripts are written in Node.js, which the project already requires for the frontend, so they work the same on Windows, macOS and Linux.

### block-dangerous-bash.js (PreToolUse, Bash)

The header explains the contract:

```js
// PreToolUse(Bash): block `rm -rf` (any flag order/form) and any command touching .env files.
// Exit 2 = block and show stderr to Claude. Any internal error fails open (exit 1).
// Guardrail only: indirection such as `bash -c "$cmd"` or a script file can bypass these checks.
```

How it works:

1. `readInput()` parses standard input as JSON, returning `{}` if it is missing or malformed.
2. `hasRecursiveForceRm` splits the command on `&&`, `||`, `;`, `|` and newlines, finds each `rm` (including forms such as `/bin/rm`), and checks its flags. It recognises `-rf`, `-fr`, `-r -f`, `-Rf`, `--recursive --force` and combinations, which a naive search for the string `rm -rf` would miss.
3. A regular expression `ENV_FILE` detects `.env` or `.env.local` as a path component, while allowing `.env.example`, `.env.sample` and `.env.template`.
4. On a match it writes a helpful message to standard error and exits 2. The message tells Claude what to do instead: "Delete specific files, or ask the user to do it."

The decision to fail open (exit 1 on an internal error) means a bug in the hook never stops all Bash use. The final comment is an honest statement of its limit: it is a guardrail, not a security boundary.

> TIP: Notice that the block message suggests an alternative. When a hook blocks Claude, a message that says what to do next prevents Claude from repeatedly trying variations of the blocked command.

### build-on-cs-edit.js (PostToolUse, Edit|Write)

This hook builds the solution after a C# file in the API project is edited.

```js
if (path.basename(filePath).toLowerCase() === 'claude.md') process.exit(0)
if (!/(^|\/)backend\/Larchmont\.Api\/.*\.cs$/i.test(filePath)) process.exit(0)
```

The matcher `Edit|Write` fires for every edit, so the script filters itself: it normalises backslashes to forward slashes (important on Windows), ignores `CLAUDE.md`, and exits 0 at once unless the path is a `.cs` file under `backend/Larchmont.Api`. This keeps edits to Markdown, TypeScript and tests fast.

For a matching file it runs `dotnet build backend/Larchmont.sln --nologo` with `spawnSync`, using a timeout of 170 seconds, deliberately just inside the 180-second hook `timeout` in settings so the script can report rather than being killed. If the build fails it extracts up to 15 unique lines containing "error", writes them to standard error with the file name, and exits 2. Because this is `PostToolUse`, the edit is kept, but Claude immediately sees the compiler errors and fixes them. This is the mechanism behind the `backend` agent's "build after every batch of edits" habit: even if the agent forgets, the hook does not.

### noop.js (PostToolUse, Edit|Write)

```js
// PostToolUse(Edit|Write) on CLAUDE.md: intentionally does nothing, so editing CLAUDE.md can never
// start a hook loop. Reads and discards stdin so the caller never sees a broken pipe.
process.stdin.resume()
process.stdin.on('data', () => {})
process.stdin.on('end', () => process.exit(0))
```

This script reads and discards its input and exits 0. Two lessons follow from it. First, a hook should consume standard input even if it ignores it, so the harness never sees a broken pipe. Second, its comment says it applies to `CLAUDE.md`, but in `settings.json` it is registered under the general `Edit|Write` matcher, so in practice it runs after every edit. That is harmless, but it is a good example of why comments and configuration should be reviewed together.

### log-prompt.js (UserPromptSubmit)

This hook appends every prompt to `docs/prompt-journal.md` as an `[auto]` entry. Its design reflects the fact that the journal is committed to Git:

- `stripInjected` removes text that the IDE and harness wrap around the prompt, such as `<ide_selection>` and `<system-reminder>` blocks, so only what the user typed is logged.
- `redact` replaces things that look like passwords, tokens, API keys, bearer tokens, `sk-` keys and GitHub tokens with `[REDACTED]`.
- Prompts longer than 1,500 characters are truncated.
- The timestamp includes the local time-zone offset.
- If the journal does not exist, it is created with a header explaining the `[auto]` and `[manual]` tags, the same header the `prompt-journal` skill uses.

It never blocks the prompt: on any error it exits 1, which is non-blocking.

> WARNING: Redaction by regular expression is best effort. It will not catch every secret. The real protection is not pasting secrets into prompts at all, which is also a rule in this project's `CLAUDE.md`.

### write-handoff.sh and write-handoff.js (Stop)

The `Stop` hook runs a shell script inside the `session-handoff` skill folder, which calls a Node helper. The script always exits 0 "so it can never block or fail the end of a session". The helper:

1. Reads the hook input and returns immediately if `stop_hook_active` is true, avoiding loops.
2. Opens the JSONL transcript at `transcript_path`, collects user prompts (skipping injected text) and every `Edit`, `Write` and `NotebookEdit` file path.
3. Lists only files inside the project, counting but not naming outside files, "so absolute local paths (and user names) never reach a committed file".
4. Adds the branch and `git status --short`.
5. Writes `docs/session-logs/YYYY-MM-DD-auto-<session>.md`, but only if the content has changed, "so repeated Stop events don't churn git".

The note is explicit about its limits: a mechanical summary "cannot see decisions or open questions"; run `/handoff` for the full note. This pairing of a hook for automatic capture with a skill for judgement mirrors the prompt journal.

> NOTE: The `Stop` hook is invoked with `bash`. On Windows this relies on Git Bash being available on the path, as it is for Claude Code's own shell on this machine.

## 9.8 Writing and testing a new hook

Suppose the team wants Claude to run the frontend typecheck after editing a TypeScript file. A hook might look like this:

```js
#!/usr/bin/env node
// PostToolUse(Edit|Write): after a .ts/.tsx file under frontend/src is edited, run the build.
// Exit 2 with the first errors so Claude can fix them. Internal errors fail open.
const fs = require('fs')
const { spawnSync } = require('child_process')

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  const file = ((input.tool_input && input.tool_input.file_path) || '').replace(/\\/g, '/')
  if (!/(^|\/)frontend\/src\/.*\.tsx?$/i.test(file)) process.exit(0)

  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const r = spawnSync('npm', ['run', 'build'], { cwd: `${dir}/frontend`, encoding: 'utf8', shell: true, timeout: 170000 })
  if (r.status === 0) process.exit(0)

  const errors = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => /error TS\d+/.test(l)).slice(0, 15)
  process.stderr.write(`Frontend build failed after editing ${file}:\n${errors.join('\n')}\n`)
  process.exit(2)
} catch (err) {
  process.stderr.write(`frontend-build hook error (ignored): ${err.message}\n`)
  process.exit(1)
}
```

Register it alongside the existing `PostToolUse` hooks with a generous timeout.

### Testing a hook outside Claude Code

Because a hook is just a program that reads JSON from standard input, you can test it from a terminal by piping sample input into it and checking the exit code:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -fr dist"}}' \
  | node .claude/hooks/block-dangerous-bash.js; echo "exit=$?"

echo '{"tool_name":"Bash","tool_input":{"command":"cat .env.example"}}' \
  | node .claude/hooks/block-dangerous-bash.js; echo "exit=$?"
```

The first should print the block message and `exit=2`; the second should print `exit=0`.

A short checklist before committing a hook:

1. Test the positive case (it acts) and the negative case (it stays out of the way).
2. Test malformed or empty input.
3. Test Windows-style paths with backslashes.
4. Check how long it takes. A slow hook on a common event slows every action.
5. Decide and document fail-open or fail-closed behaviour.
6. Run `/hooks` in Claude Code to confirm it is registered as you expect, then try it in a real session.

## 9.9 Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Exiting 1 to block | Nothing is blocked | Exit 2 or return a JSON deny |
| No path filter on `Edit|Write` | Expensive work after every edit | Filter early and exit 0 |
| Hook not reading stdin | Occasional broken-pipe errors | Read or drain stdin |
| Stop hook that always says "continue" | Claude never stops | Check `stop_hook_active` |
| Relative script paths | Hook fails when started from a subfolder | Use `$CLAUDE_PROJECT_DIR` |
| Printing secrets or local paths into committed files | Data leakage | Redact and keep to project-relative paths |
| Treating a guard as a sandbox | False sense of security | Combine with permission rules |

## Exercises

> EXERCISE: Pipe five different `rm` commands into `block-dangerous-bash.js` (for example `rm -r -f x`, `rm --force --recursive x`, `rm -r x`, `/bin/rm -Rf x`, `bash -c "rm -rf x"`). Predict the exit code for each first. Which one demonstrates the limitation in the header comment?

> EXERCISE: Edit a `.cs` file in `backend/Larchmont.Api` to introduce a deliberate syntax error and observe how Claude reacts to the `build-on-cs-edit.js` output. Then revert the change.

> EXERCISE: Implement the frontend build hook from section 9.8 in `.claude/settings.local.json` (so it affects only you), test it from the terminal, and then in a session.

> EXERCISE: The `noop.js` comment and its registration disagree. Propose a change to either the comment or `settings.json` so that they match, and explain which you would choose.

## Key takeaways

- Hooks are shell commands run by the harness on events; unlike prompts, they always run.
- Key events are `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `Notification` and `PreCompact`.
- Hooks are configured in `settings.json` with an optional `matcher` for tool events, a `command` and a `timeout`.
- Hooks read JSON from standard input. Exit 0 means continue, exit 2 blocks and feeds standard error back, and other codes are non-blocking warnings. JSON output gives finer control.
- This repository uses hooks to block dangerous Bash, build after C# edits, log prompts with redaction, and write an automatic handoff note when the session stops.
- Hooks run with your permissions: review them, filter early, fail deliberately, and test them from the terminal before relying on them.
