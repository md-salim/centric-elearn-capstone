using FluentValidation;
using Larchmont.Api.Domain;
using Larchmont.Api.Dtos;
using Larchmont.Api.Infrastructure;
using Larchmont.Api.Mappers;
using Larchmont.Api.Repositories;

namespace Larchmont.Api.Services;

/// <summary>What a checkout did. RoomId is null when the booking had no room.</summary>
public record CheckoutOutcome(int? RoomId, string? Status, bool Duplicate);

public interface IHousekeepingService
{
    Task<BoardDto> GetBoardAsync(int hotelId, int? floor);
    Task<List<LateRoomDto>> GetLateRoomsAsync(int hotelId);
    Task<ReadyByDto> GetReadyByAsync(int roomId);
    Task<BoardRoomDto> TransitionAsync(int roomId, RoomTransitionRequest request, string? actorRole);
    Task<BoardRoomDto> OutOfOrderAsync(int roomId, OutOfOrderRequest request, string? actorRole);
    /// <summary>The legacy PUT /api/rooms/{id}/status. Goes through the same rules as TransitionAsync.</summary>
    Task<RoomDto> SetStatusAsync(int roomId, RoomStatusRequest request, string? actorRole);
    Task<List<FloorAssignmentDto>> GetFloorAssignmentsAsync(int hotelId);
    Task<List<FloorAssignmentDto>> ReplaceFloorAssignmentsAsync(int hotelId, FloorAssignmentsRequest request);
    Task<HousekeeperFloorsDto> AssignHousekeeperFloorsAsync(int housekeeperId, AssignHousekeeperFloorsRequest request);
    Task<CheckoutOutcome> RecordLockCheckoutAsync(int bookingId, DateTime checkedOutAt);
    Task RecordDeskCheckoutAsync(int bookingId);
}

public class HousekeepingService : IHousekeepingService
{
    /// <summary>A Ready room counts as late only if it became Ready within this window (AC-16, late list each morning).</summary>
    private static readonly TimeSpan LateReadyWindow = TimeSpan.FromHours(24);
    /// <summary>Attempts for a checkout that loses an optimistic-concurrency race (lock webhook and desk at once).</summary>
    private const int MaxCheckoutAttempts = 3;
    private const string HousekeeperRole = "Housekeeper";
    private const int MaxRoleLength = 20;

    private readonly IHousekeepingRepository _repo;
    private readonly IRoomTypeRepository _types;
    private readonly IBookingRepository _bookings;
    private readonly IBoardNotifier _notifier;
    private readonly TimeProvider _clock;
    private readonly IValidator<RoomTransitionRequest> _transitionValidator;
    private readonly IValidator<OutOfOrderRequest> _outOfOrderValidator;
    private readonly IValidator<RoomStatusRequest> _statusValidator;
    private readonly IValidator<FloorAssignmentsRequest> _floorsValidator;
    private readonly IValidator<AssignHousekeeperFloorsRequest> _housekeeperFloorsValidator;

    public HousekeepingService(IHousekeepingRepository repo, IRoomTypeRepository types, IBookingRepository bookings,
        IBoardNotifier notifier, TimeProvider clock,
        IValidator<RoomTransitionRequest> transitionValidator, IValidator<OutOfOrderRequest> outOfOrderValidator,
        IValidator<RoomStatusRequest> statusValidator, IValidator<FloorAssignmentsRequest> floorsValidator,
        IValidator<AssignHousekeeperFloorsRequest> housekeeperFloorsValidator)
    {
        _repo = repo;
        _types = types;
        _bookings = bookings;
        _notifier = notifier;
        _clock = clock;
        _transitionValidator = transitionValidator;
        _outOfOrderValidator = outOfOrderValidator;
        _statusValidator = statusValidator;
        _floorsValidator = floorsValidator;
        _housekeeperFloorsValidator = housekeeperFloorsValidator;
    }

    // ---------- Board and reads ----------

    public async Task<BoardDto> GetBoardAsync(int hotelId, int? floor)
    {
        await EnsureHotelAsync(hotelId);
        var now = Now();
        // Three queries in total, however many floors or rooms: hotel check, rooms, assignments.
        var rooms = await _repo.ListBoardRoomsAsync(hotelId, floor);
        var assignments = (await _repo.ListFloorAssignmentsAsync(hotelId)).ToDictionary(a => a.Floor);
        var floors = rooms
            .GroupBy(r => r.Floor)
            .OrderBy(g => g.Key)
            .Select(g => new BoardFloorDto(
                g.Key,
                assignments.TryGetValue(g.Key, out var a) ? new BoardHousekeeperDto(a.UserId, a.DisplayName) : null,
                g.Select(r => r.ToBoardRoom(now)).ToList()))
            .ToList();
        return new BoardDto(hotelId, now, floors);
    }

    public async Task<List<LateRoomDto>> GetLateRoomsAsync(int hotelId)
    {
        await EnsureHotelAsync(hotelId);
        var now = Now();
        // SQL decides which rooms are late. Here we compute minutes over and sort worst first.
        var rows = await _repo.ListLateRoomsAsync(hotelId, now, now - LateReadyWindow);
        return rows
            .Select(r =>
            {
                var due = Turnaround.DueAt(r.CheckedOutAt, r.SlaMinutes)!.Value;
                var end = Turnaround.EndAt(r.Status, r.ReadyAt, now) ?? now;
                return (Row: r, Due: due, Minutes: Turnaround.MinutesOver(due, end));
            })
            .OrderByDescending(x => x.Minutes)
            .ThenBy(x => x.Row.Floor)
            .ThenBy(x => x.Row.RoomNumber)
            .Select(x => x.Row.ToLateRoom(x.Minutes, x.Due))
            .ToList();
    }

    public async Task<ReadyByDto> GetReadyByAsync(int roomId)
    {
        var row = await _repo.GetRoomTimingAsync(roomId) ?? throw new NotFoundException($"Room {roomId} not found.");
        var now = Now();
        switch (row.Status)
        {
            case RoomStatuses.Ready:
                return new ReadyByDto(row.RoomId, row.Status, now, null, now, "ready now");
            case RoomStatuses.OutOfOrder:
                return new ReadyByDto(row.RoomId, row.Status, null, Turnaround.AsUtc(row.ExpectedReturnAt), null,
                    row.ExpectedReturnAt.HasValue ? "out of order, expected back" : "out of order, no return date set");
            default:
                var due = Turnaround.DueAt(row.CheckedOutAt, row.SlaMinutes);
                return due.HasValue
                    ? new ReadyByDto(row.RoomId, row.Status, Turnaround.AsUtc(due), null, Turnaround.AsUtc(due),
                        $"checkout plus {row.SlaMinutes} minute target")
                    : new ReadyByDto(row.RoomId, row.Status, null, null, null, "no checkout time recorded");
        }
    }

    // ---------- Room state moves ----------

    public async Task<BoardRoomDto> TransitionAsync(int roomId, RoomTransitionRequest request, string? actorRole)
    {
        await _transitionValidator.ValidateAndThrowAsync(request);
        var result = await ApplyMoveAsync(roomId, request.To!, TrimOrNull(request.Reason), ToUtcSeconds(request.ExpectedReturnAt),
            actorRole);
        return result.Room.ToBoardRoom(result.Type, result.Now);
    }

    public async Task<BoardRoomDto> OutOfOrderAsync(int roomId, OutOfOrderRequest request, string? actorRole)
    {
        await _outOfOrderValidator.ValidateAndThrowAsync(request);
        var result = await ApplyMoveAsync(roomId, RoomStatuses.OutOfOrder, TrimOrNull(request.Reason),
            ToUtcSeconds(request.Until), actorRole);
        return result.Room.ToBoardRoom(result.Type, result.Now);
    }

    public async Task<RoomDto> SetStatusAsync(int roomId, RoomStatusRequest request, string? actorRole)
    {
        await _statusValidator.ValidateAndThrowAsync(request);
        if (request.Status == RoomStatuses.OutOfOrder)
            throw new InvalidRequestException("Use POST /api/rooms/{id}/out-of-order to move a room out of order. A reason is required.");
        var result = await ApplyMoveAsync(roomId, request.Status, null, null, actorRole, request.ChangedByUserId);
        return result.Room.ToDto(result.Type.Name);
    }

    /// <summary>
    /// The one place a room changes state by a person. Checks the move against the rules, applies it,
    /// writes the history row in the same save, then pushes the change after the save commits.
    /// The room's row version (bumped on save) makes two simultaneous moves conflict: one wins, the other gets 409.
    /// </summary>
    private async Task<MoveResult> ApplyMoveAsync(int roomId, string to, string? reason, DateTime? expectedReturnAt,
        string? actorRole, int? actorUserId = null)
    {
        var room = await _repo.GetRoomAsync(roomId) ?? throw new NotFoundException($"Room {roomId} not found.");
        var from = room.Status;
        if (!RoomTransitionRules.IsAllowed(from, to))
            throw new InvalidTransitionException(RoomTransitionRules.Refusal(room.RoomNumber, from, to));
        var type = await _types.GetAsync(room.RoomTypeId) ?? throw new NotFoundException($"Room type {room.RoomTypeId} not found.");
        var now = Now();
        var selfMarked = RoomTransitionRules.IsSelfMark(from, to);

        room.Status = to;
        room.SelfMarked = selfMarked;
        switch (to)
        {
            case RoomStatuses.OutOfOrder:
                room.OutOfOrderReason = reason;
                room.ExpectedReturnAt = expectedReturnAt;
                room.ReadyAt = null;
                break;
            case RoomStatuses.Ready:
                room.ReadyAt = now;
                room.OutOfOrderReason = null;
                room.ExpectedReturnAt = null;
                break;
            case RoomStatuses.Dirty when from == RoomStatuses.OutOfOrder:
                // Back in service. Assumed (spec Q8): a new turnaround clock starts now.
                room.CheckedOutAt = now;
                room.ReadyAt = null;
                room.OutOfOrderReason = null;
                room.ExpectedReturnAt = null;
                break;
            default:
                room.ReadyAt = null;
                break;
        }

        _repo.AddHistory(new RoomStatusEvent
        {
            RoomId = room.Id,
            FromStatus = from,
            ToStatus = to,
            ChangedByUserId = actorUserId,
            ChangedAt = now,
            SelfMarked = selfMarked,
            Reason = reason,
            ByUserRole = NormaliseRole(actorRole)
        });
        await _repo.SaveRoomChangeAsync();

        // Only after the save has committed.
        await _notifier.RoomUpdatedAsync(room.ToRoomUpdated(type, now));
        if (to == RoomStatuses.Ready && room.CheckedOutAt.HasValue)
        {
            var due = Turnaround.DueAt(room.CheckedOutAt, type.SlaMinutes)!.Value;
            var minutes = Turnaround.MinutesOver(due, now);
            if (minutes > 0)
                await _notifier.SlaBreachAddedAsync(new SlaBreachAddedEvent(room.Id, room.HotelId, room.RoomNumber,
                    Turnaround.AsUtc(due), minutes));
        }
        return new MoveResult(room, type, now);
    }

    // ---------- Floors ----------

    public async Task<List<FloorAssignmentDto>> GetFloorAssignmentsAsync(int hotelId)
    {
        await EnsureHotelAsync(hotelId);
        return (await _repo.ListFloorAssignmentsAsync(hotelId)).Select(a => a.ToDto()).ToList();
    }

    public async Task<List<FloorAssignmentDto>> ReplaceFloorAssignmentsAsync(int hotelId, FloorAssignmentsRequest request)
    {
        await _floorsValidator.ValidateAndThrowAsync(request);
        await EnsureHotelAsync(hotelId);
        var items = request.Assignments!;

        var roomFloors = (await _repo.ListRoomFloorsAsync(hotelId)).ToHashSet();
        var emptyFloor = items.FirstOrDefault(i => !roomFloors.Contains(i.Floor));
        if (emptyFloor is not null)
            throw new InvalidRequestException($"Floor {emptyFloor.Floor} has no rooms in this hotel.");

        var housekeepers = (await _repo.ListUserRefsAsync(items.Select(i => i.HousekeeperId).Distinct().ToList()))
            .ToDictionary(u => u.Id);
        foreach (var item in items)
            EnsureHousekeeperAt(hotelId, item.HousekeeperId, housekeepers);

        var tracked = await _repo.ListTrackedFloorRowsAsync(hotelId);
        var before = tracked.ToDictionary(r => r.Floor, r => r.UserId);
        var desired = items.ToDictionary(i => i.Floor, i => i.HousekeeperId);

        // Full replacement: rows for floors not listed go, listed floors are updated or added.
        foreach (var row in tracked.Where(r => !desired.ContainsKey(r.Floor)))
            _repo.RemoveFloorRow(row);
        foreach (var (floor, housekeeperId) in desired)
        {
            var existing = tracked.FirstOrDefault(r => r.Floor == floor);
            if (existing is null)
                _repo.AddFloorRow(new HousekeeperFloor { HotelId = hotelId, Floor = floor, UserId = housekeeperId });
            else
                existing.UserId = housekeeperId;
        }
        await _repo.SaveFloorChangesAsync();

        foreach (var floor in before.Keys.Union(desired.Keys).Order())
        {
            int? previous = before.TryGetValue(floor, out var p) ? p : null;
            int? current = desired.TryGetValue(floor, out var c) ? c : null;
            if (previous != current)
                await _notifier.HousekeeperMovedAsync(new HousekeeperMovedEvent(hotelId, floor, current));
        }
        return (await _repo.ListFloorAssignmentsAsync(hotelId)).Select(a => a.ToDto()).ToList();
    }

    public async Task<HousekeeperFloorsDto> AssignHousekeeperFloorsAsync(int housekeeperId, AssignHousekeeperFloorsRequest request)
    {
        await _housekeeperFloorsValidator.ValidateAndThrowAsync(request);
        await EnsureHotelAsync(request.HotelId);
        var floors = request.Floors!.Distinct().Order().ToList();

        var user = await _repo.GetUserRefAsync(housekeeperId) ?? throw new NotFoundException($"User {housekeeperId} not found.");
        if (user.Role != HousekeeperRole)
            throw new InvalidRequestException($"User {housekeeperId} is not a housekeeper.");
        if (user.HotelId != request.HotelId)
            throw new InvalidRequestException($"User {housekeeperId} does not work at hotel {request.HotelId}.");

        var roomFloors = (await _repo.ListRoomFloorsAsync(request.HotelId)).ToHashSet();
        var emptyFloors = floors.Where(f => !roomFloors.Contains(f)).ToList();
        if (emptyFloors.Count > 0)
            throw new InvalidRequestException($"Floor {emptyFloors[0]} has no rooms in this hotel.");

        var tracked = await _repo.ListTrackedFloorRowsAsync(request.HotelId);
        var heldByOther = tracked.FirstOrDefault(r => floors.Contains(r.Floor) && r.UserId != housekeeperId);
        if (heldByOther is not null)
            throw new InvalidRequestException($"Floor {heldByOther.Floor} is already held by another housekeeper. Remove it from them first.");

        foreach (var floor in floors)
        {
            var existing = tracked.FirstOrDefault(r => r.Floor == floor);
            if (existing is null)
                _repo.AddFloorRow(new HousekeeperFloor { HotelId = request.HotelId, Floor = floor, UserId = housekeeperId });
            else
                existing.UserId = housekeeperId;
        }
        await _repo.SaveFloorChangesAsync();

        foreach (var floor in floors)
            await _notifier.HousekeeperMovedAsync(new HousekeeperMovedEvent(request.HotelId, floor, housekeeperId));

        var saved = tracked.Where(r => r.UserId == housekeeperId).Select(r => r.Floor).Union(floors).Order().ToList();
        return new HousekeeperFloorsDto(request.HotelId, housekeeperId, saved);
    }

    // ---------- Checkouts (lock webhook and desk) ----------

    public Task<CheckoutOutcome> RecordLockCheckoutAsync(int bookingId, DateTime checkedOutAt) =>
        RecordCheckoutAsync(bookingId, CheckoutSources.Lock, Turnaround.ToWholeSeconds(checkedOutAt));

    public async Task RecordDeskCheckoutAsync(int bookingId) =>
        await RecordCheckoutAsync(bookingId, CheckoutSources.Desk, Now());

    private async Task<CheckoutOutcome> RecordCheckoutAsync(int bookingId, string source, DateTime checkedOutAt)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await TryRecordCheckoutAsync(bookingId, source, checkedOutAt);
            }
            catch (ConflictException) when (attempt < MaxCheckoutAttempts)
            {
                // The room or booking changed under us. Drop the stale entities and read them again.
                _repo.DetachAll();
            }
        }
    }

    /// <summary>
    /// Room Dirty, checked_out_at set to the earliest checkout seen, booking CheckedOut, event recorded, all in one save.
    /// A repeat of the same (booking ref, checkout time) changes nothing (BR-12). Pushes only when something changed.
    /// </summary>
    private async Task<CheckoutOutcome> TryRecordCheckoutAsync(int bookingId, string source, DateTime checkedOutAt)
    {
        var booking = await _bookings.GetAsync(bookingId) ?? throw new NotFoundException($"Booking {bookingId} not found.");
        var now = Now();

        if (booking.RoomId is not int roomId)
        {
            booking.Status = BookingStatuses.CheckedOut;
            booking.UpdatedAt = now;
            await _repo.TrySaveCheckoutAsync();
            return new CheckoutOutcome(null, null, false);
        }

        if (await _repo.CheckoutEventExistsAsync(booking.Reference, checkedOutAt))
        {
            var current = await _repo.GetRoomTimingAsync(roomId);
            return new CheckoutOutcome(roomId, current?.Status, true);
        }

        var room = await _repo.GetRoomAsync(roomId) ?? throw new NotFoundException($"Room {roomId} not found.");
        var type = await _types.GetAsync(room.RoomTypeId) ?? throw new NotFoundException($"Room type {room.RoomTypeId} not found.");
        var timestampChanged = room.CheckedOutAt is null || checkedOutAt < room.CheckedOutAt.Value;
        if (timestampChanged) room.CheckedOutAt = checkedOutAt;

        // An out of order room stays out of order. The checkout time is still recorded.
        var statusChanged = room.Status != RoomStatuses.Dirty && room.Status != RoomStatuses.OutOfOrder;
        if (statusChanged)
        {
            _repo.AddHistory(new RoomStatusEvent
            {
                RoomId = room.Id,
                FromStatus = room.Status,
                ToStatus = RoomStatuses.Dirty,
                ChangedAt = now,
                Reason = $"Guest checkout ({source})"
            });
            room.Status = RoomStatuses.Dirty;
            room.SelfMarked = false;
            room.ReadyAt = null;
        }

        booking.Status = BookingStatuses.CheckedOut;
        booking.UpdatedAt = now;
        _repo.AddCheckoutEvent(new CheckoutEvent
        {
            BookingId = booking.Id,
            BookingRef = booking.Reference,
            RoomId = room.Id,
            CheckedOutAt = checkedOutAt,
            Source = source,
            ReceivedAt = now
        });

        if (!await _repo.TrySaveCheckoutAsync())
        {
            // An identical checkout committed first. Nothing from this attempt was written, so read the room again.
            _repo.DetachAll();
            var current = await _repo.GetRoomTimingAsync(roomId);
            return new CheckoutOutcome(roomId, current?.Status, true);
        }

        if (statusChanged || timestampChanged)
            await _notifier.RoomUpdatedAsync(room.ToRoomUpdated(type, now));
        return new CheckoutOutcome(roomId, room.Status, false);
    }

    // ---------- Helpers ----------

    private async Task EnsureHotelAsync(int hotelId)
    {
        if (!await _repo.HotelExistsAsync(hotelId)) throw new NotFoundException($"Hotel {hotelId} not found.");
    }

    private static void EnsureHousekeeperAt(int hotelId, int housekeeperId, IReadOnlyDictionary<int, UserRef> users)
    {
        if (!users.TryGetValue(housekeeperId, out var user))
            throw new InvalidRequestException($"Housekeeper {housekeeperId} does not exist.");
        if (user.Role != HousekeeperRole)
            throw new InvalidRequestException($"User {housekeeperId} is not a housekeeper.");
        if (user.HotelId != hotelId)
            throw new InvalidRequestException($"Housekeeper {housekeeperId} does not work at this hotel.");
    }

    /// <summary>Current UTC time, truncated to whole seconds (db-analysis 3.2).</summary>
    private DateTime Now() => Turnaround.ToWholeSeconds(_clock.GetUtcNow().UtcDateTime);

    private static DateTime? ToUtcSeconds(DateTimeOffset? value) =>
        value.HasValue ? Turnaround.ToWholeSeconds(value.Value.UtcDateTime) : null;

    private static string? TrimOrNull(string? text)
    {
        var trimmed = text?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    /// <summary>
    /// The X-User-Role header is a placeholder until login exists (spec Q9). It is recorded in history
    /// (by_user_role) and never used to authorise a move.
    /// </summary>
    private static string? NormaliseRole(string? role)
    {
        var trimmed = TrimOrNull(role);
        return trimmed is null ? null : trimmed[..Math.Min(trimmed.Length, MaxRoleLength)];
    }

    private sealed record MoveResult(Room Room, RoomType Type, DateTime Now);
}
