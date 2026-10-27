---
name: prompt-journal
description: Append a structured entry (timestamp, prompt, tools used, outcome) to docs/prompt-journal.md. Use when the user asks to journal or log a prompt, or after a prompt that gave a notable result, surprise or failure worth recording.
---

# Prompt journal

Add a reflective entry to `docs/prompt-journal.md`. The UserPromptSubmit hook already logs every prompt as `[auto]` (timestamp and prompt only). This skill adds the `[manual]` entry that records what was used and what came of it.

## Steps
1. **Pick the prompt(s)** to record: the one the user names, otherwise the most recent substantial one. One entry per prompt.
2. **Get the real time** with the Bash tool: `date +%Y-%m-%dT%H:%M:%S%:z`. Never invent a timestamp.
3. **Collect the facts from this conversation**, not from memory of what you meant to do:
   - Tools used: the tools, subagents, skills and slash commands actually called for that prompt.
   - Outcome: what really happened. Say `worked`, `partly worked` or `failed`, with one or two sentences of evidence (a test result, a build, a file written, an error).
4. **Append** the entry to `docs/prompt-journal.md` (see format). If the file does not exist, create it with this header first:

   ```markdown
   # Prompt journal

   Entries tagged `[auto]` are written by the UserPromptSubmit hook (timestamp + prompt only).
   Entries tagged `[manual]` are written by the `prompt-journal` skill (prompt, tools used, outcome).
   Secrets are redacted and long prompts are truncated.
   ```
5. **Confirm** to the user with the entry title and the line it was added at.

## Entry format

```markdown
## [manual] 2026-10-27T14:05:00+00:00 - Short title of what was asked

- **Prompt:**
  > The prompt, quoted. Trim to the useful part; long prompts may be shortened with "...".
- **Tools used:** Read, Grep, Edit, Bash (dotnet build), Agent: backend
- **Outcome:** worked | partly worked | failed - what happened, with evidence.
- **Lesson:** (optional) what to change in the next prompt or setup.
```

## Rules
- Append only. Never edit, reorder or delete existing entries, including `[auto]` ones.
- Redact secrets, passwords, tokens and connection strings, and keep personal data about guests or staff out.
- Be honest. A failed or wasted prompt is a valid and useful entry; do not rewrite it as a success.
- Use the same heading shape (`## [manual] <timestamp> - <title>`) so entries can be counted with a search for `^## \[`.
- Do not commit or push the journal unless the user asks.
