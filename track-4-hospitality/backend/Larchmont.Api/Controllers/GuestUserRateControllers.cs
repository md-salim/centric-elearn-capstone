using Larchmont.Api.Dtos;
using Larchmont.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Larchmont.Api.Controllers;

[ApiController]
[Route("api/guests")]
public class GuestsController : ControllerBase
{
    private readonly IGuestService _guests;
    private readonly IBookingService _bookings;

    public GuestsController(IGuestService guests, IBookingService bookings)
    {
        _guests = guests;
        _bookings = bookings;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<GuestDto>>> Search([FromQuery] string? q, [FromQuery] string? region,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50) =>
        await _guests.SearchAsync(q, region, page, pageSize);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<GuestDto>> Get(int id) => await _guests.GetAsync(id);

    [HttpPost]
    public async Task<ActionResult<GuestDto>> Create(GuestRequest request)
    {
        var created = await _guests.CreateAsync(request);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<GuestDto>> Update(int id, GuestRequest request) => await _guests.UpdateAsync(id, request);

    [HttpGet("{id:int}/bookings")]
    public async Task<ActionResult<List<BookingDto>>> Bookings(int id) => await _bookings.ListForGuestAsync(id);
}

[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
    private readonly IUserService _users;
    public UsersController(IUserService users) => _users = users;

    [HttpGet]
    public async Task<ActionResult<List<UserPublicDto>>> List([FromQuery] int? hotelId, [FromQuery] string? role) =>
        await _users.ListAsync(hotelId, role);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<UserPublicDto>> Get(int id) => await _users.GetAsync(id);

    [HttpPost]
    public async Task<ActionResult<UserPublicDto>> Create(UserRequest request)
    {
        var created = await _users.CreateAsync(request);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<UserPublicDto>> Update(int id, UserUpdateRequest request) => await _users.UpdateAsync(id, request);
}

[ApiController]
[Route("api")]
public class RatesController : ControllerBase
{
    private readonly IRateService _rates;
    public RatesController(IRateService rates) => _rates = rates;

    [HttpGet("rate-plans")]
    public async Task<ActionResult<List<RatePlanDto>>> Plans() => await _rates.ListPlansAsync();

    [HttpGet("rates")]
    public async Task<ActionResult<List<RoomRateDto>>> List([FromQuery] int? hotelId, [FromQuery] int? roomTypeId) =>
        await _rates.ListRatesAsync(hotelId, roomTypeId);

    [HttpPost("rates")]
    public async Task<ActionResult<RoomRateDto>> Create(RoomRateRequest request) => await _rates.CreateRateAsync(request);

    [HttpPut("rates/{id:int}")]
    public async Task<ActionResult<RoomRateDto>> Update(int id, RoomRateRequest request) => await _rates.UpdateRateAsync(id, request);

    [HttpGet("rates/quote")]
    public async Task<ActionResult<QuoteDto>> Quote([FromQuery] int hotelId, [FromQuery] int roomTypeId, [FromQuery] int ratePlanId,
        [FromQuery] DateOnly checkIn, [FromQuery] DateOnly checkOut) =>
        await _rates.QuoteAsync(hotelId, roomTypeId, ratePlanId, checkIn, checkOut);
}
