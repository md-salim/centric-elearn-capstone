namespace Larchmont.Api.Domain;

/// <summary>
/// Turnaround arithmetic (BR-07 to BR-09, BR-16). Pure: the caller supplies the clock.
/// Stored times are UTC and whole seconds.
/// </summary>
public static class Turnaround
{
    /// <summary>The target: checkout plus the room type's SLA. Null when no checkout time is known.</summary>
    public static DateTime? DueAt(DateTime? checkedOutAt, int slaMinutes) => checkedOutAt?.AddMinutes(slaMinutes);

    /// <summary>When the turnaround stopped: the ready time for a Ready room, otherwise now.</summary>
    public static DateTime? EndAt(string status, DateTime? readyAt, DateTime now) =>
        status == RoomStatuses.Ready ? readyAt : now;

    /// <summary>
    /// Whole minutes over the target, rounded up. Exactly on target is 0 (not late).
    /// 46:00 past a 45 minute target is 1; 45:01 past is also 1.
    /// </summary>
    public static int MinutesOver(DateTime due, DateTime end)
    {
        var seconds = (end - due).TotalSeconds;
        return seconds <= 0 ? 0 : (int)Math.Ceiling(seconds / 60);
    }

    /// <summary>Truncate to whole seconds. The lock system's sub-second part is dropped (db-analysis 3.2).</summary>
    public static DateTime ToWholeSeconds(DateTime value) =>
        new(value.Ticks - value.Ticks % TimeSpan.TicksPerSecond, value.Kind);

    /// <summary>Stored DATETIME values come back with Kind Unspecified. They are UTC, so mark them so JSON gets a Z.</summary>
    public static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? AsUtc(DateTime? value) => value.HasValue ? AsUtc(value.Value) : null;
}
