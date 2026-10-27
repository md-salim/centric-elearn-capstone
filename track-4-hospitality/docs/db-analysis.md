# DB analysis: planned V005 housekeeping migration

Scope: MySQL 8.4, DbUp scripts, EF Core + Pomelo. Inputs read: `FEATURE-housekeeping-api.md`, `docs/specs/housekeeping-board.md`, `CLAUDE.md`, `.claude/rules/coding-conventions.md`, `backend/db/migrations/V001..V004`, `Data/LarchmontDbContext.cs`, `Domain/Entities.cs`, `Repositories/HotelRepositories.cs`, `Repositories/BookingRepository.cs`, plus `Services/BookingService.cs`, `Services/HotelServices.cs`, `Infrastructure/Exceptions.cs`.

## 0. What was measured and what was only reasoned

**Nothing was measured.** No throwaway MySQL 8.4 was available: `docker` is not installed on this machine, and the compose container is not running. Something answers on 127.0.0.1:3306, but it rejected the `compose.yaml` root credentials. It is therefore not the throwaway DB, and I did not probe it further. Every plan, row count and concurrency claim below is **reasoned, not measured**.

| Item | Status |
|---|---|
| Schema, constraints, types (V001-V004 vs EF model) | Read from source (fact) |
| Count of `Clean` in seed data (104 rooms in V003, history rows in V004) | grep of source (fact) |
| Code that reads `Clean` | grep of source (fact) |
| Index use and plans for board, late-rooms, ready-by | Reasoned |
| EF to SQL translation (`AddMinutes`, grouping) | Reasoned, must be checked in the EF SQL log |
| Concurrency behaviour (409 paths, double-assign) | Reasoned |
| V005 runs cleanly on a V001-V004 database | Not run |

## 1. Schema summary and model/migration mismatches

Tables (V001): `hotels`, `room_types`, `rate_plans`, `room_rates`, `users`, `rooms`, `room_status_history`, `guests`, `bookings`, `booking_notes`. All InnoDB by default, all keys `INT AUTO_INCREMENT` (history is `BIGINT`). Charset and collation come from the database (`utf8mb4_0900_ai_ci` per `db-setup/01-create-users.sql`), so string comparison is case and accent insensitive.

Relevant facts:
- `rooms`: `status VARCHAR(20) NOT NULL DEFAULT 'Clean'`, `floor INT NOT NULL`, only index is `ux_rooms_hotel_number (hotel_id, room_number)` plus the two FK indexes. There is no index that serves `floor`.
- `bookings`: `ix_bookings_room (room_id)`, `ix_bookings_hotel_dates (hotel_id, check_in)`, unique `reference VARCHAR(20)`. No `bookings` uniqueness prevents two bookings sharing a room on overlapping dates.
- All timestamps are `DATETIME` (no fractional seconds). No timestamp columns carry a timezone; code writes `DateTime.UtcNow`.
- `room_types.code`: `STD, TWN, SUP, FAM, JNR, STE` (V002 lines 10-16). Names: Standard Double, Standard Twin, Superior Double, Family Room, Junior Suite, Suite.
- `users.role` includes `Housekeeper` (12 rows in V003, two per hotel), `users.hotel_id` is nullable (directors have NULL).

Mismatches and gaps (file references):
1. `booking_notes.note` is `VARCHAR(255)` in `V001__create_schema.sql:132` but `HasMaxLength(1000)` in `LarchmontDbContext.cs:108`. EF does not create the schema, so the 1000 is never applied. A 256-1000 character note passes the model and fails in MySQL strict mode with "Data too long" (a 500). Not part of V005, but fix with a validator limit of 255 or a later `ALTER ... VARCHAR(1000)`.
2. `room_status_history.changed_by_user_id` (V001:77) and `booking_notes.author_user_id` (V001:131) have no FK to `users`. BR-15 needs "who" on every move, so the history FK should exist (see section 3.4).
3. `Entities.cs:51,57,60` hard-code `Clean`; the DB default `'Clean'` in `rooms.status` (V001:65) is invisible to EF (no `HasDefaultValue`), so new `Room` objects get the status from the C# initialiser, not the column default. Both must change together.
4. EF model has no `HasOne/HasMany` or FK configuration. This is harmless because the FKs live in SQL, but the new entities must not assume EF will create or validate anything.
5. `Room` has no concurrency token, `Booking` has none either (section 5).
6. `DateTime` properties map to `DATETIME(0)`. MySQL **rounds** fractional seconds on insert into `DATETIME(0)`. This matters for `checked_out_at` and the idempotency key (section 3.2).

## 2. The `Clean` to `Ready` rename

### What reads or writes `Clean` today
- `backend/Larchmont.Api/Domain/Entities.cs:51` (`Room.Status` default), `:57` (const), `:60` (`RoomStatuses.All`).
- `backend/Larchmont.Api/Services/HotelServices.cs:152` (`CreateAsync` sets new rooms to `Clean`). `HotelServices.cs:174-175` validates against `RoomStatuses.All`, so after the rename the old `PUT /api/rooms/{id}/status` rejects `Clean`.
- `V001__create_schema.sql:65` default; `V003` inserts 104 rooms with `'Clean'` (10 `Dirty`, 6 `OutOfOrder`); `V004` lines 611-724+ insert history rows with `'Clean'` in both `from_status` and `to_status`.
- Not found: nothing in `frontend/src`, `db-setup`, or test sources reads `Clean` (grep). Compiled `bin/` output matches only because it is a build artefact. Re-grep right before merging, because `docs/bug-LH-56.md` (occupancy report) was out of scope and I did not read it.

### Data update
Rewrite both columns of history, not just `to_status`, otherwise `Dirty -> Clean` rows and `Clean -> Dirty` rows become inconsistent with the new vocabulary. The tables are tiny (120 rooms, a few hundred history rows), so full scans are fine. No index is needed.

Order matters: update data first, then change the default, then add columns. MySQL DDL implicitly commits, so **V005 is not transactional**. If it dies half way, DbUp does not record the journal entry and the rerun will fail on `ADD COLUMN` (duplicate column). Recommendation: split into small scripts so each can be retried (V005 rename, V006 columns/seed, V007 new tables), or accept that a failed V005 on a throwaway DB means drop and recreate. Do not guard with `IF NOT EXISTS` (not supported for `ADD COLUMN` in MySQL).

```sql
-- V005__rename_clean_to_ready.sql (PROPOSED, NOT APPLIED)
UPDATE rooms               SET status      = 'Ready' WHERE status      = 'Clean';
UPDATE room_status_history SET from_status = 'Ready' WHERE from_status = 'Clean';
UPDATE room_status_history SET to_status   = 'Ready' WHERE to_status   = 'Clean';
ALTER TABLE rooms ALTER COLUMN status SET DEFAULT 'Ready';
```
`room_status_history` has no default on `to_status`/`from_status` (V001:75-76), so "default change" applies only to `rooms.status`. The spec/feature text says "same for `room_status_history`"; there is nothing to change there except the data.

Verification query to run on a real DB afterwards: `SELECT status, COUNT(*) FROM rooms GROUP BY status;` must show 0 `Clean`; same for both history columns. Do the check in a MySQL-tagged test.

## 3. New columns and tables

### 3.1 Columns on `rooms` and `room_status_history`, and `room_types.sla_minutes`

```sql
-- V006__housekeeping_columns.sql (PROPOSED, NOT APPLIED)
ALTER TABLE rooms
  ADD COLUMN self_marked        TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN checked_out_at     DATETIME    NULL,
  ADD COLUMN ready_at           DATETIME    NULL,
  ADD COLUMN ooo_reason         VARCHAR(255) NULL,
  ADD COLUMN expected_return_at DATETIME    NULL,
  ADD COLUMN row_version        INT         NOT NULL DEFAULT 0,
  ADD KEY ix_rooms_hotel_floor (hotel_id, floor, room_number);

ALTER TABLE room_status_history
  ADD COLUMN self_marked  TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN reason       VARCHAR(255) NULL,
  ADD COLUMN by_user_role VARCHAR(20)  NULL;

ALTER TABLE room_types
  ADD COLUMN sla_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 45,
  ADD CONSTRAINT ck_room_types_sla CHECK (sla_minutes BETWEEN 1 AND 1440);

UPDATE room_types SET sla_minutes = 75 WHERE code IN ('STE', 'FAM');

ALTER TABLE bookings
  ADD COLUMN row_version INT NOT NULL DEFAULT 0;
```

Notes and decisions:
- **`ready_at` is missing from the plan and is required.** AC-16 ("made Ready 50 minutes after checkout is listed late by 5") needs the moment the room became Ready. Without it the late query must join `room_status_history` for the latest `Ready` row per room, which is a correlated subquery. One nullable column on `rooms`, set on every move to Ready and cleared on moves out of Ready, keeps the late query a single-table scan plus one join to `room_types`.
- Column names follow the existing snake_case convention, which the DbContext derives from the property name (`LarchmontDbContext.cs:111-113`). The spec calls it `ooo_reason` / `expected_return_at`; the task brief mentioned `out_of_order_reason` / `out_of_order_until`. Pick one set before coding. I used the FEATURE file names. `ooo_reason` matches property `OooReason`, which the regex converts to `ooo_reason`. A property named `OutOfOrderReason` would become `out_of_order_reason`.
- `self_marked` on `rooms` is state, not history. Clear it whenever the room leaves Ready (any move out of Ready), otherwise a later Ready via Inspected shows a stale badge. The history row keeps the permanent record.
- `ooo_reason` 255 matches `notes VARCHAR(255)` (V001:66); `reason` on history same length. The service must also trim and cap at 255 (validator), since EF will not.
- `by_user_role` is a snapshot of `users.role` (VARCHAR(20), same width). Role only, no location or other personal data, consistent with `docs/privacy-note.md`. `changed_by_user_id` remains nullable.
- `sla_minutes` SMALLINT UNSIGNED is enough (max 65535). MySQL 8.4 enforces `CHECK`. EF: `RoomType.SlaMinutes` as `int` is fine (SMALLINT UNSIGNED reads into int; the model has no max length concern), or use `ushort`.
- **Suite and Family codes:** from V002 the codes are `STE` (Suite) and `FAM` (Family Room). **`JNR` (Junior Suite) is ambiguous.** The spec says "Suite and Family room types", so JNR stays at 45. Ask Sofia (spec Q2). Match on `code`, not `id` or `name`, as the FEATURE file says. A `WHERE code IN (...)` that matches 0 rows would silently seed nothing, so the MySQL test should assert exactly 2 room types have 75.
- **Backfill of `checked_out_at`:** the 10 rooms currently `Dirty` in V003 have no checkout time, so after V006 they have `checked_out_at IS NULL`. They would never appear late and ready-by would be null. Either backfill from history (`MAX(changed_at)` of the latest `to_status='Dirty'` row where one exists) or accept NULL and document that legacy Dirty rooms are excluded. The late query must say `checked_out_at IS NOT NULL` explicitly.
- OOO to Dirty (spec Q8): if a new clock starts at that moment, `checked_out_at` is overwritten with the return time, which contradicts BR-08 ("clock from checkout"). Keep `checked_out_at` for real checkouts only, and decide whether OOO to Dirty sets it. This changes late-list semantics, so it needs a stakeholder answer.
- `ALTER TABLE ... ADD COLUMN` on these small tables is instantaneous or near-instant in InnoDB 8.4. Adding the index builds in place. No table-lock concern at this size.
- `ix_rooms_hotel_floor (hotel_id, floor, room_number)` is a superset of the requested `(hotel_id, floor)`. The third column makes `ORDER BY floor, room_number` index-ordered for the board without a filesort. The existing `ux_rooms_hotel_number` already serves `WHERE hotel_id = ?` and `fk_rooms_hotel`, so keep it.

### 3.2 `checkout_events` (webhook idempotency)

Naming conflict: FEATURE line 68 calls it `lock_events(booking_ref, checked_out_at, room_id, received_at)`; the task here says `checkout_events`. Use one name. `checkout_events` is better because the desk path also writes it (see AC-26 below).

```sql
-- V007__housekeeping_tables.sql (PROPOSED, NOT APPLIED)
CREATE TABLE checkout_events (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id     INT          NOT NULL,
  booking_ref    VARCHAR(20)  NOT NULL,
  room_id        INT          NOT NULL,
  checked_out_at DATETIME     NOT NULL,
  source         VARCHAR(10)  NOT NULL DEFAULT 'Lock',
  received_at    DATETIME     NOT NULL,
  UNIQUE KEY ux_checkout_events_ref_time (booking_ref, checked_out_at),
  KEY ix_checkout_events_booking (booking_id),
  KEY ix_checkout_events_room (room_id, checked_out_at),
  CONSTRAINT fk_checkout_events_booking FOREIGN KEY (booking_id) REFERENCES bookings (id),
  CONSTRAINT fk_checkout_events_room    FOREIGN KEY (room_id)    REFERENCES rooms (id)
);
```
- `booking_ref VARCHAR(20)` matches `bookings.reference VARCHAR(20)` (V001:102), so it can also be given a FK to `bookings(reference)` (a unique key) instead of `booking_id`. I kept `booking_id` for a cheap INT join and kept `booking_ref` because the unique key in the spec uses it. They are redundant; the service resolves the ref to the booking first (404 if unknown), so they cannot disagree.
- **Timestamp precision.** `DATETIME(0)` rounds fractional seconds on insert. If the lock system sends `...:58.600Z`, it is stored as `...:59`, and `...:58.400Z` as `...:58`: two near-identical events differ, or a rounding makes a genuine duplicate differ. Truncate to whole seconds in the service **before** the lookup and the insert (and compare using that value), and keep `DATETIME(0)`, consistent with every other column. If sub-second events are real, switch this one column and `rooms.checked_out_at` to `DATETIME(3)` and say so.
- Idempotency pattern: insert the event inside the same transaction as the room change. On duplicate key (MySQL error 1062, `MySqlException.Number == 1062`, reached through `DbUpdateException.InnerException`) roll back and return `duplicate: true`. Do **not** do "SELECT exists then INSERT" as the only guard; two simultaneous identical webhooks both pass the check and the loser is saved only by the unique key. The loser must roll back so there is one history row and one push (AC-19). Push after commit only.
- AC-26 gap: the desk check-out and the lock event for the same real checkout usually carry **different timestamps**, so `UNIQUE (booking_ref, checked_out_at)` does not dedupe them. "Dirty once, earlier timestamp wins" has to come from the booking row (status already `CheckedOut`, guarded by the booking `row_version`, section 5) and a rule `rooms.checked_out_at = LEAST(existing, incoming)`, and the room history row is written only when status actually changes to Dirty. Record desk check-outs in `checkout_events` with `source = 'Desk'`, so there is one place to audit both sources.
- If the lock system only ever sends one event per booking, `UNIQUE (booking_id)` would be stronger, but it contradicts the spec's key and the "earlier timestamp wins" update; leave as specified.
- `ON DELETE` is left as the default (RESTRICT), consistent with V001 which uses no cascades.

### 3.3 `housekeeper_floors`

```sql
CREATE TABLE housekeeper_floors (
  hotel_id INT NOT NULL,
  floor    INT NOT NULL,
  user_id  INT NOT NULL,
  PRIMARY KEY (hotel_id, floor),
  KEY ix_housekeeper_floors_user (user_id),
  CONSTRAINT fk_hf_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id),
  CONSTRAINT fk_hf_user  FOREIGN KEY (user_id)  REFERENCES users (id)
);
```
- `PRIMARY KEY (hotel_id, floor)` *is* the "one housekeeper per floor" rule and also the `UNIQUE(hotel_id, floor)` the spec asks for. Many floors per housekeeper is allowed because `user_id` is not unique. No surrogate id is needed; EF can map the composite key with `HasKey(x => new { x.HotelId, x.Floor })`. If the team prefers a surrogate `id`, keep `UNIQUE (hotel_id, floor)` as named in the spec.
- `floor INT` matches `rooms.floor INT`. `floor` is not a reserved word in MySQL (V001 already uses it).
- The DB cannot check that the user is a Housekeeper or belongs to the hotel (a plain FK only checks existence). Options: validate in the service (400 per the spec, required anyway), and optionally add `UNIQUE KEY ux_users_id_hotel (id, hotel_id)` on `users` and a composite FK `(user_id, hotel_id) REFERENCES users (id, hotel_id)` to make "belongs to this hotel" a DB rule. Role cannot be enforced by FK; keep it in the service. "Floor has no rooms" (400) also needs a query, not a constraint.
- `PUT floor-assignments` is a full replacement, so it is delete-then-insert inside one transaction. Two concurrent PUTs for the same hotel can deadlock (InnoDB gap locks, error 1213) or one can hit the PK (1062). Serialise per hotel by `SELECT id FROM hotels WHERE id = ? FOR UPDATE` first, and map 1062 and 1213 to a retry or a 409.
- Index on `user_id` is required for the FK and for "floors of housekeeper X". The table has at most a few dozen rows per hotel.

### 3.4 Optional hardening (not in the plan)
- FK from `room_status_history.changed_by_user_id` to `users(id)` (`ALTER TABLE ... ADD CONSTRAINT`). Check first that V004 history has no orphan user ids (it uses user ids like 5-26 which exist in V003).
- `room_status_history` index is `(room_id, changed_at)`, which is right for per-room history and for "latest Ready", so no new index is needed there.

## 4. Query analysis

All plans below are **reasoned**. Data size is tiny (120 rooms, 20 per hotel), so MySQL may choose a full scan over an index regardless. The index is for correctness at growth, and `EXPLAIN` must be run on real MySQL to see the actual choice.

### 4.1 Board: `GET /api/hotels/{id}/board?floor=`
Required shape: a fixed number of queries per request (three), no per-floor or per-room query, filter in SQL, group in memory.

1. `SELECT 1 FROM hotels WHERE id = @h LIMIT 1` (404 check; PK lookup, 1 row).
2. Rooms with their type, one join, filtered and ordered in SQL:
```sql
SELECT r.id, r.room_number, r.floor, r.status, r.self_marked, r.checked_out_at,
       r.ready_at, r.ooo_reason, r.expected_return_at, t.name AS room_type, t.sla_minutes
FROM rooms r JOIN room_types t ON t.id = r.room_type_id
WHERE r.hotel_id = @h            -- AND r.floor = @floor when supplied
ORDER BY r.floor, r.room_number;
```
Expected plan (reasoned): `rooms` `ref` on `ix_rooms_hotel_floor` (or `range`/`ref` with the floor param), about 20 rows, no filesort because the index order matches; `room_types` `eq_ref` on PK. Without the new index, `ux_rooms_hotel_number` is used for `hotel_id` and the `ORDER BY floor` needs a filesort (harmless at 20 rows, wasteful at scale), and the `floor = ?` filter is applied per row.
3. Assignments with the housekeeper name:
```sql
SELECT hf.floor, u.id, u.display_name
FROM housekeeper_floors hf JOIN users u ON u.id = hf.user_id
WHERE hf.hotel_id = @h;
```
PK prefix lookup plus `eq_ref` on `users` PK.

EF notes: use `AsNoTracking()` and a projection (no entities, no `Include` chains). Do the floor grouping in memory after the SQL-filtered, hotel-scoped result: EF cannot translate a `GroupBy` that returns the group members to a single SQL statement anyway, and it is safe here because the rows are already limited to one hotel (and optionally one floor) in SQL. Do not call `ListAsync(hotelId, null, null)` and then filter by floor in C#; pass `floor` into the `WHERE`. Compute `dueAt` and `minutesOver` in C# from the injected clock using the already-fetched `checked_out_at`, `ready_at`, `sla_minutes`; that is not a "filter after ToListAsync" because nothing is discarded. Order by `room_number` is a string order (`'1002' < '101'`), so check seed numbering is zero-width consistent per floor.

Existing `RoomService.ListAsync` (`HotelServices.cs:128-133`) already filters by hotel/status/floor in SQL via `RoomRepository.ListAsync` and loads the 6 room types once (2 queries, no N+1). Reuse the pattern.

### 4.2 Late rooms: `GET /api/hotels/{id}/late-rooms`
Filter and sort in SQL. Pass the clock in as a parameter (UTC, from the injected clock) rather than `NOW()`, so boundary tests are deterministic.

```sql
SELECT r.id, r.room_number, r.floor, t.name, r.status, r.checked_out_at,
       DATE_ADD(r.checked_out_at, INTERVAL t.sla_minutes MINUTE) AS due_at,
       CEIL(TIMESTAMPDIFF(SECOND,
            DATE_ADD(r.checked_out_at, INTERVAL t.sla_minutes MINUTE),
            COALESCE(r.ready_at, @now)) / 60) AS minutes_over
FROM rooms r JOIN room_types t ON t.id = r.room_type_id
WHERE r.hotel_id = @h
  AND r.status <> 'OutOfOrder'
  AND r.checked_out_at IS NOT NULL
  AND COALESCE(r.ready_at, @now) > DATE_ADD(r.checked_out_at, INTERVAL t.sla_minutes MINUTE)
ORDER BY minutes_over DESC, r.floor, r.room_number;
```
Plan (reasoned): `ref` on `ix_rooms_hotel_floor` for `hotel_id`, `eq_ref` on `room_types`, residual predicate evaluated per room, small filesort for the sort. No extra index is justified at 20 rows per hotel; a `(hotel_id, checked_out_at)` index would not help because the predicate is a computed expression.

Correctness issues to settle:
- **Boundary and rounding.** Test the predicate in seconds, not minutes. `TIMESTAMPDIFF(MINUTE, ...)` truncates, so 10:45:30 would be "late by 0". With the predicate `> due` and `CEIL(seconds/60)`, 10:45:00 is not late (AC-12), 10:46:00 is 1 minute over, 10:45:01 is 1 minute over. If the product owner wants whole elapsed minutes instead, use `FLOOR` and compare `>= 1 minute`. Decide with Sofia.
- **Ready rooms stay listed forever.** AC-16 lists rooms made Ready late, and `ready_at` is never cleared until the next cycle, so the list grows unbounded. Add a window (e.g. `checked_out_at >= @since`, default start of today UTC, or last 24 h). The spec says "each morning", so a window is implied but not stated. This is a design question, not just SQL.
- `COALESCE(r.ready_at, @now)` handles both "still not ready and past target" and "became ready after target" (BR-09). OutOfOrder rooms are excluded here; spec silent, confirm.
- Whether Pomelo translates `checkedOutAt.AddMinutes(t.SlaMinutes)` with a column argument and `EF.Functions.TimestampDiff` into this SQL is **unverified**; check the EF SQL log. Fallback is `FromSqlInterpolated`, still inside the repository.

### 4.3 Ready-by: `GET /api/rooms/{id}/ready-by`
One query: `rooms` PK lookup joined to `room_types` PK, 1 row, no index concern. Compute in C#. Ready returns "ready now", Dirty/Cleaning/Inspected returns `checked_out_at + sla_minutes` (null if legacy NULL `checked_out_at`, see 3.1), OutOfOrder returns `expected_return_at`.

### 4.4 Existing queries touched by the feature
- `BookingRepository.RoomHasOverlapAsync` (`BookingRepository.cs:51-54`): `SELECT EXISTS(... WHERE room_id = @r AND id <> @b AND status IN ('Confirmed','CheckedIn') AND check_in < @out AND check_out > @in)`. Uses `ix_bookings_room (room_id)` (reasoned), then filters the few rows for that room. Efficient, but it is the check half of check-then-act (section 5).
- `RoomRepository.GetAsync` is tracked (no `AsNoTracking`), correct since callers modify it.
- `BookingService.CheckOutAsync` (`BookingService.cs:157-181`) writes the room status event and the status change but not `checked_out_at`/`ready_at`/`self_marked`; the FEATURE already lists this. It must also clear `self_marked`.

## 5. Concurrency

### 5.1 What is unsafe today (reasoned from code)
- `RoomService.SetStatusAsync` (`HotelServices.cs:172-189`): read room, set status, insert history, save. Two parallel moves both succeed; the later `UPDATE rooms SET status` silently overwrites, and **both** write a history row with the same `from_status`. No token, no unique key.
- `BookingService.AssignRoomAsync` (`BookingService.cs:183-197`): read booking, read room, `RoomHasOverlapAsync`, set `booking.RoomId`, save. Two parallel assigns for *different bookings* on the same room and overlapping dates both pass the overlap check (neither sees the other's uncommitted write) and both commit. Nothing in the schema prevents it.
- `CheckOutAsync`: two parallel check-outs both see `CheckedIn`; both write history and both succeed. Desk check-out racing the lock webhook (AC-26) has the same shape.
- `ConflictException` already maps to 409 (`Exceptions.cs:42`), but `DbUpdateConcurrencyException` is unhandled and would be a 500.

### 5.2 Mechanism: `row_version INT` with `IsConcurrencyToken`
MySQL has no `rowversion`; `[Timestamp]` byte[] is not supported by Pomelo as an auto-generated token. Use an integer version column on `rooms` and `bookings` (added in 3.1, `NOT NULL DEFAULT 0`).

EF model:
```csharp
// Entities: public int RowVersion { get; set; }   (Room and Booking)
// DbContext.OnModelCreating
e.Property(x => x.RowVersion).IsConcurrencyToken();   // column row_version via the snake-case loop
```
EF does **not** increment a plain int token. Do it centrally so nobody forgets (the DbContext is in the Data layer, so this does not break the layering rule):
```csharp
public override Task<int> SaveChangesAsync(CancellationToken ct = default)
{
    foreach (var e in ChangeTracker.Entries().Where(x => x.State == EntityState.Modified
                 && (x.Entity is Room || x.Entity is Booking)))
        e.Property("RowVersion").CurrentValue = (int)e.Property("RowVersion").OriginalValue! + 1;
    return base.SaveChangesAsync(ct);
}
```
EF then emits `UPDATE rooms SET ..., row_version = @new WHERE id = @id AND row_version = @orig`, and a 0-row result raises `DbUpdateConcurrencyException`. The repository `SaveAsync` catches that and rethrows `ConflictException("Room 204 changed since you read it. Reload and try again.")`, which `ApiExceptionHandler` already turns into 409 (AC-25). Because the version always changes on a real update, the "found rows vs affected rows" setting of the MySQL driver does not hide a conflict. Keep the room change and its history insert in **one** `SaveChanges` so a lost race rolls back both; the loser must not leave a history row or trigger a push. Push only after the save returns.

Optional: return `RowVersion` in the room DTO and accept it back so a client can detect staleness across a long form edit. AC-25 does not need it (the token covers the window between read and write inside a request).

### 5.3 Transitions (AC-25)
Token on `rooms` is sufficient. Both requests read version N; the first commits N+1; the second's `WHERE row_version = N` matches nothing and gets 409. If the second reads after the first commits, it sees the new status and the transition rules decide (legal move, or 400), which is correct.

### 5.4 AssignRoom: a version on `bookings` alone does NOT fix double assignment
Two bookings are two different rows, so each one's version check passes. The serialisation point has to be the **room** row. Options:

1. **Recommended: touch the room row and rely on the room token.** In `AssignRoomAsync`, after the existing room read, mark the room as modified so its version bumps: `_db.Entry(room).Property(r => r.RowVersion).IsModified = true` (done in the repository, e.g. `IRoomRepository.TouchAsync(room)`), and keep the existing order (**read room, then `RoomHasOverlapAsync`, then save**). Whichever order two requests interleave, one of two things happens: B's overlap check runs after A's commit and sees A's booking (existing `ConflictException`, 409), or it runs before and B's `UPDATE rooms ... WHERE row_version = N` fails (409). This also closes the race between assign and "move to OutOfOrder" (BR-06) because both write the room row. Add a comment that the room read must precede the overlap check, and a test.
2. Pessimistic alternative: wrap check-and-write in a transaction and read the room with `SELECT ... FROM rooms WHERE id = @id FOR UPDATE` (`FromSqlInterpolated`). Correct and simple to reason about, but holds a row lock during the request and needs an explicit transaction and deadlock handling. Use only if option 1 proves awkward.
3. A unique constraint cannot express "no overlapping date ranges": MySQL has no exclusion constraints, and `UNIQUE (room_id, check_in)` only stops identical starts. The only DB-enforced form is a night-grain table `room_nights (room_id, night DATE, booking_id, UNIQUE (room_id, night))` maintained on assign, unassign, cancel, date change, check-out and the CSV importer (`ChannelImportService.cs:125` also clears `RoomId`). That is a bigger change touching more code paths; **not recommended for V005**, noted as the strongest option if overbooking must be impossible even for out-of-band SQL writers.

Also add the `bookings.row_version`: it stops two parallel actions on the same booking (assign twice with different rooms, cancel vs assign, double check-out) from last-write-wins, and gives AC-26 its guard (loser reloads, sees `CheckedOut`, returns duplicate/no-op). For the webhook, retry once on conflict internally instead of returning 409 to the lock system.

Other writers of `rooms`/`bookings`: `RoomService.UpdateAsync`, `CancelAsync` (`BookingService.cs:133`), `CheckInAsync`, `CheckOutAsync`, the CSV import. They all go through the DbContext, so the central increment covers them. Any hand-run SQL against these tables bypasses it.

### 5.5 What the EF InMemory provider cannot prove (and what real MySQL 8.4 must)
InMemory (`ApiFactory`) can show that code paths exist and map exceptions to status codes. It does **not**:
- enforce unique indexes (so `housekeeper_floors` PK, `ux_checkout_events_ref_time` are never exercised), FKs, `CHECK` constraints or string lengths;
- run real transactions or isolation, so no lost-update, no gap-lock/deadlock, no `FOR UPDATE`, and a conflict test inside one process is not a race;
- emit SQL, so the `WHERE row_version = ?` clause, `AddMinutes`/`TimestampDiff` translation, group/order translation and the 1062 error path are untested;
- model `DATETIME(0)` rounding, collation (case-insensitive `booking_ref`), the V005-V007 DDL itself, or index selection.

Required real MySQL 8.4 tests (throwaway DB from `compose.yaml`, DbUp applying V001..V00N, tagged e.g. `[Trait("Category","MySql")]`):
1. Migration: run V005-V007 on a V001-V004 database; assert 0 `Clean` in `rooms` and both history columns, row counts unchanged, exactly 2 room types at 75 (`STE`, `FAM`), the new indexes exist (`SHOW INDEX FROM rooms`).
2. Constraints: duplicate `(booking_ref, checked_out_at)` gives MySQL error 1062; second housekeeper for the same `(hotel_id, floor)` gives 1062; same housekeeper on several floors succeeds; case variation of `booking_ref` is a duplicate.
3. Concurrent transitions (AC-25): two `DbContext` instances load the same room, then both save, forced with a barrier or `TaskCompletionSource` so both reads happen before either write. Assert exactly one succeeds, the other is `DbUpdateConcurrencyException` mapped to 409, `row_version` is old+1, and exactly one history row exists.
4. Concurrent assign: two bookings of the same hotel/type with overlapping dates, same room, same barrier technique. Assert one 409 and exactly one booking holds `room_id`. Also assign vs move-to-OutOfOrder.
5. Duplicate webhook race: two identical events in parallel; assert one `checkout_events` row, one history row, one `duplicate: true`.
6. Query shape: run `EXPLAIN` / `EXPLAIN ANALYZE` on the board and late-rooms SQL (from the EF SQL log) and record the plan; assert the number of commands per board request is 3 (command interceptor or log).
7. Timestamp boundary through MySQL: checkout at 10:00:00, evaluated at 10:45:00 and 10:46:00 (and a sub-second input) with the stored `DATETIME(0)` values.

## 6. Recommendations (summary)

1. Split V005 into small scripts (rename and default; columns and seed; new tables), or accept that a failed run needs a DB reset (DDL is non-transactional). Update both `rooms` and both history columns; the history default does not exist.
2. Rename `Clean` in `Entities.cs:51,57,60` and `HotelServices.cs:152` in the same change; nothing in the frontend, tests or `db-setup` reads it.
3. Add `rooms.ready_at` (missing from the plan, needed for AC-16), clear `self_marked` on leaving Ready, and decide a window for the late list.
4. `room_types.sla_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 45` with a CHECK; 75 for `STE` and `FAM` only. `JNR` stays 45 pending an answer.
5. `housekeeper_floors` with `PRIMARY KEY (hotel_id, floor)`, index on `user_id`, FKs to `hotels` and `users`; per-hotel `FOR UPDATE` on replace; service checks hotel membership and role.
6. `checkout_events` with `UNIQUE (booking_ref, checked_out_at)`, FKs, `DATETIME(0)` truncated to seconds in code, insert-in-transaction and catch error 1062; AC-26 is handled by the booking version plus `LEAST(checked_out_at)`, not by the unique key. Reconcile the name with the FEATURE's `lock_events`.
7. Index `rooms (hotel_id, floor, room_number)`; board is 3 queries; late-rooms filters and sorts in SQL with a parameterised clock and second-level comparison.
8. Concurrency: `row_version INT NOT NULL DEFAULT 0` on `rooms` and `bookings`, `IsConcurrencyToken()`, increment in a `SaveChangesAsync` override, map `DbUpdateConcurrencyException` to `ConflictException` (409) in the repository. For AssignRoom, **touch the room row** (version bump) so the room is the serialisation point, with `SELECT ... FOR UPDATE` as the alternative; a unique constraint cannot enforce date overlap and a `bookings` version alone does not prevent double assignment.
9. Prove all of it on real MySQL 8.4 (section 5.5); InMemory cannot.
10. Side findings: `booking_notes.note` 255 vs 1000, no FK on `room_status_history.changed_by_user_id`.


---

# DB analysis: MCP read-only views (02-mcp-views.sql)

Scope: the five views in the "View column contract" of `FEATURE-mcp-server.md`, the booking status values, index use, the cost of a `vw_rooms_status` self-join, and whether `SQL SECURITY DEFINER` lets a view-only user read the views. Inputs read: `FEATURE-mcp-server.md`, migrations `V001` to `V007`, `Domain/Turnaround.cs`, `Domain/Entities.cs`, `Repositories/BookingRepository.cs`, `Repositories/HousekeepingRepository.cs`, `Services/HousekeepingService.cs`.

## M0. Measured versus reasoned

**Nothing in this section was measured.** I did not connect to any database. A MySQL 8.0 client exists on this machine and something answers on 127.0.0.1:3306, but I have no credentials, and I did not guess or probe. The SQL below has not been executed, not even for syntax. Treat every plan statement as reasoned from the MySQL 8.4 manual and the schema, and verify it with the commands in M6 on a throwaway MySQL 8.4 before merge.

| Claim | Basis |
|---|---|
| Column, index and seed facts | Read from migrations (checked) |
| Booking status strings, arrival rule | Read from code (checked) |
| `minutes_over` arithmetic equals `Turnaround.MinutesOver` | Worked by hand on boundary cases (M1.2), not run |
| Index use, condition pushdown, row counts, costs | Reasoned from the manual, not measured |
| DEFINER behaviour | Reasoned from the manual, not measured |

## M1. Proposed `db-setup/02-mcp-views.sql` (not applied)

Prerequisites: run after the API has started once, so `V006` (columns on `rooms`, `room_types.sla_minutes`) and `V007` (`housekeeper_floors`) exist. All stored times are `DATETIME(0)` in UTC, so comparing with `UTC_TIMESTAMP()` is correct whatever the session `time_zone`. No view exposes `email`, `phone`, `address_line`, `postcode`, `password_hash`, `notes`, `reason`, `ooo_reason`, or any guest column. The only person-name column is `display_name` in `vw_housekeeper_load`.

### M1.1 `vw_rooms_status`

```sql
CREATE OR REPLACE VIEW vw_rooms_status AS
SELECT r.hotel_id,
       h.code                AS hotel_code,
       r.id                  AS room_id,
       r.room_number,
       r.floor,
       rt.code               AS room_type_code,
       rt.name               AS room_type_name,
       r.status,
       r.self_marked,
       r.checked_out_at,
       r.ready_at,
       r.expected_return_at,
       rt.sla_minutes,
       r.checked_out_at + INTERVAL rt.sla_minutes MINUTE AS due_at   -- NULL when checked_out_at is NULL
FROM rooms r
JOIN hotels h      ON h.id  = r.hotel_id
JOIN room_types rt ON rt.id = r.room_type_id;
```

Columns match the contract exactly, in order. `ooo_reason` and `notes` are deliberately not selected. This view has no aggregate, so MySQL merges it into the outer query (reasoned).

### M1.2 `vw_sla_breaches`

```sql
CREATE OR REPLACE VIEW vw_sla_breaches AS
SELECT s.hotel_id, s.hotel_code, s.room_id, s.room_number, s.floor,
       s.room_type_code, s.room_type_name, s.status,
       s.checked_out_at, s.ready_at, s.sla_minutes, s.due_at,
       (TIMESTAMPDIFF(SECOND, s.due_at,
                      CASE WHEN s.status = 'Ready' THEN s.ready_at ELSE UTC_TIMESTAMP() END)
        + 59) DIV 60 AS minutes_over
FROM vw_rooms_status s
WHERE s.checked_out_at IS NOT NULL
  AND (   (s.status <> 'Ready' AND UTC_TIMESTAMP() > s.due_at)
       OR (s.status =  'Ready' AND s.ready_at IS NOT NULL
           AND s.ready_at > s.due_at
           AND s.ready_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR));
```

Parity with the C# code (`Turnaround.MinutesOver`: `seconds <= 0 ? 0 : ceil(seconds / 60)`; `EndAt`: ready time for Ready, otherwise now):

| seconds past due | C# | SQL `(secs + 59) DIV 60` | listed? |
|---|---|---|---|
| 0 (exactly on target) | 0 | not selected, `end > due` is false | no |
| 1 | 1 | 60 DIV 60 = 1 | yes |
| 60 | 1 | 119 DIV 60 = 1 | yes |
| 61 | 2 | 120 DIV 60 = 2 | yes |

The `WHERE` only admits `secs > 0`, so `DIV` never sees a negative. Stored times are whole seconds, so `TIMESTAMPDIFF(SECOND, ...)` is exact. Integer `DIV` avoids relying on DECIMAL rounding of `/ 60`. Worked by hand, not run.

Rules copied from `HousekeepingRepository.ListLateRoomsAsync` (lines 81 to 95) so the view and `late-rooms` agree. The contract does not state them:
1. A non-Ready room is late if `now > due`. This **includes `OutOfOrder` rooms** that still have a `checked_out_at`. That is what the API does; a manager may not want a room under repair in the breach list. Flag, do not change silently.
2. A Ready room is listed only if it became Ready after its target **and within the last 24 hours** (`LateReadyWindow`, `HousekeepingService.cs` line 32). The 24 hours is now written in two places (C# and this view). If one changes, AC_05/AC_06 parity breaks. The FEATURE's phrase "only rooms that are late" hides this.
3. Rooms with no `checked_out_at` never appear.

**Defect in the FEATURE to fix before the tool is built:** AC_05 passes `asOf` (10:45:00, then 10:46) to `rooms_breaching_sla`, but this view is fixed to `UTC_TIMESTAMP()`, so it cannot honour `asOf`. The named tool must read `vw_rooms_status` and take `asOf` as a parameter (`?`, never string-built):

```sql
SELECT room_id, room_number, floor, room_type_name AS room_type, status,
       checked_out_at, due_at, sla_minutes,
       (TIMESTAMPDIFF(SECOND, due_at, CASE WHEN status = 'Ready' THEN ready_at ELSE ? END) + 59) DIV 60 AS minutes_over
FROM vw_rooms_status
WHERE hotel_id = ? AND checked_out_at IS NOT NULL
  AND (   (status <> 'Ready' AND ? > due_at)
       OR (status =  'Ready' AND ready_at IS NOT NULL AND ready_at <= ?
           AND ready_at > due_at AND ready_at >= ? - INTERVAL 24 HOUR))
ORDER BY minutes_over DESC, floor, room_number;
```

`asOf` must be truncated to whole seconds and passed as a UTC DATETIME string. The extra `ready_at <= ?` keeps a "Ready after asOf" row out of a past `asOf`; the API has no such term because its clock is always now. `vw_sla_breaches` then serves `run_readonly_query` and the "as of now" case only.

### M1.3 `vw_ooo_impact` (LEAD over `room_status_history`)

```sql
CREATE OR REPLACE VIEW vw_ooo_impact AS
SELECT x.hotel_id, x.room_id, x.room_number, x.room_type_code,
       x.changed_at      AS ooo_from,
       x.next_changed_at AS ooo_to          -- NULL while still out of order
FROM (
  SELECT r.hotel_id, h.room_id, r.room_number, rt.code AS room_type_code,
         h.to_status, h.changed_at,
         LEAD(h.changed_at) OVER (PARTITION BY r.hotel_id, h.room_id
                                  ORDER BY h.changed_at, h.id) AS next_changed_at
  FROM room_status_history h
  JOIN rooms r       ON r.id  = h.room_id
  JOIN room_types rt ON rt.id = r.room_type_id
) x
WHERE x.to_status = 'OutOfOrder';
```

Points that matter:
- `LEAD` runs over **all** history rows of the room, and `to_status = 'OutOfOrder'` is applied **after**, in the outer query. Filtering first would make `LEAD` return the next OOO row and merge separate intervals.
- **Still OOO / no closing row:** the last history row of a room has no successor, so `LEAD` gives NULL and `ooo_to` is NULL. This is not an edge case in the data: all six OOO rooms in the seed (rooms 11, 34, 55, 78, 87, 109; history ids 119 to 124, all `2026-09-28 14:00:00`) have an open interval (`V004__seed_bookings.sql` lines 733 to 740). Consumers must treat NULL as "to now" or "to the range end"; the tool query below does.
- **Tie-break:** `changed_at` has one-second resolution, so `ORDER BY changed_at, id` makes two moves in the same second deterministic. The secondary index `(room_id, changed_at)` carries the primary key implicitly, so it can deliver that order.
- `PARTITION BY r.hotel_id, h.room_id` (hotel first) is deliberate. From 8.0.22, MySQL can push a `WHERE hotel_id = ?` condition into a derived table that has a window function only when it references the `PARTITION BY` columns (reasoned from the manual; verify with EXPLAIN). A bare `PARTITION BY room_id` would window the whole history on every call, because the tool filters by hotel.
- **Invisible OOO (Q5):** a room whose `rooms.status` is `OutOfOrder` but which has no `OutOfOrder` history row cannot appear. The seed has none, but a room set by hand would be missed. A check query for the owner:
  ```sql
  SELECT r.id, r.hotel_id, r.room_number FROM rooms r
  WHERE r.status = 'OutOfOrder'
    AND NOT EXISTS (SELECT 1 FROM vw_ooo_impact o WHERE o.room_id = r.id AND o.ooo_to IS NULL);
  ```
  I did not add a fallback `UNION` row because its start time would be invented.
- A duplicate `OutOfOrder -> OutOfOrder` history row would split an interval in two. I did not trace every write path to prove it cannot happen; `COUNT(DISTINCT)` in the night count below makes the result immune.

Illustrative named-tool query for `roomNightsLost` (both ends inclusive, the plan's default for Q5; a night is lost if the room is out of order at any moment of that calendar date; this definition needs the owner's answer to Q5):

```sql
WITH RECURSIVE nights AS (
  SELECT CAST(? AS DATE) AS d
  UNION ALL
  SELECT d + INTERVAL 1 DAY FROM nights WHERE d < CAST(? AS DATE)
)
SELECT o.room_id, o.room_number, o.room_type_code, COUNT(DISTINCT n.d) AS nights_lost
FROM vw_ooo_impact o
JOIN nights n ON o.ooo_from < n.d + INTERVAL 1 DAY
             AND (o.ooo_to IS NULL OR o.ooo_to > n.d)
WHERE o.hotel_id = ?
GROUP BY o.room_id, o.room_number, o.room_type_code;
```

Only dates in `[from, to]` are generated, so counting is clipped to the range; this covers an interval that starts before `from` and one that is still open. The default `cte_max_recursion_depth` is 1000, so ranges over 1000 days fail; the tool should cap the range and say so. `roomNightsAvailable` needs the room count (`SELECT COUNT(*) FROM vw_rooms_status WHERE hotel_id = ?`) times the number of dates (current inventory only).

### M1.4 `vw_housekeeper_load`

```sql
CREATE OR REPLACE VIEW vw_housekeeper_load AS
SELECT hf.hotel_id,
       hf.user_id               AS housekeeper_id,
       u.display_name,
       d.work_date,
       hf.floor,
       fr.rooms_on_floor        AS rooms_assigned,
       COALESCE(c.rooms_done,0) AS rooms_completed
FROM housekeeper_floors hf
JOIN users u ON u.id = hf.user_id
JOIN (SELECT hotel_id, floor, COUNT(*) AS rooms_on_floor
      FROM rooms GROUP BY hotel_id, floor) fr
       ON fr.hotel_id = hf.hotel_id AND fr.floor = hf.floor
JOIN (SELECT UTC_DATE() AS work_date
      UNION
      SELECT DATE(changed_at) FROM room_status_history WHERE to_status = 'Ready') d
LEFT JOIN (SELECT r.hotel_id, r.floor, h.changed_by_user_id AS user_id,
                  DATE(h.changed_at) AS work_date,
                  COUNT(DISTINCT h.room_id) AS rooms_done
           FROM room_status_history h
           JOIN rooms r ON r.id = h.room_id
           WHERE h.to_status = 'Ready' AND h.changed_by_user_id IS NOT NULL
           GROUP BY r.hotel_id, r.floor, h.changed_by_user_id, DATE(h.changed_at)) c
       ON  c.hotel_id = hf.hotel_id AND c.floor = hf.floor
       AND c.user_id  = hf.user_id  AND c.work_date = d.work_date;
```

The tool derives `outstanding = rooms_assigned - rooms_completed` (clamped at 0). Decisions the contract leaves open (Q6), which I had to make and the owner must confirm:
- **`rooms_assigned` is the number of rooms on the floor today**, not the rooms that needed turning that day. There is no assignment history (`V007` holds only the current floor per `(hotel_id, floor)`), so a past `work_date` shows today's floors and room count. State this in the tool description.
- **`rooms_completed` counts distinct rooms moved to `Ready` by that user on that date**, on a floor that user holds now. `Inspected` is not counted. Self-marked Ready moves are counted; to exclude them add `AND h.self_marked = 0` (history has the column since `V006`).
- A Ready move by someone who no longer holds that floor is credited to nobody.
- Housekeepers with no floor do not appear (`housekeeper_floors` drives the view). Inactive users are not filtered; add `AND u.active = 1` if wanted.
- Dates offered are today plus every date with a Ready move. Today always has rows, even with zero completions, so `outstanding` is meaningful. A past date with no Ready moves returns no rows, not zeros.
- `changed_by_user_id` has no foreign key (side finding 10 in section 6 above), so a bad id simply never matches a floor holder.

### M1.5 `vw_arrivals_vs_ready`

```sql
CREATE OR REPLACE VIEW vw_arrivals_vs_ready AS
SELECT b.hotel_id,
       rt.code  AS room_type_code,
       rt.name  AS room_type_name,
       b.check_in AS arrival_date,
       COUNT(*) AS arrivals,
       MAX(COALESCE(rr.ready_rooms, 0)) AS ready_rooms
FROM bookings b
JOIN room_types rt ON rt.id = b.room_type_id
LEFT JOIN (SELECT hotel_id, room_type_id, COUNT(*) AS ready_rooms
           FROM rooms WHERE status = 'Ready'
           GROUP BY hotel_id, room_type_id) rr
       ON rr.hotel_id = b.hotel_id AND rr.room_type_id = b.room_type_id
WHERE b.status = 'Confirmed'
GROUP BY b.hotel_id, rt.code, rt.name, b.check_in;
```

`ready_rooms` is the **current** Ready count, repeated on every date row, so it is only meaningful for `arrival_date = UTC_DATE()`. That is why the FEATURE's Q7 proposes an error for other dates. `MAX(...)` only satisfies `ONLY_FULL_GROUP_BY`; the value is the same across the group. Room types with no arrivals have no row. The tool's `shortfall` (`arrivals - ready_rooms`, only where positive) does not need them, but `readyRooms` for a type with no arrivals is not available through this view. Ready rooms already held by an assigned booking are not subtracted (Q7, open).

## M2. Booking status values and what counts as an arrival

From `Domain/Entities.cs`, `BookingStatuses` (the strings stored in `bookings.status`, which is `VARCHAR(20) NOT NULL` with no CHECK constraint, so the database does not enforce them):

| Constant | Stored value |
|---|---|
| Confirmed | `Confirmed` |
| CheckedIn | `CheckedIn` |
| CheckedOut | `CheckedOut` |
| Cancelled | `Cancelled` |
| NoShow | `NoShow` |

The seed (`V004`) uses `Confirmed` and `CheckedIn` in the lines I sampled; I did not tabulate every row. SQL comparison is case-insensitive under the default `utf8mb4_0900_ai_ci` collation, C# comparison is case-sensitive.

**Arrival rule in code:** `BookingRepository.ListArrivalsAsync` (lines 68 to 73) uses `CheckIn == date AND Status == Confirmed`, nothing else. A booking already `CheckedIn` is not an arrival, nor is `Cancelled`, `NoShow` or `CheckedOut`. `vw_arrivals_vs_ready` uses the same rule (`status = 'Confirmed'`), so its count equals the API arrivals list for a date.

Two other queries use different sets, which invites confusion: occupancy overlap uses `Staying = {Confirmed, CheckedIn, CheckedOut}` (line 62), and room overlap and assign use `{Confirmed, CheckedIn}` (lines 57 and 77). Do not reuse those for "arrivals".

Consequence: a `Confirmed` booking whose `check_in` is in the past (never checked in, never marked `NoShow`) stays in the view under its old date. The named tool filters by date so it never shows, but `run_readonly_query` users will see these stale rows.

## M3. Indexes serving each view

Indexes after `V007`: `rooms`: PK, `ux_rooms_hotel_number (hotel_id, room_number)`, `ix_rooms_hotel_floor (hotel_id, floor, room_number)`, FK indexes; `room_status_history`: PK, `ix_room_status_history_room (room_id, changed_at)`; `bookings`: `ix_bookings_hotel_dates (hotel_id, check_in)`, `ix_bookings_room`, `ix_bookings_guest`, `ux_bookings_reference`; `housekeeper_floors`: PK `(hotel_id, floor)`, `ix_housekeeper_floors_user`; `hotels`, `room_types`, `users`: PK.

| View | Access path (reasoned) | Gap |
|---|---|---|
| `vw_rooms_status` | With `hotel_id = ?`: `ref` on a `hotel_id` prefix of `ix_rooms_hotel_floor` (about 17 rooms per hotel); `hotels` and `room_types` by PK `eq_ref`. Unfiltered: scan of 104 rooms. | None needed at this size. |
| `vw_sla_breaches` | Same. Status, `checked_out_at` and time tests are applied to fetched rows; no index on them. | None needed for 104 rooms. `rooms` has no index on `status`; irrelevant until rooms number in the thousands. |
| `vw_ooo_impact` | Hotel-filtered, if pushdown into the window derived table works: `rooms` by `ix_rooms_hotel_floor`, then history by `ix_room_status_history_room` in partition order, no sort. If pushdown does not happen: full scan of `room_status_history` (about 124 seed rows, growing with every move) and a window pass over all of it. Cost is linear in history. | No index leads with `to_status` or `changed_at`, so "all OOO rows" cannot be found without a scan. |
| `vw_housekeeper_load` | `housekeeper_floors` PK prefix, `users` PK, `rooms` grouped by `(hotel_id, floor)` (covered by `ix_rooms_hotel_floor`). **The `d` and `c` derived tables scan all of `room_status_history`**: `to_status = 'Ready'` has no usable index, and `DATE(changed_at)` is not sargable. | A `work_date = ?` filter does not reduce that scan. See V008 below. |
| `vw_arrivals_vs_ready` | `bookings` via `ix_bookings_hotel_dates (hotel_id, check_in)` when the tool passes `hotel_id` and `arrival_date`, provided the optimiser pushes them into the grouped view (both are `GROUP BY` columns, so 8.0.22+ condition pushdown applies; reasoned). `status = 'Confirmed'` is checked per fetched row. `rooms` subquery: hotel prefix or scan, at most 104 rows. Without pushdown: full scan of `bookings` (about 50 seed rows, growing). | `status` is not in the index. One hotel and day is a handful of rows, so fine. |

Optional index as a new migration (proposal, not applied; never edit `V001` to `V007`):

```sql
-- V008__mcp_view_support.sql (proposal)
ALTER TABLE room_status_history
  ADD KEY ix_rsh_to_status_changed (to_status, changed_at, changed_by_user_id, room_id);
```

It covers the `to_status = 'Ready'` scans in `vw_housekeeper_load` and lets the outer `to_status = 'OutOfOrder'` find its rows without reading the whole table; the window pass still needs every row of the affected rooms. Writes get one more index to maintain. At about 124 rows it is not justified; I am not recommending it now. Measure first.

**All five views are plain views, not materialised.** Every call, from a named tool or `run_readonly_query`, re-executes the view body. Views with `GROUP BY`, `UNION`, window functions or derived tables (`vw_ooo_impact`, `vw_housekeeper_load`, `vw_arrivals_vs_ready`) are materialised into a temporary table per reference, so a query that references one twice builds it twice.

## M4. Cost of `vw_rooms_status` joined to itself

`SELECT ... FROM vw_rooms_status a JOIN vw_rooms_status b` with no join condition returns 104 x 104 = **10,816** rows. The 104 comes from the earlier analysis (section 2, 104 rooms in `V003`) and the FEATURE; I did not recount it here.

Reasoned cost: the view is merged, so this is two copies of `rooms x hotels x room_types`. With 104 rows per side and PK lookups on the small tables, MySQL visits about 104 + 104 x 104 `rooms` rows and about 21,000 PK lookups. That is milliseconds of server work, far below the 10 s `max_execution_time`. The 10,000-row cap bites first (AC_19: 10,816 > 10,000, so 816 rows are cut).

What those numbers do not show:
1. **The row cap does not bound server work for buffered plans.** With `ORDER BY`, `GROUP BY`, `DISTINCT` or a window function, MySQL builds the whole result before sending a row, so "stop at 10,001 rows and `KILL QUERY`" saves transfer, not execution. For a plain nested-loop cross join, rows stream and an early stop does save work (reasoned; confirm with `EXPLAIN ANALYZE` or `Handler_read%` counters).
2. **It scales as a power.** A three-way self-join is 104^3 = 1,124,864 rows, a four-way 104^4 = about 117 million. The four-way will not finish in 10 s and relies on `max_execution_time`. The row cap protects the client, the timeout protects the server; neither proves performance.
3. **Heavier views multiply worse.** `vw_ooo_impact` or `vw_housekeeper_load` joined to themselves rematerialise per reference, and the housekeeper view scans `room_status_history` at least twice per reference.
4. `MAX_USER_CONNECTIONS` (suggested 5) limits how many run at once. `max_execution_time` applies only to read-only `SELECT` statements; the FEATURE sets the session read only.
5. `SLEEP()`: whether `max_execution_time` interrupts it with an error or lets it return early was not tested (the FEATURE's Risk 4 says the same). Needs real MySQL 8.4.

## M5. Does `SQL SECURITY DEFINER` let a user with `SELECT` only on the views read them?

**Reasoned from the MySQL 8.4 manual; not tested.**

Yes, provided the definer still has the privileges. With `SQL SECURITY DEFINER` (the default, so what `CREATE OR REPLACE VIEW` gives unless told otherwise) the view body runs with the privileges of the `DEFINER` account, not the caller's. The caller needs `SELECT` on the view and nothing on the base tables. `SHOW VIEW` is not needed to read data. So `GRANT SELECT ON larchmont.vw_rooms_status TO mcp_readonly` and the same for the four others are sufficient. With `SQL SECURITY INVOKER` it would **not** work: `mcp_readonly` would need `SELECT` on `rooms`, `users` and the rest, defeating the purpose.

Conditions and traps:
1. **The definer must exist and keep `SELECT` on the base tables** (`rooms`, `hotels`, `room_types`, `room_status_history`, `bookings`, `housekeeper_floors`, `users`). If it is dropped or loses privileges, every read fails (error 1449, "The user specified as a definer does not exist", or an access error). Re-running the script as a different account silently changes the definer. Record who it is.
2. **The default definer is whoever runs the script.** The FEATURE Verify step uses `root`, so the views would run as root, and anyone able to `ALTER VIEW` can change what they return. The views are the whole security boundary. Better: a dedicated definer (call it `mcp_owner`) with `SELECT` only on those seven tables, and `CREATE OR REPLACE DEFINER = mcp_owner SQL SECURITY DEFINER VIEW ...`. Do not use `larchmont_app` (it has `ALL` on the database, per the FEATURE). This is my recommendation, not part of the contract.
3. **Leakage is controlled by column list only.** The definer can read `users`, so a view must never use `SELECT *`. The SQL above names every column. `vw_housekeeper_load` reads `users` but exposes only `display_name`.
4. **Simple views can be updatable.** `vw_rooms_status` (a merged join view) is potentially updatable. `mcp_readonly` has no `INSERT`, `UPDATE` or `DELETE` on it, so those fail on privilege, which is what AC_03 wants. Do not grant them. Views with aggregation, `UNION` or window functions are not updatable at all.
5. **AC_03 as written cannot pass.** It says `SELECT` on `information_schema.tables` must be denied. In MySQL every account can query `information_schema`; it returns only the objects the account has a privilege on. For `mcp_readonly` that would be the five views, not an error. The guard still rejects `information_schema`, and nothing sensitive is visible there, but the test should assert "returns no base tables", not "access denied". `larchmont.rooms` and `mysql.user` should give access denied (reasoned).
6. `information_schema.views.view_definition` is shown only to accounts with `SHOW VIEW`, so the SQL text is not exposed to `mcp_readonly` (reasoned).

## M6. Commands to turn the reasoning into measurements

Run on a throwaway MySQL 8.4 (for example `compose.yaml`) after the API has applied `V001` to `V007` and the owner has created the views. These are `SELECT` and `EXPLAIN` only.

```sql
EXPLAIN FORMAT=TREE SELECT * FROM vw_rooms_status WHERE hotel_id = 1;
EXPLAIN ANALYZE SELECT * FROM vw_sla_breaches WHERE hotel_id = 1;
EXPLAIN ANALYZE SELECT * FROM vw_ooo_impact WHERE hotel_id = 1;            -- is hotel_id pushed into the window derived table?
EXPLAIN ANALYZE SELECT * FROM vw_housekeeper_load WHERE hotel_id = 1;      -- note rows read from room_status_history
EXPLAIN ANALYZE SELECT * FROM vw_arrivals_vs_ready WHERE hotel_id = 1 AND arrival_date = CURDATE();
EXPLAIN ANALYZE SELECT COUNT(*) FROM vw_rooms_status a JOIN vw_rooms_status b;   -- expect 10,816
SELECT COUNT(*) FROM rooms;                                                       -- confirm 104
SELECT status, COUNT(*) FROM bookings GROUP BY status;                           -- confirm status strings in data
SHOW GRANTS FOR mcp_readonly;
-- as mcp_readonly:
SELECT COUNT(*) FROM vw_rooms_status;        -- should work (DEFINER)
SELECT COUNT(*) FROM rooms;                  -- should be denied
SELECT table_name FROM information_schema.tables WHERE table_schema = 'larchmont';  -- expect only the five views
```

Parity test for `minutes_over`: seed rooms due at 10:45:00 and compare the tool query and `vw_sla_breaches` with `GET /api/hotels/{id}/late-rooms` at 10:45:00, 10:45:01, 10:46:00 and 10:46:01. Expected: absent, 1, 1, 2.

## M7. Summary of findings and decisions needed

1. SQL for the five views is proposed above with the exact contract column names, no PII, no free text. **Unexecuted.**
2. `minutes_over` is `(TIMESTAMPDIFF(SECOND, due, end) + 59) DIV 60` for `secs > 0`, equal to `Turnaround.MinutesOver` on the boundary cases (worked by hand).
3. **FEATURE gap:** `vw_sla_breaches` is fixed to `UTC_TIMESTAMP()`, so `rooms_breaching_sla` with `asOf` (AC_05) must query `vw_rooms_status` with a parameter (query in M1.2).
4. **Hidden rules:** the API lists Ready-late rooms only from the last 24 hours and includes `OutOfOrder` rooms that have a checkout time. The view copies both. Confirm both are wanted.
5. Arrival = `status = 'Confirmed'` and `check_in = date`, exactly like `ListArrivalsAsync`. Stale past `Confirmed` bookings remain in the view.
6. `ooo_to IS NULL` covers "still OOO" and "no closing row"; all six seeded OOO rooms are open intervals. A room with `status = 'OutOfOrder'` and no history row is invisible (check query in M1.3).
7. Open questions that change view output: Q5 (night definition, inclusive ends), Q6 (meaning of assigned and completed; self-marks; Inspected), Q7 (subtract held rooms; dates other than today).
8. The self-join of `vw_rooms_status` is cheap (10,816 rows). The risk is the power law and buffered plans, not that case. The 10 s timeout is the real bound.
9. DEFINER views let a view-only user read them if the definer persists with base-table `SELECT`. Use a dedicated definer, not `root` or `larchmont_app`. AC_03 `information_schema` clause cannot pass as worded.
10. Optional V008 index on `room_status_history (to_status, changed_at, changed_by_user_id, room_id)`; not justified at about 124 rows; measure first.
