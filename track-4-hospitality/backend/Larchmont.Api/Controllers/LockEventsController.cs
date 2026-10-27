using Larchmont.Api.Dtos;
using Larchmont.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Larchmont.Api.Controllers;

[ApiController]
[Route("api/lock-events")]
public class LockEventsController : ControllerBase
{
    private readonly ILockEventService _lockEvents;
    public LockEventsController(ILockEventService lockEvents) => _lockEvents = lockEvents;

    /// <summary>
    /// Key-card checkout from the lock system. The signature is checked over the raw body, so the body is read as bytes
    /// before any binding. Requires header X-Signature: sha256=&lt;hex HMAC-SHA256&gt;.
    /// </summary>
    [HttpPost("checkout")]
    public async Task<ActionResult<LockCheckoutResultDto>> Checkout(CancellationToken ct)
    {
        Request.EnableBuffering();
        using var buffer = new MemoryStream();
        await Request.Body.CopyToAsync(buffer, ct);
        Request.Body.Position = 0;

        var signature = Request.Headers["X-Signature"].FirstOrDefault();
        return await _lockEvents.HandleCheckoutAsync(buffer.ToArray(), signature);
    }
}
