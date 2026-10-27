# FEATURE: ponytail plugin (`plugins/ponytail/`)

Owner: alok

## Why
Every team member should start a session reminded of the three rules that matter here: plan before coding, trace to the stakeholder brief, never commit secrets. The banner also tells them where they are (branch, dirty state) and which FEATURE file is theirs.

## Layout
```
plugins/ponytail/
  .claude-plugin/plugin.json   manifest (name, version, description)
  hooks/hooks.json             SessionStart hook -> node scripts/banner.js
  scripts/banner.js            builds the banner
```

## Banner
First line, exactly as requested:
`Larchmont Capstone — <branch> — remember to /plan before coding, always reference the stakeholder brief, never commit secrets.`
Then: working tree state (`clean` or `N uncommitted`) and the member's FEATURE file (or a hint to run `/plan`).

## How the FEATURE file is found
Scan `FEATURE-*.md` in the project root. A file is "assigned" when its `Owner:` line matches (case-insensitive) the git `user.name`, the local part of `user.email`, or the first segment of the branch name (for example `alok-changes` -> `alok`). Up to three matches are listed; none gives a hint to run `/plan`.

## Delivery
- The script prints `hookSpecificOutput.additionalContext` (the model sees it, "prepended" to the session) and `systemMessage` (the user sees it).
- It is not auto-installed. Load it with `claude --plugin-dir plugins/ponytail`, or add it through a local marketplace. Documented in `docs/onboarding-brief.md`.
- The script fails open: any error still prints the first line and exits 0, so it can never block a session start.

## Verify
- `plugin.json` and `hooks.json` are valid JSON; the script prints valid JSON.
- Run in this repo (branch `alok-changes`) and see the FEATURE files owned by `alok`; run in an empty temp dir and see the `/plan` hint and no crash.
