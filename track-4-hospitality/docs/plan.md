# Larchmont Hotels Capstone: Housekeeping Board + Claude Code Setup

## Context

This is a training capstone (DELIVERABLES.md) on the Larchmont Hotels repo. The trainee has completed Claude Code training on Skills, Hooks, Plugins, and MCP. The plan goes deep on those four topics while still checking off every item in DELIVERABLES.md, which is graded as a checklist.

The stakeholder brief (docs/stakeholder-brief.md, from Sofia Lindqvist, Director of Rooms) asks for:
- A 4-state housekeeping/room-status board (Dirty → Cleaning → Inspected → Ready)
- Out-of-order handling
- A 45/75-minute turnaround SLA with a breach list
- Floor-based housekeeper assignment
- A ready-by endpoint
- "Live" updates
- An occupancy-report bug fix (docs/bug-LH-56.md)
- A channel-import refactor

Real-time triggers (lock-system checkout, housekeeper floor position) are stubbed/simulated, not built against real hardware, per explicit decision.

Exploration confirmed the repo's real stack diverges sharply from what CLAUDE.md currently claims:
- **Backend:** ASP.NET Core 8 (not 6), controller-based MVC (not minimal APIs), EF Core 8 + Pomelo MySQL (not Dapper/SQL Server), no MediatR/AutoMapper/Serilog, throw + central ApiExceptionHandler → ProblemDetails (not Result<T>), xUnit (not NUnit) with `Method_Scenario_Expected` naming.
- **Frontend:** Vite + React 19 + TypeScript (not CRA/JS/Redux), using a local useAsync/StateView pattern with plain fetch.

CLAUDE.md must be rewritten to match this reality, as the user requested.

Housekeeping groundwork already exists and must be reused, not duplicated: `Room.Status`/`Floor`, `RoomStatuses` (currently Clean/Dirty/OutOfOrder), `RoomStatusEvent` (audit-log table), `RoomRepository.AddStatusEventAsync`, and a checkout hook in `BookingService` (~line 169-176) that already writes a Clean→Dirty event.

---

## 1. DB Migrations

New files in `backend/db/migrations/` (DbUp, embedded resources, numbered after V004).

### V005__extend_room_status_and_sla.sql
- Extend the RoomStatuses pipeline to Dirty, Cleaning, Inspected, Ready in the existing `rooms.status` column.
- Add `rooms.is_out_of_order TINYINT(1) NOT NULL DEFAULT 0`, `out_of_order_reason VARCHAR(255) NULL`, `out_of_order_set_at DATETIME NULL`, `out_of_order_set_by_user_id INT NULL` (FK → users).
  - OOO becomes a flag parallel to status, not a status value. A room can be OOO while its last cleaning state is preserved. Clearing OOO always force-sets status back to Dirty, per the brief ("returns through the same cleaning steps").
  - This replaces `RoomStatuses.OutOfOrder` as a status constant.
- Add `rooms.checkout_at DATETIME NULL`, set whenever a room goes Dirty (by the real checkout flow or the simulated webhook). Used to compute `ready_by`.
- Create `room_type_sla (room_type_id INT PK FK → room_types, turnaround_minutes INT NOT NULL)`, seeded with 45 minutes for standard types and 75 for Suite/Family room types (matched by existing `room_types` rows). Code falls back to 45 if a type has no row.
- Add `room_status_history.source VARCHAR(20) NULL` (`"webhook"` / `"staff"` / `"system"`) to distinguish simulated-hardware events from manual ones in reporting.

### V006__housekeeper_floor_assignment.sql
- `housekeeper_floor_assignments (id PK, hotel_id FK, user_id FK, floor INT, assigned_at DATETIME)`
- `staff_positions (user_id PK FK, hotel_id FK, last_known_zone VARCHAR(50) NULL, updated_at DATETIME NULL)`: the privacy-conscious stub for "where is this housekeeper". It is a settable field, not continuous tracking.
  - The spec's Assumptions must flag that always-on tracking (including off-shift, as literally requested) raises a consent/HR concern. This stub deliberately does not implement it.

### db-setup/02-mcp-views.sql
Run manually, like `01-create-users.sql`. Not a DbUp migration. Creates read-only views backing four of the five required MCP tools:
- `vw_rooms_breaching_sla`
- `vw_ooo_impact_on_occupancy`
- `vw_housekeeper_load`
- `vw_arrivals_without_ready_room`

### db-setup/03-create-mcp-user.sql
- Creates a new `larchmont_mcp` MySQL user.
- `GRANT SELECT` only on the 4 views, plus an explicit table allowlist (`rooms`, `room_types`, `hotels`, `bookings`, `guests`, `room_status_history`, `housekeeper_floor_assignments`, `staff_positions`, `room_type_sla`) for `run_readonly_query`.
- In the same change, tighten `db-setup/01-create-users.sql`: the existing `larchmont_app` user drops from `ALL PRIVILEGES` to `SELECT/INSERT/UPDATE/DELETE` on the app schema only (no DDL/GRANT). This fixes a review-checklist finding.

---

## 2. Backend

### Domain (`Domain/Entities.cs`)
- Update `RoomStatuses` to the 4-state pipeline.
- Add `IsOutOfOrder`, `OutOfOrderReason`, `OutOfOrderSetAt`, `OutOfOrderSetByUserId`, `CheckoutAt` to `Room`.
- Add `Source` to `RoomStatusEvent`.
- New entities: `RoomTypeSla`, `HousekeeperFloorAssignment`, `StaffPosition`.

### Repositories
- Extend `RoomRepository`: `ListByFloorAsync`, `GetSlaMinutesAsync` (45-minute fallback), `SetOutOfOrderAsync` / `ClearOutOfOrderAsync`.
- New `HousekeepingRepository`: `GetBreachingSlaAsync`, floor-assignment CRUD, staff-position get/set.

### New `Services/HousekeepingService.cs`
Kept separate from `RoomService` because it is a distinct concern.

- **`TryTransitionAsync(roomId, toStatus, byUserId, role)`**
  - Enforces Dirty → Cleaning → Inspected → Ready with no skipping.
  - Exception: a Housekeeper may self-mark Cleaning → Ready directly on a "simple turn". A simple turn means the room type is not Suite/Family, the room is not OOO, and the prior status was Cleaning (not coming out of OOO).
  - All other skip or invalid attempts throw `BusinessRuleException` → HTTP 422.
  - This exception is a documented assumption, not stated explicitly in the brief.
- **`SetOutOfOrderAsync` / `ClearOutOfOrderAsync`**
  - OOO blocks any sell or assign attempt.
  - Clearing force-sets status to Dirty and logs a history row.
- **`TriggerCheckoutDirtyAsync(roomId, source)`**
  - One method called by both the existing `BookingService` checkout hook and the new simulated webhook. This gives one source of truth for "room goes Dirty", and `CheckoutAt` is always set consistently.
  - New endpoint `POST /api/rooms/{id}/lock-events/checkout` is the simulated lock-system trigger, documented as a stand-in for real hardware.
- **`GetReadyByAsync(roomId)`**
  - Returns `CheckoutAt + SLA minutes` if the room is not Ready or OOO.
  - Returns `null` with no fabricated return estimate if OOO. This is a documented gap, not invented data.
- **`GetSlaBreachesAsync(hotelId?)`**: returns overdue rooms, sorted worst-first.
- **`AssignHousekeeperToFloorAsync` / fairness-suggestion helper**
  - "Fair" means each on-shift housekeeper's total assigned room count across their floors differs by at most 1 from any other's.
  - Implemented with a simple greedy bin-packing heuristic (documented assumption).

### LH-56 fix
In `Services/ReportService.cs:44`, change:
```csharp
bookings.Count(b => b.CheckIn <= day && day <= b.CheckOut)
```
to:
```csharp
bookings.Count(b => b.CheckIn <= day && day < b.CheckOut)
```
This matches the existing `Booking.Nights` semantics (`CheckOut.DayNumber - CheckIn.DayNumber`). Nights occupied are `[CheckIn, CheckOut)`, so the checkout day is vacant.

### New `Controllers/HousekeepingController.cs`

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/hotels/{hotelId}/rooms/board?floor=` | Housekeeping board |
| PUT | `/api/rooms/{id}/status` | Routes through `TryTransitionAsync`, replacing the unchecked setter in `HotelControllers.cs` |
| POST / DELETE | `/api/rooms/{id}/out-of-order` | Set / clear OOO |
| POST | `/api/rooms/{id}/lock-events/checkout` | Simulated lock-system trigger |
| GET | `/api/rooms/{id}/ready-by` | Ready-by time |
| GET | `/api/hotels/{hotelId}/sla-breaches` | SLA breach list |
| various | floor-assignment and staff-position endpoints | Assignment and position stub |

**Auth scope limit:** This repo has no auth at all. Role and userId are supplied by the caller and trusted, the same no-RBAC model as the rest of the codebase. This is flagged explicitly in the spec as an accepted scope limit, not a silent gap.

### Live updates
Short polling, not SignalR. The repo has zero realtime infrastructure today, and a SignalR hub is disproportionate for a stubbed requirement. Polling every 15 seconds on the two new screens satisfies "no manual refresh" adequately for a staff tool.

---

## 3. Frontend

- `src/api/client.ts`: add `postJson` / `putJson` (currently GET-only).
- New `src/api/housekeeping.ts` and `src/types/housekeeping.ts`, mirroring the backend DTOs.
- Extend `src/hooks/useAsync.ts` with an optional `{ pollMs }` parameter: interval re-fetch with cleanup on unmount. This is the one mechanism for "live" on both new screens.
- New `src/pages/HousekeepingBoardPage.tsx`: grouped by floor, with the busiest floors (most non-Ready rooms) surfaced first.
- New `src/pages/SlaBreachListPage.tsx`: worst-first.
- Both reuse `useAsync` / `StateView` for loading, empty, and error states, and are registered as routes alongside existing pages.

**Scoped out:** No Vitest or React Testing Library. The repo has zero frontend test infrastructure today. Backend AC tests carry correctness for this capstone's priorities. This is documented as a conscious trade-off in `docs/ai-usage-reflection.md` and `docs/review-report.md`, not a silent gap.

---

## 4. Tests (backend, xUnit, `backend/Larchmont.Tests`)

### Characterisation tests first
Extend the existing `ChannelImportServiceTests` class to pin current behavior before any refactor:
- CANCELLED branch
- MODIFIED branch
- Malformed CSV quoting
- Rate-plan fallback
- Adults-exceeds-occupancy
- Duplicate `external_ref`

Then extract `ChannelImportService` into `CsvRowParser`, `ImportRowValidator`, `BookingResolutionService`, and `GuestUpsertService`, orchestrated by a thinned `ChannelImportService`. The same characterisation tests must pass unchanged afterward.

### LH-56 regression test
In `ReportServiceTests`: a booking whose `CheckOut` falls on day D asserts that day D is not counted as sold. This fails on the original `<=` code and passes after the fix.

### AC-named tests (at least 25)
New `HousekeepingServiceTests.cs` and `HousekeepingControllerTests.cs`, using the `AC_NN_Description` naming from DELIVERABLES.md's example. They cover:
- Each valid transition
- `AC_04_CannotMarkReadyWithoutInspection`
- `AC_05_HousekeeperSelfMarksReadyOnSimpleTurn`
- `AC_06_SimpleTurnExceptionDoesNotApplyToSuite`
- `AC_07_OooBlocksAnyTransitionExceptClear`
- `AC_08_OooRoomCannotBeAssignedOrSold`
- `AC_09_ClearingOooReturnsRoomToDirtyNotReady`
- SLA default and Suite-override tests
- `AC_12_ReadyByComputedFromCheckoutPlusSla`
- `AC_13_SlaBreachListSortedWorstFirst`
- Webhook and existing-checkout-hook tests
- Floor-fairness test
- The LH-56 and characterisation tests, counted toward the total

---

## 5. MCP Server (`mcp/`), Deep-Priority Section

Node.js + TypeScript, using `@modelcontextprotocol/sdk` with strong Zod-typed tool schemas.

### Layout
- `mcp/src/server.ts`: stdio entrypoint
- `mcp/src/db.ts`: mysql2 pool as `larchmont_mcp`, env-driven
- `mcp/src/tools/`:
  - `roomsBreachingSla.ts`
  - `oooImpactOnOccupancy.ts`
  - `housekeeperLoad.ts`
  - `arrivalsWithoutReadyRoom.ts`
  - `runReadonlyQuery.ts`
- `mcp/src/guardrails/sqlGuard.ts`

### Five tools
- Four tools, `rooms_breaching_sla`, `ooo_impact_on_occupancy`, `housekeeper_load`, and `arrivals_without_ready_room`, each backed by one of the views above.
- One guarded tool, `run_readonly_query`, with these guardrails:
  - Single-SELECT-only parse check. Rejects `;` multi-statements and any write or DDL verb.
  - Forced `LIMIT 100` default, clamped at 500.
  - Session query timeout of about 5 seconds.
  - Table allowlist as defense-in-depth on top of the DB-level GRANTs.

### Tests (`mcp/tests/`)
Real MySQL, per the user's decision. Tests use a disposable seeded schema via mysql2. CI spins up a MySQL service container, reusing the service definition from `compose.yaml`, so views and guardrails are proven against actual SQL, not mocks. Tests call tool handler functions directly (unit-level), not through a live MCP transport.

### `.mcp.json`
Registered at the repo root. Runs `node mcp/dist/server.js` with env vars for local MySQL.

---

## 6. `.claude/` Setup, Deep-Priority Section

### Rules (`.claude/rules/`)
- `backend-conventions.md`
- `frontend-conventions.md`
- `migration-safety.md`: "never edit a committed V0xx__*.sql file, add a new one"
- `mcp-conventions.md`: read-only only, with guardrail requirements for any new tool

### Skills (`.claude/skills/`, at least 2)
- **spec-writer:** scaffolds a new `docs/specs/<name>.md` from `docs/specs/_template.md`, prompting through Overview, Users, BR-xx, API, UI, AC-xx, and Assumptions. Fills the Traceability table by matching `AC_NN_*` test names.
- **characterisation-test:** given a target method, scans existing tests, finds untested branches, and scaffolds characterisation stubs that pin current behavior before a refactor. This is the workflow used for `ChannelImportService`.
- **(stretch) migration-guard:** scaffolds a correctly numbered new migration file rather than letting an edit touch an old one.

### Agents (`.claude/agents/`, at least 5)
- **backend-dev:** `backend/`
- **frontend-dev:** `frontend/`
- **test-writer:** `Tests/`, `mcp/tests/`; invokes the characterisation-test skill
- **reviewer:** read-only; runs `docs/review-checklist.md` against the diff
- **db-analyst:** read on `backend/db/**` and `db-setup/**`, plus MCP tool access. This agent most directly justifies the MCP server, answering SLA and occupancy questions via live tool calls instead of hand-written SQL.

### CLAUDE.md via `/init`
Run the built-in init skill first to generate a baseline CLAUDE.md from what it can detect on disk. Then hand-correct it against the verified ground truth from exploration: stack, layout, commands, conventions. Do not write the whole file freehand. The diff between what `/init` produces and the hand-corrections becomes a concrete example of why "trust but verify" matters even with tooling.

### Commands (`.claude/commands/`)
- `/new-spec <name>`: invokes the spec-writer skill directly.
- `/review`: runs `docs/review-checklist.md` against the current diff via the reviewer agent, writing the result to `docs/review-report.md`. This is the same check the Stop hook runs automatically, exposed as an on-demand command.
- `/build-feature <name>`: the orchestrator command (see below).

### Orchestrator subagent model
`/build-feature` runs the five agents in a fixed sequence for a new slice of work:

1. backend-dev (implement)
2. test-writer (AC and characterisation tests)
3. frontend-dev (consume the now-stable API)
4. reviewer (checklist pass)
5. db-analyst (migration and MCP-view review, if schema changed)

This mirrors the Explore → Plan → build pattern used to produce this plan. `docs/agent-map.md` documents the model as "the pattern we used on ourselves."

### `.claude/settings.json` hooks
- **PreToolUse** on Edit/Write matching `backend/db/migrations/V0*.sql`: blocks edits to already-committed migration files, enforcing `migration-safety.md`.
- **PostToolUse** on backend `.cs` edits: runs `dotnet build backend/Larchmont.sln --nologo`.
- **PostToolUse** on frontend `.tsx`/`.ts` edits: runs `npm --prefix frontend run build` (or `tsc --noEmit`).
- **Stop**: runs a condensed review-checklist script (plaintext-secret grep, debug-leftover grep) feeding `docs/review-report.md`.

---

## 7. CI, Compose, README, and CLAUDE.md Fixes

- **`.github/workflows/ci.yml`:**
  - `dotnet-version: '6.0.x'` → `'8.0.x'`
  - Frontend job `working-directory: web` → `frontend`
  - New `mcp-tests` job: MySQL service container seeded from `db-setup/*.sql`, then `npm --prefix mcp ci && npm --prefix mcp test`
- **`compose.yaml`:** MySQL only, per the user's decision. Remove the hardcoded root password and source it from `.env`. Commit a new `.env.example` with placeholders, and gitignore `.env`. Otherwise unchanged in shape.
- **`README.md`:** full run sequence:
  1. `compose up` MySQL
  2. `01-create-users.sql`
  3. `02-mcp-views.sql`
  4. `03-create-mcp-user.sql`
  5. `dotnet run --project backend/Larchmont.Api`
  6. `cd frontend && npm run dev`
  7. MCP server start command
  8. `dotnet test backend/Larchmont.sln`
  9. `npm --prefix mcp test`
- **`CLAUDE.md`:** full rewrite to the verified real stack, layout, commands, and conventions:
  - .NET 8, controllers, EF Core + MySQL
  - Throw + ApiExceptionHandler
  - xUnit `Method_Scenario_Expected`
  - Vite / React / TypeScript
  - `useAsync` / `StateView`
  - Layout: `backend/Larchmont.Api`, `backend/Larchmont.Tests`, `backend/db/migrations`, `frontend/src`

---

## 8. Docs (10 files)

Each file has concrete content, not generic boilerplate:

1. `docs/onboarding-brief.md`
2. `docs/specs/housekeeping-board.md`: full `_template.md`-shaped spec with BR-xx, AC-xx, Assumptions, and Traceability
3. `docs/prompt-journal.md`: at least 15 real dated entries, written as the work progresses
4. `docs/mcp-security.md`: least-privilege design for `larchmont_mcp`, guardrail layers, threat model
5. `docs/agent-map.md`: the five agents and what each built
6. `docs/debug-report.md`: LH-56 investigation using the debug skill's structure
7. `docs/refactor-note.md`: `ChannelImportService` before and after
8. `docs/perf-note.md`: EF Core SQL-log before and after for the board and SLA query. Tests use in-memory, so this needs proof against real MySQL or the SQL log.
9. `docs/review-report.md`: checklist run against the real diff, including the fixed `larchmont_app` grants and committed secrets
10. `docs/ai-usage-reflection.md`: honest reflection on where Skills, Agents, Hooks, and MCP helped

### Token-saving prompting technique
`docs/prompt-journal.md` includes a dedicated entry comparing a verbose prompt with the same request written in the terse, telegraphic "caveman" style covered in training. It uses an actual before/after token count from a real prompt used in this build, such as an Explore-agent brief or a skill description. It is a measured example, not a generic claim.

`docs/ai-usage-reflection.md` summarizes where this style helped and where it did not:
- **Helped:** skill and command descriptions, and short agent instructions, which are read every turn.
- **Hurt:** the spec and plan documents, which must stay unambiguous for a human reviewer.

---

## 9. Contradictions and Resolutions

Four real contradictions turned up across the brief, the checklist, and the existing docs. Each needs an explicit written resolution, because a reviewer following `docs/review-checklist.md` will check for exactly this kind of thing.

### A. Inspection "no exceptions" vs. housekeeper self-mark
The brief says: "Nothing goes to Ready without a supervisor inspection, no exceptions. I do not want a repeat of the leak room." Two paragraphs later it says: "Housekeepers should be able to mark a room Ready themselves when it is a simple turn."

**Resolution:** "No exceptions" is scoped to the leak-room failure mode, an OOO room reaching Ready without being fixed. The state machine makes this structurally impossible, since `TryTransitionAsync` rejects any transition on an OOO room. The housekeeper self-mark is a narrow carve-out for simple turns only, never from OOO and never for Suite or Family. It does not reopen the leak-room scenario. The spec's Assumptions section quotes both sentences and states this resolution explicitly.

### B. Staff tracking vs. the checklist's privacy bar
The brief says: "I want the board to show where each housekeeper is on the floor plan, all the time... during their breaks." The checklist says: "Anything that tracks staff has a lawful purpose and stops when the person is off duty." These directly conflict.

**Resolution:** Implement only the settable `staff_positions.last_known_zone` stub. A staff member or supervisor sets it. Nothing is captured automatically, and nothing persists after a shift ends. There is no background polling and no break or off-shift capture. The spec's Assumptions state that the always-on tracking as literally requested was not built, cite the checklist as the reason, and recommend the HR conversation the brief itself raises happen before any real tracking is added.

### C. CLAUDE.md vs. the actual repo
The old CLAUDE.md contradicts the repo on nearly every point: stack, framework style, data access, test framework, test naming, and terminology.

**Resolution:** Full rewrite (section 7). Old and new claims are listed side by side in the PR or commit description, so the correction is auditable.

One concrete sub-case: the old test command `dotnet test Larchmont.sln --filter Category=Unit` assumes `[Trait("Category","Unit")]` attributes that do not exist in `backend/Larchmont.Tests`. The filter would silently run zero tests. The rewritten CLAUDE.md drops the filter and documents the real command, `dotnet test backend/Larchmont.sln`.

### D. "Never edit a deployed migration" with no record of deployment
DbUp tracks applied scripts in its own database table, which a local pre-edit hook cannot see. The repo has no separate "deployed" marker.

**Resolution:** The hook treats "already committed to the default branch" as the practical proxy for "deployed". If a file is in main, assume someone may have run it against a real database. This is an imperfect but workable stand-in, stated explicitly as an assumption in `migration-safety.md`.

---

## 9b. Presentation Plan

Two audiences need different presentations: a reviewer checking against `docs/review-checklist.md`, and the stakeholder, Sofia, checking against her own criteria.

### Reviewer-facing: `docs/review-report.md`
- Mirrors `docs/review-checklist.md` exactly: same four section headers (Correctness, Data, Security and privacy, Tests, Delivery), same bullet order.
- Every bullet gets a Pass, Fail, or N/A verdict and a file:line reference, as the checklist requires.
- Anything marked Fail must be fixed before submission, or carry a one-line reason it is deliberately out of scope, such as the no-auth gap from section 2 or the frontend-test gap from section 3. Never a silent Fail.

### Stakeholder-facing: README demo order
Sofia's brief ends with three things she will check: "Show me the board for one hotel, show me the late rooms list, and show me that the desk cannot sell a room that is not ready."

The demo follows her order:
1. `HousekeepingBoardPage` for one hotel, grouped by floor, busiest floors visible.
2. `SlaBreachListPage`, worst-first.
3. An attempt to assign or sell an OOO or non-Ready room via the API, showing the 4xx ProblemDetails response.

Everything else (MCP tools, agents, hooks, docs) comes afterward as supporting engineering work. Sofia said plainly, "I do not need pretty. I need it to be right," so the demo leads with correctness evidence: the three asks plus the AC-named tests that prove them.

The README gets a short "Demo order" subsection pointing at these three checks.

---

## 10. Build Order

1. CI and CLAUDE.md fixes (small, unblocks everything, gives agents correct ground truth)
2. LH-56 fix and regression test
3. Migrations V005–V006, `02-mcp-views.sql`, `03-create-mcp-user.sql`
4. Backend housekeeping feature and its AC tests, written together
5. Frontend screens
6. `ChannelImportService` characterisation tests, then refactor
7. MCP server and `mcp/tests/`
8. `.claude/` setup (rules, skills, agents, hooks, `.mcp.json`), last among infra items so it references finished, real conventions
9. `compose.yaml` and README final pass
10. Docs last, written against the finished work. `docs/review-report.md` is written last of all.

---

## 11. Verification

- `dotnet build backend/Larchmont.sln` and `dotnet test backend/Larchmont.sln` from a clean checkout. All AC tests, characterisation tests, and the LH-56 regression must pass.
- Deliberately break the LH-56 fix and the simple-turn rule locally. Confirm each has a test that fails without it.
- `npm --prefix frontend run build` confirms `tsc -b` strictness passes with the two new pages.
- Run the API and UI manually:
  - `GET /api/reports/occupancy?hotelId=1&from=2026-10-02&to=2026-10-02` returns `roomNightsSold=5`, per `docs/bug-LH-56.md`.
  - The board renders by floor with polling.
  - The SLA-breach screen sorts worst-first.
  - Attempting to assign an OOO room returns a 4xx.
- `npm --prefix mcp test` against a seeded MySQL schema confirms the four views' tool wrappers return correct rows, and `run_readonly_query` rejects a crafted INSERT or multi-statement attempt.
- Push to a branch and confirm the fixed `ci.yml` goes green for the backend, frontend, and `mcp-tests` jobs, resolving `docs/ci-failing-run.log`.
- Trigger the migration-guard hook by editing `V001__create_schema.sql` directly, and confirm it is blocked.

---

## 12. Team Split (5 members) and 20-Minute Presentation

The five `.claude/agents/` roles map onto five people. Each person owns the work their namesake agent would do and presents that slice.

| Person | Owns | Build-order items |
|---|---|---|
| Backend dev | Migrations, HousekeepingService, controller, LH-56 fix, ChannelImportService refactor | §1, §2, build steps 2/3/4/6 |
| Frontend dev | Board and SLA-breach screens, useAsync polling, API client | §3, build step 5 |
| Test writer | Characterisation tests, LH-56 regression, AC tests | §4, interleaved with steps 2/4/6 |
| MCP/DB analyst | Migration review, `02-mcp-views.sql`, `03-create-mcp-user.sql`, MCP server and `mcp/tests/` | §1 (views and user), §5, build step 7 |
| Claude Code lead | `/init` → CLAUDE.md, rules, skills, commands, agents, hooks, `.mcp.json`, CI, compose, README, all 10 docs | §6, §7, §8, §9, build steps 1/8/9/10 |

The build order still applies within this split. The table assigns ownership, not a sequence where everyone starts at minute one. The MCP/DB analyst and Claude Code lead are blocked on migrations. The frontend is blocked on a stable backend API. Reviewer-facing docs come last for everyone, since `docs/review-report.md` needs the finished diff.

### Agenda

- **0–1 min:** One slide with the problem (the brief, the leak-room incident, LH-56) and the four training topics: Skills, Hooks, Agents/orchestration, and MCP. *Claude Code lead.*
- **1–6 min:** Sofia's three judging criteria, live, in her order.
  - Board for one hotel by floor (frontend dev)
  - SLA-breach list, worst-first (frontend dev)
  - Attempt to sell or assign an OOO room, returning a 4xx (backend dev)
- **6–9 min:** Two bug fixes as evidence of correctness.
  - LH-56 before and after, with the regression test that fails on old code (backend dev, test writer)
  - `ChannelImportService` characterisation, then refactor (test writer)
- **9–13 min:** MCP server. Run `rooms_breaching_sla` or `arrivals_without_ready_room` live from inside Claude Code, then show `run_readonly_query` rejecting a crafted write attempt. This is the most demoable depth artifact. *MCP/DB analyst.*
- **13–17 min:** Claude Code setup tour. Trigger the migration-guard hook blocking an edit to V001. Run `/new-spec` or `/review`. Show the db-analyst agent answering a question via MCP tools instead of hand SQL. The orchestrator model and the `/init` → CLAUDE.md correction get one sentence each. *Claude Code lead.*
- **17–20 min:** The two contradictions from §9 (inspection "no exceptions" vs. housekeeper self-mark, and the staff-tracking pushback). This shows the team read the brief critically rather than implementing it literally. Close with a pointer to `docs/review-report.md` and `docs/ai-usage-reflection.md`. *Claude Code lead.*

Each person presents only the section they built. The Claude Code lead also opens on slide 1 and closes with the contradictions and doc pointers, since that role has the whole-repo view.
