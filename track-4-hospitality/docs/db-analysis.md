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
