#!/usr/bin/env bash
# Stop hook: write a mechanical session handoff note (docs/session-logs/YYYY-MM-DD-auto-<session>.md).
# A shell script cannot read the conversation itself; write-handoff.js reads the transcript file named
# in the hook JSON on stdin. Always exits 0 so it can never block or fail the end of a session.
# The rich handoff (goal, decisions, open questions) comes from the session-handoff skill (/handoff).

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$here/write-handoff.js" || true
exit 0
