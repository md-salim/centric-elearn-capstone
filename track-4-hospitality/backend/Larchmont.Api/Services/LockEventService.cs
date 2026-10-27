using System.Text.Json;
using FluentValidation;
using Larchmont.Api.Domain;
using Larchmont.Api.Dtos;
using Larchmont.Api.Infrastructure;
using Larchmont.Api.Repositories;

namespace Larchmont.Api.Services;

public interface ILockEventService
{
    /// <summary>Verifies the signature over the raw body, then records the checkout. Order: 401, 400, 404, 422.</summary>
    Task<LockCheckoutResultDto> HandleCheckoutAsync(byte[] rawBody, string? signatureHeader);
}

public class LockEventService : ILockEventService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ILockSignatureVerifier _verifier;
    private readonly IRoomRepository _rooms;
    private readonly IBookingRepository _bookings;
    private readonly IHousekeepingService _housekeeping;
    private readonly IValidator<LockCheckoutRequest> _validator;

    public LockEventService(ILockSignatureVerifier verifier, IRoomRepository rooms, IBookingRepository bookings,
        IHousekeepingService housekeeping, IValidator<LockCheckoutRequest> validator)
    {
        _verifier = verifier;
        _rooms = rooms;
        _bookings = bookings;
        _housekeeping = housekeeping;
        _validator = validator;
    }

    public async Task<LockCheckoutResultDto> HandleCheckoutAsync(byte[] rawBody, string? signatureHeader)
    {
        // Fail closed: no secret, a missing header or a wrong signature all stop here, before the body is parsed.
        if (!_verifier.IsValid(rawBody, signatureHeader))
            throw new UnauthorizedException("The request signature is missing or invalid.");

        LockCheckoutRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<LockCheckoutRequest>(rawBody, JsonOptions);
        }
        catch (JsonException)
        {
            throw new InvalidRequestException("The checkout event is not valid JSON.");
        }
        if (request is null) throw new InvalidRequestException("The checkout event is empty.");
        await _validator.ValidateAndThrowAsync(request);

        var room = await _rooms.GetAsync(request.RoomId) ?? throw new NotFoundException($"Room {request.RoomId} not found.");
        var booking = await _bookings.GetByReferenceAsync(request.BookingRef!.Trim())
            ?? throw new NotFoundException($"Booking reference {request.BookingRef} not found.");
        if (booking.RoomId != room.Id)
            throw new BusinessRuleException($"Booking {booking.Reference} is not assigned to room {room.RoomNumber}.");

        var outcome = await _housekeeping.RecordLockCheckoutAsync(booking.Id, request.CheckedOutAt!.Value.UtcDateTime);
        return new LockCheckoutResultDto(outcome.RoomId ?? room.Id, outcome.Status ?? room.Status, outcome.Duplicate);
    }
}
