# FEATURE: SLA breach list screen

Owner: Mohammad Salim

## Why

Sofia Lindqvist (Director of Rooms) specifically stated in `docs/stakeholder-brief.md`:
> *"I want a turnaround target of 45 minutes from checkout to Ready, for every room type, everywhere. Anything slower is a breach and should appear on a list I can look at each morning, worst first... Breaches are what I will be judged on, so please make the clock honest."*
> *"How I will judge it: Show me the board for one hotel, show me the late rooms list, and show me that the desk cannot sell a room that is not ready."*
> *"with the housekeeper who had the floor, so Sofia can walk the floors that need help."*

`DELIVERABLES.md` explicitly lists:
- `Screen: SLA breach list`
- `Loading, empty and error states on both screens`

Currently, only a basic `LateRoomsPage.tsx` exists at `/housekeeping/late-rooms`, with no dedicated `/housekeeping/sla-breaches` route, no link titled "SLA breach list", no SLA target column (45m/75m), and no assigned housekeeper context for the floor. A dedicated SLA Breach List Screen provides the exact tool Sofia needs each morning to inspect turnaround breaches, evaluate severity, and take immediate operational action.

## Scope / out of scope

**In scope**
- Dedicated SLA Breach List Screen at `/housekeeping/sla-breaches` (with `/housekeeping/late-rooms` supported as an alias).
- Navigation links from the Housekeeping Board and topbar/sub-nav for "SLA breach list".
- Worst-first sorted list displaying:
  - Room number & floor
  - Assigned housekeeper for that floor (from floor assignments)
  - Room type and SLA target (45 min Standard / 75 min Suite & Family)
  - Current status (Dirty, Cleaning, Inspected, Ready-Late)
  - Checked out timestamp (UTC)
  - Due time (UTC)
  - Minutes over target (+N min) with visual severity indicators (Critical >30m, Moderate 1-30m)
- Hotel selector to view breaches across all six Larchmont properties.
- Summary metrics bar: Total Breaching Rooms, Worst Breach (max minutes over), and Affected Floors.
- Standard loading, empty ("No rooms currently breaching SLA."), and error states with retry via `StateView`.

**Out of scope**
- Modifying backend turnaround calculation logic or database schemas.
- Housekeeper live GPS/location tracking (explicitly declined per BR-17).
- Editing SLA targets from this screen (read-only monitoring).

## Acceptance criteria

- **AC_01** Given the SLA breach screen loads for a hotel, when late rooms are returned, then they are displayed sorted worst-first (highest minutes over target first).
- **AC_02** Given a late room row, when displayed, then it shows the room type, the turnaround SLA target in minutes (45 min for Standard, 75 min for Suite/Family), and the minutes over target.
- **AC_03** Given floor assignments exist for that hotel, when a room on that floor is late, then the assigned housekeeper's display name is shown in the table row. If unassigned, it shows "Unassigned".
- **AC_04** Given a hotel has no late rooms, when the screen loads, then `StateView` displays the empty state: "No rooms currently breaching SLA."
- **AC_05** Given the network request is loading or fails with an API error, then `StateView` displays the standard loading or error state with a working retry action.
- **AC_06** Given a user navigates to `/housekeeping/sla-breaches` or `/housekeeping/late-rooms`, both routes render the SLA breach screen.
- **AC_07** Given the Housekeeping Board screen, when viewed, then it provides a prominent link to the "SLA breach list".

## API contract

Uses existing backend endpoints in `HousekeepingBoardController`:

- `GET /api/hotels/{id}/late-rooms` (and alias `GET /api/hotels/{id}/sla-breaches`)
  - `200 OK`: Array of `{ roomId: number, roomNumber: string, floor: number, roomType: string, status: string, checkedOutAt: string, dueAt: string, minutesOver: number }`
  - `404 Not Found`: if hotel does not exist.

- `GET /api/hotels/{id}/floor-assignments`
  - `200 OK`: Array of `{ floor: number, housekeeperId: number, displayName: string }`

- `GET /api/hotels`
  - `200 OK`: Array of `{ id: number, code: string, name: string, ... }`

## Plan by area

### Frontend (`frontend/src/**`)
1. Create `src/pages/SlaBreachesPage.tsx` with:
   - Header: "SLA Breach List" with Sofia's turnaround policy explanation.
   - Hotel selector (Hotels 1–6).
   - Summary cards: Total Breaching Rooms, Maximum Breach, Affected Floors.
   - Table: Room, Floor, Assigned Housekeeper, Room Type, Target (min), Status, Checked Out (UTC), Due (UTC), and Over Target (+min).
   - Integration with `useAsync` and `StateView` for loading, empty ("No rooms currently breaching SLA."), and error states.
2. Update `src/api/housekeeping.ts` to export `getSlaBreaches` (pointing to `/api/hotels/${hotelId}/sla-breaches`).
3. Update `src/App.tsx`:
   - Wire route `/housekeeping/sla-breaches` to `SlaBreachesPage`.
   - Keep `/housekeeping/late-rooms` routing to `SlaBreachesPage` for full backward compatibility.
4. Update `src/pages/HousekeepingBoardPage.tsx`:
   - Ensure the sub-navigation link prominently says "SLA breach list" pointing to `/housekeeping/sla-breaches`.
5. Update `src/styles.css` with badges for SLA breach severity (`severity-critical`, `severity-moderate`, `sla-target-badge`).

### Backend & MCP Compatibility
- The backend already provides `GET /api/hotels/{id}/sla-breaches` as an alias to `late-rooms`.
- The Larchmont MCP tool `rooms_breaching_sla` provides identical data over stdio/protocol.

### Verification
- `cd frontend && npm run build` passes with strict TypeScript checks.
- Verify both `/housekeeping/sla-breaches` and `/housekeeping/late-rooms` load.
- Verify empty, loading, and populated states with housekeeper mapping.

## Risks and open questions

- **Housekeeper assignment coverage**: If a floor has no assigned housekeeper, the screen will display "Unassigned" rather than crashing or showing blank.
- **Route compatibility**: Existing links or bookmarks to `/housekeeping/late-rooms` must continue to work seamlessly.

## Verify

- `cd frontend && npm run build`

