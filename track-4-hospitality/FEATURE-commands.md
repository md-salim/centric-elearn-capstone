# FEATURE: slash commands (`.claude/commands/`)

Owner: alok

## Commands
| Command | Does | Writes |
|---|---|---|
| `/plan <feature>` | Plans a feature: reads the brief and any spec, explores the code, applies the planner agent's steps, writes a FEATURE file. Writes no code. | `FEATURE-<name>.md` |
| `/implement <file>` | Reads a FEATURE or BUG file and dispatches `backend`, `frontend` and `test-writer` in parallel, then `reviewer`. | code, tests, `docs/review-report.md` |
| `/reflect` | Scans the conversation for repeated manual steps and proposes new skills, commands or hooks. Does not create them. | `docs/reflection-<date>.md` |
| `/handoff` | Invokes the `session-handoff` skill. | `docs/session-logs/<date>-<slug>.md` |

## Design notes
- **`/plan` name.** Claude Code already has a built-in `/plan` (toggles plan mode). The user chose to keep `/plan` as written. If the built-in wins in someone's install, the fallback is to ask Claude to "follow `.claude/commands/plan.md` for <feature>". I have not confirmed which one wins, so this must be checked by typing `/plan` in a fresh session. Recorded in the onboarding brief.
- **Subagents cannot spawn subagents.** So `/plan` does not hand the whole job to the `planner` subagent. The command runs in the main thread, follows `planner.md` steps 1 to 3 itself, and may spawn `Explore` and `db-analyst` for research. `/implement` runs in the main thread, so it can fan out to `backend`, `frontend` and `test-writer` in one message (the same graph as `docs/agent-map.md`).
- FEATURE files carry an `Owner:` line (git user name). The ponytail plugin uses it to find a member's assigned FEATURE file.
- Commands never commit or push.

## Verify
- Each file has frontmatter with `description` (and `argument-hint`), uses `$ARGUMENTS`, and references only paths and agents that exist.
- The four commands appear in the slash menu after a reload.
