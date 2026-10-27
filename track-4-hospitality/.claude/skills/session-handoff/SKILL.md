---
name: session-handoff
description: Write a handoff note for the current session to docs/session-logs/YYYY-MM-DD-<slug>.md (goal, key decisions, files touched, open questions, follow-ups). Use when the user runs /handoff, says they are ending or pausing the session, or asks for a summary for the next person.
---

# Session handoff

Write a note that lets a teammate (or a fresh session) continue this work without re-reading the conversation.

## When to use
- The user runs `/handoff`, or asks to wrap up, pause or hand over.
- At the end of a work session, before the user closes it.

A Stop hook (`write-handoff.sh`) also writes a short mechanical note named `YYYY-MM-DD-auto-<session>.md`. That one only lists branch, files and git status. This skill writes the full one; do not edit or delete the auto file.

## Steps
1. **Review the conversation** from the first user message to now. Identify what the user actually asked for, what was done, and what was decided.
2. **Find the files touched.** Use the Edit/Write/NotebookEdit calls in this conversation, and confirm with `git status --short` and `git diff --stat`. List created, modified and deleted files separately. Do not claim a file was changed if git shows it was not.
3. **Pick a slug**: 3 to 5 lowercase words from the goal, joined by hyphens (for example `claude-setup-hooks-skills`).
4. **Write `docs/session-logs/YYYY-MM-DD-<slug>.md`** (today's date; create the folder if missing). If that file already exists, add `-2`, `-3` and so on rather than overwriting.
5. **Tell the user** the path and give a two-line summary.

## File format

```markdown
# Session handoff: <short title>

- Date: YYYY-MM-DD
- Branch: <git branch>
- Author: <git user.name, or "unknown">
- State: <committed and pushed | uncommitted changes | nothing changed>

## Goal
What the user wanted, in one or two sentences.

## Key decisions
- Decision, and why (include options rejected and who decided: user or assistant).

## Files touched
- `path` - created | modified | deleted - one line on what changed

## Open questions
- Anything unresolved, unverified, or waiting on a person. Say what is blocked.

## Follow-ups
- [ ] Next action, with the file or command to start from
```

## Rules
- Be accurate over complete. If something was not tested or verified, say so under Open questions.
- Never include secrets, passwords, tokens or connection strings, even if they appeared in the conversation.
- Do not include personal data about guests or staff.
- Keep it under about 60 lines. Link to FEATURE-*.md, BUG files and docs instead of copying them.
- Do not commit or push the note unless the user asks.
