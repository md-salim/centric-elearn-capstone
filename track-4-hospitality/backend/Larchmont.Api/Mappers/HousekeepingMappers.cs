using Larchmont.Api.Domain;
using Larchmont.Api.Dtos;
using Larchmont.Api.Repositories;

namespace Larchmont.Api.Mappers;

/// <summary>A room joined with its room type, as read for the board, late list and ready-by.</summary>
public record RoomTimingRow(int RoomId, string RoomNumber, int Floor, string RoomType, int SlaMinutes, string Status,
    bool SelfMarked, DateTime? CheckedOutAt, DateTime? ReadyAt, string? OooReason, DateTime? ExpectedReturnAt);

public static class HousekeepingMapper
{
    public static FloorAssignmentDto ToDto(this FloorAssignmentRow a) => new(a.Floor, a.UserId, a.DisplayName);

    /// <summary>Board tile for one room at time <paramref name="now"/>.</summary>
    public static BoardRoomDto ToBoardRoom(this RoomTimingRow r, DateTime now)
    {
        var due = Turnaround.DueAt(r.CheckedOutAt, r.SlaMinutes);
        var end = Turnaround.EndAt(r.Status, r.ReadyAt, now);
        var minutesOver = due.HasValue && end.HasValue ? Turnaround.MinutesOver(due.Value, end.Value) : (int?)null;
        return new BoardRoomDto(r.RoomId, r.RoomNumber, r.RoomType, r.Status, r.SelfMarked,
            Turnaround.AsUtc(r.CheckedOutAt), Turnaround.AsUtc(due), minutesOver, r.OooReason);
    }

    public static BoardRoomDto ToBoardRoom(this Room r, RoomType type, DateTime now) =>
        new RoomTimingRow(r.Id, r.RoomNumber, r.Floor, type.Name, type.SlaMinutes, r.Status, r.SelfMarked,
            r.CheckedOutAt, r.ReadyAt, r.OutOfOrderReason, r.ExpectedReturnAt).ToBoardRoom(now);

    public static LateRoomDto ToLateRoom(this RoomTimingRow r, int minutesOver, DateTime due) =>
        new(r.RoomId, r.RoomNumber, r.Floor, r.RoomType, r.Status, Turnaround.AsUtc(r.CheckedOutAt!.Value),
            Turnaround.AsUtc(due), minutesOver);

    public static RoomUpdatedEvent ToRoomUpdated(this Room r, RoomType type, DateTime now) =>
        new(r.Id, r.HotelId, r.Status, r.SelfMarked, Turnaround.AsUtc(r.CheckedOutAt),
            Turnaround.AsUtc(Turnaround.DueAt(r.CheckedOutAt, type.SlaMinutes)), now);
}
