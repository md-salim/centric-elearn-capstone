# FEATURE: Restore MCP server startup and database setup
Owner: Mohammad Salim

## Why
The Larchmont MCP server does not start in the local workspace. Its startup check currently fails first with `MCP_DB_PASSWORD is required`, and the reachable MySQL server is not MCP-ready: it has the base tables but none of the five required `vw_*` views or the `mcp_readonly` database user. This prevents all MCP operations and blocks the stakeholder-facing late-room and housekeeping reports.

The user-facing need comes from `docs/stakeholder-brief.md`: Sofia must be able to see a worst-first breach list and understand room, out-of-order and housekeeper operations, while the MCP integration must keep guest data and database writes inaccessible.

## Scope / out of scope

**In**
- Diagnose and repair local MCP configuration and startup prerequisites.
- Make MySQL setup for MCP repeatable and explicit: migrations V001-V007, create views, create/read-only grant the MCP user.
- Ensure `.mcp.json` can start the built server with a usable password supplied by the MCP host environment.
- Improve startup failure messages so configuration, database, view, permission and version problems are distinguishable without exposing secrets.
- Update directly related MCP setup documentation and verification commands.
- Add or update MCP tests for startup and database setup requirements.

**Out**
- Restoring or changing unrelated application behavior, except fixing tightly coupled MCP database setup.
- Changing the five MCP tool contracts or adding tools.
- Committing a database password or connection string containing a secret.
- Replacing Docker with a host-specific database service.
- Changing guest privacy policy or adding base-table access.

## Acceptance criteria

**Configuration**
- AC_01 Given no password is set, When the server or setup script starts, Then startup reports `MCP_DB_PASSWORD is required` without printing or prompting for a password value.
- AC_02 Given a password and database configuration are set, When the MCP host starts the server, Then the process connects using `mcp_readonly` and remains available over stdio.
- AC_03 Given environment variables are absent, When the setup path is followed, Then the documentation states exactly where to set the required variables and how to run the server on Windows and non-Windows shells.
- AC_04 Given the project is checked out after setup, When repository files are searched, Then no MCP password literal exists and no audit log contains a password.

**Database setup**
- AC_05 Given MySQL is reachable and V001-V007 have been applied, When the view setup script runs, Then `larchmont` contains exactly `vw_rooms_status`, `vw_sla_breaches`, `vw_ooo_impact`, `vw_housekeeper_load`, and `vw_arrivals_vs_ready` with their documented columns.
- AC_06 Given the view setup succeeds and `MCP_DB_PASSWORD` is non-empty, When the read-only user setup script runs, Then `mcp_readonly`@`%` has `SELECT` only on those five views, has no base-table grants, and uses the supplied password.
- AC_07 Given MCP setup has not completed, When the server starts, Then it fails closed with a clear message naming the missing prerequisite; it does not attempt tool calls or expose a raw stack trace.
- AC_08 Given MySQL is running at the target host and port, When a setup verification command runs, Then it checks connectivity, migrations, views, grants and the MCP startup identity in one predictable sequence.

**Server startup**
- AC_09 Given Docker Desktop is unavailable or the MySQL service is not reachable, When setup or startup is attempted, Then the failure identifies the host/port connection problem instead of implying that the password or MCP code is at fault.
- AC_10 Given the connected account is not `mcp_readonly`, When startup checks the identity, Then the server exits clearly and closes the database connection.
- AC_11 Given startup has configuration, database, view or permission failures, When errors are observed, Then they do not include passwords or credentials and stdout remains reserved for MCP protocol messages.
- AC_12 Given startup succeeds, When a tool call is made, Then an existing test can exercise the real database read path and one of the five tools returns its documented JSON shape.

**Regression validation**
- AC_13 Given unit tests run, When MCP tests run, Then configuration/startup failures are covered without requiring real MySQL.
- AC_14 Given a MySQL 8.4 test environment is available, When `npm run test:mysql` runs, Then setup, permissions, view contracts and MCP tool behavior pass.
- AC_15 Given setup succeeds, When MCP server tests start and stop, Then no password is written to stdout, stderr, audit logs or repository files.

## MCP contract

The existing tool names and schemas are unchanged:

- `rooms_breaching_sla`
- `ooo_impact_on_occupancy`
- `housekeeper_load`
- `arrivals_without_ready_room`
- `run_readonly_query`

Startup and setup errors are server lifecycle errors, not tool result changes. Tool inputs and output shapes remain governed by `FEATURE-mcp-server.md`.

## Plan by area

**MCP configuration and startup** - `mcp/src/config.ts`, `mcp/src/startup.ts`, `mcp/src/index.ts`
- Preserve environment-only secret handling.
- Separate configuration errors from database connection errors and permission errors.
- Improve startup diagnostics while preserving secret-free output and MCP stdout discipline.
- Verify the server is closed cleanly on every startup failure.

**MCP setup and host configuration** - `.mcp.json`, `db-setup/02-mcp-views.sql`, `db-setup/03-create-mcp-user.sql`, `db-setup/run-03-create-mcp-user.*`
- Define one ordered setup sequence: start MySQL, apply V001-V007, create views, create read-only user, build/start MCP.
- Make setup idempotent and provide explicit checks for prerequisites and grants.
- Keep passwords environment-only and avoid changes that weaken the read-only privilege boundary.
- Decide and document the intended password source for VS Code/local MCP startup rather than relying on undefined shell state.

**Documentation** - `README.md`, `docs/mcp-security.md`
- Add a quick-start and troubleshooting matrix for missing password, unreachable host, missing migrations/views, denied identity, and wrong MySQL version.
- Document Windows PowerShell commands and the Docker/host database alternatives.
- Keep security limits and setup responsibilities aligned with implementation.

**Tests** - `mcp/tests/**`
- Add fail-first unit coverage for startup phases and failure-message secrecy.
- Update or add real-MySQL coverage for setup prerequisites and actual server startup identity.
- Keep unit tests independent of MySQL and retain the MySQL-tagged integration suite.

## Risks and open questions

- **Q1: Local database source.** The checked port is reachable but serves MySQL 8.0.18 and has no MCP views or user. It is unclear whether this is the intended project container or an unrelated service. Do not overwrite it until the correct source is confirmed.
- **Q2: Docker runtime.** `docker compose ps` cannot reach Docker Desktop on this machine. The fix must support an existing MySQL server while giving a clear Docker startup path for users who choose containers.
- **Q3: Password provisioning.** The MCP host receives no `MCP_DB_PASSWORD` in the current process environment. The plan should not place a password in `.mcp.json` or `.env`; choose whether VS Code injects it interactively or the user exports it per shell/session.
- **Q4: Setup ownership.** The database migration and view scripts are separate. If setup automation is added, it must handle existing databases safely and never rotate the password merely as a side effect of server startup.
- **Q5: MySQL compatibility.** The application requires MySQL 8.4, while the currently reachable service is 8.0.18. Use MySQL 8.4 for final verification; do not claim parity until integration tests pass there.
- **Q6: Existing data.** Applying migrations or replacing views can affect an existing database. Setup must be explicit and verify migration state rather than silently initializing or dropping application data.
- **Q7: MCP host behavior.** `.mcp.json` uses environment interpolation syntax. Confirm how the installed MCP host resolves `${MCP_DB_PASSWORD}` before relying on a new setup instruction.

## Verify

- `cd mcp && npm run build`
- `cd mcp && npm test`
- `cd mcp && npm run test:mysql` with a MySQL 8.4 admin URL and newly provisioned `MCP_DB_PASSWORD`
- Run `node dist/index.js` with no password and confirm a clear, secret-free failure.
- Run the MCP setup/verification sequence against disposable MySQL 8.4 and confirm the server exposes all five tools.
- Check repository files and audit output for password exposure.
- `dotnet test backend/Larchmont.sln`
- `cd frontend && npm run build`
