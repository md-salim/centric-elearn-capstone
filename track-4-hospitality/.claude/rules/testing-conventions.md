---
paths:
  - "backend/Larchmont.Tests/**"
---

# Testing conventions

## Framework
- xUnit (`[Fact]`/`[Theory]`) with Moq. `Larchmont.Tests.csproj` does not use NUnit or MSTest; do not add them.
- Run with `dotnet test backend/Larchmont.sln`.

## Two kinds of test
- Unit tests (`UnitTests.cs`): construct a service with mocked repositories and a real validator, as `RateServiceTests` does.
- API tests (`ApiTests.cs`): use `ApiFactory`. It sets the `Testing` environment (DbUp is skipped), swaps the DbContext for a uniquely named InMemory database, and offers `Seed(...)` and `SeedBasics()`.

## Naming
- New tests are named after the acceptance criterion: `AC_NN_Description`, for example `AC_04_CannotMarkReadyWithoutInspection`. One behaviour per test.
- Existing `Method_Condition_Result` tests may stay as they are.

## What InMemory cannot prove
The InMemory provider does not run SQL, enforce constraints or indexes, or behave under real concurrency. Any claim about performance, schema or indexes, SQL translation, transactions or locking, or concurrent updates needs one of:
- a test against real MySQL 8.4 (use `compose.yaml`, with a throwaway database), or
- the EF Core SQL log (`LogTo` / `EnableSensitiveDataLogging` in the test only) showing the generated SQL.

Say which evidence you used. Do not report an in-memory pass as proof.

## Regression and characterisation
- A bug-fix test must fail on the original code. Run it before the fix and keep that output.
- Before refactoring `ChannelImportService`, write characterisation tests that pin current behaviour (use `docs/sample-channel-export.csv`).
- Tests must not depend on order or shared state; each `ApiFactory` gets its own database.
