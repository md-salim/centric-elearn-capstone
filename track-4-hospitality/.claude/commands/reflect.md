---
description: Scan this conversation for repeated manual steps and propose new skills (writes docs/reflection-<date>.md)
allowed-tools: Read, Grep, Glob, Write, Bash(date:*), Bash(git status --short), Bash(ls:*)
---

Reflect on this conversation. Find work that was done by hand more than once, and propose how to automate it. Propose only; do not create the skills, commands or hooks.

## Steps
1. **Re-read the conversation** from the first message. List every kind of step that happened two or more times: the same shell command or check (build, test, grep), the same file pattern written (agent files, SKILL.md, FEATURE files), the same explanation re-given, the same fix after the same mistake, the same commit and push routine.
2. **Check what already exists** in `.claude/skills`, `.claude/commands`, `.claude/agents` and `.claude/settings.json`, so you do not propose something that is already there.
3. **Score each candidate**: how many times it happened (count them honestly), roughly how much effort it cost, and whether a skill, a slash command, a hook, or a rule in CLAUDE.md fits best. Hooks are for things that must happen every time; skills and commands are for things done on request.
4. **Get today's date** with `date +%F`. Write `docs/reflection-<date>.md`. If it exists, add `-2`, `-3` and so on.

## File format

```markdown
# Reflection: <date>

## What this session did
Two or three sentences.

## Repeated manual steps
| Step | Times | Evidence (where in the conversation) | Cost |
|---|---|---|---|

## Proposed automation
For each, in priority order:
### <name> (skill | command | hook | rule)
- Trigger: when it should run
- Steps: what it does
- Saves: what it removes
- Risk: what could go wrong

## Not worth automating
Things that repeated but should stay manual, and why.

## What went wrong or was slow
Honest notes: failed attempts, wrong assumptions, rework.
```

## Rules
- Count honestly. If nothing repeated enough, say so and keep the file short.
- Do not include secrets or personal data.
- After writing, tell the user the path and the top three proposals in one line each.
- Do not commit or push.
