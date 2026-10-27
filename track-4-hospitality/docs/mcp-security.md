# MCP server security note

Status: written from the plan in `FEATURE-mcp-server.md`, before implementation. Where this note describes behaviour, it is the behaviour the plan specifies. Check it against the code and the "Verification status" section before relying on it. The 10 second and 10,000 row limits below must equal the constants in `mcp/` (AC_23).

## Purpose and scope
The Larchmont MCP server (`mcp/`, stdio) gives managers and an AI assistant five tools: `rooms_breaching_sla`, `ooo_impact_on_occupancy`, `housekeeper_load`, `arrivals_without_ready_room` and `run_readonly_query`. All read through five database views as the database user `mcp_readonly`. There is no write tool, no base-table access, and no login of its own (the MCP host owns that).

## Threat model
| Threat | Who or what | How we limit it |
|---|---|---|
| Prompt injection or a careless client | A document, web page or message steers the assistant into calling tools with attacker-chosen input | Least privilege (below): even a fully hijacked client can only `SELECT` five views |
| SQL injection through the free-form tool | `run_readonly_query` takes raw SQL by design | Statement allowlist (guard), then database privileges as the real boundary. Named tools use `?` placeholders, never string-built SQL |
| Exfiltration of guest PII | A query that tries to read guests, contact details or free text | The views contain no guest columns, no contact details, no free text. The user has no grant on any base table |
| Resource exhaustion | A heavy join, a self-join, `SLEEP`, `BENCHMARK`, many connections | 10 second timeout, 10,000 row cap, `MAX_USER_CONNECTIONS` (plan suggests 5) |
| Secret leakage | Password in a repo file, command line, log or tool output | Password only from the environment (`MCP_DB_PASSWORD`), never in committed files, never in the audit log, not passed on a command line |
| Audit tampering | Someone hides or alters what was asked | Audit log is a local JSON-lines file that `mcp_readonly` cannot touch. If a line cannot be written, the call is refused. Tampering by someone with file-system access is not prevented by the server |

## Least privilege
- The server connects as `mcp_readonly` only. At start-up it runs `SELECT CURRENT_USER()` and exits with a clear message if the user is anything else or the password is missing (AC_22).
- It must never use `larchmont_app`, which has `ALL` on the database, or the root account.
- Each connection sets `SET SESSION TRANSACTION READ ONLY` and `SET SESSION max_execution_time = 10000`. These are extra layers. They are not the boundary.

## The read-only user
Created by `db-setup/03-create-mcp-user.sql`, run through `db-setup/run-03-create-mcp-user.sh`:
- `mcp_readonly`@`%`, password from `MCP_DB_PASSWORD` only. The wrapper refuses an empty value, and the SQL aborts if the password is NULL or empty. Nothing is created in that case (AC_02).
- `SELECT` on exactly five views: `vw_rooms_status`, `vw_sla_breaches`, `vw_ooo_impact`, `vw_housekeeper_load`, `vw_arrivals_vs_ready`. Nothing else, no `GRANT OPTION`.
- `MAX_USER_CONNECTIONS` set (suggest 5).
- **The host `'%'` is broad.** It lets the account connect from any address. It was requested, and it is not changed here. Production should narrow it to the host or network the MCP server runs from.

Expected checks (AC_03, real MySQL): `SHOW GRANTS` lists only `SELECT` on the five views. `SELECT` on `rooms`, `users`, `guests`, `information_schema.tables` and `mysql.user` is denied. `INSERT`, `UPDATE`, `DELETE` and `DROP` on a view are denied.

## View-only access and column policy
The views are created by the owner account with the default `SQL SECURITY DEFINER`, so `mcp_readonly` needs `SELECT` on the views only.

Column policy (AC_01):
- No guest columns at all.
- No contact details: nothing named `email`, `phone`, `address_line` or `postcode`.
- No free text: nothing named `notes` or `reason` (so no `ooo_reason`, `rooms.notes` or booking notes), because free text can hold anything.
- No credentials: nothing named `password_hash`.
- The only personal data is the housekeeper `display_name` (in `vw_housekeeper_load`).
- No location data exists in any view.

Columns by view:
- `vw_rooms_status`: `hotel_id, hotel_code, room_id, room_number, floor, room_type_code, room_type_name, status, self_marked, checked_out_at, ready_at, expected_return_at, sla_minutes, due_at`
- `vw_sla_breaches`: a subset of the above plus `minutes_over`
- `vw_ooo_impact`: `hotel_id, room_id, room_number, room_type_code, ooo_from, ooo_to`
- `vw_housekeeper_load`: `hotel_id, housekeeper_id, display_name, work_date, floor, rooms_assigned, rooms_completed`
- `vw_arrivals_vs_ready`: `hotel_id, room_type_code, room_type_name, arrival_date, arrivals, ready_rooms`

`run_readonly_query` is not scoped to a hotel: it sees all six hotels. This was an open question in the plan (Risks 5) and is documented, not changed.

## Statement allowlist (guard for `run_readonly_query`)
**The parser is not trusted on its own.** Parsers (the plan uses `node-sql-parser`, MySQL dialect) differ from MySQL in edge cases. The guard is the second line of defence. The first and real boundary is that `mcp_readonly` can only `SELECT` the five views.

Rules, applied in this order, failing closed:
1. Reject if the text contains `/*`, `--` or `#` anywhere. This rejects all comments, including `/*! ... */` and `/*M! ... */`, even inside strings. A string literal that contains `#` is therefore also rejected.
2. Parse with the MySQL dialect. A parse error, more than one statement, or any statement type other than `select` is rejected.
3. Reject `INTO` (`OUTFILE`, `DUMPFILE`, variables), locking clauses (`FOR UPDATE`, `LOCK IN SHARE MODE`) and a `SELECT` with no `FROM`.
4. Walk the whole syntax tree (joins, subqueries, CTEs, unions). Every table must be one of the five views, optionally qualified with the configured database. Anything else, including `information_schema`, `mysql` and other schemas, is rejected.
5. Run on the pool (limits below).

Statements such as `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `CALL`, `SET`, `SHOW`, `EXPLAIN` and `USE` are rejected by rule 2 and the database is not contacted. Because a bare `SELECT SLEEP(15)` has no `FROM`, rule 3 rejects it too.

Errors returned to the client are short and plain. Raw MySQL messages and stack traces are not returned.

## Limits
- **Timeout: 10 seconds.** Three layers: server-side `max_execution_time = 10000` ms on each session; a client-side timer of about 10.5 s as a backstop; and `KILL QUERY` on the connection when the client timer fires. Whether `max_execution_time` aborts a `SLEEP` with an error or lets it return early is not asserted here. It needs a real MySQL 8.4 run (see the verification section).
- **Row cap: 10,000 rows.** The result is streamed. At row 10,001 the server stops reading, issues `KILL QUERY`, and returns 10,000 rows with `truncated: true`.
- **Connections:** `MAX_USER_CONNECTIONS` on the account.

## Audit log
- Every call to any of the five tools, whether accepted, rejected or failed, appends one JSON line to the file named by `MCP_AUDIT_LOG` (default `mcp/logs/audit.jsonl`, git-ignored).
- Fields: time, tool, arguments, outcome, row count, duration. For `run_readonly_query` the SQL text is included. The password is never included.
- **Fails closed:** if the audit line cannot be written, the call is refused.
- Nothing but MCP protocol messages goes to stdout. Logs go to the audit file or stderr (AC_21).
- **Restrict access.** The SQL text and arguments can contain personal data, for example if someone types a guest name as a literal. Only named people should be able to read the file. Who they are is to be agreed.
- **Retention: TBD by the team.** No retention period or reader list has been decided.
- A JSON-lines file was chosen over a table so that `mcp_readonly` cannot alter it. A person with file-system access still can; protect the file accordingly.

## Guest PII
The views expose no guest data. Housekeeper `display_name` is the only personal data. No location data exists. Because `run_readonly_query` is free-form, a user could combine views in ways not anticipated, but only the columns above are reachable. The privacy position on staff location is in `docs/privacy-note.md`.

## Rotating the password
1. Choose a new secret and set `MCP_DB_PASSWORD` in your shell. Do not put it in a file or on a command line.
2. Re-run `db-setup/run-03-create-mcp-user.sh`. When the user already exists, the script applies `ALTER USER` and sets the new password.
3. Restart the MCP server so its pool reconnects with the new value.
4. Update the CI secret that supplies `MCP_DB_PASSWORD` for the MCP job.

## Revoking access
In order of increasing finality, as a privileged account:
```sql
ALTER USER 'mcp_readonly'@'%' ACCOUNT LOCK;
-- find and end any open connections
SELECT id FROM information_schema.processlist WHERE user = 'mcp_readonly';
KILL <id>;            -- repeat for each id
DROP USER 'mcp_readonly'@'%';
```
Locking stops new logins but does not end existing connections, hence the `KILL`. To restore access after a lock, `ALTER USER ... ACCOUNT UNLOCK`, or re-run the user script after a drop.

## Known limits
- The views are not materialised. Every call re-runs the view. A free-form join can be slow. The timeout and row cap bound it. They do not prove performance, and no index claim is made here.
- `SLEEP` and `BENCHMARK` are allowed when used with a view in `FROM` (the timeout test needs `SLEEP`). They can hold a connection until the 10 second limit. They are bounded, not blocked.
- `run_readonly_query` sees all six hotels.
- `'%'` as the user host is broad (see above).
- The guard rejects some harmless queries (any `#`, `--` or `/*`, even in strings). That is deliberate.
- The in-memory tests cannot prove SQL translation, privileges or timeouts. Bypass attempts, grants and the timeout are proven only by tests against real MySQL 8.4.
- The existing `db-setup/01-create-users.sql` and `compose.yaml` hold committed passwords. That is outside this feature and should be raised separately.
- Audit log retention and readers are not decided.

## Verification status
To be completed by the lead after implementation. Nothing below is claimed yet.

| Item | Evidence | Status |
|---|---|---|
| Guard unit tests (AC_12 to AC_17), no database | mocked / unit | TBD |
| Grants and column policy on real MySQL 8.4 (AC_01, AC_03) | real MySQL | TBD |
| 10 second timeout with `SELECT SLEEP(15) FROM vw_rooms_status LIMIT 1` (AC_18) | real MySQL | TBD |
| 10,000 row cap and `truncated: true` (AC_19) | real MySQL | TBD |
| Audit log fail-closed and no password in log (AC_20) | mocked | TBD |
| Real-MySQL tests were run (yes / no, where, date) | | TBD |
| Constants in code equal 10 s and 10,000 rows (AC_23) | code review | TBD |
