using Larchmont.Api.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace Larchmont.Api.Infrastructure;

/// <summary>
/// Pushes board events to the hotel's group. Called only after a change has committed (BR-14).
/// Replace this in tests to capture events without a live hub.
/// </summary>
public interface IBoardNotifier
{
    Task RoomUpdatedAsync(RoomUpdatedEvent evt);
    Task SlaBreachAddedAsync(SlaBreachAddedEvent evt);
    Task HousekeeperMovedAsync(HousekeeperMovedEvent evt);
}

public class SignalRBoardNotifier : IBoardNotifier
{
    private readonly IHubContext<BoardHub> _hub;
    private readonly ILogger<SignalRBoardNotifier> _logger;

    public SignalRBoardNotifier(IHubContext<BoardHub> hub, ILogger<SignalRBoardNotifier> logger)
    {
        _hub = hub;
        _logger = logger;
    }

    public Task RoomUpdatedAsync(RoomUpdatedEvent evt) =>
        SendAsync(evt.HotelId, "room-updated", evt);

    public Task SlaBreachAddedAsync(SlaBreachAddedEvent evt) =>
        SendAsync(evt.HotelId, "sla-breach-added", evt);

    public Task HousekeeperMovedAsync(HousekeeperMovedEvent evt) =>
        SendAsync(evt.HotelId, "housekeeper-moved", evt);

    /// <summary>
    /// The change is already committed, so a failed push must not turn the response into an error.
    /// The failure is logged and the board's 30 second poll catches up.
    /// </summary>
    private async Task SendAsync(int hotelId, string method, object payload)
    {
        try
        {
            await _hub.Clients.Group(BoardHub.GroupFor(hotelId)).SendAsync(method, payload);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not push {Method} for hotel {HotelId}", method, hotelId);
        }
    }
}
