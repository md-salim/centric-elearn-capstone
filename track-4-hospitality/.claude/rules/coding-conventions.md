---
paths:
  - "backend/**"
---

# Backend coding conventions

## Layering
- Controllers are thin: bind the request, call one service method, return the result. No EF queries or business rules in controllers.
- Services hold business rules and orchestrate repositories. Repositories are the only code that touches `LarchmontDbContext`.
- Register every new repository and service (interface + class, `AddScoped`) in `Program.cs`.

## Errors and validation
- Validate request DTOs with FluentValidation validators in `Validators/`. They are auto-registered by `AddValidatorsFromAssemblyContaining<Program>()`.
- Services throw `BusinessRuleException` (rule violated, 4xx) or `NotFoundException` (missing entity) from `Infrastructure/Exceptions.cs`. `ApiExceptionHandler` turns them into ProblemDetails. Do not catch them to return ad-hoc status codes, and do not return raw `Exception` messages.
- Invalid state transitions must return a clear 4xx with a message the front desk can act on.

## Data
- Schema changes are new files in `backend/db/migrations/` named `V00N__description.sql` (next number, never reuse). Never edit one that has been applied. DbUp embeds them via the csproj glob.
- Do not use EF Core migrations or `EnsureCreated`.
- Use `DateOnly` for stay dates. Do not introduce timezone conversion without agreeing it first.
- Read-only queries use `AsNoTracking()`. Avoid N+1: project or `Include` deliberately, and filter in SQL, not after `ToListAsync()`.
- The server version is `MySqlServerVersion(8, 4, 0)`; keep it in step with `compose.yaml`.

## Style
- `Nullable` and `ImplicitUsings` are enabled; fix nullable warnings, don't suppress them.
- Map entities to DTOs in `Mappers/` by hand (no AutoMapper). DTOs live in `Dtos/`, entities in `Domain/`.
- Target `net10.0` and EF Core 10 for new code; do not add packages pinned to 8.x.
- No secrets in `appsettings*.json`. Use `ConnectionStrings__Larchmont` for real credentials.
