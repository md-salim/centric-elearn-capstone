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
