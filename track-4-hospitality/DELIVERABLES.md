# Deliverables checklist

Tick every box before you submit. Paths are relative to this folder. Submit with no `node_modules`, `bin`, `obj` or `dist`.

## Documents
- [ ] `docs/onboarding-brief.md`
- [ ] `docs/specs/housekeeping-board.md`
- [ ] `docs/prompt-journal.md` (at least 15 entries)
- [ ] `docs/mcp-security.md`
- [ ] `docs/agent-map.md`
- [ ] `docs/debug-report.md`
- [ ] `docs/refactor-note.md`
- [ ] `docs/perf-note.md` - Performance and concurrency note (before and after). Proof of performance, schema and concurrency fixes needs a test against MySQL or the EF Core SQL log (the existing tests use an in-memory database).
- [ ] `docs/review-report.md`
- [ ] `docs/ai-usage-reflection.md`

## Claude Code setup
- [ ] `CLAUDE.md` (corrected)
- [ ] `.claude/rules/*` or a nested `CLAUDE.md`
- [ ] `.claude/skills/` (at least 2)
- [ ] `.claude/agents/` (at least 5: backend, frontend, test, reviewer, db-analyst)
- [ ] `.claude/settings.json` with hooks
- [ ] `.mcp.json`

## MCP server
- [ ] `mcp/` (the server) and `mcp/tests/`
- [ ] `db-setup/03-create-mcp-user.sql`
- [ ] `db-setup/02-mcp-views.sql`

## Pipeline and run files
- [ ] `.github/workflows/ci.yml` (fixed, plus a job that runs the MCP tests)
- [ ] `compose.yaml` (complete and free of secrets)
- [ ] `README.md` (updated)

## This track: housekeeping and room-status board
- [ ] Room states Dirty, Cleaning, Inspected, Ready, with rules; invalid moves return a clear 4xx
- [ ] Out-of-order rooms cannot be sold or assigned
- [ ] Inspection step before Ready
- [x] Turnaround SLA with a breach list
- [ ] Assignment of housekeepers by floor
- [ ] `GET /api/rooms/{id}/ready-by` tells the desk when a room will be ready
- [ ] Screen: live board by floor
- [x] Screen: SLA breach list
- [x] Loading, empty and error states on both screens
- [ ] MCP tools: `rooms_breaching_sla`, `ooo_impact_on_occupancy`, `housekeeper_load`, `arrivals_without_ready_room`, plus a guarded `run_readonly_query`
- [ ] Ticket `docs/bug-LH-56.md` resolved with a regression test that fails on the original code
- [ ] Channel import service refactored behind characterisation tests
- [ ] At least 25 tests named after acceptance criteria (for example `AC_04_CannotMarkReadyWithoutInspection`)
- [ ] Findings from the review checklist fixed or explained, and the failing CI run in `docs/ci-failing-run.log` explained and fixed
