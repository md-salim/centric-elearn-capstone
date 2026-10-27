# FEATURE: spec-writer skill

Owner: alok

## Why
The stakeholder is non-technical and her brief (`docs/stakeholder-brief.md`) contains conflicts and one request that raises a legal issue. A spec has to be written from it carefully, with questions recorded rather than guessed. This skill makes that repeatable for any named feature.

## Behaviour
- Input: a feature name (for example `housekeeping-board`, `turnaround-sla`, `ready-by`).
- Reads `docs/stakeholder-brief.md` in full, `docs/specs/_template.md`, and `docs/review-checklist.md` (so the spec is reviewable).
- Writes `docs/specs/<kebab-feature-name>.md` using the template's headings exactly (Overview, Users, Business rules, API, UI, Acceptance Criteria, Assumptions & Open Questions, Traceability).
- Business rules are `BR-01...`, acceptance criteria are `AC-01...` (Given/When/Then), and the Traceability table maps every brief item to BR, AC, endpoint or screen, and test name (`AC_NN_Description`, matching the test naming rule).
- Never overwrites an existing spec without the user's OK.

## Things the skill must surface, not silently resolve
1. Mandatory supervisor inspection ("no exceptions") vs housekeepers marking Ready themselves on a simple turn.
2. 45-minute target "for every room type" vs 75 minutes for suites and family rooms.
3. "The clock should start when the guest leaves" vs the room becoming Dirty at checkout / key-card expiry: which timestamp starts the clock.
4. Live updates from the lock system: whether the integration exists and what it sends; no refresh needed implies push or polling.
5. "Ready-by" for an out-of-order room needs an expected return date, which the brief never asks for.
6. **Staff location tracking** (all the time, off-shift, unclocked extra shifts, during breaks). This is personal data with no lawful purpose stated; the hotels are in the UK. It is recorded as an **open question for HR/legal and out of scope**, not specified. The feature as written is not built.
7. The occupancy report problem is a bug (`docs/bug-LH-56.md`), not part of the board spec.

## Verify
- SKILL.md has valid frontmatter, uses the template's headings, and lists the seven items above.
- Each item was checked against the brief text (done with grep before writing).
