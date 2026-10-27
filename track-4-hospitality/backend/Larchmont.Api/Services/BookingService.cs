using FluentValidation;
using Larchmont.Api.Domain;
using Larchmont.Api.Dtos;
using Larchmont.Api.Infrastructure;
using Larchmont.Api.Mappers;
using Larchmont.Api.Repositories;

namespace Larchmont.Api.Services;

public interface IBookingService
{
    Task<PagedResult<BookingDto>> SearchAsync(BookingFilter filter);
    Task<BookingDto> GetAsync(int id);
    Task<List<BookingDto>> ListForGuestAsync(int guestId);
    Task<BookingDto> CreateAsync(BookingRequest request);
    Task<BookingDto> UpdateAsync(int id, BookingUpdateRequest request);
    Task<CancelResultDto> CancelAsync(int id);
    Task<BookingDto> CheckInAsync(int id);
    Task<BookingDto> CheckOutAsync(int id);
    Task<BookingDto> AssignRoomAsync(int id, AssignRoomRequest request);
    Task<List<BookingNoteDto>> ListNotesAsync(int id);
    Task<BookingNoteDto> AddNoteAsync(int id, BookingNoteRequest request);
}

public class BookingService : IBookingService
{
    private readonly IBookingRepository _bookings;
    private readonly IGuestRepository _guests;
    private readonly IHotelRepository _hotels;
    private readonly IRoomTypeRepository _types;
    private readonly IRoomRepository _rooms;
    private readonly IRateRepository _rates;
    private readonly IValidator<BookingRequest> _validator;
    private readonly IValidator<BookingUpdateRequest> _updateValidator;
    private readonly IValidator<BookingNoteRequest> _noteValidator;
    private readonly IHousekeepingService? _housekeeping;

    public BookingService(IBookingRepository bookings, IGuestRepository guests, IHotelRepository hotels,
        IRoomTypeRepository types, IRoomRepository rooms, IRateRepository rates,
        IValidator<BookingRequest> validator, IValidator<BookingUpdateRequest> updateValidator,
        IValidator<BookingNoteRequest> noteValidator, IHousekeepingService? housekeeping = null)
    {
        _bookings = bookings;
        _guests = guests;
        _hotels = hotels;
        _types = types;
        _rooms = rooms;
        _rates = rates;
        _validator = validator;
        _updateValidator = updateValidator;
        _noteValidator = noteValidator;
        _housekeeping = housekeeping;
    }

    public async Task<PagedResult<BookingDto>> SearchAsync(BookingFilter filter)
    {
        var page = Math.Max(filter.Page, 1);
        var pageSize = Math.Clamp(filter.PageSize, 1, 200);
        var (items, total) = await _bookings.SearchAsync(filter with { Page = page, PageSize = pageSize });
        var dtos = new List<BookingDto>();
        foreach (var b in items) dtos.Add(await ToDtoAsync(b));
        return new PagedResult<BookingDto>(dtos, page, pageSize, total);
    }

    public async Task<BookingDto> GetAsync(int id) => await ToDtoAsync(await LoadAsync(id));

    public async Task<List<BookingDto>> ListForGuestAsync(int guestId)
    {
        if (await _guests.GetAsync(guestId) == null) throw new NotFoundException($"Guest {guestId} not found.");
        var dtos = new List<BookingDto>();
        foreach (var b in await _bookings.ListForGuestAsync(guestId)) dtos.Add(await ToDtoAsync(b));
        return dtos;
    }

    public async Task<BookingDto> CreateAsync(BookingRequest request)
    {
        await _validator.ValidateAndThrowAsync(request);
        var guest = await _guests.GetAsync(request.GuestId) ?? throw new NotFoundException($"Guest {request.GuestId} not found.");
        var hotel = await _hotels.GetAsync(request.HotelId) ?? throw new NotFoundException($"Hotel {request.HotelId} not found.");
        var type = await _types.GetAsync(request.RoomTypeId) ?? throw new NotFoundException($"Room type {request.RoomTypeId} not found.");
        if (request.Adults > type.MaxOccupancy)
            throw new BusinessRuleException($"{type.Name} sleeps at most {type.MaxOccupancy}.");
        var rate = await _rates.FindRateAsync(hotel.Id, type.Id, request.RatePlanId, request.CheckIn)
            ?? throw new BusinessRuleException("No rate is loaded for that room type and rate plan on the check-in date.");
        var nights = request.CheckOut.DayNumber - request.CheckIn.DayNumber;
        var now = DateTime.UtcNow;
        var booking = new Booking
        {
            Reference = $"LH-{await _bookings.NextReferenceNumberAsync()}",
            Channel = string.IsNullOrWhiteSpace(request.Channel) ? "Direct" : request.Channel,
            HotelId = hotel.Id,
            GuestId = guest.Id,
            RoomTypeId = type.Id,
            RatePlanId = request.RatePlanId,
            CheckIn = request.CheckIn,
            CheckOut = request.CheckOut,
            Adults = request.Adults,
            Status = BookingStatuses.Confirmed,
            TotalAmount = rate.NightlyRate * nights,
            CreatedAt = now,
            UpdatedAt = now
        };
        await _bookings.AddAsync(booking);
        return await ToDtoAsync(booking);
    }

    public async Task<BookingDto> UpdateAsync(int id, BookingUpdateRequest request)
    {
        await _updateValidator.ValidateAndThrowAsync(request);
        var booking = await LoadAsync(id);
        if (booking.Status != BookingStatuses.Confirmed)
            throw new BusinessRuleException("Only confirmed bookings can be changed.");
        var type = await _types.GetAsync(booking.RoomTypeId);
        if (type != null && request.Adults > type.MaxOccupancy)
            throw new BusinessRuleException($"{type.Name} sleeps at most {type.MaxOccupancy}.");
        var rate = await _rates.FindRateAsync(booking.HotelId, booking.RoomTypeId, booking.RatePlanId, request.CheckIn)
            ?? throw new BusinessRuleException("No rate is loaded for the new dates.");
        booking.CheckIn = request.CheckIn;
        booking.CheckOut = request.CheckOut;
        booking.Adults = request.Adults;
        booking.TotalAmount = rate.NightlyRate * booking.Nights;
        booking.UpdatedAt = DateTime.UtcNow;
        await _bookings.SaveAsync();
        return await ToDtoAsync(booking);
    }

    public async Task<CancelResultDto> CancelAsync(int id)
    {
        var booking = await LoadAsync(id);
        if (booking.Status != BookingStatuses.Confirmed)
            throw new BusinessRuleException($"A {booking.Status} booking cannot be cancelled.");
        var daysToArrival = booking.CheckIn.DayNumber - DateOnly.FromDateTime(DateTime.Now).DayNumber;
        var fee = daysToArrival < 2 ? Math.Round(booking.TotalAmount / booking.Nights, 2) : 0m;
        booking.Status = BookingStatuses.Cancelled;
        booking.RoomId = null;
        booking.UpdatedAt = DateTime.UtcNow;
        await _bookings.AddNoteAsync(new BookingNote
        {
            BookingId = booking.Id,
            Note = fee > 0 ? $"Cancelled inside 2 days of arrival. Fee {fee:0.00}." : "Cancelled by guest.",
            CreatedAt = DateTime.UtcNow
        });
        await _bookings.SaveAsync();
        return new CancelResultDto(booking.Id, booking.Status, fee);
    }

    public async Task<BookingDto> CheckInAsync(int id)
    {
        var booking = await LoadAsync(id);
        if (booking.Status != BookingStatuses.Confirmed)
            throw new BusinessRuleException($"A {booking.Status} booking cannot be checked in.");
        if (booking.RoomId == null) throw new BusinessRuleException("Assign a room before check-in.");
        booking.Status = BookingStatuses.CheckedIn;
        booking.UpdatedAt = DateTime.UtcNow;
        await _bookings.SaveAsync();
        return await ToDtoAsync(booking);
    }

    public async Task<BookingDto> CheckOutAsync(int id)
    {
        var booking = await LoadAsync(id);
        if (booking.Status != BookingStatuses.CheckedIn)
            throw new BusinessRuleException($"A {booking.Status} booking cannot be checked out.");
        // Same path as the lock webhook: room Dirty, checked_out_at set (earliest wins), event recorded, push.
        // Optional in the constructor only so existing callers that build the service by hand still compile.
        // DI always supplies it. Desk checkout cannot run without it.
        var housekeeping = _housekeeping ?? throw new InvalidOperationException("Housekeeping service is not configured for BookingService.");
        await housekeeping.RecordDeskCheckoutAsync(booking.Id);
        return await ToDtoAsync(await LoadAsync(id));
    }

    public async Task<BookingDto> AssignRoomAsync(int id, AssignRoomRequest request)
    {
        var booking = await LoadAsync(id);
        if (booking.Status != BookingStatuses.Confirmed && booking.Status != BookingStatuses.CheckedIn)
            throw new BusinessRuleException($"A {booking.Status} booking cannot be given a room.");
        // Read the room before the overlap check. The room's version is bumped below, so two assigns
        // to the same room serialise on the room row: the loser gets a 409 (AC-25).
        var room = await _rooms.GetAsync(request.RoomId) ?? throw new NotFoundException($"Room {request.RoomId} not found.");
        if (room.HotelId != booking.HotelId) throw new BusinessRuleException("That room belongs to a different hotel.");
        if (room.RoomTypeId != booking.RoomTypeId) throw new BusinessRuleException("That room is a different room type from the one booked.");
        if (room.Status == RoomStatuses.OutOfOrder)
            throw new BusinessRuleException($"Room {room.RoomNumber} is out of order and cannot be assigned.");
        if (await _bookings.RoomHasOverlapAsync(room.Id, booking.Id, booking.CheckIn, booking.CheckOut))
            throw new ConflictException($"Room {room.RoomNumber} is already taken for those dates.");
        _rooms.BumpVersion(room);
        booking.RoomId = room.Id;
        booking.UpdatedAt = DateTime.UtcNow;
        await _bookings.SaveAsync();
        return await ToDtoAsync(booking);
    }

    public async Task<List<BookingNoteDto>> ListNotesAsync(int id)
    {
        await LoadAsync(id);
        return (await _bookings.ListNotesAsync(id)).Select(n => n.ToDto()).ToList();
    }

    public async Task<BookingNoteDto> AddNoteAsync(int id, BookingNoteRequest request)
    {
        await _noteValidator.ValidateAndThrowAsync(request);
        await LoadAsync(id);
        var note = new BookingNote
        {
            BookingId = id,
            AuthorUserId = request.AuthorUserId,
            Note = request.Note.Trim(),
            CreatedAt = DateTime.UtcNow
        };
        await _bookings.AddNoteAsync(note);
        await _bookings.SaveAsync();
        return note.ToDto();
    }

    private async Task<Booking> LoadAsync(int id) =>
        await _bookings.GetAsync(id) ?? throw new NotFoundException($"Booking {id} not found.");

    private async Task<BookingDto> ToDtoAsync(Booking b)
    {
        var guest = await _guests.GetAsync(b.GuestId);
        var hotel = await _hotels.GetAsync(b.HotelId);
        var type = await _types.GetAsync(b.RoomTypeId);
        var room = b.RoomId.HasValue ? await _rooms.GetAsync(b.RoomId.Value) : null;
        return b.ToDto(hotel?.Name ?? "", guest == null ? "" : $"{guest.FirstName} {guest.LastName}", type?.Name ?? "", room?.RoomNumber);
    }
}
