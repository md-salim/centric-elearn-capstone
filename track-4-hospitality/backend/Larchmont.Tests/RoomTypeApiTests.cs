using System.Net.Http.Json;
using System.Text.Json;
using Larchmont.Api.Domain;

namespace Larchmont.Tests;

public class RoomTypeApiTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public RoomTypeApiTests(ApiFactory factory)
    {
        _factory = factory;
        factory.SeedBasics();
    }

    [Fact]
    public async Task AC_01_RoomTypeListAndDetailsIncludeStoredSlaMinutes()
    {
        _factory.Seed(db =>
        {
            var roomType = db.RoomTypes.Single(type => type.Id == 1);
            roomType.SlaMinutes = 75;
        });

        var client = _factory.CreateClient();
        var list = await client.GetFromJsonAsync<JsonElement[]>("/api/room-types");
        var details = await client.GetFromJsonAsync<JsonElement>("/api/room-types/1");

        Assert.NotNull(list);
        Assert.Equal(75, list!.Single(type => type.GetProperty("id").GetInt32() == 1)
            .GetProperty("slaMinutes").GetInt32());
        Assert.Equal(75, details.GetProperty("slaMinutes").GetInt32());
    }

    [Fact]
    public async Task AC_02_CreatingRoomTypeWithoutSlaUsesDefaultTarget()
    {
        var response = await _factory.CreateClient().PostAsJsonAsync("/api/room-types",
            new { code = "TEST", name = "Test Room", maxOccupancy = 2, baseRate = 100m });

        response.EnsureSuccessStatusCode();
        var roomType = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(45, roomType.GetProperty("slaMinutes").GetInt32());
    }
}
