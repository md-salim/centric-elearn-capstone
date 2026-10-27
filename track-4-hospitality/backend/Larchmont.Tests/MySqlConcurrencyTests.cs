using System.Net.Http.Json;
using Larchmont.Api.Data;
using Larchmont.Api.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MySqlConnector;

namespace Larchmont.Tests;

/// <summary>
/// Runs the real app (DbUp migrations and Pomelo, MySQL 8.4) against a throwaway database.
/// Only used when LARCHMONT_MYSQL_TESTS is set to a server connection string WITHOUT a database name,
/// e.g. "Server=127.0.0.1;Port=3306;User ID=...;Password=...". Nothing is hard-coded here.
/// </summary>
public class MySqlConcurrencyTests
{
    public const string EnvironmentVariable = "LARCHMONT_MYSQL_TESTS";

    [Trait("Category", "MySql")]
    [Fact]
    public async Task AC_20_ConcurrentBookingAssignmentReturns409_RealMySql()
    {
        var serverConnection = Environment.GetEnvironmentVariable(EnvironmentVariable);
        // NOT RUN when the variable is unset. xUnit 2.9.2 with the VS runner reports a runtime skip as Failed here,
        // so this returns early instead. A "Passed" line for this test therefore means "not run", not evidence.
        if (string.IsNullOrWhiteSpace(serverConnection)) return;

        var databaseName = "larchmont_test_" + Guid.NewGuid().ToString("N")[..12];
        var adminConnection = new MySqlConnectionStringBuilder(serverConnection!).ConnectionString;
        await CreateDatabaseAsync(adminConnection, databaseName);
        try
        {
            var testConnection = new MySqlConnectionStringBuilder(serverConnection!) { Database = databaseName }.ConnectionString;
            await using var factory = new MySqlApiFactory(testConnection);
            var client = factory.CreateClient(); // starts the host, which runs DbUp against the throwaway database

            int roomId;
            int bookingA, bookingB;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<LarchmontDbContext>();
                var room = await db.Rooms.AsNoTracking().Where(r => r.Status != "OutOfOrder").OrderBy(r => r.Id).FirstAsync();
                var guest = new Guest
                {
                    FirstName = "Concurrent", LastName = "Test", Email = "concurrent.test@example.com", Phone = "+44 7700 900099",
                    AddressLine = "1 Test Street", City = "Leeds", Postcode = "LS1 1AA", Country = "GB", Region = "North",
                    CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                };
                var plan = await db.RatePlans.AsNoTracking().OrderBy(p => p.Id).FirstAsync();
                db.Guests.Add(guest);
                await db.SaveChangesAsync();

                Booking NewBooking(string reference) => new()
                {
                    Reference = reference, Channel = "Direct", HotelId = room.HotelId, GuestId = guest.Id,
                    RoomTypeId = room.RoomTypeId, RoomId = null, RatePlanId = plan.Id,
                    CheckIn = new DateOnly(2031, 3, 1), CheckOut = new DateOnly(2031, 3, 3), Adults = 2,
                    Status = BookingStatuses.Confirmed, TotalAmount = 200m,
                    CreatedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
                    UpdatedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc)
                };
                var a = NewBooking("MT" + Guid.NewGuid().ToString("N")[..10]);
                var b = NewBooking("MT" + Guid.NewGuid().ToString("N")[..10]);
                db.Bookings.AddRange(a, b);
                await db.SaveChangesAsync();
                roomId = room.Id;
                bookingA = a.Id;
                bookingB = b.Id;
            }

            // Both requests are sent together so they race inside MySQL. One race is not guaranteed to interleave,
            // so a green run here is weaker evidence than a red run; repeat it if in doubt.
            var results = await Task.WhenAll(
                client.PostAsJsonAsync($"/api/bookings/{bookingA}/assign-room", new { roomId }),
                client.PostAsJsonAsync($"/api/bookings/{bookingB}/assign-room", new { roomId }));

            var codes = results.Select(r => (int)r.StatusCode).OrderBy(c => c).ToArray();
            Assert.Equal(new[] { 200, 409 }, codes);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<LarchmontDbContext>();
                var holders = (await db.Bookings.AsNoTracking().Where(x => x.RoomId == roomId).ToListAsync())
                    .Count(x => x.CheckIn == new DateOnly(2031, 3, 1));
                Assert.Equal(1, holders);
            }
        }
        finally
        {
            await DropDatabaseAsync(adminConnection, databaseName);
        }
    }

    private static async Task CreateDatabaseAsync(string adminConnection, string name)
    {
        await using var connection = new MySqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = new MySqlCommand($"CREATE DATABASE `{name}` CHARACTER SET utf8mb4", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseAsync(string adminConnection, string name)
    {
        await using var connection = new MySqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = new MySqlCommand($"DROP DATABASE IF EXISTS `{name}`", connection);
        await command.ExecuteNonQueryAsync();
    }
}

/// <summary>Real MySQL host: environment is not "Testing", so DbUp runs; no InMemory swap.</summary>
public sealed class MySqlApiFactory : WebApplicationFactory<Program>
{
    private readonly string _connectionString;

    public MySqlApiFactory(string connectionString) => _connectionString = connectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("MySqlTests");
        var connection = _connectionString;
        builder.ConfigureAppConfiguration((_, cfg) =>
            cfg.AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Larchmont"] = connection }));
    }
}
