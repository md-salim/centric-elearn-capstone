-- V005: rename the room state 'Clean' to 'Ready' (housekeeping board, BR-01).
-- MySQL DDL is not transactional. Each statement here is safe to re-run on its own:
-- the UPDATEs match nothing once applied, and the ALTER only sets a default.

UPDATE rooms SET status = 'Ready' WHERE status = 'Clean';

UPDATE room_status_history SET from_status = 'Ready' WHERE from_status = 'Clean';

UPDATE room_status_history SET to_status = 'Ready' WHERE to_status = 'Clean';

ALTER TABLE rooms ALTER COLUMN status SET DEFAULT 'Ready';
