# Spec: Housekeeping board

## Overview
Front desks at Larchmont hotels sell rooms that are still being cleaned or are out of service, because housekeeping reports by walkie-talkie and whiteboard (brief: "Why I am asking"). This feature gives each hotel a board that shows every room's cleaning state by floor, enforces the order of cleaning steps, stops the desk from assigning out-of-order rooms, times each turnaround against a target, and updates live when the lock system reports a checkout.

For: Sofia Lindqvist (Director of Rooms), supervisors, housekeepers, maintenance, front desk.

**In scope**
- Room cleaning states and the legal moves between them.
- Out-of-order (OOO) handling and the block on assigning OOO rooms.
- Turnaround target (SLA), clock, and the late-rooms list.
- Housekeeper-to-floor assignment.
- "When will this room be ready?" for the desk.
- Lock-system checkout webhook and live push to the board.
- A deliberate **501 stub** for housekeeper live position (BR-17).

**Out of scope**
- Housekeeper live location, GPS or floor-plan tracking. Declined. See `docs/privacy-note.md`.
- The Monday occupancy report. It is a bug, tracked in `docs/bug-LH-56.md`.
- Login and permissions. The app has none today (see Open Questions 9).
- Payroll, shift clocking, the staff mobile app itself.

**What exists today:** rooms have status `Clean`, `Dirty` or `OutOfOrder`. `PUT /api/rooms/{id}/status` accepts any move. `BookingService.CheckOutAsync` sets the room Dirty but records no checkout time on the room. `BookingService.AssignRoomAsync` does not look at room status. There is no floor assignment, no target data and no live push.

## Users
| Role | May see | May do |
|---|---|---|
| Housekeeper | Board for their hotel, their assigned floors | Dirty→Cleaning; Cleaning→Ready (self-mark, flagged) |
| Supervisor | Board, late rooms, floor assignments | Cleaning→Inspected; Inspected→Ready; set floor assignments |
| Maintenance | Board | Any→OutOfOrder with a reason; OutOfOrder→Dirty when the room is back |
| Front desk | Board, ready-by time for a room | Assign rooms (never an OOO room). Cannot change cleaning state |
| Director of Rooms | Everything above, late-rooms list for each hotel | Change targets (see Open Questions 2) |

Who may do what is an assumption until login exists (Open Questions 9).

## Business rules

**States and moves**
- BR-01 A room is in one of five states: Dirty, Cleaning, Inspected, Ready, OutOfOrder. The first four are the cleaning cycle; OutOfOrder is the maintenance state. The existing state `Clean` becomes `Ready`.
- BR-02 Only these moves are legal:
  - Dirty → Cleaning (housekeeper starts).
  - Cleaning → Inspected (supervisor passes).
  - Inspected → Ready (final).
  - Cleaning → Ready (housekeeper self-mark, for simple turns only; see BR-04).
  - Any state → OutOfOrder (maintenance, with a reason).
  - OutOfOrder → Dirty (the room is back).
- BR-03 Any other move is refused with a 400 ProblemDetails. The message names the current state and the moves allowed from it, in words the front desk can act on.
- BR-04 A Cleaning → Ready move sets the flag `SelfMarked`. The flag shows on the board and in history. A room made Ready through Inspected is not flagged.
- BR-05 Moving to OutOfOrder needs a non-blank reason. A room leaving OutOfOrder goes to Dirty and then through the normal steps.
- BR-06 An OutOfOrder room cannot be sold or assigned. `BookingService.AssignRoomAsync` refuses it.
- BR-15 Every move is recorded: room, from, to, who, when, `SelfMarked`, and the OOO reason.

**Turnaround**
- BR-07 Each room type has a target in minutes, held as data. Default 45. Suite and Family room types are 75.
- BR-08 The clock starts at the guest's checkout timestamp, not at the moment the room became Dirty.
- BR-09 A room is late when it is not Ready and the target has passed, or it became Ready after the target. The late-rooms list is sorted worst first (most minutes over target first). A room exactly on target is not late.
- BR-16 Ready-by for one room: Ready gives "ready now"; Dirty, Cleaning or Inspected gives checkout time plus target; OutOfOrder gives "out of order" and the expected return if one is known.

**Floors**
- BR-10 Housekeepers are assigned to floors within a hotel. One housekeeper may have several floors. A floor has at most one housekeeper.

**Lock system and live updates**
- BR-11 When the lock system reports a key-card checkout, the room turns Dirty at once and the reported `checkedOutAt` becomes the clock start.
- BR-12 The checkout webhook is idempotent on `bookingRef` plus `checkedOutAt`. A repeat changes nothing and still succeeds.
- BR-13 The webhook must carry an HMAC-SHA256 signature made with a shared secret read from the environment. A missing or wrong signature is refused with 401. If no secret is configured, every call is refused.
- BR-14 After any committed room change, a `room-updated` event is pushed to clients subscribed to that hotel.

**Staff**
- BR-17 Live housekeeper position is **not implemented**. `GET /api/housekeepers/{id}/position` always returns 501. No location data is received, stored or logged.
- BR-18 Moves are limited to the roles in the Users table (assumption; see Open Questions 9).

## API
All errors are ProblemDetails (`application/problem+json`). Times are UTC, ISO 8601.

Note: existing `BusinessRuleException` returns **422**. Illegal moves must return **400**, so a new `InvalidTransitionException` mapping to 400 is needed in `Infrastructure/Exceptions.cs`. Existing 422 rules do not change.

### `GET /api/hotels/{hotelId}/board?floor={n}`
200: `{ hotelId, generatedAt, floors: [ { floor, housekeeper: {id, displayName} | null, rooms: [ { roomId, roomNumber, roomType, status, selfMarked, checkedOutAt | null, dueAt | null, minutesOver | null, oooReason | null } ] } ] }`
404 if the hotel does not exist.

### `POST /api/rooms/{roomId}/transitions`
Request: `{ "to": "Cleaning", "reason": "optional, required for OutOfOrder", "expectedReturnAt": "optional, OutOfOrder only" }`. This replaces the free-form `PUT /api/rooms/{id}/status`, which is removed or made to call the same rules.
200: the updated room as in the board.
400 illegal move (BR-03), for example "Room 204 is Dirty. It can only go to Cleaning or OutOfOrder."
400 validation: unknown state, or OutOfOrder without a reason.
404 room not found.
409 the room changed since it was read (two people moved it at once).

### `GET /api/rooms/{roomId}/ready-by`
200: `{ roomId, state, readyBy | null, expectedReturnAt | null }`. 404 room not found.

### `GET /api/hotels/{hotelId}/late-rooms`
200: list of `{ roomId, roomNumber, floor, roomType, status, checkedOutAt, dueAt, minutesOver }`, worst first. Empty list when nothing is late. 404 hotel not found.

### `GET /api/hotels/{hotelId}/floor-assignments` and `PUT /api/hotels/{hotelId}/floor-assignments`
PUT request: `{ "assignments": [ { "floor": 2, "housekeeperId": 7 } ] }` (full replacement).
200: the saved assignments.
400 a floor appears twice; a housekeeper does not belong to this hotel; a floor has no rooms.
404 hotel not found.

### `POST /api/lock-events/checkout`
Header: `X-Signature: sha256=<hex HMAC-SHA256 of the raw body>`. Secret from environment variable `LockEvents__SharedSecret`.
Request: `{ "bookingRef": "LH-1234", "roomId": 12, "checkedOutAt": "2026-10-27T09:58:00Z" }`
200: `{ "roomId": 12, "status": "Dirty", "duplicate": false }`. A repeat returns 200 with `duplicate: true` and changes nothing.
400 malformed body or missing fields.
401 missing or wrong signature, or no secret configured.
404 room or booking reference not found.
422 the booking is not assigned to that room.
The booking is marked CheckedOut too if it is not already, so the desk does not need a second click.

### Live push: SignalR hub `/hubs/board`
Client joins a hotel group with `JoinHotel(hotelId)`. Server sends `room-updated` with `{ roomId, hotelId, status, selfMarked, checkedOutAt, dueAt, changedAt }` after every committed move, webhook checkout, and desk check-out. SignalR was chosen over SSE (`/api/stream/board`) because it is built into ASP.NET Core, supports groups and reconnects automatically.

### `GET /api/housekeepers/{housekeeperId}/position` (stub)
Always 501, for any id, without looking anything up:
```json
{ "status": 501, "title": "Not implemented",
  "detail": "Live housekeeper position is deliberately not implemented. See docs/privacy-note.md for the rationale and the proposed scoped alternative." }
```

### Change to an existing endpoint: `POST /api/bookings/{id}/room` (AssignRoom)
422 (existing rule style) if the room is OutOfOrder: "Room 204 is out of order and cannot be assigned."

## UI
- **Board** (one hotel). Floors as rows, rooms as tiles. Each tile shows room number, state as colour **and** text, a "Self-marked" badge, and minutes left or over target. Busiest floors (most Dirty or Cleaning rooms) are sorted first or highlighted. A small indicator shows "Live" or "Reconnecting". If the live connection is down, the board re-reads every 30 seconds.
  - Loading: "Loading board".
  - Empty: "No rooms for this hotel."
  - Error: message and a Retry button.
- **Late rooms**. Table, worst first, with minutes over. Empty: "No late rooms." Loading and error as above.
- **Floor assignments**. One row per floor, a housekeeper dropdown, Save. Shows the 400 message if a floor is double-booked.
- **Ready-by lookup**. Enter a room, get a time, "ready now", or "out of order, back at ...".
- **Move buttons** on a tile show only the moves legal from that state.
- There is no map and no housekeeper location anywhere in the UI.

## Acceptance Criteria
- AC-01 Given a Dirty room, When a housekeeper moves it to Cleaning, Then it is Cleaning and the move is recorded.
- AC-02 Given a Cleaning room, When a supervisor moves it to Inspected, Then it is Inspected.
- AC-03 Given an Inspected room, When it is moved to Ready, Then it is Ready and `SelfMarked` is false.
- AC-04 Given a Cleaning room, When a housekeeper moves it straight to Ready, Then it is Ready and `SelfMarked` is true.
- AC-05 Given a Dirty room, When anyone moves it to Ready, Then 400 and the room stays Dirty.
- AC-06 Given a room in each state, When moved to any target not allowed by BR-02 (Dirty→Inspected, Inspected→Cleaning, Ready→Cleaning, Ready→Inspected, OutOfOrder→Ready, a move to its own state), Then 400 naming the allowed moves.
- AC-07 Given a Ready room, When maintenance moves it to OutOfOrder with a reason, Then it is OutOfOrder and the reason is stored.
- AC-08 Given any room, When it is moved to OutOfOrder with a blank or missing reason, Then 400 and the status is unchanged.
- AC-09 Given an OutOfOrder room, When it is moved to Dirty, Then it is Dirty; When moved to Cleaning, Inspected or Ready, Then 400.
- AC-10 Given an OutOfOrder room and a confirmed booking of the same hotel and type, When the desk assigns that room, Then 422 and the booking has no room.
- AC-11 Given a Ready room, When the desk assigns it, Then the assignment succeeds as it does today.
- AC-12 Given a Standard room checked out at 10:00, When the board is read at 10:45:00, Then the room is not late; at 10:46 it is late by 1 minute.
- AC-13 Given a Suite or Family room checked out at 10:00, When read at 11:15:00, Then not late; at 11:16 late by 1 minute.
- AC-14 Given a room checked out at 10:00 that became Dirty at 10:20, When it is read at 10:50, Then minutes over are counted from 10:00 (5 minutes), not 10:20.
- AC-15 Given three late rooms with 5, 40 and 12 minutes over, When the late list is read, Then the order is 40, 12, 5.
- AC-16 Given a room that was made Ready 50 minutes after checkout, When the late list is read, Then it is listed with 5 minutes over.
- AC-17 Given housekeeper 7, When assigned floors 1, 2 and 3, Then saved. Given floor 2 given to housekeepers 7 and 8 in one request, Then 400 and nothing is saved.
- AC-18 Given a correctly signed checkout event for a room occupied by that booking, When posted, Then 200, the room is Dirty and `checkedOutAt` is the reported time.
- AC-19 Given the same event posted twice, When the second arrives, Then 200 with `duplicate: true`, one history row only, one push only.
- AC-20 Given an event with a wrong signature, no signature, or no secret configured, When posted, Then 401 and nothing changes.
- AC-21 Given a signed event for an unknown room, Then 404; for a booking not assigned to that room, Then 422.
- AC-22 Given a client subscribed to hotel 1, When any room in hotel 1 changes state (webhook or manual move), Then it receives `room-updated` without a refresh; a client of hotel 2 does not.
- AC-23 Given any housekeeper id (existing or not), When `GET .../position` is called, Then 501 with the exact title and detail above, and no location data is stored.
- AC-24 Given a Ready room, Then ready-by is "ready now"; a Dirty room checked out at 10:00 with a 45 minute target gives 10:45; an OutOfOrder room gives "out of order" and the expected return if known.
- AC-25 Given two users moving the same room at the same moment, When both submit, Then one succeeds and the other gets 409.
- AC-26 Given a desk check-out and a lock event for the same checkout, When both arrive, Then the room is Dirty once, with the earlier checkout time as the clock start.

## Assumptions & Open Questions

### Decided by us
- We use five states: the four from the brief plus OutOfOrder. `Clean` is renamed `Ready`.
- Cleaning→Ready is built as instructed by the team, flagged `SelfMarked`. This goes against the brief's "no exceptions" (see Question 1).
- Targets are data per room type, not code constants.
- Times are UTC. No timezone conversion.
- SignalR, not SSE, for live push.
- The webhook returns 200 for a duplicate so the lock system does not retry forever.
- If the lock system and the desk both report a checkout, the earlier timestamp starts the clock.
- Invalid moves return 400, not the 422 used by other rules, as instructed.
- The 501 position stub is included because it holds no personal data. The brief's GPS request is declined, not built (BR-17, `docs/privacy-note.md`). The spec-writer skill says to write no API for tracking; the stub is an exception requested by the team, and it records and returns nothing.
- Legal references are UK GDPR and the Data Protection Act 2018 (Larchmont is UK-based). This is not legal advice.

### Asked the stakeholder (replies blank)
1. The brief says nothing reaches Ready without a supervisor, "no exceptions", and also that housekeepers may mark a simple turn Ready themselves. These conflict. We built the self-mark with a visible flag. What is a "simple turn", who decides, and should rooms returning from OutOfOrder always be inspected? Reply:
2. 45 minutes "for every room type" and then 75 for suites and family rooms: is 75 for those two types right, and who may change targets? Reply:
3. "The clock should start when the guest leaves." Which timestamp is that: the key-card expiry from the lock system, the desk check-out click, or something else? What if they differ? Reply:
4. Does the lock system send events today? What does it send, can it sign requests, who holds the shared secret, and what should the board show if events stop arriving? Reply:
5. Ready-by for an OOO room needs an expected return date. The brief does not ask maintenance for one. Should maintenance enter it? Reply:
6. "Show me that the desk cannot sell a room that is not ready." We block only OutOfOrder rooms. Should Dirty, Cleaning and Inspected rooms also be blocked? A future booking can sensibly be assigned a room that is dirty today. Reply:
7. What happens if maintenance marks an occupied room OutOfOrder, or one with a booking assigned? Reply:
8. After OutOfOrder→Dirty, does a new turnaround clock start at that moment? (We assume yes.) Reply:
9. The app has no login. How will we know whether a caller is a housekeeper, supervisor or maintenance? Needed before BR-18 can be enforced. Reply:
10. Housekeeper live position "all the time, including breaks and off-shift, including people not clocked in": **out of scope pending HR and legal advice. Not built.** It lacks a lawful basis and necessity (UK GDPR Art 5(1)(c) data minimisation, Art 6), covers people who are off duty, and would need a DPIA. A narrower option is in `docs/privacy-note.md`. Reply:
11. Occupancy report: tracked as `docs/bug-LH-56.md`, not part of this feature.

## Traceability
| Brief item | Business rule | Acceptance criteria | Endpoint / screen | Test |
|---|---|---|---|---|
| Four states; checkout → Dirty → Cleaning → Inspected → Ready | BR-01, BR-02, BR-03, BR-15 | AC-01, 02, 03, 05, 06 | `POST /api/rooms/{id}/transitions`; Board | AC_01_DirtyToCleaning, AC_02_CleaningToInspected, AC_03_InspectedToReady, AC_05_DirtyToReadyRefused, AC_06_IllegalMovesRefused |
| Nothing Ready without supervisor, no exceptions (conflicts with self-mark; Question 1) | BR-02, BR-04 | AC-03, AC-05 | same | AC_03_InspectedToReady, AC_05_DirtyToReadyRefused |
| Housekeeper marks simple turn Ready | BR-04 | AC-04 | same; Board "Self-marked" badge | AC_04_SelfMarkSetsFlag |
| OOO with a reason; returns through cleaning steps | BR-05 | AC-07, 08, 09 | `POST /api/rooms/{id}/transitions` | AC_07_MaintenanceSetsOutOfOrder, AC_08_OutOfOrderNeedsReason, AC_09_OutOfOrderOnlyToDirty |
| Desk can never assign an OOO room | BR-06 | AC-10, AC-11 | `POST /api/bookings/{id}/room` | AC_10_CannotAssignOutOfOrderRoom, AC_11_CanAssignReadyRoom |
| 45 minute target; 75 for suite and family | BR-07, BR-09 | AC-12, AC-13 | Board; Late rooms | AC_12_StandardBoundary45, AC_13_SuiteFamilyBoundary75 |
| Clock starts when guest leaves | BR-08, BR-11 | AC-14, AC-26 | Board; lock webhook | AC_14_ClockStartsAtCheckout, AC_26_EarlierCheckoutWins |
| Late rooms list each morning, worst first | BR-09 | AC-15, AC-16 | `GET /api/hotels/{id}/late-rooms`; Late rooms page | AC_15_LateListWorstFirst, AC_16_LateWhenReadyAfterTarget |
| Organised by floor; housekeeper per floor; busiest floors visible | BR-10 | AC-17 | `GET/PUT /api/hotels/{id}/floor-assignments`; Board; Floor assignments | AC_17_FloorAssignmentRules |
| Desk asks when a room will be ready | BR-16 | AC-24 | `GET /api/rooms/{id}/ready-by`; Ready-by lookup | AC_24_ReadyByTime |
| Lock system: room Dirty instantly | BR-11, BR-12, BR-13 | AC-18, 19, 20, 21 | `POST /api/lock-events/checkout` | AC_18_WebhookMakesRoomDirty, AC_19_WebhookIdempotent, AC_20_WebhookRejectsBadSignature, AC_21_WebhookUnknownRoomOrBooking |
| Board updates without a refresh | BR-14 | AC-22 | `/hubs/board`; Board "Live" indicator | AC_22_HubPushesRoomUpdated |
| Two people moving one room | BR-03 | AC-25 | `POST /api/rooms/{id}/transitions` | AC_25_ConcurrentMoveOneWins (real MySQL) |
| Show where each housekeeper is, all the time, incl. breaks and off-shift | BR-17 | AC-23 | `GET /api/housekeepers/{id}/position` returns 501 | AC_23_PositionIsNotImplemented |
| Monday occupancy report looks wrong | none | none | out of scope, `docs/bug-LH-56.md` | none |
| "Show me the board, the late list, and that the desk cannot sell a non-ready room" | BR-06 (Question 6) | AC-10, AC-15 | Board; Late rooms | see above |
