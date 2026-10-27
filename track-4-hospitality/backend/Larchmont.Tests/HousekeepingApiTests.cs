using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Larchmont.Api.Domain;

namespace Larchmont.Tests;

/// <summary>Housekeeping board: transitions, OOO, assignment, floors, ready-by, position stub, user DTO. In-memory (ApiFactory).</summary>
public class HousekeepingApiTests
{
    [Fact]
    public async Task AC_01_CheckoutMovesRoomToDirty()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 1, "LH-0001", roomId: 101, status: BookingStatuses.CheckedIn);
        f.Time.Set(TestTimes.At(10));
        var client = f.CreateClient();

        var checkout = await Api.DeskCheckOutAsync(client, 1);
        Assert.Equal(HttpStatusCode.OK, checkout.StatusCode);

        var room = Api.FindBoardRoom(await Api.GetBoardAsync(client), 101);
        Assert.Equal("Dirty", room.GetProperty("status").GetString());
        Assert.Equal(TestTimes.At(10), DateTimeOffset.Parse(room.GetProperty("checkedOutAt").GetString()!));
    }

    [Fact]
    public async Task AC_02_CannotGoReadyWithoutInspection()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Dirty");
        var client = f.CreateClient();

        var response = await client.PostAsJsonAsync("/api/rooms/101/transitions", new { to = "Ready" });
        await Api.AssertProblemAsync(response, HttpStatusCode.BadRequest);

        var room = Api.FindBoardRoom(await Api.GetBoardAsync(client), 101);
        Assert.Equal("Dirty", room.GetProperty("status").GetString());
    }

    [Fact]
    public async Task AC_03_SelfMarkedReadyFlagsBypass()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Cleaning");
        var client = f.CreateClient();

        var response = await client.PostAsJsonAsync("/api/rooms/101/transitions", new { to = "Ready" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("selfMarked").GetBoolean());
    }

    [Fact]
    public async Task AC_03_InspectedToReadyIsNotSelfMarked()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Inspected");
        var client = f.CreateClient();

        var response = await client.PostAsJsonAsync("/api/rooms/101/transitions", new { to = "Ready" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(doc.RootElement.GetProperty("selfMarked").GetBoolean());
    }

    [Fact]
    public async Task AC_04_OutOfOrderRoomCannotBeAssigned()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "OutOfOrder");
        HousekeepingSeed.AddBooking(f, 2, "LH-0002", roomId: null, status: BookingStatuses.Confirmed);

        var response = await f.CreateClient().PostAsJsonAsync("/api/bookings/2/assign-room", new { roomId = 101 });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task AC_11_ReadyRoomCanStillBeAssigned()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 2, "LH-0002", roomId: null, status: BookingStatuses.Confirmed);

        var response = await f.CreateClient().PostAsJsonAsync("/api/bookings/2/assign-room", new { roomId = 101 });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // IN-MEMORY ONLY: EF Core InMemory has no transactions, row locks or row_version checks, so this test does NOT
    // prove concurrency safety. It shows that two overlapping assignments of one room are not both accepted in-process.
    // The real race proof is MySqlConcurrencyTests.AC_20_ConcurrentBookingAssignmentReturns409_RealMySql.
    [Fact]
    public async Task AC_20_ConcurrentBookingAssignmentReturns409()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 2, "LH-0002", roomId: null, status: BookingStatuses.Confirmed);
        HousekeepingSeed.AddBooking(f, 3, "LH-0003", roomId: null, status: BookingStatuses.Confirmed);
        var client = f.CreateClient();

        var results = await Task.WhenAll(
            client.PostAsJsonAsync("/api/bookings/2/assign-room", new { roomId = 101 }),
            client.PostAsJsonAsync("/api/bookings/3/assign-room", new { roomId = 101 }));

        var codes = results.Select(r => (int)r.StatusCode).OrderBy(c => c).ToArray();
        Assert.Equal(new[] { 200, 409 }, codes);
    }

    [Theory]
    [InlineData("Dirty", "Inspected", "Cleaning|OutOfOrder")]
    [InlineData("Dirty", "Ready", "Cleaning|OutOfOrder")]
    [InlineData("Dirty", "Dirty", "Cleaning|OutOfOrder")]
    [InlineData("Cleaning", "Dirty", "Inspected|Ready|OutOfOrder")]
    [InlineData("Cleaning", "Cleaning", "Inspected|Ready|OutOfOrder")]
    [InlineData("Inspected", "Cleaning", "Ready|OutOfOrder")]
    [InlineData("Inspected", "Inspected", "Ready|OutOfOrder")]
    [InlineData("Ready", "Cleaning", "OutOfOrder")]
    [InlineData("Ready", "Inspected", "OutOfOrder")]
    [InlineData("OutOfOrder", "Ready", "Dirty")]
    [InlineData("OutOfOrder", "Cleaning", "Dirty")]
    public async Task AC_08_InvalidTransitionReturns400ProblemDetails(string from, string to, string allowedMoves)
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, from);
        var client = f.CreateClient();

        var response = await client.PostAsJsonAsync("/api/rooms/101/transitions", new { to });

        var problem = await Api.AssertProblemAsync(response, HttpStatusCode.BadRequest);
        Assert.Equal("Invalid transition", problem.GetProperty("title").GetString());
        var detail = problem.GetProperty("detail").GetString() ?? "";
        foreach (var allowed in allowedMoves.Split('|'))
            Assert.Contains(allowed, detail);
    }

    [Fact]
    public async Task AC_09_ReadyByReturnsEstimatedTime()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 1, "LH-0001", roomId: 101, status: BookingStatuses.CheckedIn);
        f.Time.Set(TestTimes.At(10));
        var client = f.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Api.DeskCheckOutAsync(client, 1)).StatusCode);

        var readyBy = await Api.GetJsonAsync(client, "/api/rooms/101/ready-by");

        Assert.Equal(TestTimes.At(10, 45), DateTimeOffset.Parse(readyBy.GetProperty("readyBy").GetString()!));
    }

    [Fact]
    public async Task AC_10_HousekeeperFloorAssignmentPersists()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddRoom(f, 201, "201", 2, "Ready");
        HousekeepingSeed.AddRoom(f, 301, "301", 3, "Ready");
        var client = f.CreateClient();

        var body = new
        {
            assignments = new[]
            {
                new { floor = 1, housekeeperId = 7 },
                new { floor = 2, housekeeperId = 7 },
                new { floor = 3, housekeeperId = 7 }
            }
        };
        var put = await client.PutAsJsonAsync("/api/hotels/1/floor-assignments", body);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var board = await Api.GetBoardAsync(client);
        var housekeeperIdByFloor = board.GetProperty("floors").EnumerateArray()
            .ToDictionary(fl => fl.GetProperty("floor").GetInt32(),
                fl => fl.GetProperty("housekeeper").ValueKind == JsonValueKind.Null ? -1 : fl.GetProperty("housekeeper").GetProperty("id").GetInt32());
        Assert.Equal(7, housekeeperIdByFloor[1]);
        Assert.Equal(7, housekeeperIdByFloor[2]);
        Assert.Equal(7, housekeeperIdByFloor[3]);
    }

    [Fact]
    public async Task AC_10_FloorGivenToTwoHousekeepersReturns400()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 201, "201", 2, "Ready");
        var client = f.CreateClient();

        var body = new
        {
            assignments = new[]
            {
                new { floor = 2, housekeeperId = 7 },
                new { floor = 2, housekeeperId = 8 }
            }
        };
        var put = await client.PutAsJsonAsync("/api/hotels/1/floor-assignments", body);
        await Api.AssertProblemAsync(put, HttpStatusCode.BadRequest);

        var board = await Api.GetBoardAsync(client);
        var floor2 = board.GetProperty("floors").EnumerateArray().Single(fl => fl.GetProperty("floor").GetInt32() == 2);
        Assert.Equal(JsonValueKind.Null, floor2.GetProperty("housekeeper").ValueKind);
    }

    [Fact]
    public async Task AC_10_HousekeeperFloorsEndpointPersists()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddRoom(f, 201, "201", 2, "Ready");
        var client = f.CreateClient();

        var post = await client.PostAsJsonAsync("/api/housekeepers/7/floors", new { hotelId = 1, floors = new[] { 1, 2 } });
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var board = await Api.GetBoardAsync(client);
        var floor1 = board.GetProperty("floors").EnumerateArray().Single(fl => fl.GetProperty("floor").GetInt32() == 1);
        Assert.Equal(7, floor1.GetProperty("housekeeper").GetProperty("id").GetInt32());
    }

    [Theory]
    [InlineData("GET", 7)]
    [InlineData("POST", 7)]
    [InlineData("GET", 999999)]
    [InlineData("POST", 999999)]
    public async Task AC_18_PositionEndpointReturns501WithPrivacyNoteLink(string method, int housekeeperId)
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        var client = f.CreateClient();
        var request = new HttpRequestMessage(new HttpMethod(method), $"/api/housekeepers/{housekeeperId}/position");
        if (method == "POST") request.Content = new StringContent("{}", Encoding.UTF8, "application/json");

        var response = await client.SendAsync(request);

        var problem = await Api.AssertProblemAsync(response, HttpStatusCode.NotImplemented);
        Assert.Equal("Not implemented", problem.GetProperty("title").GetString());
        Assert.Contains("docs/privacy-note.md", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task AC_19_PositionEndpointDoesNotPersistAnyCoordinate()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        var client = f.CreateClient();
        var entityNamesBefore = RowSnapshot.EntityNames(f);
        var before = RowSnapshot.Take(f);
        var body = new
        {
            latitude = 55.9533,
            longitude = -3.1883,
            accuracyMetres = 5,
            recordedAt = "2026-10-27T10:00:00Z"
        };

        var response = await client.PostAsJsonAsync("/api/housekeepers/7/position", body);

        // Without the 501 check this test would pass before the backend lands (a 404 persists nothing).
        Assert.Equal(HttpStatusCode.NotImplemented, response.StatusCode);
        Assert.Equal(before, RowSnapshot.Take(f));
        Assert.Equal(entityNamesBefore, RowSnapshot.EntityNames(f));
        Assert.DoesNotMatch(RowSnapshot.LocationLike, string.Join(",", RowSnapshot.EntityNames(f)));
    }

    [Fact]
    public async Task AC_21_UserDtoNeverLeaksPasswordHash()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);

        var json = await f.CreateClient().GetStringAsync("/api/users");

        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.GetArrayLength() > 0);
        foreach (var user in doc.RootElement.EnumerateArray())
            foreach (var property in user.EnumerateObject())
                Assert.DoesNotContain(property.Name, new[] { "passwordHash", "email", "phone", "lastLoginAt" }, StringComparer.OrdinalIgnoreCase);
    }
}
