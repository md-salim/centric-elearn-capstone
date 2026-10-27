# FEATURE: session-handoff skill

Owner: alok

## Why
Team members switch sessions and machines. A handoff note lets the next person (or the next session) pick up without re-reading the whole conversation.

## Two parts
1. **Skill** (`.claude/skills/session-handoff/SKILL.md`), Claude-driven. When invoked (by `/handoff` or at session end) Claude reads the conversation and writes `docs/session-logs/YYYY-MM-DD-<slug>.md` with: goal, key decisions, files touched, open questions, follow-ups. This is the rich version.
2. **Stop hook script** (`.claude/skills/session-handoff/write-handoff.sh` -> `write-handoff.js`), mechanical. A shell script cannot read the conversation; it reads `transcript_path` from the hook JSON and writes `docs/session-logs/YYYY-MM-DD-auto-<session>.md` with branch, dirty state, first prompt, prompt count, files touched (from Edit/Write tool calls) and `git status`. It points at `/handoff` for the rich version.

## Script rules
- Exits 0 always (never fails or blocks a session end). Exits immediately if `stop_hook_active` is true (no loops).
- One file per session id, overwritten, and only written when the content changed, so repeated Stop events don't churn git.
- The first prompt is redacted the same way as the prompt logger.
- Skill file and auto file have different names so neither overwrites the other.

## Verify
- Run the script with a sample hook JSON and a small fake transcript: file created with the right sections; second run leaves it untouched; `stop_hook_active: true` writes nothing; missing transcript still exits 0.
- SKILL.md has valid frontmatter.
