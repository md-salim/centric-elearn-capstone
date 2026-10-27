---
name: spec-writer
description: Write a feature spec by reading docs/stakeholder-brief.md and filling docs/specs/_template.md for a named feature, saved to docs/specs/<feature>.md. Use when the user asks for a spec, requirements, or acceptance criteria for a feature from the stakeholder brief.
---

# Spec writer

Turn the stakeholder brief into a reviewable spec for one named feature. The stakeholder is not technical, so wording in the brief is informal and sometimes contradicts itself. Record those problems as open questions; do not quietly pick an answer.

## Input
The feature name, for example `housekeeping-board`, `turnaround-sla`, `ready-by`, `out-of-order`. If it is missing or ambiguous, ask which part of the brief it covers.

## Steps
1. **Read** `docs/stakeholder-brief.md` in full, `docs/specs/_template.md`, and `docs/review-checklist.md`. Note which brief paragraphs belong to this feature. Quote or paraphrase closely; do not invent requirements.
2. **Check the existing code** for what already exists (entities, endpoints, validators in `backend/Larchmont.Api`; screens in `frontend/src`) so the spec describes real changes. Follow `.claude/rules/coding-conventions.md` (rules live in services, invalid input and invalid state changes return a 4xx ProblemDetails).
3. **Write `docs/specs/<kebab-feature-name>.md`** with exactly the template's headings, in this order: Overview, Users, Business rules, API, UI, Acceptance Criteria, Assumptions & Open Questions, Traceability. If the file already exists, stop and ask before changing it.
4. **Fill each section**
   - Overview: the problem, who it is for, and what is **out of scope**.
   - Users: each role (housekeeper, supervisor, front desk, maintenance, Director of Rooms) and what they may see and do.
   - Business rules: `BR-01`, `BR-02`... State the rule, not the field. One rule per number.
   - API: route, method, request and response shape, and the error response for each failure (status code and what the message says). Invalid transitions return a clear 4xx.
   - UI: each screen, what it shows, and its **loading, empty and error** states.
   - Acceptance Criteria: `AC-01`... as Given / When / Then. Each must be testable and map to a test later named `AC_01_Description`. Cover edges: the state transitions that must be refused, the out-of-order room that cannot be sold or assigned, and the boundary of the turnaround target.
   - Assumptions & Open Questions: separate "Decided by us" from "Asked the stakeholder". Leave the reply blank if there is none; never invent a reply.
   - Traceability: one row per brief item, linking brief item, BR, AC, endpoint or screen, and test name (the planned `AC_NN_Description`).
5. **Tell the user** the file path, the number of BRs and ACs, and the open questions that block work.

## Problems in the brief to surface (check them against the brief text; do not resolve them yourself)
1. **Inspection vs self-service Ready.** The brief says nothing goes to Ready without supervisor inspection, "no exceptions", and also that housekeepers should mark a room Ready themselves on a simple turn. These conflict. Spec the strict rule and ask Sofia.
2. **Turnaround target.** 45 minutes "for every room type, everywhere", then 75 minutes for suites and family rooms. Spec the per-room-type target as configurable data and ask which is right.
3. **Clock start.** "When the guest leaves" is not the same as the checkout being recorded or the key card expiring. Ask which timestamp starts the SLA clock and what happens if they differ.
4. **Live updates from the lock system.** The brief says the lock system "already knows" and the board should update without a refresh. Ask whether an integration or feed exists and what it sends; do not assume one. Specify what the board does when no event arrives.
5. **Ready-by for an out-of-order room** needs an expected return date; the brief never asks for one. Raise it.
6. **Staff location tracking is not specified.** The request is to show every housekeeper's location all the time, including people who have not clocked in and during breaks. That is personal data without a lawful purpose, necessity or limits (UK GDPR: lawful basis, data minimisation, a DPIA), and it covers people who are off duty. Put it under Open Questions as **out of scope pending HR and legal advice**; do not write rules, API or UI for it. A narrower, on-shift, floor-level assignment (which floor a housekeeper is responsible for) is fine to spec.
7. **Occupancy report.** The Monday report problem is a bug (`docs/bug-LH-56.md`), not part of the board. Reference it in Out of scope.

## Rules
- Trace everything to the brief. If something is your own assumption, label it as one.
- No secrets, no personal data about real guests or staff.
- Plain English, short sentences; the spec will be read by the stakeholder.
- Do not commit or push the spec unless the user asks.
