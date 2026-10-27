# FEATURE: Claude Code hooks (`.claude/settings.json`)

Owner: alok

## Why
Guardrails and automation for every team member's Claude Code session: stop destructive shell commands, catch broken builds right after an edit, auto-log prompts for the journal, and write a handoff note when a session ends.

## Hooks
| Event | Matcher | Script | Behaviour |
|---|---|---|---|
| PreToolUse | `Bash` | `.claude/hooks/block-dangerous-bash.js` | Exit 2 (block) if the command is `rm` with both recursive and force flags, or touches a `.env` file (not `.env.example`). |
| PostToolUse | `Edit\|Write` | `.claude/hooks/build-on-cs-edit.js` | If the file matches `backend/Larchmont.Api/**/*.cs`, run `dotnet build backend/Larchmont.sln --nologo`; on failure print the error lines to stderr and exit 2 so Claude sees them. Never undoes the edit. |
| PostToolUse | `Edit\|Write` | `.claude/hooks/noop.js` | Explicit no-op for `CLAUDE.md` (exit 0, writes nothing) so editing CLAUDE.md can never trigger a loop. Redundant with the build hook's path filter; kept as requested. |
| UserPromptSubmit | - | `.claude/hooks/log-prompt.js` | Append `[auto]` entry (timestamp + prompt) to `docs/prompt-journal.md`. |
| Stop | - | `.claude/skills/session-handoff/write-handoff.sh` | Mechanical handoff note (created in the session-handoff feature). |

## Design notes
- No `jq` on the machine and the project already needs Node 20, so scripts are Node and read the hook JSON from stdin.
- Commands use `$CLAUDE_PROJECT_DIR` so they work from any working directory.
- **Guardrail, not a sandbox.** Pattern checks can be bypassed by indirection (`bash -c "$cmd"`, scripts, variables). They stop the obvious mistakes.
- **Prompt log privacy.** The journal is committed to GitHub. The logger truncates long prompts and redacts `password=`, `secret`, `token`, `api key` values, bearer tokens and `sk-` style keys. It only sees what the user typed, not tool use or outcome; the `prompt-journal` skill adds structured `[manual]` entries.
- Hooks fail open: an unexpected script error exits 1 (non-blocking), never 2.

## Verify
- `settings.json` is valid JSON.
- Pipe sample hook JSON into each script: `rm -rf`, `rm -fr`, `rm -r -f` and `.env` reads blocked; `.env.example`, `rm file` and `ls` allowed; `.cs` edit triggers a build and a non-`.cs` edit does not; the logger appends and redacts.
