# FEATURE: Housekeeping board API
Owner: unassigned

Plan only. No code has been written. Spec: `docs/specs/housekeeping-board.md` (BR-01..BR-18, AC-01..AC-26). Privacy decision: `docs/privacy-note.md`.

## Why
Last month the London Bridge desk sold rooms that were being cleaned or out of order (brief: "Why I am asking"). The board enforces the cleaning steps, blocks OOO assignment, times turnarounds from checkout, and updates live from the lock system.

## Scope / out of scope
In: five-state room machine, transitions endpoint, OOO block in `AssignRoomAsync`, SLA data and late list, floor assignment, ready-by, lock webhook with HMAC, SignalR hub, board UI, 501 position stub.
Out: any housekeeper location tracking, the occupancy report (`docs/bug-LH-56.md`), login/auth, the net10 bump (M4).

## Acceptance criteria
AC_01 Dirty→Cleaning works and is recorded.
AC_02 Cleaning→Inspected works.
AC_03 Inspected→Ready works, `SelfMarked` false.
AC_04 Cleaning→Ready works and sets `SelfMarked` true.
AC_05 Dirty→Ready refused, 400.
AC_06 Every other illegal move refused, 400 naming allowed moves.
AC_07 Any→OutOfOrder with a reason works.
AC_08 OutOfOrder without a reason refused, 400.
AC_09 OutOfOrder→Dirty only.
AC_10 Assigning an OOO room refused.
AC_11 Assigning a Ready room still works.
AC_12 Standard boundary: 45:00 not late, 46 min late by 1.
AC_13 Suite/Family boundary: 75:00 not late, 76 late by 1.
AC_14 Clock counted from checkout, not from Dirty.
AC_15 Late list worst first.
AC_16 Room made Ready after target is listed late.
AC_17 Floor rules: many floors per housekeeper, one housekeeper per floor.
AC_18 Signed webhook makes the room Dirty with `checkedOutAt`.
AC_19 Duplicate webhook is idempotent (one history row, one push).
AC_20 Bad, missing signature or missing secret gives 401.
AC_21 Unknown room 404; booking not in that room 422.
AC_22 Hub pushes `room-updated` to the hotel's group only.
AC_23 Position endpoint returns 501 with the exact body; nothing stored.
AC_24 Ready-by for Ready, Dirty and OOO rooms.
AC_25 Concurrent moves: one wins, one gets 409.
AC_26 Desk check-out plus lock event: Dirty once, earlier timestamp wins.

## API contract
Full shapes and errors are in the spec's API section. Summary:
| Route | Success | Errors |
|---|---|---|
| `GET /api/hotels/{id}/board?floor=` | 200 floors → rooms | 404 |
| `POST /api/rooms/{id}/transitions` `{to, reason?, expectedReturnAt?}` | 200 room | 400 illegal/validation, 404, 409 |
| `GET /api/rooms/{id}/ready-by` | 200 | 404 |
| `GET /api/hotels/{id}/late-rooms` | 200 worst first | 404 |
| `GET/PUT /api/hotels/{id}/floor-assignments` | 200 | 400, 404 |
| `POST /api/lock-events/checkout` + `X-Signature` | 200 (`duplicate` flag) | 400, 401, 404, 422 |
| `/hubs/board` SignalR, `JoinHotel(id)`, event `room-updated` | – | – |
| `GET /api/housekeepers/{id}/position` | – | 501 ProblemDetails "Not implemented" |
| `POST /api/bookings/{id}/room` (existing) | – | new: 422 for OOO room |

Illegal moves are **400**, but `BusinessRuleException` is 422 today. Add `InvalidTransitionException` → 400 in `Infrastructure/Exceptions.cs`; leave existing 422 behaviour alone.

## Plan by area

### db-analyst (first, writes `docs/db-analysis.md`)
Check: board query is one query per request; index on `rooms(hotel_id, floor)`; late-rooms query filtered in SQL; concurrency token on `rooms`; the two unique keys below.

### backend → `backend/Larchmont.Api/**`, `backend/db/migrations/V005__housekeeping.sql`
1. **Migration V005** (new file; V001–V004 untouched):
   - `UPDATE rooms SET status='Ready' WHERE status='Clean'`; change column default to `'Ready'`; same for `room_status_history`.
   - `rooms`: add `self_marked`, `checked_out_at`, `ooo_reason`, `expected_return_at`, `row_version`.
   - `room_types`: add `sla_minutes` (default 45; 75 for Suite and Family, matched by code, to be confirmed against V002 data).
   - `housekeeper_floors(hotel_id, floor, user_id)` with `UNIQUE (hotel_id, floor)`.
   - `lock_events(booking_ref, checked_out_at, room_id, received_at)` with `UNIQUE (booking_ref, checked_out_at)`.
   - `room_status_history`: add `self_marked`, `reason`.
2. **Domain**: `RoomStatuses` gets Cleaning, Inspected, Ready (rename Clean); new entities; update `LarchmontDbContext`.
3. **Rules**: `RoomTransitionRules` (pure static table), `InvalidTransitionException`, SLA calculator.
4. **Services/repos**: `HousekeepingService` (transition, board, late, ready-by, assignments, lock checkout), repository methods behind existing repository classes only (layering: controller → service → repository). Edit `BookingService.AssignRoomAsync` (OOO block) and `CheckOutAsync` (set `checked_out_at`, go through the same path and push).
5. **Webhook**: `LockSignatureVerifier` (HMAC-SHA256, constant-time compare, raw body, fail closed with no secret). Secret only from `LockEvents__SharedSecret`; nothing in `appsettings*.json`.
6. **Live push**: `BoardHub`, `IBoardNotifier`; `Program.cs`: `AddSignalR`, `MapHub<BoardHub>("/hubs/board")`, CORS `AllowCredentials`, DI for every new service and repository.
7. **Controllers**: board, transitions, ready-by, late-rooms, floor-assignments, lock-events, housekeepers position stub (returns 501 ProblemDetails; no service call). Validators in `Validators/` for each request DTO. Remove or redirect `PUT /api/rooms/{id}/status`.

### frontend → `frontend/src/**`
`api/board.ts`, `api/types.ts`, `hooks/useBoardHub.ts` (`@microsoft/signalr`, 30 s polling fallback), `pages/BoardPage.tsx`, `LateRoomsPage.tsx`, `FloorAssignmentsPage.tsx`, routes in `App.tsx`, `vite.config.ts` proxy `/hubs` with `ws: true`. Loading, empty and error states through `StateView`. No location UI. Follow `frontend/CLAUDE.md`.

### tests → `backend/Larchmont.Tests/**`
xUnit, names `AC_NN_Description`. Unit tests (Moq) for `RoomTransitionRules` and the SLA boundary (inject a clock; no dependence on current time). `ApiFactory` tests for endpoints and the 501 stub; set the webhook secret in the factory configuration. **Real MySQL 8.4 tests** (throwaway DB from `compose.yaml`) for: the two unique constraints, duplicate-webhook race, concurrent transition (AC_25), and the board query's SQL. Each new test must fail first against the unimplemented code.

## Risks and open questions
- Brief conflict: "no exceptions" supervisor inspection vs housekeeper self-mark. Built as instructed with the flag; Sofia must define "simple turn" (spec Q1).
- Spec Q2–Q9 are unanswered: SLA owner, which timestamp starts the clock, whether a lock feed exists, OOO return date, whether to block Dirty rooms (the brief's demo test), OOO on occupied rooms, clock after OOO, roles with no login. Q3, Q4 and Q9 could change the design; get answers before the webhook and permissions are built.
- The `Clean`→`Ready` rename touches existing data and any frontend/report code that reads `Clean`; grep before the migration.
- Project still targets net8.0 until M4. Write for net10, but it must build today.
- InMemory cannot prove constraints, concurrency or SQL; AC_19 and AC_25 need real MySQL.
- Two sources of checkout (desk and lock) must not double-fire.
- Time: UTC only.
- Privacy: position endpoint must never read or write location; reviewer checks the "stops when off duty" item in `docs/review-checklist.md`.

## Verify
- `dotnet build backend/Larchmont.sln`
- `dotnet test backend/Larchmont.sln`
- `cd frontend && npm run build`
- Real MySQL: `docker compose up -d`, run the MySQL-tagged tests, check the board SQL log.
- Manual: post a signed webhook with curl and watch the board change with no refresh; try assigning an OOO room; read `/swagger`.
- Then run `reviewer` against `docs/review-checklist.md`.

Next: review this file, then `/implement FEATURE-housekeeping-api.md`.
