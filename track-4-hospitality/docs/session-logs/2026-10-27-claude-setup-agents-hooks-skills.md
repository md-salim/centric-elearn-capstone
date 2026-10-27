# Session handoff: Claude Code setup (CLAUDE.md, agents, hooks, skills, plugin)

- Date: 2026-10-27
- Branch: alok-changes
- Author: alok (git user.name is not set; commits used `-c user.name=alok`)
- State: first two pieces committed and pushed (87531c4, bd675a7); the automation layer below was committed in the next commit on this branch

## Goal
Set up the Claude Code project configuration for the Larchmont track-4 capstone: a correct CLAUDE.md and rules, subagents, then hooks, skills, slash commands, a plugin and an onboarding brief. Each piece planned first in a `FEATURE-*.md`.

## Key decisions
- CLAUDE.md written for the target state (net10.0, EF Core 10); csproj still says net8.0 until the M4 pipeline PR. (user's brief)
- Tests are xUnit + Moq, not NUnit, because that is what the repo uses. (assistant; told the user)
- `effort: medium` used instead of `reasoning: medium`, which is not a frontmatter field. (assistant)
- Subagents cannot spawn subagents, so `/plan` and `/implement` run in the main session; `planner` fans out only as the main agent. (assistant)
- `/plan` kept as written although a built-in `/plan` exists; whether the built-in wins is unconfirmed. (user decision)
- Hook scripts are Node, because there is no `jq` here. The `rm -rf`/`.env` block is a pattern guardrail, not a sandbox. (assistant)
- Stop hook is mechanical (reads the transcript file); the rich handoff is the skill. (assistant)
- Prompt logger redacts secrets and truncates, because the journal is committed. (assistant)
- Staff location tracking in the stakeholder brief is treated as out of scope pending HR/legal, and the spec-writer skill raises it. (assistant)

## Files touched
Committed and pushed:
- `CLAUDE.md`, `frontend/CLAUDE.md`, `.claude/rules/*`, `FEATURE-claude-md.md` - created or rewritten (87531c4)
- `.claude/agents/*` (6 files), `docs/agent-map.md` - created (bd675a7)

Uncommitted (new):
- `.claude/settings.json`, `.claude/hooks/{block-dangerous-bash,build-on-cs-edit,noop,log-prompt}.js`
- `.claude/skills/{session-handoff,prompt-journal,spec-writer}/SKILL.md`, `.claude/skills/session-handoff/write-handoff.{sh,js}`
- `.claude/commands/{plan,implement,reflect,handoff}.md`
- `plugins/ponytail/` (plugin.json, hooks.json, scripts/banner.js)
- `docs/onboarding-brief.md`, `docs/reflection-2026-10-27.md`, this file
- `FEATURE-{hooks,skill-session-handoff,skill-prompt-journal,skill-spec-writer,commands,plugin-ponytail,onboarding-brief}.md`

## Open questions
- Does the built-in `/plan` shadow `.claude/commands/plan.md`? Type `/plan` in a fresh session to find out.
- The prompt logger and Stop hook did fire in a real session (after the turn that created them) and exposed two bugs, now fixed (IDE tag noise in the journal; absolute paths in the auto handoff). The build hook and the block hook have not been seen firing in a real session yet.
- The plugin has not been loaded with `claude --plugin-dir plugins/ponytail` yet, and the four slash commands have not been run.
- Pomelo release that pairs with EF Core 10 (M4 to confirm). README and CI still say .NET 8.
- `compose.yaml` has a hardcoded root password; `DELIVERABLES.md` wants it secret-free.
- Staff location tracking: needs an HR/legal answer from the stakeholder before any design.

## Follow-ups
- [ ] Set `git config user.name` / `user.email` so commits no longer need `-c` overrides.
- [ ] Start a fresh session with `--plugin-dir plugins/ponytail` and check the banner, `/plan`, and the build and block hooks.
- [ ] Reach 15+ prompt-journal entries: the logger writes `[auto]` entries from the next session; add `[manual]` ones with the `prompt-journal` skill.
- [ ] Add the proposed hook tests and `.claude/` lint (see `docs/reflection-2026-10-27.md`).
- [ ] Run `spec-writer` for the housekeeping board; then `/plan` and `/implement`.
- [ ] Bump to net10.0 in the M4 pipeline PR and update README and CI.
