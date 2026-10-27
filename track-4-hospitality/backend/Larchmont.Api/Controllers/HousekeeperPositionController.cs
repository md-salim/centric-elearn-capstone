using Microsoft.AspNetCore.Mvc;

namespace Larchmont.Api.Controllers;

/// <summary>
/// Deliberate stub (BR-17). Live housekeeper position is not implemented. See docs/privacy-note.md.
/// Always 501. Nothing is looked up, bound, stored or logged.
/// </summary>
[ApiController]
[Route("api/housekeepers")]
public class HousekeeperPositionController : ControllerBase
{
    private const string Detail =
        "Live housekeeper position is deliberately not implemented. See docs/privacy-note.md for the rationale and the proposed scoped alternative.";

    [HttpGet("{id}/position")]
    public IActionResult GetPosition(string id) => NotImplementedProblem();

    [HttpPost("{id}/position")]
    public IActionResult PostPosition(string id) => NotImplementedProblem();

    private ObjectResult NotImplementedProblem() =>
        StatusCode(StatusCodes.Status501NotImplemented, new ProblemDetails
        {
            Status = StatusCodes.Status501NotImplemented,
            Title = "Not implemented",
            Detail = Detail
        });
}
