# Review report: housekeeping board API

Date: 2026-10-27
Branch: alok-changes, uncommitted working tree against `main` (HEAD 65812db). Nothing is committed.

Scope reviewed:
- Modified: Controllers (`GuestUserRateControllers.cs`, `HotelControllers.cs`), `Data/LarchmontDbContext.cs`, `Domain/Entities.cs`, `Dtos/Dtos.cs`, `Infrastructure/Exceptions.cs`, `Mappers/Mappers.cs`, `Program.cs`, `Repositories/BookingRepository.cs`, `Repositories/HotelRepositories.cs`, `Services/BookingService.cs`, `Services/GuestUserRateServices.cs`, `Services/HotelServices.cs`, `Larchmont.Tests/ApiFactory.cs`.
- New backend files: `HousekeeperPositionController`, `HousekeepingControllers`, `LockEventsController`, `RoomTransitionRules`, `Turnaround`, `HousekeepingDtos`, `BoardHub`, `LockSignatureVerifier`, `SignalRBoardNotifier`, `HousekeepingMappers`, `DbSave`, `HousekeepingRepository`, `HousekeepingService`, `LockEventService`, `HousekeepingValidators`.
- New migrations `V005`, `V006`, `V007`.
- New tests `HousekeepingApiTests.cs`, `HousekeepingSlaWebhookTests.cs`, `HousekeepingSupport.cs`, `MySqlConcurrencyTests.cs`.
- Read against: `docs/review-checklist.md`, `docs/specs/housekeeping-board.md`, `FEATURE-housekeeping-api.md`, `docs/db-analysis.md`, `docs/privacy-note.md`, `.claude/rules/*`.
- Not in the diff: no `frontend/` change and no `.github` change.

## Summary

- Checklist: **11 Fail, 8 Pass, 1 Not applicable** (20 items).
- Verdict: **Do not merge.** The core design is sound: state machine, HMAC check, 501 stub, DTO fix and row-version tokens. Four things block it.
  - The turnaround clock is wrong from the second use of any room.
  - Committed credentials remain in the repo.
  - No HTTP behaviour could be run here.
  - Many acceptance criteria have no test.

Commands I ran:
- `dotnet build backend/Larchmont.sln`: Succeeded, 0 warnings, 0 errors (net8.0).
- `dotnet test backend/Larchmont.sln`: the test host will not start without a .NET 8 runtime.
- `DOTNET_ROLL_FORWARD=Major dotnet test --no-build`: **Failed 41, Passed 17, Total 58.** This matches the figure you gave.
  - Every failure I opened has `The PipeWriter 'ResponseBodyPipeWriter' does not implement PipeWriter.UnflushedBytes`.
  - It also hits the pre-existing `ApiTests` (for example `Hotels_List_ReturnsSeededHotel`).
  - Any test whose response has a JSON body fails.
  - The 17 passing tests are non-HTTP unit tests. None of them exercise the new code.
- I did not run `npm run build` (no frontend change).

## Findings, most severe first

### F1 (High). Turnaround clock is never reset, so second and later cycles are wrong, and out-of-order rooms show as late
- Files:
  - `Services/HousekeepingService.cs:361-362` (`timestampChanged = room.CheckedOutAt is null || checkedOutAt < room.CheckedOutAt`).
  - `HousekeepingService.cs:174-183` (the Ready and OutOfOrder branches never clear `CheckedOutAt`).
  - `Repositories/HousekeepingRepository.cs:84-87` and `Domain/Turnaround.cs:13-14`.
- Problem:
  - "Earliest checkout wins" (AC-26) is applied against the room's previous cycle, not just the same checkout.
  - `checked_out_at` is kept after the room is Ready, so it is never the earliest for the next guest.
- Failing scenario:
  - Room 101 checks out Monday 10:00 and is Ready by 10:30.
  - A new guest checks out Wednesday 10:00, by desk or lock.
  - `checkedOutAt` (Wed) is not less than `room.CheckedOutAt` (Mon), so the Monday time stays.
  - The room goes Dirty with the clock two days old.
  - The late list (`status != Ready && now > due`) shows it about 2,900 minutes over, and the board tile shows the same.
  - A same-day turnover is also wrong.
  - Ready room, then moved to OutOfOrder: `CheckedOutAt` stays set.
  - `ListLateRoomsAsync` has no OutOfOrder exclusion, so the room is "late" forever with growing minutes.
  - `db-analysis.md` section 4.2 told the author to exclude OutOfOrder.
  - Current tests do not catch this because every seeded room has a null `CheckedOutAt`.
- Fix:
  - Apply "earlier wins" only when the existing `CheckedOutAt` belongs to the same open checkout. For example, the room is already Dirty and a `checkout_events` row for this booking exists.
  - Otherwise overwrite `CheckedOutAt`, and clear `ReadyAt` and `SelfMarked`.
  - Exclude OutOfOrder from the late list and from board `minutesOver`.
  - Add a two-cycle test and an OOO-late test.

### F2 (High). Credentials are committed in the repo (not introduced by this diff, still unremediated)
- Files (values deliberately not repeated here):
  - `backend/Larchmont.Api/appsettings.Development.json:3` has a MySQL app password in the connection string.
  - `appsettings.Development.json:7` has `ChannelManager.ApiKey`, a production-style key.
  - `appsettings.Development.json:13` has `Smtp.Password`.
  - `compose.yaml:5` has `MYSQL_ROOT_PASSWORD`.
  - `db-setup/01-create-users.sql` contains the application user password (the grep matched it).
- Git state:
  - The file is tracked and has been in git history since commit 540db4c.
  - `.gitignore` does not exclude it.
  - `.claude/rules/coding-conventions.md` says "No secrets in `appsettings*.json`".
- Fix:
  - Treat all four secrets as burned. Rotate the channel key, the SMTP password and both DB passwords.
  - Move the values to user-secrets or env vars (`ConnectionStrings__Larchmont`).
  - Commit placeholders only, and purge history if the repo is shared.
- Webhook secret: it is not in any file. `LockSignatureVerifier.cs:24` reads `LockEvents:SharedSecret` only. A grep found no secret under `LockEvents` in any appsettings or compose file. The only value is the test constant `test-lock-secret-not-for-production` in `Larchmont.Tests/ApiFactory.cs:15`, which is acceptable.

### F3 (High). The key behaviours are not proven. No HTTP test could run, the one real-MySQL test passes vacuously, and the migrations were never executed
- Env failure:
  - The 41 failures are the environment (.NET 10 runtime vs Mvc.Testing 8.0.13), not necessarily bugs.
  - Because of it, none of these were demonstrated at runtime: transitions returning 400, webhook 401/200/duplicate, the 501 stub, the OOO assign block, user-DTO fields, late-list boundaries.
- Vacuous MySQL test: `MySqlConcurrencyTests.cs:29` returns early (a pass) when `LARCHMONT_MYSQL_TESTS` is unset. A green line is "not run", not evidence. Mark it with a real skip, or fail loudly in CI.
- Missing real-MySQL coverage:
  - AC-19 duplicate-webhook race and the 1062 path.
  - AC-25 concurrent transitions.
  - The V005-V007 DDL on a V001-V004 database.
  - The board and late-room SQL. Pomelo translation of `CheckedOutAt.AddMinutes(column)` (`HousekeepingRepository.cs:87,91`) is unverified. It could fail at runtime with a 500.
  - `db-analysis.md` states that nothing was measured and V005 was not run.
  - The backend agent reported only that the solution builds.
- Fix: install a .NET 8 runtime, or do the M4 net10 bump and pin Mvc.Testing to match. Then run against compose MySQL 8.4 with the EF SQL log captured.

### F4 (Medium). Many spec acceptance criteria have no test, and test names do not match spec AC numbers
- Traceability: tests are named `AC_01_CheckoutMovesRoomToDirty`, `AC_04_OutOfOrderRoomCannotBeAssigned` and `AC_20_ConcurrentBookingAssignment...`. In the spec those numbers mean other things. The spec's traceability table names (for example `AC_01_DirtyToCleaning`) were not used.
- No test found for:
  - AC-01 and AC-02 as stand-alone moves (Dirty to Cleaning, Cleaning to Inspected).
  - AC-07, AC-08 and AC-09 (OOO with a reason, blank reason gives 400, OOO to Dirty).
  - AC-14 is only partly covered, by `AC_07_SlaClockStartsAtCheckoutNotDirty`.
  - AC-15 (late list ordering worst first) and AC-16 (Ready after target).
  - AC-21 (webhook 404 unknown room, 422 booking not in that room).
  - AC-22 (hub pushes `room-updated` to the hotel group only).
  - AC-25 (two moves of the same room give 409).
  - AC-26 (desk plus lock, earlier time wins).
- Also untested: `RoomTransitionRules` and `Turnaround` have no unit tests. `UnitTests.cs` is unchanged.

### F5 (Medium). "Who" is not recorded, roles are not enforced, and the hub is open
- Files: `Controllers/HousekeepingControllers.cs:63`, `HousekeepingService.cs:196-206`.
- BR-15:
  - Transition history rows get `ChangedByUserId = null`. The legacy `PUT /status` path is the only one that records a user id.
  - The only attribution is `by_user_role`, taken from an unauthenticated `X-User-Role` header that any caller can set. The audit trail can be forged.
- BR-18: roles are not enforced. The code comment states this and spec Q9 is open, so it is an accepted gap, but it is not tested or visible to callers.
- `BoardHub.JoinHotel` (`Infrastructure/BoardHub.cs:13`) lets any client join any hotel's group. Payloads carry no personal data.
- Fix: record a user id once login exists. Meanwhile do not present `by_user_role` as an audit field.

### F6 (Medium). The webhook does not check booking state or event freshness
- Files: `Services/LockEventService.cs:54-60`, `HousekeepingService.cs:340-404`.
- Booking state:
  - A correctly signed event for a booking that is already CheckedOut, or Confirmed or Cancelled but still assigned to the room, is applied.
  - It sets the booking CheckedOut and turns the room Dirty, even if a new guest is in or the room is Ready.
- Future time: `checkedOutAt` in the future is accepted. Only the whole-second truncation is applied.
- Offset parsing: a timestamp with no offset, such as `2026-10-27T09:58:00`, is read as server-local time. The spec says UTC.
- Out-of-order rooms:
  - A room that is OutOfOrder stays OutOfOrder, but the response returns `status: "OutOfOrder"`.
  - This differs from BR-11 and AC-18's "Dirty at once".
  - It is a reasoned choice (spec Q7 is unanswered) but is not documented in the spec.
- Fix:
  - Accept only a booking in `CheckedIn` or already `CheckedOut` with the same time.
  - Reject future times and offset-less times with 400.
  - Document the OOO case.

### F7 (Medium). Floor assignments have no concurrency protection
- Files: `Repositories/HousekeepingRepository.cs:134-144`, `HousekeepingService.cs:230-271`.
- Two PUTs for the same hotel that both add the same new floor will hit the primary key and return 409. Good.
- Two PUTs that update or delete the same existing row have no token and no per-hotel lock. The last writer wins silently.
- `db-analysis.md` 3.3 recommended `SELECT ... FOR UPDATE` on the hotel row or a token.
- An inactive housekeeper (`Users.Active = false`) is accepted as a floor holder (`HousekeepingService.cs:413-421`).

### F8 (Low). Migration risks
- `V006__housekeeping_columns.sql:17-25` backfills `checked_out_at` for seeded Dirty rooms from the last Dirty history time, else `UTC_TIMESTAMP()`.
  - Seeded history is old, so these rooms will show as very late on first load.
  - If there is no history row, they become late 45 minutes after the migration runs.
- DDL is not transactional (documented in the file). A half-applied V006 cannot be re-run.
- Naming divergence: `FEATURE-housekeeping-api.md` still says `V005__housekeeping.sql` and `lock_events`. The code uses V005-V007 and `checkout_events`. The FEATURE file is stale.
- The `booking_notes.note` 255 vs 1000 mismatch from `db-analysis.md` is pre-existing and was not fixed.

### F9 (Low). Undocumented additions and deviations from the spec
- Extra endpoints and behaviour:
  - `POST /api/housekeepers/{id}/position` also returns 501 (`HousekeeperPositionController.cs:19`). Harmless, but the spec says GET only.
  - `POST /api/rooms/{id}/out-of-order`, `GET /hotels/{id}/sla-breaches` and `POST /api/housekeepers/{id}/floors` are not in the spec.
  - There are extra SignalR events: `sla-breach-added` and `housekeeper-moved`. The second is a floor-assignment event, not a position event, but the name could be misread.
  - A 24 hour window for late-but-Ready rooms (`HousekeepingService.cs:32`) is not in the spec.
- `ReadyByDto` carries extra fields `estimatedReadyAt` and `basedOn`. For a Ready room, `readyBy` is "now".
- The board shows `minutesOver` for a Ready room from any past cycle, with no window.
- The spec says assignment is `POST /api/bookings/{id}/room`. The real route is `/assign-room`. Fix the spec.
- `BookingService.cs:489` throws `InvalidOperationException` (a 500) if `IHousekeepingService` is missing. DI always supplies it, but the optional constructor parameter exists only to keep hand-built test instances compiling.
- `LockSignatureVerifier.cs:25` treats a whitespace-only secret as configured. Use `IsNullOrWhiteSpace`. There is no replay window. Replays are harmless because of idempotency.

## Attention items you asked about

| Item | Result | Evidence |
|---|---|---|
| HMAC verification | Pass by code, not run | The raw body is buffered and read as bytes before binding (`LockEventsController.cs:21-27`). `CryptographicOperations.FixedTimeEquals` compares (`LockSignatureVerifier.cs:38`). A missing secret, header or prefix returns false (`:30-32`), which gives 401 before the body is parsed (`LockEventService.cs:39`). The secret comes only from `LockEvents:SharedSecret`. The wrong or missing signature tests exist (`AC_22_...`) but could not run. Only the whitespace-secret nit applies. |
| 501 position stub stores/logs nothing | Pass by code, not run | `HousekeeperPositionController.cs:16-29`. No service, repository or model binding. The string id is not looked up. There is no location entity (the db-analysis model has none). The tests `AC_18`/`AC_19` could not run. The extra POST verb is noted in F9. |
| Illegal moves return 400, not 500 | Pass by code, not run | `InvalidTransitionException` maps to 400 (`Exceptions.cs:57-59`). `ApplyMoveAsync` checks the rules before any write (`HousekeepingService.cs:164-165`). The message names the state and the allowed moves (`RoomTransitionRules.cs:28-35`). The theory test has 11 cases and could not run. |
| OOO assignment block | Pass by code, not run | `BookingService.cs:504-505` returns 422 before the overlap check. `AC_04_OutOfOrderRoomCannotBeAssigned` could not run. |
| SLA boundary and clock source | Boundary Pass; cycle reset Fail | `Turnaround.MinutesOver` returns 0 at exactly the target and `ceil(seconds/60)` after. The SQL uses `now > due`, consistent with it. The clock is the injected `TimeProvider` (`HousekeepingService.cs:424`), truncated to seconds. The new code does not use `DateTime.UtcNow`. The two-cycle bug is F1. |
| Idempotency and concurrency (row_version, 409) | Design Pass; unproven | `BumpRowVersions` in `LarchmontDbContext.cs:92-102`, the `IsConcurrencyToken` entries, `DbSave.SaveAsync` mapping to `ConflictException` (409), `BumpVersion` in `AssignRoomAsync`, the unique key plus 1062 handling, and the room, history and event written in one `SaveChanges`. None of it was run against MySQL (F3). The floor gap is F7. |
| Migrations vs EF model | Pass by reading | Types, lengths, nullability and indexes agree: `self_marked` is `TINYINT(1)`/bool, `sla_minutes` is `SMALLINT UNSIGNED`, `ooo_reason` is mapped through `ColumnOverrides`, `ix_rooms_hotel_floor` and `ux_checkout_events_ref_time` match, and the `housekeeper_floors` composite PK matches. V001-V004 are unmodified. The DDL was never executed. |
| N+1 on board and late queries | Pass by code, SQL unverified | Board is the hotel check, one rooms-plus-types join and one assignments join, three queries. The late list is the hotel check plus one query, filtered in SQL, then sorted in memory. `AsNoTracking` is used. There is no SQL log evidence. |
| User DTO leaks | Pass | `UserPublicDto` returns only id, displayName, role, hotelId and active (`Dtos.cs:32`, `Mappers.cs:78-80`). `PasswordHash`, email, phone and lastLogin are gone. `UserRef` is projected and never reads the hash. `AC_21` could not run. Pre-existing guest endpoints still return full personal data to any caller. That is out of this diff, but note it. |
| Committed credentials | Fail | See F2. |

## Full checklist

### Correctness
1. **Does what the spec's acceptance criteria say, and every criterion has a test: Fail.** See F4 for the missing tests and F1 for a failing criterion (AC-26, and AC-12 to AC-16 after a second cycle). Test names do not follow the spec traceability table. All 41 HTTP tests failed to run here.
2. **Business rules live in the service layer: Pass.** Transition rules are in `Domain/RoomTransitionRules.cs`, SLA maths in `Turnaround.cs`, the OOO block in `BookingService.cs:504`, and all orchestration in `HousekeepingService.cs`. Controllers are thin. Note: the late predicate is also encoded in the repository (`HousekeepingRepository.cs:86-91`) and duplicated in `Turnaround`, which risks drift.
3. **Invalid input and state changes return a 4xx ProblemDetails, never a 500: Pass (code only, not confirmed by running).**
   - Illegal moves return 400; validation errors, bad floors and malformed webhook JSON return 400; bad signature returns 401; unknown ids return 404.
   - The handler now writes `application/problem+json` (`Exceptions.cs:81-82`).
   - Residual 500 risks: untested Pomelo translation (F3) and the `InvalidOperationException` in F9.
4. **Date and night counting right at the edges: Fail.** The second-by-second boundary is correct (45:00 not late, 45:01 gives 1). The clock start and same-day turnover are wrong because `checked_out_at` is never reset (F1). Out-of-order to Dirty sets `CheckedOutAt = now` (`HousekeepingService.cs:186`), which is the spec Q8 assumption.
5. **Tests are reliable and repeatable: Fail.** Good: a `FakeClock`, one InMemory database per factory, and fixed dates. Bad: `MySqlConcurrencyTests.cs:29` passes without running (F3). In this environment 41 of 58 tests fail for a package/runtime reason.

### Data
6. **Every schema change is a new migration; no applied migration was edited: Pass.** `git status` shows only new V005, V006 and V007. V001 to V004 are untouched.
7. **Migration and EF model agree: Pass (by reading only).** See the attention table. Not run on MySQL. The pre-existing `booking_notes` mismatch is noted in F8.
8. **List endpoints run a fixed number of queries: Pass (code only).** Board is 3 queries, late list is 2, floors are fixed. The SQL log was not captured and the translation is unverified (F3).
9. **Two people changing the same record cannot both succeed silently: Fail.**
   - Rooms and bookings have an `IsConcurrencyToken` row version, a bump on save, and a 409 mapping. The assign path serialises on the room row.
   - Floor assignments have no guard (F7).
   - No test demonstrates AC-25 for transitions (F3, F4).
   - The only real-MySQL test is vacuous when its variable is unset.

### Security and privacy
10. **No secret, key or password committed: Fail.** F2. The new webhook secret is correctly absent.
11. **No response returns fields the caller does not need: Pass.** `UserPublicDto` replaces the old DTO. Board and push payloads hold no hashes or contact data. Pre-existing guest responses are unchanged and out of scope.
12. **Personal data shown only to the roles that need it, and nothing stored that the business has no right to keep: Fail.**
    - Storage is fine: history stores a role string, not a person's location.
    - Display is not role-limited. There is no login (spec Q9), `X-User-Role` is spoofable, any caller can read the board with housekeeper names and `GET /api/users`, and any client can join any hub group (F5).
    - This is a known, accepted gap, but the item cannot be passed.
13. **Anything that tracks staff or guests has a lawful purpose and stops when off duty: Pass (code only).** The position endpoint is a stub that receives, stores and logs nothing, in line with `docs/privacy-note.md`. Floor assignment and move history are work records. The test that proves no location is stored could not run.

### Tests
14. **Each test fails if the behaviour it names is broken: Fail (not demonstrated).** I could not run any HTTP test, so I could not try breaking the code. One test passes without running. Several named behaviours have no test (F4).
15. **No test depends on current date, time zone or test order: Pass.** The `FakeClock` is fixed at 2026-10-27 09:00Z, dates are fixed and each test builds its own factory. Existing `BookingService` uses `DateTime.Now` at line 132, but no new test relies on it.
16. **New code has a test that fails on the old code: Fail.** Much of the new code has no test (F4). The journal says the 37 AC tests were written red before the backend landed, but there is no green run to compare with.

### Delivery
17. **`dotnet build`, `dotnet test` and `npm run build` pass from a clean checkout: Fail.** Build passes. Test: 41 of 58 fail (PipeWriter error, environment/package mismatch). `npm run build` was not run.
18. **The CI workflow runs the same steps and its paths and versions match the repo: Fail.** `.github/workflows/ci.yml` uses `dotnet-version: '6.0.x'` and `working-directory: web` (the folder is `frontend/`). It triggers on `main` only. It has no MySQL service, so the MySQL tests would pass vacuously. The diff did not touch it.
19. **README and CLAUDE.md match how the project is built and run: Fail.** README still says .NET 8 and `dotnet run --project Larchmont.Api`. Neither document mentions `LockEvents__SharedSecret`, `/hubs/board` or `LARCHMONT_MYSQL_TESTS`. CLAUDE.md says net10.0 is the target while the csproj files are net8.0 (known, M4).
20. **Loading, empty and error states on every new screen: Not applicable.** No frontend screens were added. The spec's board, late rooms and floor assignment UI are not built.

## What I could not verify
- **Needs a runnable HTTP test host.** Every request-level behaviour could not be confirmed here because of the runtime/package mismatch (41 failures). That covers checklist items 1, 3, 11, 13, 14 and 16 and these attention items: HMAC 401 and idempotency, the 501 stub, illegal-move 400s, the OOO assign block, late-list boundaries and the user-DTO fields. I confirmed them by reading code only.
- **Needs real MySQL 8.4.** No MySQL was used. Not confirmed:
  - V005-V007 apply cleanly on V001-V004 data.
  - Pomelo translates the late-list query.
  - Query counts in the EF SQL log.
  - Real concurrency: 409 on simultaneous moves, assign races, the duplicate-webhook race.
  - The 1062 handling.
  - Whether `DATETIME(0)` truncation behaves as intended.
- **Needs a SignalR client test.** The hub group isolation (AC-22) was not tested. I checked the group name only.
- **Mutation checks** (breaking the code to see tests fail) were not possible.
- **`npm run build`** was not run. Frontend files are unchanged.
- I did not check git history for secrets beyond confirming `appsettings.Development.json` has been tracked since 540db4c.
