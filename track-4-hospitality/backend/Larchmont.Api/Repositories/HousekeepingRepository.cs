using Larchmont.Api.Data;
using Larchmont.Api.Domain;
using Larchmont.Api.Infrastructure;
using Larchmont.Api.Mappers;
using Microsoft.EntityFrameworkCore;

namespace Larchmont.Api.Repositories;

/// <summary>A housekeeper's floor assignment, joined with the housekeeper's name.</summary>
public record FloorAssignmentRow(int Floor, int UserId, string DisplayName);

/// <summary>The fields the floor rules need about a user. Projected, so no password hash or contact details are read.</summary>
public record UserRef(int Id, int? HotelId, string Role, string DisplayName);

public interface IHousekeepingRepository
{
    Task<bool> HotelExistsAsync(int hotelId);

    /// <summary>All rooms of a hotel (or one floor) with their room type, in one query, ordered by floor then room number.</summary>
    Task<List<RoomTimingRow>> ListBoardRoomsAsync(int hotelId, int? floor);

    /// <summary>
    /// Rooms that are late, decided in SQL: not Ready and past target at now,
    /// or Ready after target with ready_at inside the window (ready_at at or after readySince).
    /// Rooms with no checkout time are never late.
    /// </summary>
    Task<List<RoomTimingRow>> ListLateRoomsAsync(int hotelId, DateTime now, DateTime readySince);

    Task<RoomTimingRow?> GetRoomTimingAsync(int roomId);

    Task<List<FloorAssignmentRow>> ListFloorAssignmentsAsync(int hotelId);
    Task<List<int>> ListRoomFloorsAsync(int hotelId);
    Task<List<HousekeeperFloor>> ListTrackedFloorRowsAsync(int hotelId);
    Task<UserRef?> GetUserRefAsync(int userId);
    Task<List<UserRef>> ListUserRefsAsync(IReadOnlyCollection<int> userIds);
    void AddFloorRow(HousekeeperFloor row);
    void RemoveFloorRow(HousekeeperFloor row);
    Task SaveFloorChangesAsync();

    /// <summary>Tracked room, for writes.</summary>
    Task<Room?> GetRoomAsync(int roomId);
    void AddHistory(RoomStatusEvent ev);
    /// <summary>Saves the room and its history row in one SaveChanges. A concurrent change becomes a 409.</summary>
    Task SaveRoomChangeAsync();

    Task<bool> CheckoutEventExistsAsync(string bookingRef, DateTime checkedOutAt);
    void AddCheckoutEvent(CheckoutEvent checkoutEvent);
    /// <summary>
    /// Saves a checkout (room, booking and event together). Returns false on a unique-key clash
    /// (MySQL 1062), which means the same checkout was already recorded. A concurrent change throws ConflictException.
    /// </summary>
    Task<bool> TrySaveCheckoutAsync();

    /// <summary>Drops every tracked entity, so a retry re-reads the database and no failed change lingers.</summary>
    void DetachAll();
}

public class HousekeepingRepository : IHousekeepingRepository
{
    private readonly LarchmontDbContext _db;
    public HousekeepingRepository(LarchmontDbContext db) => _db = db;

    public Task<bool> HotelExistsAsync(int hotelId) => _db.Hotels.AsNoTracking().AnyAsync(h => h.Id == hotelId);

    // Board: one query. The join to room_types is on its primary key. Filter and order are in SQL.
    public async Task<List<RoomTimingRow>> ListBoardRoomsAsync(int hotelId, int? floor)
    {
        var rooms = _db.Rooms.AsNoTracking().Where(r => r.HotelId == hotelId);
        if (floor.HasValue) rooms = rooms.Where(r => r.Floor == floor.Value);
        return await rooms
            .Join(_db.RoomTypes.AsNoTracking(), r => r.RoomTypeId, t => t.Id,
                (r, t) => new RoomTimingRow(r.Id, r.RoomNumber, r.Floor, t.Name, t.SlaMinutes, r.Status, r.SelfMarked,
                    r.CheckedOutAt, r.ReadyAt, r.OutOfOrderReason, r.ExpectedReturnAt))
            .OrderBy(x => x.Floor).ThenBy(x => x.RoomNumber)
            .ToListAsync();
    }

    // Late list: one query. The target is checked_out_at + sla_minutes, compared with the clock passed in.
    // Only the 'late' test runs in SQL. Minutes over and the worst-first order are computed by the service
    // on this already-filtered set.
    public async Task<List<RoomTimingRow>> ListLateRoomsAsync(int hotelId, DateTime now, DateTime readySince)
    {
        return await _db.Rooms.AsNoTracking()
            .Where(r => r.HotelId == hotelId && r.CheckedOutAt != null)
            .Join(_db.RoomTypes.AsNoTracking(), r => r.RoomTypeId, t => t.Id, (r, t) => new { r, t })
            .Where(x => (x.r.Status != RoomStatuses.Ready
                         && now > x.r.CheckedOutAt!.Value.AddMinutes(x.t.SlaMinutes))
                     || (x.r.Status == RoomStatuses.Ready
                         && x.r.ReadyAt != null
                         && x.r.ReadyAt >= readySince
                         && x.r.ReadyAt > x.r.CheckedOutAt!.Value.AddMinutes(x.t.SlaMinutes)))
            .Select(x => new RoomTimingRow(x.r.Id, x.r.RoomNumber, x.r.Floor, x.t.Name, x.t.SlaMinutes, x.r.Status,
                x.r.SelfMarked, x.r.CheckedOutAt, x.r.ReadyAt, x.r.OutOfOrderReason, x.r.ExpectedReturnAt))
            .ToListAsync();
    }

    public Task<RoomTimingRow?> GetRoomTimingAsync(int roomId) =>
        _db.Rooms.AsNoTracking()
            .Where(r => r.Id == roomId)
            .Join(_db.RoomTypes.AsNoTracking(), r => r.RoomTypeId, t => t.Id,
                (r, t) => new RoomTimingRow(r.Id, r.RoomNumber, r.Floor, t.Name, t.SlaMinutes, r.Status, r.SelfMarked,
                    r.CheckedOutAt, r.ReadyAt, r.OutOfOrderReason, r.ExpectedReturnAt))
            .FirstOrDefaultAsync();

    public Task<List<FloorAssignmentRow>> ListFloorAssignmentsAsync(int hotelId) =>
        _db.HousekeeperFloors.AsNoTracking()
            .Where(f => f.HotelId == hotelId)
            .Join(_db.Users.AsNoTracking(), f => f.UserId, u => u.Id,
                (f, u) => new FloorAssignmentRow(f.Floor, u.Id, u.DisplayName))
            .OrderBy(x => x.Floor)
            .ToListAsync();

    public Task<List<int>> ListRoomFloorsAsync(int hotelId) =>
        _db.Rooms.AsNoTracking().Where(r => r.HotelId == hotelId).Select(r => r.Floor).Distinct().ToListAsync();

    public Task<List<HousekeeperFloor>> ListTrackedFloorRowsAsync(int hotelId) =>
        _db.HousekeeperFloors.Where(f => f.HotelId == hotelId).ToListAsync();

    public Task<UserRef?> GetUserRefAsync(int userId) =>
        _db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new UserRef(u.Id, u.HotelId, u.Role, u.DisplayName))
            .FirstOrDefaultAsync();

    public Task<List<UserRef>> ListUserRefsAsync(IReadOnlyCollection<int> userIds) =>
        _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .Select(u => new UserRef(u.Id, u.HotelId, u.Role, u.DisplayName))
            .ToListAsync();

    public void AddFloorRow(HousekeeperFloor row) => _db.HousekeeperFloors.Add(row);
    public void RemoveFloorRow(HousekeeperFloor row) => _db.HousekeeperFloors.Remove(row);

    public async Task SaveFloorChangesAsync()
    {
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (DbSave.IsDuplicateKey(ex))
        {
            throw new ConflictException("Floor assignments changed while you were saving. Reload and try again.");
        }
    }

    public Task<Room?> GetRoomAsync(int roomId) => _db.Rooms.FirstOrDefaultAsync(r => r.Id == roomId);

    public void AddHistory(RoomStatusEvent ev) => _db.RoomStatusHistory.Add(ev);

    public Task SaveRoomChangeAsync() =>
        DbSave.SaveAsync(_db, "Room changed since it was read. Reload and try again.");

    public Task<bool> CheckoutEventExistsAsync(string bookingRef, DateTime checkedOutAt) =>
        _db.CheckoutEvents.AsNoTracking().AnyAsync(e => e.BookingRef == bookingRef && e.CheckedOutAt == checkedOutAt);

    public void AddCheckoutEvent(CheckoutEvent checkoutEvent) => _db.CheckoutEvents.Add(checkoutEvent);

    public async Task<bool> TrySaveCheckoutAsync()
    {
        try
        {
            await _db.SaveChangesAsync();
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflictException("The room or booking changed while the checkout was being recorded. Retrying.");
        }
        catch (DbUpdateException ex) when (DbSave.IsDuplicateKey(ex))
        {
            return false;
        }
    }

    public void DetachAll() => _db.ChangeTracker.Clear();
}
