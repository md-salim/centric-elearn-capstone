# Larchmont Hotels - agent briefing

Internal system for six hotels: hotels, room types, rooms, guests, bookings, rates, staff, an occupancy report and a channel-manager CSV importer.

## Stack (target state)
- API: ASP.NET Core 10 Web API with controllers, FluentValidation, Swashbuckle. Project: `backend/Larchmont.Api`.
- Data: EF Core 10 with Pomelo.EntityFrameworkCore.MySql (use the release M4 confirms pairs with EF Core 10) on MySQL 8.4.
- Schema: DbUp runs embedded `backend/db/migrations/V00N__*.sql` at startup. No EF migrations.
- Frontend: Vite + React 19 + TypeScript (strict) in `frontend/`, react-router-dom.
- Tests: xUnit + Moq + `WebApplicationFactory` with the EF Core InMemory provider (`backend/Larchmont.Tests`).
- **Current vs target:** both csproj files still say `net8.0` (EF 8.0.13, Pomelo 8.0.3). The pipeline PR (M4) bumps them to `net10.0`. Write new code for net10.0.

## Requirements
- .NET 10 SDK (see README for install guidance; README still says .NET 8 until M4), Node 20+, Docker or a MySQL 8.4 server on port 3306.

## Commands
- MySQL: `docker compose up -d` (root of repo), then `mysql -h 127.0.0.1 -P 3306 -u root -p < db-setup/01-create-users.sql`
- API: `dotnet run --project backend/Larchmont.Api` (http://localhost:5080/swagger)
- Frontend: `cd frontend && npm install && npm run dev` (http://localhost:5173, proxies `/api` to 5080)
- Frontend build/typecheck: `cd frontend && npm run build`
- Tests: `dotnet test backend/Larchmont.sln`
- Other host/port: set env var `ConnectionStrings__Larchmont`.

## Layout
- `backend/Larchmont.Api` - Controllers, Services, Repositories, Data (DbContext), Domain, Dtos, Mappers, Validators, Infrastructure
- `backend/Larchmont.Tests` - `ApiFactory.cs`, `ApiTests.cs`, `UnitTests.cs`
- `backend/db/migrations` - DbUp scripts
- `db-setup/` - one-off MySQL user/view scripts
- `frontend/` - React app (has its own CLAUDE.md)
- `docs/` - specs, tickets, review checklist

## Rules
- Details: `.claude/rules/coding-conventions.md`, `.claude/rules/testing-conventions.md`, `frontend/CLAUDE.md`.
- Request flow is Controller -> Service -> Repository -> DbContext. Do not skip layers.
- Never edit an applied migration; add the next `V00N__name.sql`.
- Never commit passwords or connection strings with secrets.
- The in-memory tests cannot prove performance, indexes, SQL translation or concurrency. Those claims need a test against real MySQL 8.4 or the EF Core SQL log.
- Keep changes small, and run `dotnet test` (and `npm run build` for frontend changes) before saying work is done.
