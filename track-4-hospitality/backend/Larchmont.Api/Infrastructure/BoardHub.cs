using Microsoft.AspNetCore.SignalR;

namespace Larchmont.Api.Infrastructure;

/// <summary>
/// Live board updates at /hubs/board. A client joins one hotel's group and receives that hotel's events only.
/// No login exists yet, so any client can join any hotel's group. The events carry room state, not personal data.
/// </summary>
public class BoardHub : Hub
{
    public static string GroupFor(int hotelId) => $"hotel-{hotelId}";

    public Task JoinHotel(int hotelId) => Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(hotelId));

    public Task LeaveHotel(int hotelId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupFor(hotelId));
}
