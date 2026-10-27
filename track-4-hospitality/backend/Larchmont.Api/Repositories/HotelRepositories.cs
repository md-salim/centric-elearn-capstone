using Larchmont.Api.Data;
using Larchmont.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Larchmont.Api.Repositories;

public interface IHotelRepository
{
    Task<List<Hotel>> ListAsync();
    Task<Hotel?> GetAsync(int id);
    Task<Hotel?> GetByCodeAsync(string code);
    Task AddAsync(Hotel hotel);
    Task SaveAsync();
}

public class HotelRepository : IHotelRepository
{
    private readonly LarchmontDbContext _db;
    public HotelRepository(LarchmontDbContext db) => _db = db;

    public Task<List<Hotel>> ListAsync() => _db.Hotels.OrderBy(h => h.Name).ToListAsync();
    public Task<Hotel?> GetAsync(int id) => _db.Hotels.FirstOrDefaultAsync(h => h.Id == id);
    public Task<Hotel?> GetByCodeAsync(string code) => _db.Hotels.FirstOrDefaultAsync(h => h.Code == code);
    public async Task AddAsync(Hotel hotel) { _db.Hotels.Add(hotel); await _db.SaveChangesAsync(); }
    public Task SaveAsync() => _db.SaveChangesAsync();
}

public interface IRoomTypeRepository
{
    Task<List<RoomType>> ListAsync();
    Task<RoomType?> GetAsync(int id);
    Task<RoomType?> GetByCodeAsync(string code);
    Task AddAsync(RoomType type);
    Task SaveAsync();
}

public class RoomTypeRepository : IRoomTypeRepository
{
    private readonly LarchmontDbContext _db;
    public RoomTypeRepository(LarchmontDbContext db) => _db = db;

    public Task<List<RoomType>> ListAsync() => _db.RoomTypes.OrderBy(t => t.Id).ToListAsync();
    public Task<RoomType?> GetAsync(int id) => _db.RoomTypes.FirstOrDefaultAsync(t => t.Id == id);
    public Task<RoomType?> GetByCodeAsync(string code) => _db.RoomTypes.FirstOrDefaultAsync(t => t.Code == code);
    public async Task AddAsync(RoomType type) { _db.RoomTypes.Add(type); await _db.SaveChangesAsync(); }
    public Task SaveAsync() => _db.SaveChangesAsync();
}

public interface IRoomRepository
{
    Task<List<Room>> ListAsync(int? hotelId, string? status, int? floor);
    Task<Room?> GetAsync(int id);
    Task<int> CountForHotelAsync(int? hotelId);
    Task AddAsync(Room room);
    Task AddStatusEventAsync(RoomStatusEvent ev);
    /// <summary>Marks the room's version as changed even when no room column changes, so a concurrent write to the room conflicts.</summary>
    void BumpVersion(Room room);
    Task SaveAsync();
}

public class RoomRepository : IRoomRepository
{
    private readonly LarchmontDbContext _db;
    public RoomRepository(LarchmontDbContext db) => _db = db;

    public Task<List<Room>> ListAsync(int? hotelId, string? status, int? floor)
    {
        var q = _db.Rooms.AsQueryable();
        if (hotelId.HasValue) q = q.Where(r => r.HotelId == hotelId);
        if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
        if (floor.HasValue) q = q.Where(r => r.Floor == floor);
        return q.OrderBy(r => r.HotelId).ThenBy(r => r.RoomNumber).ToListAsync();
    }

    public Task<Room?> GetAsync(int id) => _db.Rooms.FirstOrDefaultAsync(r => r.Id == id);

    public Task<int> CountForHotelAsync(int? hotelId) =>
        hotelId.HasValue ? _db.Rooms.CountAsync(r => r.HotelId == hotelId) : _db.Rooms.CountAsync();

    public async Task AddAsync(Room room) { _db.Rooms.Add(room); await _db.SaveChangesAsync(); }
    public Task AddStatusEventAsync(RoomStatusEvent ev) { _db.RoomStatusHistory.Add(ev); return Task.CompletedTask; }

    public void BumpVersion(Room room) => _db.Entry(room).Property(r => r.RowVersion).IsModified = true;

    public Task SaveAsync() => DbSave.SaveAsync(_db, "Room changed since it was read. Reload and try again.");
}
