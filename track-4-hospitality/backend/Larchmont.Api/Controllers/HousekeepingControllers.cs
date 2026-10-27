using Larchmont.Api.Dtos;
using Larchmont.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Larchmont.Api.Controllers;

/// <summary>
/// Housekeeping board, late rooms and floor assignments for a hotel.
/// X-User-Role is a placeholder for the caller's role until login exists (spec Q9). It is recorded in history only.
/// </summary>
[ApiController]
[Route("api/hotels")]
public class HousekeepingBoardController : ControllerBase
{
    private readonly IHousekeepingService _housekeeping;
    public HousekeepingBoardController(IHousekeepingService housekeeping) => _housekeeping = housekeeping;

    [HttpGet("{id:int}/board")]
    public async Task<ActionResult<BoardDto>> Board(int id, [FromQuery] int? floor) =>
        await _housekeeping.GetBoardAsync(id, floor);

    [HttpGet("{id:int}/late-rooms")]
    public async Task<ActionResult<List<LateRoomDto>>> LateRooms(int id) =>
        await _housekeeping.GetLateRoomsAsync(id);

    /// <summary>Alias of late-rooms, same result.</summary>
    [HttpGet("{id:int}/sla-breaches")]
    public async Task<ActionResult<List<LateRoomDto>>> SlaBreaches(int id) =>
        await _housekeeping.GetLateRoomsAsync(id);

    [HttpGet("{id:int}/floor-assignments")]
    public async Task<ActionResult<List<FloorAssignmentDto>>> GetFloorAssignments(int id) =>
        await _housekeeping.GetFloorAssignmentsAsync(id);

    [HttpPut("{id:int}/floor-assignments")]
    public async Task<ActionResult<List<FloorAssignmentDto>>> PutFloorAssignments(int id, FloorAssignmentsRequest request) =>
        await _housekeeping.ReplaceFloorAssignmentsAsync(id, request);
}

/// <summary>Room state moves. These replace the free-form status write, which now goes through the same rules.</summary>
[ApiController]
[Route("api/rooms")]
public class RoomTransitionsController : ControllerBase
{
    private readonly IHousekeepingService _housekeeping;
    public RoomTransitionsController(IHousekeepingService housekeeping) => _housekeeping = housekeeping;

    [HttpPost("{id:int}/transitions")]
    public async Task<ActionResult<BoardRoomDto>> Transition(int id, RoomTransitionRequest request) =>
        await _housekeeping.TransitionAsync(id, request, RoleHeader());

    [HttpPost("{id:int}/out-of-order")]
    public async Task<ActionResult<BoardRoomDto>> OutOfOrder(int id, OutOfOrderRequest request) =>
        await _housekeeping.OutOfOrderAsync(id, request, RoleHeader());

    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<RoomDto>> SetStatus(int id, RoomStatusRequest request) =>
        await _housekeeping.SetStatusAsync(id, request, RoleHeader());

    [HttpGet("{id:int}/ready-by")]
    public async Task<ActionResult<ReadyByDto>> ReadyBy(int id) => await _housekeeping.GetReadyByAsync(id);

    private string? RoleHeader() => Request.Headers["X-User-Role"].FirstOrDefault();
}

[ApiController]
[Route("api/housekeepers")]
public class HousekeeperFloorsController : ControllerBase
{
    private readonly IHousekeepingService _housekeeping;
    public HousekeeperFloorsController(IHousekeepingService housekeeping) => _housekeeping = housekeeping;

    [HttpPost("{id:int}/floors")]
    public async Task<ActionResult<HousekeeperFloorsDto>> AssignFloors(int id, AssignHousekeeperFloorsRequest request) =>
        await _housekeeping.AssignHousekeeperFloorsAsync(id, request);
}
