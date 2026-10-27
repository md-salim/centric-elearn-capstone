# FEATURE: Room-type SLA display

Owner: Mohammad Salim

## Why

The turnaround target (`sla_minutes`) exists in the database, and backend housekeeping behavior uses it, but users cannot see the target in the frontend. The stakeholder asks for 45 minutes by default and 75 minutes for Suite and Family room types ("Turnaround time" in `docs/stakeholder-brief.md`). Showing each stored target will make the policy visible and let staff understand the time used by the late-room and ready-by calculations.

The existing room-type API does not include `slaMinutes` in its DTO, and the frontend has no room-type page.

## Scope / out of scope

**In scope**
- Include the stored `slaMinutes` in room-type API responses.
- Add a read-only Room Types screen showing each type's name, code, maximum occupancy, base rate, and turnaround target in minutes.
- Add the screen to the frontend navigation.
- Use the existing loading, empty, and error state pattern.

**Out of scope**
- Editing or configuring SLA targets from the frontend or API.
- Database schema changes or modifications to existing migrations.
- Changes to the housekeeping board, late-room calculation, or ready-by behavior.

## Acceptance criteria

- **AC_01** Given the room-type list endpoint is requested, when room types are returned, then each response includes `slaMinutes` equal to the value stored for that type.
- **AC_02** Given the Room Types screen loads successfully, when room types are displayed, then each row shows the stored turnaround target with a minutes unit.
- **AC_03** Given the seeded room types, when the list is displayed, then the default target is shown as 45 minutes and Suite and Family targets are shown as 75 minutes.
- **AC_04** Given the room-type request is loading, returns no room types, or fails, when the user views the screen, then the appropriate loading, empty, or error state is shown.
- **AC_05** Given the Room Types screen is displayed, when a user views a room type, then the SLA is read-only and no target-editing action is offered.

## API contract

Extend the existing room-type response without changing its route or existing fields:

- `GET /api/room-types`
  - `200 OK`: array of `{ id, code, name, maxOccupancy, baseRate, slaMinutes }`.
- `GET /api/room-types/{id}`
  - `200 OK`: `{ id, code, name, maxOccupancy, baseRate, slaMinutes }`.
  - `404 Not Found` for an unknown room type, unchanged.

The existing `POST /api/room-types` and `PUT /api/room-types/{id}` request and response behavior is not expanded to edit SLA values in this feature. The `slaMinutes` response property is additive; existing response properties retain their names and meanings.

## Plan by area

### Backend

Owns `backend/Larchmont.Api/**`.

- Add `SlaMinutes` to the room-type response DTO and map it from the existing `RoomType.SlaMinutes` entity property.
- Keep current room-type create/update request behavior unchanged; do not add a migration or alter how targets are set.
- Confirm GET list and GET by ID serialize `slaMinutes` as a JSON number.

### Frontend

Owns `frontend/src/**`.

- Add the `slaMinutes` field to the frontend room-type API type and a room-types API helper using the shared API client.
- Add a Room Types page and route/navigation entry.
- Show room type name, code, maximum occupancy, base rate, and SLA target with a minutes unit.
- Handle loading, empty, and error states through `StateView` and `useAsync`.
- Do not add target editing controls.

### Tests

Owns `backend/Larchmont.Tests/**`.

- Add xUnit API tests named `AC_NN_Description` to verify room-type list and detail responses include their stored SLA values.
- Verify the existing CRUD behavior remains valid when request payloads omit `slaMinutes`.
- Use the existing InMemory API test setup; no SQL, performance, index, or concurrency claims are in scope.

## Risks and open questions

- The stakeholder spec's Open Question 2 asks whether the targets of 75 minutes for Suite and Family are confirmed and who may change targets. The brief states these values, so this plan displays stored values but does not allow editing. Confirm before adding an editor or exposing SLA updates through POST/PUT.
- The database must have the migration that adds `room_types.sla_minutes` applied. If it is absent in a deployment, adding the response property will expose the schema mismatch at runtime; this feature does not add migration recovery behavior.
- The user has requested target availability in the frontend but did not specify which screen. This plan uses a dedicated read-only Room Types page because the frontend currently has no housekeeping screens or room-type page.

## Verify

- `dotnet build backend/Larchmont.sln --nologo`
- `dotnet test backend/Larchmont.sln`
- From `frontend/`: `npm run build`
