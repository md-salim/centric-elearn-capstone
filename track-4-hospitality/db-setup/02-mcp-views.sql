-- 02-mcp-views.sql : read-only views for the MCP server (FEATURE-mcp-server.md).
--
-- WHEN TO RUN
--   After the API has started at least once, so DbUp has applied V001..V007
--   (V006 adds rooms.checked_out_at / ready_at / self_marked and room_types.sla_minutes,
--   V007 adds housekeeper_floors). Run as a privileged account, for example:
--     mysql -h 127.0.0.1 -P 3306 -u root -p < db-setup/02-mcp-views.sql
--   Run it BEFORE 03-create-mcp-user.sql (the GRANTs there need the views to exist).
--
-- SECURITY MODEL
--   The views use the default SQL SECURITY DEFINER, so they run with the privileges of the
--   account that runs this script (the DEFINER). That account must keep SELECT on
--   rooms, hotels, room_types, room_status_history, bookings, housekeeper_floors and users,
--   or every read fails (error 1449 or access denied). mcp_readonly gets SELECT on the
--   views only. Never use SELECT * here: the definer can read users, guests and free text.
--   No view exposes a guest column, email, phone, address_line, postcode, password_hash,
--   notes, ooo_reason or reason. The only person name is display_name (housekeeper).
--   The views are plain (not materialised): every query re-runs the view body.
--
-- All stored times are DATETIME in UTC, so UTC_TIMESTAMP() / UTC_DATE() are correct
-- whatever the session time_zone. Safe to re-run (CREATE OR REPLACE VIEW).
-- NOT EXECUTED by the author: no MySQL server was available when this was written.

SET NAMES utf8mb4;
USE larchmont;

-- ---------------------------------------------------------------------------
-- vw_rooms_status : one row per room with its turnaround clock and target.
-- due_at = checked_out_at + room type sla_minutes (NULL when never checked out).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_rooms_status AS
SELECT r.hotel_id,
       h.code                 AS hotel_code,
       r.id                   AS room_id,
       r.room_number,
       r.floor,
       rt.code                AS room_type_code,
       rt.name                AS room_type_name,
       r.status,
       r.self_marked,
       r.checked_out_at,
       r.ready_at,
       r.expected_return_at,
       rt.sla_minutes,
       r.checked_out_at + INTERVAL rt.sla_minutes MINUTE AS due_at
FROM rooms r
JOIN hotels h      ON h.id  = r.hotel_id
JOIN room_types rt ON rt.id = r.room_type_id;

-- ---------------------------------------------------------------------------
-- vw_sla_breaches : late rooms as of UTC_TIMESTAMP(). Mirrors the API late-rooms rules
-- (HousekeepingRepository.ListLateRoomsAsync, Turnaround.MinutesOver):
--   * a room that is not Ready is late when now > due_at. This INCLUDES OutOfOrder rooms
--     that still have a checked_out_at (the API does the same);
--   * a Ready room is listed only if ready_at > due_at AND ready_at is within the last
--     24 hours (the API's LateReadyWindow; the 24 is duplicated here and in C#);
--   * rooms with no checked_out_at never appear;
--   * exactly on target is not late.
-- DECISION: minutes_over = (TIMESTAMPDIFF(SECOND, due, end) + 59) DIV 60, only when
--   end > due, where end = ready_at for Ready rooms, else now. Whole minutes, rounded up.
-- This view is fixed to "now". A tool that needs an asOf must query vw_rooms_status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_sla_breaches AS
SELECT s.hotel_id,
       s.hotel_code,
       s.room_id,
       s.room_number,
       s.floor,
       s.room_type_code,
       s.room_type_name,
       s.status,
       s.checked_out_at,
       s.ready_at,
       s.sla_minutes,
       s.due_at,
       (TIMESTAMPDIFF(SECOND, s.due_at,
                      CASE WHEN s.status = 'Ready' THEN s.ready_at ELSE UTC_TIMESTAMP() END)
        + 59) DIV 60 AS minutes_over
FROM vw_rooms_status s
WHERE s.checked_out_at IS NOT NULL
  AND (   (s.status <> 'Ready' AND UTC_TIMESTAMP() > s.due_at)
       OR (s.status =  'Ready' AND s.ready_at IS NOT NULL
           AND s.ready_at > s.due_at
           AND s.ready_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR));

-- ---------------------------------------------------------------------------
-- vw_ooo_impact : one row per OutOfOrder interval, from room_status_history.
-- ooo_from = changed_at of the move to OutOfOrder; ooo_to = changed_at of the room's NEXT
-- history row (any status), NULL while the room is still out of order.
-- LEAD runs over ALL history rows of the room and the OutOfOrder filter is applied after,
-- otherwise separate intervals would be merged.
-- DECISION (Q5): consumers count room-nights with BOTH ends of the requested range
--   inclusive; a night is lost if the room is out of order at any moment of that date.
-- Limit: a room that is OutOfOrder with no OutOfOrder history row is invisible here.
-- PARTITION BY lists hotel_id first so a hotel_id filter can be pushed into the derived table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_ooo_impact AS
SELECT x.hotel_id,
       x.room_id,
       x.room_number,
       x.room_type_code,
       x.changed_at      AS ooo_from,
       x.next_changed_at AS ooo_to
FROM (
  SELECT r.hotel_id,
         h.room_id,
         r.room_number,
         rt.code AS room_type_code,
         h.to_status,
         h.changed_at,
         LEAD(h.changed_at) OVER (PARTITION BY r.hotel_id, h.room_id
                                  ORDER BY h.changed_at, h.id) AS next_changed_at
  FROM room_status_history h
  JOIN rooms r       ON r.id  = h.room_id
  JOIN room_types rt ON rt.id = r.room_type_id
) x
WHERE x.to_status = 'OutOfOrder';

-- ---------------------------------------------------------------------------
-- vw_housekeeper_load : housekeeper x floor x work_date.
-- DECISIONS (Q6):
--   * rooms_assigned = number of rooms on the floor TODAY. There is no assignment history
--     (housekeeper_floors holds only the current floor owner), so past dates use today's floors.
--   * rooms_completed = distinct rooms moved TO 'Ready' by that housekeeper on work_date,
--     on a floor that housekeeper holds now. Self-marked moves ARE counted. 'Inspected'
--     is not counted.
--   * work_date values offered: today (UTC) and every date that has a Ready move. A past
--     date with no Ready moves returns no rows. Housekeepers with no floor do not appear.
--   * a Ready move by someone who no longer holds the floor is credited to nobody.
-- outstanding = rooms_assigned - rooms_completed is derived by the consumer.
-- Exposes display_name only (no email, phone or hash).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_housekeeper_load AS
SELECT hf.hotel_id,
       hf.user_id                AS housekeeper_id,
       u.display_name,
       d.work_date,
       hf.floor,
       fr.rooms_on_floor         AS rooms_assigned,
       COALESCE(c.rooms_done, 0) AS rooms_completed
FROM housekeeper_floors hf
JOIN users u ON u.id = hf.user_id
JOIN (SELECT hotel_id, floor, COUNT(*) AS rooms_on_floor
      FROM rooms
      GROUP BY hotel_id, floor) fr
     ON fr.hotel_id = hf.hotel_id AND fr.floor = hf.floor
JOIN (SELECT UTC_DATE() AS work_date
      UNION
      SELECT DATE(changed_at) FROM room_status_history WHERE to_status = 'Ready') d
LEFT JOIN (SELECT r.hotel_id,
                  r.floor,
                  h.changed_by_user_id AS user_id,
                  DATE(h.changed_at)   AS work_date,
                  COUNT(DISTINCT h.room_id) AS rooms_done
           FROM room_status_history h
           JOIN rooms r ON r.id = h.room_id
           WHERE h.to_status = 'Ready' AND h.changed_by_user_id IS NOT NULL
           GROUP BY r.hotel_id, r.floor, h.changed_by_user_id, DATE(h.changed_at)) c
       ON  c.hotel_id  = hf.hotel_id
       AND c.floor     = hf.floor
       AND c.user_id   = hf.user_id
       AND c.work_date = d.work_date;

-- ---------------------------------------------------------------------------
-- vw_arrivals_vs_ready : per hotel, room type and arrival date.
-- DECISION (Q7): an arrival is bookings.check_in = arrival_date AND status = 'Confirmed'
--   (the same rule as BookingRepository.ListArrivalsAsync). Ready rooms already held by an
--   assigned booking are NOT subtracted.
-- ready_rooms is the CURRENT count of Ready rooms of that type in that hotel, repeated on
-- every date row, so it is only meaningful for arrival_date = today (UTC). MAX() is there
-- only to satisfy ONLY_FULL_GROUP_BY. Room types with no arrivals have no row. Confirmed
-- bookings whose check_in is in the past (never checked in) remain under their old date.
-- No guest columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_arrivals_vs_ready AS
SELECT b.hotel_id,
       rt.code   AS room_type_code,
       rt.name   AS room_type_name,
       b.check_in AS arrival_date,
       COUNT(*)  AS arrivals,
       MAX(COALESCE(rr.ready_rooms, 0)) AS ready_rooms
FROM bookings b
JOIN room_types rt ON rt.id = b.room_type_id
LEFT JOIN (SELECT hotel_id, room_type_id, COUNT(*) AS ready_rooms
           FROM rooms
           WHERE status = 'Ready'
           GROUP BY hotel_id, room_type_id) rr
       ON rr.hotel_id = b.hotel_id AND rr.room_type_id = b.room_type_id
WHERE b.status = 'Confirmed'
GROUP BY b.hotel_id, rt.code, rt.name, b.check_in;
