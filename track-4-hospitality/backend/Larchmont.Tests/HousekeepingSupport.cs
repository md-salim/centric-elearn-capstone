using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Larchmont.Api.Data;
using Larchmont.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Larchmont.Tests;

public static class TestTimes
{
    /// <summary>A UTC instant on the fixed test day, 2026-10-27.</summary>
    public static DateTimeOffset At(int hour, int minute = 0) => new(2026, 10, 27, hour, minute, 0, TimeSpan.Zero);
}

/// <summary>
/// Seed data on top of ApiFactory.SeedBasics (hotel 1 "EDI", room type 1 "STD").
/// Room statuses are passed as string literals so this code compiles before the backend adds RoomStatuses.Ready.
/// </summary>
public static class HousekeepingSeed
{
    public static void Base(ApiFactory f)
    {
        f.SeedBasics();
        f.Seed(db =>
        {
            db.RoomTypes.Add(new RoomType { Id = 2, Code = "STE", Name = "Suite", MaxOccupancy = 2, BaseRate = 250m });
            db.RoomTypes.Add(new RoomType { Id = 3, Code = "FAM", Name = "Family Room", MaxOccupancy = 4, BaseRate = 180m });
            db.RatePlans.Add(new RatePlan { Id = 1, Code = "BAR", Name = "Best available rate", DiscountPct = 0m });
            db.Guests.Add(new Guest
            {
                Id = 1, FirstName = "Ada", LastName = "Lovelace", Email = "ada@example.com", Phone = "+44 7700 900001",
                AddressLine = "1 High Street", City = "Leeds", Postcode = "LS1 1AA", Country = "GB", Region = "North",
                CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
            });
            db.Users.Add(new User
            {
                Id = 7, Email = "hannah@example.com", DisplayName = "Hannah Housekeeper", Role = "Housekeeper", HotelId = 1,
                PasswordHash = "PBKDF2-SECRET-HASH-MUST-NOT-LEAK", Phone = "+44 7700 900007",
                LastLoginAt = new DateTime(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc)
            });
            db.Users.Add(new User
            {
                Id = 8, Email = "ivan@example.com", DisplayName = "Ivan Housekeeper", Role = "Housekeeper", HotelId = 1,
                PasswordHash = "PBKDF2-OTHER-HASH", Phone = "+44 7700 900008"
            });
        });
    }

    public static void AddRoom(ApiFactory f, int id, string number, int floor, string status, int roomTypeId = 1) =>
        f.Seed(db => db.Rooms.Add(new Room
        {
            Id = id, HotelId = 1, RoomTypeId = roomTypeId, RoomNumber = number, Floor = floor, Status = status
        }));

    public static void AddBooking(ApiFactory f, int id, string reference, int? roomId, string status, int roomTypeId = 1)
    {
        var checkIn = new DateOnly(2026, 10, 26);
        f.Seed(db => db.Bookings.Add(new Booking
        {
            Id = id, Reference = reference, Channel = "Direct", HotelId = 1, GuestId = 1, RoomTypeId = roomTypeId,
            RoomId = roomId, RatePlanId = 1, CheckIn = checkIn, CheckOut = checkIn.AddDays(2), Adults = 2,
            Status = status, TotalAmount = 190m,
            CreatedAt = new DateTime(2026, 10, 20, 0, 0, 0, DateTimeKind.Utc),
            UpdatedAt = new DateTime(2026, 10, 20, 0, 0, 0, DateTimeKind.Utc)
        }));
    }

    /// <summary>Sets RoomType.SlaMinutes. Reflection keeps this file compiling before the backend adds the property.</summary>
    public static void SetSlaMinutes(ApiFactory f, int roomTypeId, int minutes)
    {
        var prop = typeof(RoomType).GetProperty("SlaMinutes")
            ?? throw new InvalidOperationException("RoomType.SlaMinutes does not exist yet (backend has not landed).");
        f.Seed(db => prop.SetValue(db.RoomTypes.Single(t => t.Id == roomTypeId), minutes));
    }
}

public static class Api
{
    public static async Task<JsonElement> GetJsonAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(url);
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    /// <summary>Asserts a ProblemDetails response and returns its body.</summary>
    public static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    public static JsonElement FindBoardRoom(JsonElement board, int roomId)
    {
        foreach (var floor in board.GetProperty("floors").EnumerateArray())
            foreach (var room in floor.GetProperty("rooms").EnumerateArray())
                if (room.GetProperty("roomId").GetInt32() == roomId) return room;
        throw new InvalidOperationException($"Room {roomId} is not on the board.");
    }

    public static JsonElement? FindLateRoom(JsonElement lateList, int roomId)
    {
        foreach (var item in lateList.EnumerateArray())
            if (item.GetProperty("roomId").GetInt32() == roomId) return item;
        return null;
    }

    public static async Task<JsonElement> GetBoardAsync(HttpClient client, int hotelId = 1) =>
        await GetJsonAsync(client, $"/api/hotels/{hotelId}/board");

    public static async Task<JsonElement> GetLateRoomsAsync(HttpClient client, int hotelId = 1) =>
        await GetJsonAsync(client, $"/api/hotels/{hotelId}/late-rooms");

    public static async Task<HttpResponseMessage> DeskCheckOutAsync(HttpClient client, int bookingId) =>
        await client.PostAsync($"/api/bookings/{bookingId}/check-out", null);
}

/// <summary>Builds, signs and posts lock-system checkout events exactly as the webhook expects.</summary>
public static class LockWebhook
{
    public static string Body(string bookingRef, int roomId, DateTimeOffset checkedOutAt) =>
        JsonSerializer.Serialize(new
        {
            bookingRef,
            roomId,
            checkedOutAt = checkedOutAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture)
        });

    /// <summary>X-Signature value: "sha256=" + lowercase hex HMAC-SHA256 of the raw body bytes.</summary>
    public static string Sign(string body, string secret)
    {
        var hash = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body));
        return "sha256=" + Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static Task<HttpResponseMessage> PostAsync(HttpClient client, string body, string? signature)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/lock-events/checkout")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        if (signature is not null) request.Headers.Add("X-Signature", signature);
        return client.SendAsync(request);
    }
}

public static class RowSnapshot
{
    /// <summary>Row count for every entity the DbContext maps. Used to prove a call wrote nothing.</summary>
    public static Dictionary<string, int> Take(ApiFactory f)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LarchmontDbContext>();
        var setMethod = typeof(DbContext).GetMethods()
            .Single(m => m.Name == nameof(DbContext.Set) && m.IsGenericMethodDefinition && m.GetParameters().Length == 0);
        var counts = new Dictionary<string, int>();
        foreach (var entity in db.Model.GetEntityTypes())
        {
            var set = (IQueryable)setMethod.MakeGenericMethod(entity.ClrType).Invoke(db, null)!;
            counts[entity.ClrType.Name] = set.Cast<object>().Count();
        }
        return counts;
    }

    public static IReadOnlyList<string> EntityNames(ApiFactory f)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LarchmontDbContext>();
        return db.Model.GetEntityTypes().Select(e => e.ClrType.Name).ToList();
    }

    public static readonly Regex LocationLike = new("location|position|coordinate|latitude|longitude|gps|geo", RegexOptions.IgnoreCase);
}
