using FluentValidation;
using Larchmont.Api.Domain;
using Larchmont.Api.Dtos;
using Larchmont.Api.Infrastructure;
using Larchmont.Api.Mappers;
using Larchmont.Api.Repositories;

namespace Larchmont.Api.Services;

public interface IGuestService
{
    Task<PagedResult<GuestDto>> SearchAsync(string? q, string? region, int page, int pageSize);
    Task<GuestDto> GetAsync(int id);
    Task<GuestDto> CreateAsync(GuestRequest request);
    Task<GuestDto> UpdateAsync(int id, GuestRequest request);
}

public class GuestService : IGuestService
{
    private readonly IGuestRepository _guests;
    private readonly IValidator<GuestRequest> _validator;

    public GuestService(IGuestRepository guests, IValidator<GuestRequest> validator)
    {
        _guests = guests;
        _validator = validator;
    }

    public async Task<PagedResult<GuestDto>> SearchAsync(string? q, string? region, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var (items, total) = await _guests.SearchAsync(q, region, page, pageSize);
        return new PagedResult<GuestDto>(items.Select(g => g.ToDto()).ToList(), page, pageSize, total);
    }

    public async Task<GuestDto> GetAsync(int id) =>
        (await _guests.GetAsync(id) ?? throw new NotFoundException($"Guest {id} not found.")).ToDto();

    public async Task<GuestDto> CreateAsync(GuestRequest request)
    {
        await _validator.ValidateAndThrowAsync(request);
        var guest = new Guest { CreatedAt = DateTime.UtcNow };
        guest.Apply(request);
        await _guests.AddAsync(guest);
        return guest.ToDto();
    }

    public async Task<GuestDto> UpdateAsync(int id, GuestRequest request)
    {
        await _validator.ValidateAndThrowAsync(request);
        var guest = await _guests.GetAsync(id) ?? throw new NotFoundException($"Guest {id} not found.");
        guest.Apply(request);
        await _guests.SaveAsync();
        return guest.ToDto();
    }
}

public interface IUserService
{
    Task<List<UserPublicDto>> ListAsync(int? hotelId, string? role);
    Task<UserPublicDto> GetAsync(int id);
    Task<UserPublicDto> CreateAsync(UserRequest request);
    Task<UserPublicDto> UpdateAsync(int id, UserUpdateRequest request);
}

public class UserService : IUserService
{
    private readonly IUserRepository _users;
    private readonly IValidator<UserRequest> _validator;

    public UserService(IUserRepository users, IValidator<UserRequest> validator)
    {
        _users = users;
        _validator = validator;
    }

    public async Task<List<UserPublicDto>> ListAsync(int? hotelId, string? role) =>
        (await _users.ListAsync(hotelId, role)).Select(u => u.ToPublicDto()).ToList();

    public async Task<UserPublicDto> GetAsync(int id) =>
        (await _users.GetAsync(id) ?? throw new NotFoundException($"User {id} not found.")).ToPublicDto();

    public async Task<UserPublicDto> CreateAsync(UserRequest request)
    {
        await _validator.ValidateAndThrowAsync(request);
        if (await _users.GetByEmailAsync(request.Email.Trim()) != null)
            throw new ConflictException("A user with that email already exists.");
        var user = new User
        {
            Email = request.Email.Trim(),
            DisplayName = request.DisplayName.Trim(),
            Role = request.Role,
            HotelId = request.HotelId,
            Phone = request.Phone,
            PasswordHash = PasswordHasher.Hash(request.Password)
        };
        await _users.AddAsync(user);
        return user.ToPublicDto();
    }

    public async Task<UserPublicDto> UpdateAsync(int id, UserUpdateRequest request)
    {
        var user = await _users.GetAsync(id) ?? throw new NotFoundException($"User {id} not found.");
        user.DisplayName = request.DisplayName.Trim();
        user.Role = request.Role;
        user.HotelId = request.HotelId;
        user.Active = request.Active;
        user.Phone = request.Phone;
        await _users.SaveAsync();
        return user.ToPublicDto();
    }
}

public interface IRateService
{
    Task<List<RatePlanDto>> ListPlansAsync();
    Task<List<RoomRateDto>> ListRatesAsync(int? hotelId, int? roomTypeId);
    Task<RoomRateDto> CreateRateAsync(RoomRateRequest request);
    Task<RoomRateDto> UpdateRateAsync(int id, RoomRateRequest request);
    Task<QuoteDto> QuoteAsync(int hotelId, int roomTypeId, int ratePlanId, DateOnly checkIn, DateOnly checkOut);
}

public class RateService : IRateService
{
    private readonly IRateRepository _rates;
    private readonly IValidator<RoomRateRequest> _validator;

    public RateService(IRateRepository rates, IValidator<RoomRateRequest> validator)
    {
        _rates = rates;
        _validator = validator;
    }

    public async Task<List<RatePlanDto>> ListPlansAsync() => (await _rates.ListPlansAsync()).Select(p => p.ToDto()).ToList();

    public async Task<List<RoomRateDto>> ListRatesAsync(int? hotelId, int? roomTypeId) =>
        (await _rates.ListRatesAsync(hotelId, roomTypeId)).Select(r => r.ToDto()).ToList();

    public async Task<RoomRateDto> CreateRateAsync(RoomRateRequest request)
    {
        await _validator.ValidateAndThrowAsync(request);
        var rate = new RoomRate();
        Apply(rate, request);
        await _rates.AddRateAsync(rate);
        return rate.ToDto();
    }

    public async Task<RoomRateDto> UpdateRateAsync(int id, RoomRateRequest request)
    {
        await _validator.ValidateAndThrowAsync(request);
        var rate = await _rates.GetRateAsync(id) ?? throw new NotFoundException($"Rate {id} not found.");
        Apply(rate, request);
        await _rates.SaveAsync();
        return rate.ToDto();
    }

    public async Task<QuoteDto> QuoteAsync(int hotelId, int roomTypeId, int ratePlanId, DateOnly checkIn, DateOnly checkOut)
    {
        if (checkOut <= checkIn) throw new BusinessRuleException("Check-out must be after check-in.");
        var rate = await _rates.FindRateAsync(hotelId, roomTypeId, ratePlanId, checkIn)
            ?? throw new NotFoundException("No rate is loaded for that hotel, room type, rate plan and date.");
        var nights = checkOut.DayNumber - checkIn.DayNumber;
        return new QuoteDto(hotelId, roomTypeId, ratePlanId, nights, rate.NightlyRate, rate.NightlyRate * nights);
    }

    private static void Apply(RoomRate rate, RoomRateRequest r)
    {
        rate.HotelId = r.HotelId;
        rate.RoomTypeId = r.RoomTypeId;
        rate.RatePlanId = r.RatePlanId;
        rate.ValidFrom = r.ValidFrom;
        rate.ValidTo = r.ValidTo;
        rate.NightlyRate = r.NightlyRate;
    }
}
