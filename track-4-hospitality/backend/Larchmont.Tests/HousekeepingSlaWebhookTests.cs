using System.Net;
using System.Text.Json;
using Larchmont.Api.Data;
using Larchmont.Api.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Larchmont.Tests;

/// <summary>SLA boundaries, clock source, lock-system webhook. In-memory (ApiFactory) with a fixed fake clock.</summary>
public class HousekeepingSlaWebhookTests
{
    [Theory]
    [InlineData(2)] // STE Suite
    [InlineData(3)] // FAM Family Room
    public async Task AC_05_SlaUses75MinutesForSuite(int roomTypeId)
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.SetSlaMinutes(f, roomTypeId, 75);
        HousekeepingSeed.AddRoom(f, 201, "201", 2, "Ready", roomTypeId);
        HousekeepingSeed.AddBooking(f, 1, "LH-0001", roomId: 201, status: BookingStatuses.CheckedIn, roomTypeId: roomTypeId);
        f.Time.Set(TestTimes.At(10));
        var client = f.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Api.DeskCheckOutAsync(client, 1)).StatusCode);

        f.Time.Set(TestTimes.At(11, 15));
        Assert.Null(Api.FindLateRoom(await Api.GetLateRoomsAsync(client), 201));

        f.Time.Set(TestTimes.At(11, 16));
        var late = Api.FindLateRoom(await Api.GetLateRoomsAsync(client), 201);
        Assert.NotNull(late);
        Assert.Equal(1, late!.Value.GetProperty("minutesOver").GetInt32());
    }

    [Fact]
    public async Task AC_06_SlaUses45MinutesForStandardDouble()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f); // STD room type, no SLA set: the default target applies
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 1, "LH-0001", roomId: 101, status: BookingStatuses.CheckedIn);
        f.Time.Set(TestTimes.At(10));
        var client = f.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Api.DeskCheckOutAsync(client, 1)).StatusCode);

        f.Time.Set(TestTimes.At(10, 45));
        Assert.Null(Api.FindLateRoom(await Api.GetLateRoomsAsync(client), 101));

        f.Time.Set(TestTimes.At(10, 46));
        var late = Api.FindLateRoom(await Api.GetLateRoomsAsync(client), 101);
        Assert.NotNull(late);
        Assert.Equal(1, late!.Value.GetProperty("minutesOver").GetInt32());
    }

    [Fact]
    public async Task AC_07_SlaClockStartsAtCheckoutNotDirty()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 7, "LH-0007", roomId: 101, status: BookingStatuses.CheckedIn);
        var client = f.CreateClient();

        // Guest left at 10:00 (reported by the lock). The event reaches us at 10:20, when the room becomes Dirty.
        f.Time.Set(TestTimes.At(10, 20));
        var body = LockWebhook.Body("LH-0007", 101, TestTimes.At(10));
        var post = await LockWebhook.PostAsync(client, body, LockWebhook.Sign(body, ApiFactory.DefaultLockSecret));
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        // Counted from 10:00 this is 5 minutes over. Counted from Dirty (10:20) the room would not be late yet.
        f.Time.Set(TestTimes.At(10, 50));
        var late = Api.FindLateRoom(await Api.GetLateRoomsAsync(client), 101);
        Assert.NotNull(late);
        Assert.Equal(5, late!.Value.GetProperty("minutesOver").GetInt32());
    }

    [Fact]
    public async Task AC_16_CheckoutWebhookTransitionsRoomToDirty()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 10, "LH-0010", roomId: 101, status: BookingStatuses.CheckedIn);
        f.Time.Set(TestTimes.At(10));
        var client = f.CreateClient();
        var body = LockWebhook.Body("LH-0010", 101, TestTimes.At(10));

        var response = await LockWebhook.PostAsync(client, body, LockWebhook.Sign(body, ApiFactory.DefaultLockSecret));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using (var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync()))
        {
            Assert.Equal(101, doc.RootElement.GetProperty("roomId").GetInt32());
            Assert.Equal("Dirty", doc.RootElement.GetProperty("status").GetString());
            Assert.False(doc.RootElement.GetProperty("duplicate").GetBoolean());
        }
        var room = Api.FindBoardRoom(await Api.GetBoardAsync(client), 101);
        Assert.Equal("Dirty", room.GetProperty("status").GetString());
        Assert.Equal(TestTimes.At(10), DateTimeOffset.Parse(room.GetProperty("checkedOutAt").GetString()!));
    }

    [Fact]
    public async Task AC_17_CheckoutWebhookIsIdempotent()
    {
        using var f = new ApiFactory();
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 10, "LH-0010", roomId: 101, status: BookingStatuses.CheckedIn);
        f.Time.Set(TestTimes.At(10));
        var client = f.CreateClient();
        var body = LockWebhook.Body("LH-0010", 101, TestTimes.At(10));
        var signature = LockWebhook.Sign(body, ApiFactory.DefaultLockSecret);

        var first = await LockWebhook.PostAsync(client, body, signature);
        var second = await LockWebhook.PostAsync(client, body, signature);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        using (var doc = JsonDocument.Parse(await second.Content.ReadAsStringAsync()))
            Assert.True(doc.RootElement.GetProperty("duplicate").GetBoolean());

        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LarchmontDbContext>();
            Assert.Equal(1, db.RoomStatusHistory.Count(h => h.RoomId == 101));
        }

        Assert.NotNull(f.BoardNotifier); // null means the backend has no IBoardNotifier yet
        Assert.Equal(1, f.BoardNotifier!.Calls);
    }

    [Theory]
    [InlineData("wrong")]
    [InlineData("missing")]
    [InlineData("nosecret")]
    public async Task AC_22_WebhookRejectsBadOrMissingSignature(string mode)
    {
        using var f = new ApiFactory { LockSecret = mode == "nosecret" ? null : ApiFactory.DefaultLockSecret };
        HousekeepingSeed.Base(f);
        HousekeepingSeed.AddRoom(f, 101, "101", 1, "Ready");
        HousekeepingSeed.AddBooking(f, 20, "LH-0020", roomId: 101, status: BookingStatuses.CheckedIn);
        f.Time.Set(TestTimes.At(10));
        var client = f.CreateClient();
        var body = LockWebhook.Body("LH-0020", 101, TestTimes.At(10));
        string? signature = mode switch
        {
            "wrong" => LockWebhook.Sign(body, "not-the-shared-secret"),
            "missing" => null,
            _ => LockWebhook.Sign(body, ApiFactory.DefaultLockSecret), // nosecret: signed, but the server has no secret
        };

        var response = await LockWebhook.PostAsync(client, body, signature);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var room = Api.FindBoardRoom(await Api.GetBoardAsync(client), 101);
        Assert.Equal("Ready", room.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, room.GetProperty("checkedOutAt").ValueKind);
    }
}
