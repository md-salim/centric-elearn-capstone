namespace Larchmont.Api.Domain;

public class Hotel
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string City { get; set; } = "";
    public string Region { get; set; } = "";
    public string AddressLine { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool Active { get; set; } = true;
}

public class RoomType
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public int MaxOccupancy { get; set; }
    public decimal BaseRate { get; set; }
    /// <summary>Turnaround target in minutes from checkout (BR-07). Column sla_minutes.</summary>
    public int SlaMinutes { get; set; } = 45;
}

public class RatePlan
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal DiscountPct { get; set; }
    public bool RequiresPrepayment { get; set; }
}

public class RoomRate
{
    public int Id { get; set; }
    public int HotelId { get; set; }
    public int RoomTypeId { get; set; }
    public int RatePlanId { get; set; }
    public DateOnly ValidFrom { get; set; }
    public DateOnly ValidTo { get; set; }
    public decimal NightlyRate { get; set; }
}

public class Room
{
    public int Id { get; set; }
    public int HotelId { get; set; }
    public int RoomTypeId { get; set; }
    public string RoomNumber { get; set; } = "";
    public int Floor { get; set; }
    public string Status { get; set; } = RoomStatuses.Ready;
    public string? Notes { get; set; }
    /// <summary>True when a housekeeper moved Cleaning to Ready themselves (BR-04). Column self_marked.</summary>
    public bool SelfMarked { get; set; }
    /// <summary>Earliest guest checkout timestamp, UTC, whole seconds. The clock start (BR-08). Column checked_out_at.</summary>
    public DateTime? CheckedOutAt { get; set; }
    /// <summary>When the room last became Ready, UTC. Cleared when it leaves Ready. Column ready_at.</summary>
    public DateTime? ReadyAt { get; set; }
    /// <summary>Reason the room is out of order. Column ooo_reason.</summary>
    public string? OutOfOrderReason { get; set; }
    /// <summary>Expected return from out of order, UTC, if known. Column expected_return_at.</summary>
    public DateTime? ExpectedReturnAt { get; set; }
    /// <summary>Optimistic concurrency token, bumped on every save. Column row_version.</summary>
    public int RowVersion { get; set; }
}

public static class RoomStatuses
{
    public const string Dirty = "Dirty";
    public const string Cleaning = "Cleaning";
    public const string Inspected = "Inspected";
    public const string Ready = "Ready";
    public const string OutOfOrder = "OutOfOrder";
    public static readonly string[] All = { Dirty, Cleaning, Inspected, Ready, OutOfOrder };
}

public static class CheckoutSources
{
    public const string Lock = "Lock";
    public const string Desk = "Desk";
}

public class RoomStatusEvent
{
    public long Id { get; set; }
    public int RoomId { get; set; }
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = "";
    public int? ChangedByUserId { get; set; }
    public DateTime ChangedAt { get; set; }
    /// <summary>True for a Cleaning to Ready self-mark (BR-04). Column self_marked.</summary>
    public bool SelfMarked { get; set; }
    /// <summary>Reason given for the move, for example the out of order reason. Column reason.</summary>
    public string? Reason { get; set; }
    /// <summary>Role of the caller, from the placeholder X-User-Role header. Column by_user_role.</summary>
    public string? ByUserRole { get; set; }
}

/// <summary>A housekeeper assigned to one floor of one hotel (BR-10). Column names match housekeeper_floors.</summary>
public class HousekeeperFloor
{
    public int HotelId { get; set; }
    public int Floor { get; set; }
    public int UserId { get; set; }
}

/// <summary>A checkout seen by the lock system or the desk. Column names match checkout_events.</summary>
public class CheckoutEvent
{
    public long Id { get; set; }
    public int BookingId { get; set; }
    public string BookingRef { get; set; } = "";
    public int RoomId { get; set; }
    public DateTime CheckedOutAt { get; set; }
    public string Source { get; set; } = CheckoutSources.Lock;
    public DateTime ReceivedAt { get; set; }
}

public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "";
    public int? HotelId { get; set; }
    public string PasswordHash { get; set; } = "";
    public bool Active { get; set; } = true;
    public string? Phone { get; set; }
    public DateTime? LastLoginAt { get; set; }
}

public class Guest
{
    public int Id { get; set; }
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AddressLine { get; set; } = "";
    public string City { get; set; } = "";
    public string Postcode { get; set; } = "";
    public string Country { get; set; } = "GB";
    public string Region { get; set; } = "";
    public string LoyaltyTier { get; set; } = "None";
    public DateTime CreatedAt { get; set; }
}

public static class BookingStatuses
{
    public const string Confirmed = "Confirmed";
    public const string CheckedIn = "CheckedIn";
    public const string CheckedOut = "CheckedOut";
    public const string Cancelled = "Cancelled";
    public const string NoShow = "NoShow";
    public static readonly string[] All = { Confirmed, CheckedIn, CheckedOut, Cancelled, NoShow };
    public static readonly string[] Staying = { Confirmed, CheckedIn, CheckedOut };
}

public class Booking
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
    public string? ExternalRef { get; set; }
    public string Channel { get; set; } = "Direct";
    public int HotelId { get; set; }
    public int GuestId { get; set; }
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public int RatePlanId { get; set; }
    public DateOnly CheckIn { get; set; }
    public DateOnly CheckOut { get; set; }
    public int Adults { get; set; }
    public string Status { get; set; } = BookingStatuses.Confirmed;
    public decimal TotalAmount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    /// <summary>Optimistic concurrency token, bumped on every save. Column row_version.</summary>
    public int RowVersion { get; set; }
    public int Nights => CheckOut.DayNumber - CheckIn.DayNumber;
}

public class BookingNote
{
    public int Id { get; set; }
    public int BookingId { get; set; }
    public int? AuthorUserId { get; set; }
    public string Note { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
