# FEATURE: MCP server (Larchmont read-only operations tools)
Owner: unassigned

Plan only. No code has been written. There is no spec for this feature in `docs/specs/`. The requirement comes from the team's request and `DELIVERABLES.md` (MCP section). It builds on the housekeeping work already in the repo (`docs/specs/housekeeping-board.md`, migrations V005 to V007).

## Why
Sofia Lindqvist wants a morning list of late rooms, worst first, and to be judged on breaches (brief: "Turnaround time" and "How I will judge it"). Managers and an AI assistant also need to ask operational questions without hand-writing SQL and without any route to guest data or write access. An MCP server gives them five fixed questions plus one tightly guarded query tool, all reading through database views as a user that can only `SELECT`.

**The stakeholder brief does not mention MCP.** The tools are the team's addition. The tie to the brief is the late-rooms list, the floor and housekeeper work and the out-of-order rooms.

## Scope / out of scope
**In**
- `mcp/`: Node 20, TypeScript (strict), MCP over stdio. Five tools in this order: `rooms_breaching_sla`, `ooo_impact_on_occupancy`, `housekeeper_load`, `arrivals_without_ready_room`, `run_readonly_query`.
- `db-setup/02-mcp-views.sql`: `vw_rooms_status`, `vw_sla_breaches`, `vw_ooo_impact`, `vw_housekeeper_load`, `vw_arrivals_vs_ready`.
- `db-setup/03-create-mcp-user.sql`: user `mcp_readonly`@`%`, password from the environment only, `SELECT` on those five views only.
- `mcp/tests/` (written by a `general-purpose` agent, decided), `docs/mcp-security.md`, `docs/privacy-note.md` (update, see Risks 1).
- `.mcp.json` at the repo root (stdio server, password passed as `${MCP_DB_PASSWORD}` from the environment, no secret in the file) and a job in `.github/workflows/ci.yml` that runs the MCP tests with a MySQL 8.4 service container. Both are `DELIVERABLES.md` items, included on the team's say-so.

**Out**
- Any write tool, any tool that reads base tables, guest contact details, hotel scoping of `run_readonly_query`.
- Login for the MCP client (the MCP host owns that).
- Nothing else from `DELIVERABLES.md` beyond the MCP items (see "In" above).
- Fixing the occupancy report bug (`docs/bug-LH-56.md`). Tool 2 must not reuse that report's code.
- The net10 bump (M4). This is a Node project and is unaffected.

## Acceptance criteria
Tests for ACs that need real SQL are tagged "MySQL". InMemory-style mocks cannot prove them (CLAUDE.md).

**Database objects**
- AC_01 Given `02-mcp-views.sql` has run, When the columns of the five views are listed from `information_schema`, Then they match the column contract below and none is named `email`, `phone`, `address_line`, `postcode`, `password_hash`, `notes` or `reason`. (MySQL)
- AC_02 Given `MCP_DB_PASSWORD` is unset or empty, When the user script runs, Then it stops with a clear error and creates nothing. Given it is set, Then `mcp_readonly`@`%` exists. A search of the repo finds no password literal for this user.
- AC_03 Given `mcp_readonly`, When `SHOW GRANTS` runs, Then it lists only `SELECT` on the five views. `SELECT` on `rooms`, `users`, `guests`, `information_schema.tables` and `mysql.user` is denied, and `INSERT`, `UPDATE`, `DELETE` and `DROP` on a view are denied. (MySQL)

**Tools**
- AC_04 Given the server is started, When tools are listed, Then there are exactly five, in the order above, and each description states its inputs and the shape of its output.
- AC_05 Given rooms checked out 10:00 (Standard) and 10:00 (Suite or Family), When `rooms_breaching_sla` runs with `asOf` 10:45:00 and then 10:46, Then the Standard room is absent then present with `minutesOver` 1. For Suite or Family the same holds at 11:15:00 and 11:16. Results are worst first. The numbers equal the API's `late-rooms` (`Turnaround.MinutesOver`). (MySQL)
- AC_06 Given `asOf` is omitted, When the tool runs, Then it uses the current UTC time. Given a room that became Ready after its target, Then it is listed with the minutes it was over.
- AC_07 Given a fixture with OutOfOrder intervals, including one still open and one that starts before `from`, When `ooo_impact_on_occupancy` runs, Then it returns `roomNightsLost` per room and in total, counted only inside the range, equal to the hand-computed value. (MySQL)
- AC_08 Given floor assignments and a day of Ready moves, When `housekeeper_load` runs, Then each housekeeper of that hotel has `assigned`, `completed` and `outstanding`, and no housekeeper of another hotel appears. (MySQL)
- AC_09 Given arrivals and Ready rooms per room type, When `arrivals_without_ready_room` runs, Then only room types with fewer Ready rooms than arrivals are returned, with `shortfall`. When none qualify, Then the list is empty. (MySQL)
- AC_10 Given a bad `hotelId`, a malformed date or an unknown hotel, When any named tool is called, Then it returns an MCP error with a plain message. Bad input never reaches the database.

**`run_readonly_query` guard**
- AC_11 Given `SELECT room_number, status FROM vw_rooms_status`, When called, Then it returns `columns`, `rows`, `rowCount`, `truncated: false`, `durationMs`.
- AC_12 Given `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `CALL`, `SET`, `SHOW` or `EXPLAIN`, When called, Then it is rejected and the database is never contacted.
- AC_13 Given `SELECT 1 FROM vw_rooms_status; SELECT 2 FROM vw_rooms_status` or a statement followed by `; DROP TABLE rooms`, When called, Then it is rejected.
- AC_14 Given a statement containing `/*! ... */`, `/*M! ... */`, `/* ... */`, `-- ` or `#`, When called, Then it is rejected, including when the comment hides `DROP`, a second statement or a table name.
- AC_15 Given `USE larchmont`, `USE mysql`, or `SELECT ... INTO OUTFILE/DUMPFILE/@var`, `FOR UPDATE`, `LOCK IN SHARE MODE`, When called, Then it is rejected.
- AC_16 Given a query that reads any table other than the five views, whether in `FROM`, a join, a subquery, a CTE or a `UNION`, quoted or upper-cased, schema-qualified (`larchmont.rooms`, `information_schema.tables`, `mysql.user`), When called, Then it is rejected.
- AC_17 Given SQL the parser cannot parse, When called, Then it is rejected (fail closed).
- AC_18 Given `SELECT SLEEP(15) FROM vw_rooms_status LIMIT 1`, When called, Then it stops at about 10 seconds with a timeout message, not 15. (MySQL; see Risks 4)
- AC_19 Given a query that would return more than 10,000 rows (`vw_rooms_status` joined to itself gives 104 x 104 = 10,816), When called, Then exactly 10,000 rows come back with `truncated: true`, and the server stops reading the rest.

**Server behaviour**
- AC_20 Given any call to any of the five tools, accepted, rejected or failed, When it finishes, Then one JSON line is appended to the audit log with time, tool, arguments, outcome, row count and duration. For `run_readonly_query` it includes the SQL text. It never includes the password. If the audit line cannot be written, the call is refused (Q8).
- AC_21 Given the server runs over stdio, Then nothing but MCP protocol messages is written to stdout. Logs go to the audit file or stderr.
- AC_22 Given the database user is not `mcp_readonly` (checked with `SELECT CURRENT_USER()` at start-up) or the password is missing, When the server starts, Then it exits with a clear message.

**Documents**
- AC_23 Given `docs/mcp-security.md`, Then it covers: threat model, least privilege, read-only user, view-only access, statement allowlist, timeout, caps, audit log, no guest PII beyond name, rotating the password, revoking. Its stated limits (10 s, 10,000 rows) equal the constants in code.
- AC_24 Given `docs/privacy-note.md`, Then it records what was declined and why, and states plainly what exists in the code (the 501 stub) and what is only proposed. It matches spec BR-17 and `HousekeeperPositionController`. The spec's Assumptions section links to it (it already does at lines 174 and 187).

## Interface contract

### Tools (all inputs validated with zod; dates are `YYYY-MM-DD`, times are UTC ISO 8601)
| Tool | Input | Output (JSON in `content[0].text`, also `structuredContent`) |
|---|---|---|
| `rooms_breaching_sla` | `hotelId` int, `asOf?` datetime | `{ hotelId, asOf, rooms: [{ roomId, roomNumber, floor, roomType, status, checkedOutAt, dueAt, slaMinutes, minutesOver }] }`, most minutes over first |
| `ooo_impact_on_occupancy` | `hotelId`, `from`, `to` | `{ hotelId, from, to, roomNightsLost, roomNightsAvailable, shareLost, byRoom: [{ roomId, roomNumber, roomType, nightsLost }] }` |
| `housekeeper_load` | `hotelId`, `date` | `{ hotelId, date, housekeepers: [{ housekeeperId, displayName, floors: [int], assigned, completed, outstanding }] }` |
| `arrivals_without_ready_room` | `hotelId`, `date` | `{ hotelId, date, roomTypes: [{ roomTypeCode, roomType, arrivals, readyRooms, shortfall }] }` |
| `run_readonly_query` | `sql` string | `{ columns: [string], rows: [[...]], rowCount, truncated, durationMs }` |

Errors use `isError: true` with a short message ("Only a single SELECT on the vw_ views is allowed", "Query exceeded 10 seconds", "Hotel 99 not found"). Raw MySQL messages and stack traces are not returned.

### View column contract (so mcp and db-setup can be built in parallel)
No contact details, no free text, no password hashes. Names only: housekeeper `display_name`. No guest columns at all (Q4).
- `vw_rooms_status`: `hotel_id, hotel_code, room_id, room_number, floor, room_type_code, room_type_name, status, self_marked, checked_out_at, ready_at, expected_return_at, sla_minutes, due_at`
- `vw_sla_breaches`: the above subset plus `minutes_over` (as of `UTC_TIMESTAMP()`), only rooms that are late. Same rules as `Turnaround`: whole minutes rounded up, exactly on target is not late.
- `vw_ooo_impact`: `hotel_id, room_id, room_number, room_type_code, ooo_from, ooo_to` (`ooo_to` NULL while still out of order), one row per interval, built from `room_status_history` with `LEAD()`.
- `vw_housekeeper_load`: `hotel_id, housekeeper_id, display_name, work_date, floor, rooms_assigned, rooms_completed`.
- `vw_arrivals_vs_ready`: `hotel_id, room_type_code, room_type_name, arrival_date, arrivals, ready_rooms`.

All views are created with `CREATE OR REPLACE VIEW` by the owner account (default `SQL SECURITY DEFINER`), so `mcp_readonly` needs `SELECT` on the views only.

### Configuration (environment only; nothing in committed files)
`MCP_DB_HOST` (default 127.0.0.1), `MCP_DB_PORT` (3306), `MCP_DB_NAME` (larchmont), `MCP_DB_USER` (`mcp_readonly`), `MCP_DB_PASSWORD` (required), `MCP_AUDIT_LOG` (default `mcp/logs/audit.jsonl`, git-ignored).

## Plan by area
Each area has its own paths, so the agents never edit the same file. The existing agent files restrict scope (`backend` is C# only, `test-writer` is xUnit and `backend/Larchmont.Tests/**` only). See Q1.

**Order:** db-analyst first, then db-setup and mcp in parallel (the column contract above is the hand-off), then test-writer, then docs, then reviewer.

### db-analyst (first, writes to `docs/db-analysis.md`)
Check the five view definitions on MySQL 8.4: `LEAD()` over `room_status_history` uses `ix_room_status_history_room (room_id, changed_at)`; `vw_arrivals_vs_ready` and the self-join row cap case do not scan unbounded; views are not materialised, so every call re-runs them. Real MySQL is needed for any claim. The previous analysis noted no throwaway MySQL was available here.

### db-setup → `db-setup/02-mcp-views.sql`, `db-setup/03-create-mcp-user.sql`, `db-setup/run-03-create-mcp-user.sh` (and a PowerShell twin if the team uses Windows)
1. Views per the column contract. The script must be run after the API has started once, because V006 and V007 create the columns and tables it reads.
2. User script. A `.sql` file cannot read environment variables. The wrapper reads `MCP_DB_PASSWORD`, refuses if empty, and pipes `SET @mcp_pw := <quoted>;` plus the `.sql` file into `mysql` over stdin. It never puts the password on a command line. The `.sql` file builds `CREATE USER IF NOT EXISTS 'mcp_readonly'@'%' IDENTIFIED BY ...` with `PREPARE`/`QUOTE(@mcp_pw)` and aborts when `@mcp_pw` is NULL or empty. Then five `GRANT SELECT ON larchmont.<view>` lines, `REVOKE ALL PRIVILEGES, GRANT OPTION FROM`, and `MAX_USER_CONNECTIONS` (suggest 5). Re-running changes the password (`ALTER USER`), which is the rotation path.
3. Do not reuse or copy `larchmont_app` (it has `ALL` on the database).

### mcp → `mcp/**` except `mcp/tests/**`
`package.json` (Node 20, ESM), `tsconfig.json` (strict), `src/index.ts` (stdio server), `src/config.ts`, `src/db.ts` (mysql2 pool as `mcp_readonly`, per connection `SET SESSION TRANSACTION READ ONLY` and `SET SESSION max_execution_time = 10000`), `src/guard.ts` (SQL validation), `src/audit.ts`, `src/tools/{roomsBreachingSla,oooImpact,housekeeperLoad,arrivalsVsReady,runReadonlyQuery}.ts`, registered in the stated order. `.gitignore` for `mcp/node_modules`, `mcp/dist`, `mcp/logs`.
Packages (check versions at install time): `@modelcontextprotocol/sdk`, `zod`, `mysql2`, `node-sql-parser` (MySQL dialect; this is the "sql-parser" in the request, Q2), `vitest`, `typescript`.
Guard rules, applied in this order and failing closed:
1. Reject if the text contains `/*`, `--` or `#` anywhere (conservative: a string literal with `#` is also rejected and the docs say so).
2. Parse with the MySQL dialect. Parse error, more than one statement, or any type other than `select` is rejected.
3. Reject `INTO`, locking clauses, and a SELECT with no `FROM`.
4. Walk the whole syntax tree (joins, subqueries, CTEs, unions). Every table must be one of the five views, optionally qualified with the configured database. Anything else, including `information_schema`, is rejected.
5. Run on the pool. Stream the result, stop and `KILL QUERY` at 10,001 rows and report 10,000 with `truncated: true`. A client-side timer of about 10.5 s is a backstop for the server's own limit.
The guard is a second line of defence. The first is that `mcp_readonly` can only `SELECT` the five views. The docs must say the parser is not trusted on its own.
Named tools run parameterised SQL (`?` placeholders) against the views only, never string-built.

### tests → `mcp/tests/**` (dispatch a `general-purpose` agent, not `test-writer`, whose scope is xUnit only; decided)
Give it `.claude/rules/testing-conventions.md` and the fail-first rule below. Vitest. Names follow `AC_NN_Description` as in the project convention. Unit tests for the guard (no database): AC_12 to AC_17. Integration tests against real MySQL 8.4 from `compose.yaml` with a throwaway database and the two db-setup scripts: AC_01, 03, 05 to 09, 11, 18, 19. Server tests with a mocked pool for AC_04, 10, 20, 21, 22. The 10-second timeout test takes about 10 s; keep it in one test and set its timeout explicitly. Each new test must fail first against a skeleton with the tools unimplemented, and the red output is kept. Tests must not depend on the current time (pass `asOf`, seed fixed dates). Report which evidence was used (real MySQL or mocked) per test.

### ci and client config → `.mcp.json`, `.github/workflows/ci.yml` (general-purpose agent; touch only the new MCP job, the existing CI fix is separate)
`.mcp.json` runs `node mcp/dist/index.js` with env passthrough. The CI job uses `mysql:8.4`, runs both db-setup scripts with a throw-away password from a CI secret or a generated value, then `npm ci`, `npm run build`, `npm test`, `npm run test:mysql`.

### docs → `docs/mcp-security.md`, `docs/privacy-note.md`, one line in `docs/specs/housekeeping-board.md` only if the link is missing (no agent fits; main thread)
- `mcp-security.md`: the eleven topics in AC_23, including exact commands for rotation (`ALTER USER`, re-run the wrapper, restart the server) and revocation (`ALTER USER ... ACCOUNT LOCK`, `KILL` its connections, `DROP USER`), plus how to review the audit log.
- `privacy-note.md`: extend the existing note (Risks 1). Keep the decision record, the Art 5(1)(c) and Art 6 argument and the 501 stub. Add an explicit "not built" list (continuous tracking; break time; off-shift and unclocked staff) and the proposal (nearest-housekeeper routing from the last known on-shift position, nothing older than 24 hours, on top of the existing opt-in, on-shift only conditions).

## Risks and open questions
1. **The privacy request contradicts the repository.** The request says "we built opt-in on-shift live position only, with server-side rejection of off-shift and on-break reports". Nothing like that exists. Spec BR-17 and the existing `docs/privacy-note.md` say position is not implemented, and the endpoint is a 501 stub. There is no shift, clock-in or break data in the schema, and shift clocking is out of scope, so there is nothing for a server to check against. I will not write that it was built. The plan documents it as proposed only. If you want it built, that is a new feature needing a DPIA and HR/legal sign-off first. Also `docs/privacy-note.md` already exists. This plan extends it. Say if you want it replaced.
2. **"sql-parser"**: confirmed as `node-sql-parser` (MySQL dialect). Parsers differ from MySQL in edge cases, which is why privileges are the real boundary and the guard also rejects all comments.
3. **Secret in SQL.** `CREATE USER ... IDENTIFIED BY` cannot read an environment variable by itself; hence the wrapper script and the prepared statement. The existing `db-setup/01-create-users.sql` and `compose.yaml` already contain committed passwords. That breaks the "never commit passwords" rule but is outside this feature. I would raise it separately.
4. **Timeout and `SLEEP(15)`.** The request says a statement with `sleep(15)` must time out, but also that only `vw_*` views may be touched. A bare `SELECT SLEEP(15)` has no table, so the guard rejects it before it can time out. The plan tests `SELECT SLEEP(15) FROM vw_rooms_status LIMIT 1`. Confirm. Also, whether `max_execution_time` aborts a `SLEEP` with an error or lets it return early is not something I can assert from here. It needs a real MySQL 8.4 run, with the client-side timer as backstop. Should `SLEEP` and `BENCHMARK` be blocked in normal use? They are the easiest way to hold a connection. The plan allows them because the timeout test needs `SLEEP`.
5. **Definitions the request leaves open (do not guess; please answer):**
   - Q5 `ooo_impact_on_occupancy`: are `from` and `to` both inclusive? A room-night is the night starting on a date. Default in the plan is both inclusive. History is per status change, so a room that was OOO before the first history row is invisible. The tool reports room-nights lost, not an occupancy percentage, because the occupancy report is still wrong (LH-56).
   - Q6 `housekeeper_load`: assignments are by floor and the app keeps no assignment history, so a past `date` uses today's floors. "Completed" is counted from `room_status_history` as moves to Ready (or Inspected?) made by that housekeeper on the date. Which? Should a self-marked Ready count? Should housekeepers with no floor appear?
   - Q7 `arrivals_without_ready_room`: "arrivals today" for a `date` other than today. Ready rooms are a current count and mean little for tomorrow. Plan: return an error for any date other than today (UTC) unless you want a forecast. Which booking statuses count as arrivals (confirm the status values in the code)? Should Ready rooms already held by an assigned booking be subtracted?
   - Q4 Guest names: the plan exposes no guest columns at all, because no tool needs them. "Beyond name" allows names, but `run_readonly_query` is free-form and names plus dates are still personal data. Confirm that none is wanted. Free text (`ooo_reason`, `rooms.notes`, booking notes) is also excluded because it can hold anything.
   - Hotel scoping: tools take `hotelId`, but `run_readonly_query` sees all six hotels. Acceptable?
   - `'%'` as the user's host is as requested but broad. Production should narrow it. Documented, not changed.
6. **Audit log (Q8).** Decided: a JSON-lines file only, no table. It cannot be altered by `mcp_readonly`. Fail closed when it cannot be written. Retention and readers are still to be agreed. The SQL text may contain personal data if someone types a name literal. Say who may read the log and for how long it is kept.
7. **Tests live outside the existing test project and are not xUnit.** Decided: `general-purpose` agent with the same fail-first rules. The tests need real MySQL 8.4, and the earlier analysis found Docker not installed on this machine, so those tests may not run here. If so, I will report that rather than call them proven.
8. **Parity with the C# rules.** The `minutesOver` arithmetic exists in `Turnaround.cs` and will exist again in SQL. The AC_05 parity test is the guard. If the targets change (spec Q2), the view reads `room_types.sla_minutes`, so it follows the data.
9. Views are not materialised. A free-form query joining views could be slow. The 10 s limit and 10,000 row cap bound it, but they do not prove performance.
10. `.mcp.json` and the CI job are now in scope (decided). The existing CI is failing (`docs/ci-failing-run.log`); the MCP job must not depend on that fix.
11. Q9 Is Node 20 enough? The request says Node 20. CLAUDE.md says Node 20+. Plan uses `engines: >=20`.

## Verify
- `cd mcp && npm ci && npm run build && npm test` (unit and mocked tests)
- Real MySQL: `docker compose up -d`, start the API once so DbUp applies V001 to V007, then `mysql -h 127.0.0.1 -P 3306 -u root -p < db-setup/02-mcp-views.sql`, then `MCP_DB_PASSWORD=<new secret> db-setup/run-03-create-mcp-user.sh`, then `MCP_DB_PASSWORD=<same> npm run test:mysql` in `mcp/`.
- By hand: `mysql -u mcp_readonly -p -e "SELECT * FROM larchmont.rooms"` fails with access denied; `SHOW GRANTS FOR 'mcp_readonly'@'%'` lists five views only; the audit file gains one line per call.
- `dotnet build backend/Larchmont.sln` and `dotnet test backend/Larchmont.sln` still pass (no backend change is planned).
- No `cd frontend && npm run build` is needed (no frontend change).
- `git grep -n "mcp_readonly"` shows no password; then run `reviewer` against `docs/review-checklist.md`.

Next: review this file and answer the remaining open questions (4, 5, 6 and the audit retention matter most), then run `/implement FEATURE-mcp-server.md`.
