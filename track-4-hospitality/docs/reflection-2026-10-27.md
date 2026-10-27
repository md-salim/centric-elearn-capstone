# Reflection: 2026-10-27

## What this session did
Replaced the wrong CLAUDE.md with one for the real stack, added rules, a nested frontend CLAUDE.md, six subagents and an agent map (committed and pushed). Then built the automation layer: hooks, three skills, four slash commands, the ponytail plugin and an onboarding brief (not yet committed). Every piece was planned first in a `FEATURE-*.md`.

## Repeated manual steps
| Step | Times | Evidence | Cost |
|---|---|---|---|
| Checking the user's brief against the repo and finding a mismatch | 4 | NUnit vs xUnit; `reasoning:` is not a frontmatter field; `/plan` clashes with a built-in; subagents cannot spawn subagents | Each needed a decision and a note in the summary |
| Writing a FEATURE/plan file before implementing | 8 | `FEATURE-claude-md.md` and the seven `FEATURE-*.md` files | Medium; `/plan` now covers it |
| Throwaway test harness: write a temp node script, pipe sample JSON into a script, check exit codes | 3 | hooks, session handoff, banner | High; each harness was written by hand and thrown away |
| Linting the new `.claude/` files: frontmatter present, name matches folder, referenced paths exist, no stale terms | 3 | agents, skills and commands, onboarding brief | Medium |
| Commit and push routine (stage, commit with trailer, push) | 2 | `87531c4`, `bd675a7`; the first attempt failed for missing git identity | Low, but easy to get wrong |
| Reading a file before overwriting it | 2 | `CLAUDE.md`, plan file | Low |

## Proposed automation
### claude-setup-lint (hook in CI, plus a command)
- Trigger: on `.claude/**` and `plugins/**` changes, and in CI.
- Steps: a committed node script checks every agent, skill and command has valid frontmatter, `name` matches the file or folder, `settings.json` and plugin JSON parse, and paths named in `docs/onboarding-brief.md` exist.
- Saves: the hand-written greps done three times this session.
- Risk: low; it is read-only.

### hook-tests (committed test files)
- Trigger: `npm test` or a CI job running node's built-in test runner.
- Steps: keep the harnesses I used (the `rm -rf`/`.env` matrix, the logger redaction, the handoff idempotence, the banner) under `.claude/hooks/tests/`.
- Saves: rewriting them whenever a hook changes, and it proves the hooks keep working. This also gives the CI "hook" evidence a reviewer can run.
- Risk: the tests use piped input, not a real session.

### brief-vs-repo preflight (rule in CLAUDE.md, or a skill)
- Trigger: any time a user prompt names a framework, version, field or command.
- Steps: check it against the csproj, package.json and existing files before planning; list mismatches first.
- Saves: the four mismatches above would have been caught in one place.
- Risk: more questions up front.

### /ship (command)
- Trigger: user asks to commit and push.
- Steps: check branch is not main, check git identity, stage named files only, commit with the attribution trailer, push, report the hash.
- Saves: the failed first commit and the repeated staging commands.
- Risk: must never run without the user asking.

## Not worth automating
- Choosing a design when the brief conflicts with the repo: it needs a human decision each time.
- Reading before overwriting: the Write tool already enforces it.

## What went wrong or was slow
- **The hooks only went live after the turn that created them.** `settings.json` was created mid-turn and nothing fired until the next prompt. After that, the logger wrote its first `[auto]` entry and the Stop hook wrote an auto session note, so those two are confirmed in a real session. The "15+ entries" target is not met yet (one real entry so far). I did not backfill invented entries.
- **Two bugs showed up only once the hooks ran for real**, and were fixed before committing: the logger kept the IDE's `<ide_opened_file>` wrapper as part of the prompt, and the auto handoff note listed absolute local paths (a case-sensitive drive-letter comparison failed). Piped test input had not caught either. Tests for both were added to the throwaway harness. Auto notes are now git-ignored.
- **Still unconfirmed in a real session**: the plugin loading (`--plugin-dir`), the four slash commands, and the build hook firing on a real `.cs` edit.
- **The `/plan` name is unresolved.** I asked, the answer was `/plan-feature`, then the user asked for `/plan` as written. It is now `plan.md`, and it is unconfirmed whether the built-in wins.
- **My cleanup glob missed a test file** because the session id is cut to 8 characters; I removed it by hand and confirmed `git status` was clean of it.
- **The build hook was checked on a real `.cs` path but the failing build only through a fake project directory**, not a genuine compile error in the API.
