namespace Larchmont.Api.Dtos;

// Board (GET /api/hotels/{id}/board)
public record BoardHousekeeperDto(int Id, string DisplayName);
public record BoardRoomDto(int RoomId, string RoomNumber, string RoomType, string Status, bool SelfMarked,
    DateTime? CheckedOutAt, DateTime? DueAt, int? MinutesOver, string? OooReason);
public record BoardFloorDto(int Floor, BoardHousekeeperDto? Housekeeper, IReadOnlyList<BoardRoomDto> Rooms);
public record BoardDto(int HotelId, DateTime GeneratedAt, IReadOnlyList<BoardFloorDto> Floors);

// Transitions (POST /api/rooms/{id}/transitions, /out-of-order)
public record RoomTransitionRequest(string? To, string? Reason, DateTimeOffset? ExpectedReturnAt);
public record OutOfOrderRequest(string? Reason, DateTimeOffset? Until);

// Ready-by (GET /api/rooms/{id}/ready-by)
public record ReadyByDto(int RoomId, string State, DateTime? ReadyBy, DateTime? ExpectedReturnAt,
    DateTime? EstimatedReadyAt, string BasedOn);

// Late rooms (GET /api/hotels/{id}/late-rooms, alias sla-breaches)
public record LateRoomDto(int RoomId, string RoomNumber, int Floor, string RoomType, string Status,
    DateTime CheckedOutAt, DateTime DueAt, int MinutesOver);

// Floor assignments
public record FloorAssignmentDto(int Floor, int HousekeeperId, string DisplayName);
public record FloorAssignmentItem(int Floor, int HousekeeperId);
public record FloorAssignmentsRequest(IReadOnlyList<FloorAssignmentItem>? Assignments);
public record AssignHousekeeperFloorsRequest(int HotelId, IReadOnlyList<int>? Floors);
public record HousekeeperFloorsDto(int HotelId, int HousekeeperId, IReadOnlyList<int> Floors);

// Lock system checkout (POST /api/lock-events/checkout)
public record LockCheckoutRequest(string? BookingRef, int RoomId, DateTimeOffset? CheckedOutAt);
public record LockCheckoutResultDto(int RoomId, string Status, bool Duplicate);

// Live push payloads (SignalR, see Infrastructure/SignalRBoardNotifier.cs)
public record RoomUpdatedEvent(int RoomId, int HotelId, string Status, bool SelfMarked,
    DateTime? CheckedOutAt, DateTime? DueAt, DateTime ChangedAt);
public record SlaBreachAddedEvent(int RoomId, int HotelId, string RoomNumber, DateTime DueAt, int MinutesOver);
public record HousekeeperMovedEvent(int HotelId, int Floor, int? HousekeeperId);
