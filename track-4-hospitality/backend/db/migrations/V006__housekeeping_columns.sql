-- V006: housekeeping columns on existing tables (FEATURE-housekeeping-api.md, db-analysis 3.1).
-- Not transactional: if this fails part way, fix by hand and re-run from the failed statement.

-- Room state added by the board.
ALTER TABLE rooms
  ADD COLUMN self_marked TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN checked_out_at DATETIME NULL,
  ADD COLUMN ready_at DATETIME NULL,
  ADD COLUMN ooo_reason VARCHAR(255) NULL,
  ADD COLUMN expected_return_at DATETIME NULL,
  ADD COLUMN row_version INT NOT NULL DEFAULT 0;

-- Board floor query: filter by hotel, order by floor then room number without a filesort.
ALTER TABLE rooms
  ADD KEY ix_rooms_hotel_floor (hotel_id, floor, room_number);

-- Backfill the clock for seeded Dirty rooms, which have no checkout time.
-- Use the time the room last became Dirty in history. If there is no such row,
-- start the clock at migration time, so the room is timed and not silently excluded from the late list.
UPDATE rooms r
SET r.checked_out_at = COALESCE(
      (SELECT MAX(h.changed_at) FROM room_status_history h
        WHERE h.room_id = r.id AND h.to_status = 'Dirty'),
      UTC_TIMESTAMP())
WHERE r.status = 'Dirty' AND r.checked_out_at IS NULL;

-- History: who (role only), whether it was a self-mark, and the OOO reason.
ALTER TABLE room_status_history
  ADD COLUMN self_marked TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN reason VARCHAR(255) NULL,
  ADD COLUMN by_user_role VARCHAR(20) NULL;

-- Turnaround target per room type (BR-07). Default 45; Suite and Family are 75. JNR stays 45 (spec Q2).
ALTER TABLE room_types
  ADD COLUMN sla_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 45;

ALTER TABLE room_types
  ADD CONSTRAINT ck_room_types_sla CHECK (sla_minutes BETWEEN 1 AND 1440);

UPDATE room_types SET sla_minutes = 75 WHERE code IN ('FAM', 'STE');

-- Optimistic concurrency token for bookings (assign, check-in, check-out races).
ALTER TABLE bookings
  ADD COLUMN row_version INT NOT NULL DEFAULT 0;
