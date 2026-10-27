# FEATURE: prompt-journal skill

Owner: alok

## Why
`DELIVERABLES.md` needs `docs/prompt-journal.md` with at least 15 entries. The UserPromptSubmit hook logs every prompt with a timestamp (`[auto]`), but it cannot know which tools were used or whether the prompt worked. This skill adds the structured, reflective entry.

## Entry format (shared with the hook)
`docs/prompt-journal.md` holds two kinds of entry, both starting with a level-2 heading:
- `## [auto] <timestamp>` then the prompt as a blockquote. Written by the hook.
- `## [manual] <timestamp> - <short title>` then:
  - **Prompt:** the prompt, quoted (redacted, trimmed)
  - **Tools used:** tools, agents, skills, commands actually used
  - **Outcome:** what happened, with a result of `worked`, `partly worked` or `failed`
  - **Lesson:** (optional) what to do differently next time

## Skill behaviour
- Triggered when the user asks to journal a prompt, or after a prompt that produced a notable result or failure.
- Gets the real timestamp from the shell (`date`), never invents one.
- Appends only; never edits or reorders existing entries. Creates the file with the same header the hook uses if it is missing.
- Redacts secrets and keeps personal data out.
- Reports honestly: failures and dead ends are valid entries.

## Verify
- SKILL.md has valid frontmatter and the format above.
- Dry-run the append on a temporary copy of the journal and check the entry renders and the hook header is not duplicated.
