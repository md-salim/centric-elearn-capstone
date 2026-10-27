-- V007: housekeeping tables (FEATURE-housekeeping-api.md, db-analysis 3.2 and 3.3).

-- One housekeeper per floor: the primary key (hotel_id, floor) enforces it.
-- A housekeeper may hold many floors: user_id is not unique.
CREATE TABLE housekeeper_floors (
  hotel_id INT NOT NULL,
  floor INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (hotel_id, floor),
  KEY ix_housekeeper_floors_user (user_id),
  CONSTRAINT fk_housekeeper_floors_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id),
  CONSTRAINT fk_housekeeper_floors_user FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Lock and desk checkouts. The unique key on (booking_ref, checked_out_at) makes the
-- lock webhook idempotent (BR-12). checked_out_at is truncated to whole seconds in code.
CREATE TABLE checkout_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  booking_ref VARCHAR(20) NOT NULL,
  room_id INT NOT NULL,
  checked_out_at DATETIME NOT NULL,
  source VARCHAR(10) NOT NULL DEFAULT 'Lock',
  received_at DATETIME NOT NULL,
  UNIQUE KEY ux_checkout_events_ref_time (booking_ref, checked_out_at),
  KEY ix_checkout_events_booking (booking_id),
  KEY ix_checkout_events_room (room_id, checked_out_at),
  CONSTRAINT fk_checkout_events_booking FOREIGN KEY (booking_id) REFERENCES bookings (id),
  CONSTRAINT fk_checkout_events_room FOREIGN KEY (room_id) REFERENCES rooms (id)
);
