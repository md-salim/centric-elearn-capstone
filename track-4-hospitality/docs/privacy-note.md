# Privacy note: housekeeper live position

Status: decision recorded 2026-10-27. Not legal advice; a data protection officer or legal adviser must review before anything in "What we would build" goes ahead.

## What was asked
The stakeholder brief (Sofia Lindqvist, 19 October 2026) asks the board to show where each housekeeper is on the floor plan "all the time", including people who "pick up extra shifts without clocking in" and "during their breaks". Objections are to be "a conversation for HR".

## What we declined, and why
We did not build it. The request as written:
- **Data minimisation (UK GDPR Art 5(1)(c)).** Continuous location of every housekeeper is far more than is needed to send the nearest person to a room.
- **Lawful basis (Art 6).** No basis fits. Consent is not valid when the employer asks and refusal is "a conversation for HR" (employee consent is unlikely to be freely given). Legitimate interests would fail the necessity and balancing test for tracking off-duty time.
- **Off-duty monitoring.** Tracking breaks and people who have not clocked in monitors people who are not working. This is the least defensible part.
- **Transparency and DPIA.** Systematic monitoring of staff needs a Data Protection Impact Assessment and clear notice to staff before any processing starts.
- **Fairness.** Building it first and handling objections afterwards reverses the required order.

## What we built instead
`GET /api/housekeepers/{id}/position` exists as a stub. It always returns `501 Not Implemented` with this body and does not look anything up:

```json
{ "status": 501, "title": "Not implemented",
  "detail": "Live housekeeper position is deliberately not implemented. See docs/privacy-note.md for the rationale and the proposed scoped alternative." }
```

No location is received, stored or logged. There is no map in the UI. The need behind the request, "send the nearest person", is covered for now by floor assignment (spec BR-10): the board shows who looks after each floor.

## What we did NOT implement
- **Constant GPS or floor-plan tracking** of housekeepers.
- **Break-time tracking.**
- **Off-shift or unclocked extra-shift tracking.**

To be explicit about what is not there:
- **No opt-in live position is built.** The opt-in, on-shift-only design below is a proposal only.
- **Server-side rejection of off-shift or on-break reports is not implemented.** There is no shift, clock-in or break data in the schema, and shift clocking is out of scope, so a server would have nothing to check a report against.
- **All that exists in code is the 501 stub** (`HousekeeperPositionController`, spec BR-17). Both `GET` and `POST /api/housekeepers/{id}/position` return 501. Nothing is received, bound, stored or logged.

## Why the declined scope fails (extended)
- **Art 5(1)(c) minimisation.** The purpose is to send the nearest person to a room. That needs, at most, the last known position of someone who is on shift and has agreed to share it, for a short time. It does not need a continuous trail, break locations or positions of people not working. A trail is not the least intrusive way to meet the purpose, and floor assignment (BR-10) already meets it in part.
- **Art 6 lawful basis.** Consent is unlikely to be freely given in an employment relationship, and cannot be relied on where refusal is to be "a conversation for HR". Legitimate interests need a necessity and balancing test. Routing on-shift staff may pass it with safeguards. Tracking people on breaks, off shift or unclocked cannot, and no other basis in Art 6 fits.

## What we propose instead (proposed, not built)
- Nearest-housekeeper routing from the **last known on-shift position**, shared only by housekeepers who **opt in per shift**.
- Switched off automatically at clock-out and during breaks.
- No history older than 24 hours.
- Limited access, with a log of who looked.
- This needs shift, clock-in and break data that the system does not have today, so it also needs a decision on shift clocking.
- It needs a **DPIA and HR/legal sign-off, and notice to staff, before anything is built.** It is a proposal, not a commitment.

## MCP server and location data
The MCP server (`mcp/`) exposes **no location data** and no guest personal data beyond what is listed in `docs/mcp-security.md`. Its views hold no guest columns, contact details or free text. The only personal data is the housekeeper display name. See `docs/mcp-security.md` for the column policy, limits and audit log. Nothing in this note is legal advice.

## What we would build for a lawful scope
Only after a DPIA and HR/legal sign-off, and staff have been told:
- **Opt-in** by each housekeeper, per shift, and they can switch it off at any time without penalty.
- **On-shift only.** Sharing stops automatically at clock-out and during breaks. Nothing is collected off-shift or from anyone not clocked in.
- **Floor-level first.** Show "floor 3" or "available / busy", not a dot on a plan, unless a need for more is shown.
- **No history beyond 24 hours.** Automatic deletion; no exports; no use in performance or disciplinary reviews.
- **Limited access.** Supervisors and the Director of Rooms, for the hotel they manage, with a log of who looked.
- **Secure transport and storage**, no third-party sharing.

## Decision record
This was a deliberate design decision: the AI drafted the privacy reasoning and the stub, and the human team confirmed pushing back on the stakeholder's request. The stakeholder should be told why and offered the scoped option above.
